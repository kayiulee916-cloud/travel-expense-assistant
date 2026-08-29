'use strict';

/* =========================================================
 * 设备同步（本地优先 + 局域网服务器中转）
 *
 * - 默认本地运行，开启同步后：
 *   本地有改动 → 定时推送到服务器（rev 递增）
 *   服务器有新版本 → 合并进本地（按 id 并集，绝不互相覆盖）
 * - 合并策略：出差 / 费用 / 附件按 id 做并集合并；
 *   同一实体的空字段用另一端补全；每次推送都打新时间戳。
 * - 已知取舍：合并式同步不传播“删除”操作（删除的出差可能被另一端同步回来）。
 * - 附件（Base64）随整包数据同步
 * ========================================================= */

const SYNC_KEY = 'travelExpenseAssistantSync_v1';
const POLL_MS = 8000;

let syncSettings = {
  enabled: false,
  serverUrl: '',
  lastPushedRev: 0,
  dirty: false,
  localUpdatedAt: 0,
  lastSyncAt: 0
};

let status = {
  connected: false,
  syncing: false,
  lastError: null,
  lastSyncAt: 0,
  serverRev: 0
};

let onStatusChange = null;
let onRemoteUpdate = null;
let pollTimer = null;
let pushing = false;

function syncLoad() {
  try {
    const raw = localStorage.getItem(SYNC_KEY);
    if (raw) syncSettings = Object.assign({}, syncSettings, JSON.parse(raw));
  } catch (err) { console.error('读取同步设置失败', err); }
}

function syncPersist() {
  try {
    localStorage.setItem(SYNC_KEY, JSON.stringify(syncSettings));
  } catch (err) { console.error('保存同步设置失败', err); }
}

function emitStatus() {
  if (onStatusChange) onStatusChange(Object.assign({}, status, {
    enabled: syncSettings.enabled,
    serverUrl: syncSettings.serverUrl
  }));
}

/* 本地数据有改动时调用（db.save 会调用） */
function syncMarkDirty() {
  if (!syncSettings.enabled) return;
  syncSettings.dirty = true;
  syncSettings.localUpdatedAt = Date.now();
  syncPersist();
}

function syncSetServer(url) {
  syncSettings.serverUrl = String(url || '').trim().replace(/\/+$/, '');
  syncPersist();
}

function syncSetEnabled(on) {
  syncSettings.enabled = !!on;
  syncPersist();
  if (on) {
    syncNow(false);
    if (!pollTimer) pollTimer = setInterval(() => syncNow(true), POLL_MS);
  } else {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    status.connected = false;
    emitStatus();
  }
}

function syncDisable() {
  syncSetEnabled(false);
}

/* 组装整包数据（含附件 Base64，每次推送都打新时间戳） */
async function buildPayload() {
  const trips = JSON.parse(JSON.stringify(state.trips || []));
  for (const t of trips) {
    for (const e of t.expenses || []) {
      for (const a of e.attachments || []) {
        a.data = await dbGet(a.id).catch(() => null) || '';
      }
    }
  }
  return {
    version: 1,
    trips,
    rates: state.rates || {},
    updatedAt: Date.now()
  };
}

/* 合并两端数据：出差 / 费用 / 附件按 id 并集，空字段用远端补全 */
function mergeTrips(localTrips, remoteTrips) {
  const map = new Map();
  localTrips.forEach(t => map.set(t.id, JSON.parse(JSON.stringify(t))));
  remoteTrips.forEach(rt => {
    const existing = map.get(rt.id);
    if (!existing) {
      map.set(rt.id, JSON.parse(JSON.stringify(rt)));
      return;
    }
    // 费用：按 id 并集
    const ex = new Map(existing.expenses.map(e => [e.id, e]));
    (rt.expenses || []).forEach(re => {
      const cur = ex.get(re.id);
      if (!cur) {
        ex.set(re.id, JSON.parse(JSON.stringify(re)));
        return;
      }
      // 同一笔费用：附件按 id 并集
      const atts = new Map((cur.attachments || []).map(a => [a.id, a]));
      (re.attachments || []).forEach(ra => {
        if (!atts.has(ra.id)) atts.set(ra.id, JSON.parse(JSON.stringify(ra)));
      });
      cur.attachments = [...atts.values()];
      // 空字段用远端补全（非空优先）
      for (const k of Object.keys(re)) {
        const cv = cur[k], rv = re[k];
        if ((cv === undefined || cv === null || cv === '') && rv !== undefined && rv !== null && rv !== '') {
          cur[k] = JSON.parse(JSON.stringify(rv));
        }
      }
    });
    existing.expenses = [...ex.values()];
    // 出差的空字段用远端补全
    for (const k of ['name', 'region', 'startDate', 'endDate', 'status', 'createdAt']) {
      const cv = existing[k], rv = rt[k];
      if ((cv === undefined || cv === null || cv === '') && rv !== undefined && rv !== null && rv !== '') {
        existing[k] = JSON.parse(JSON.stringify(rv));
      }
    }
    if (!existing.locations || !existing.locations.length) {
      existing.locations = JSON.parse(JSON.stringify(rt.locations || []));
    }
  });
  return [...map.values()];
}

/* 合并远端数据到本地，并写附件到 IndexedDB */
async function mergeRemote(serverState) {
  const data = serverState.data || { version: 1, trips: [], rates: {} };
  const remoteTrips = Array.isArray(data.trips) ? data.trips : [];
  const merged = mergeTrips(state.trips || [], remoteTrips);
  const changed = JSON.stringify(state.trips || []) !== JSON.stringify(merged);
  state.trips = merged;

  const mergedRates = Object.assign({}, DEFAULT_RATES, data.rates || {});
  const ratesChanged = JSON.stringify(state.rates || {}) !== JSON.stringify(Object.assign({}, state.rates || {}, mergedRates));
  state.rates = Object.assign({}, state.rates || {}, mergedRates);

  // 写附件到 IndexedDB
  const tasks = [];
  for (const t of merged) {
    for (const e of t.expenses || []) {
      for (const a of e.attachments || []) {
        if (a.data) {
          tasks.push(dbPut(a.id, a.data).catch(() => null));
          delete a.data;
        }
      }
    }
  }
  await Promise.all(tasks);

  save();
  syncSettings.lastPushedRev = serverState.rev || 0;
  syncSettings.dirty = false;
  syncSettings.localUpdatedAt = Date.now();
  syncSettings.lastSyncAt = Date.now();
  syncPersist();
  status.serverRev = serverState.rev || 0;
  status.lastSyncAt = Date.now();
  status.lastError = null;
  status.connected = true;
  if ((changed || ratesChanged) && onRemoteUpdate) onRemoteUpdate();
}

async function pushPayload(payload, baseRev, force) {
  const res = await fetch(syncSettings.serverUrl + '/api/state', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: payload, baseRev: baseRev, force: !!force })
  });
  if (res.status === 409) {
    // 并发推送：先把服务器最新数据合并进本地，再强制推送合并结果
    const conflict = await res.json();
    await mergeRemote(conflict.server);
    const payload2 = await buildPayload();
    const res2 = await fetch(syncSettings.serverUrl + '/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: payload2, baseRev: conflict.server.rev, force: true })
    });
    if (!res2.ok) throw new Error('force push ' + res2.status);
    const r = await res2.json();
    syncSettings.lastPushedRev = r.rev;
    syncSettings.dirty = false;
    syncSettings.lastSyncAt = Date.now();
    syncPersist();
    status.serverRev = r.rev;
    status.lastSyncAt = Date.now();
    return 'ok';
  }
  if (!res.ok) throw new Error('push ' + res.status);
  const r = await res.json();
  syncSettings.lastPushedRev = r.rev;
  syncSettings.dirty = false;
  syncSettings.lastSyncAt = Date.now();
  syncPersist();
  status.serverRev = r.rev;
  status.lastSyncAt = Date.now();
  return 'ok';
}

async function syncNow(silent) {
  if (!syncSettings.enabled || !syncSettings.serverUrl || pushing) return;
  pushing = true;
  status.syncing = true;
  emitStatus();
  try {
    // 1) 拉取服务器全量数据
    const res = await fetch(syncSettings.serverUrl + '/api/state', { cache: 'no-store' });
    if (!res.ok) throw new Error('pull ' + res.status);
    const serverState = await res.json();
    status.connected = true;
    status.serverRev = serverState.rev || 0;

    // 2) 合并进本地（按 id 并集，两端都不丢数据）
    await mergeRemote(serverState);

    // 3) 推送合并后的本地状态（每次带新时间戳）
    const payload = await buildPayload();
    await pushPayload(payload, serverState.rev || 0, false);
    status.lastError = null;
    status.lastSyncAt = Date.now();
  } catch (err) {
    status.connected = false;
    status.lastError = err.message;
    console.error('同步失败', err);
  } finally {
    status.syncing = false;
    emitStatus();
    pushing = false;
  }
}

function syncStatus() {
  return Object.assign({}, status, {
    enabled: syncSettings.enabled,
    serverUrl: syncSettings.serverUrl,
    dirty: syncSettings.dirty,
    lastPushedRev: syncSettings.lastPushedRev,
    lastSyncAt: syncSettings.lastSyncAt || status.lastSyncAt
  });
}

function syncInit(opts) {
  syncLoad();
  onStatusChange = opts.onStatusChange || null;
  onRemoteUpdate = opts.onRemoteUpdate || null;
  status.lastSyncAt = syncSettings.lastSyncAt;
  if (syncSettings.enabled && syncSettings.serverUrl) {
    syncNow(true);
    if (!pollTimer) pollTimer = setInterval(() => syncNow(true), POLL_MS);
  }
  emitStatus();
}
