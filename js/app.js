'use strict';

/* =========================================================
 * 应用：路由 / 视图 / 表单 / 状态流程 / 事件
 * ========================================================= */

let view = { page: 'home', tripId: null, tab: 'expenses', expenseId: null };
let form = null;   // 费用表单状态
let modal = null;  // 出差弹窗 / 确认弹窗
let toastTimer = null;

const app = document.getElementById('app');

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

function navigate(hash) {
  location.hash = hash;
}

function currentTrip() {
  return state.trips.find(t => t.id === view.tripId) || null;
}

/* ---------- 路由 ---------- */

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const qIdx = raw.indexOf('?');
  const path = (qIdx >= 0 ? raw.slice(0, qIdx) : raw).split('/').filter(Boolean);
  const query = new URLSearchParams(qIdx >= 0 ? raw.slice(qIdx + 1) : '');

  if (path[0] === 'trip' && path[1]) {
    if (path[2] === 'expense' && path[3] === 'new') {
      return { page: 'expense-form', tripId: path[1], expenseId: null, tab: 'expenses', type: query.get('type') };
    }
    if (path[2] === 'expense' && path[3]) {
      return { page: 'expense-form', tripId: path[1], expenseId: path[3], tab: 'expenses' };
    }
    const tab = query.get('tab');
    return { page: 'trip', tripId: path[1], tab: ['expenses', 'check', 'export'].includes(tab) ? tab : (view.tab || 'expenses'), expenseId: null };
  }
  return { page: 'home', tripId: null, tab: 'expenses', expenseId: null };
}

function render() {
  if (view.page !== 'expense-form') form = null;
  const html = view.page === 'home' ? renderHome()
    : view.page === 'expense-form' ? renderExpenseForm()
    : renderTripPage();
  app.innerHTML = html;
  document.getElementById('modalRoot').innerHTML = modal ? modalHTML() : '';
  hydrate(app);
  if (modal) hydrate(document.getElementById('modalRoot'));
  if (view.page === 'expense-form') updateExpenseHint();
}

/* ---------- 首页 ---------- */

function renderHome() {
  const trips = (state.trips || []).slice().sort((a, b) => String(b.startDate || '').localeCompare(String(a.startDate || '')));
  const active = trips.filter(t => ACTIVE_STATUSES.includes(t.status));
  const history = trips.filter(t => !ACTIVE_STATUSES.includes(t.status));
  const quickTarget = active[0] || trips[0];

  if (!trips.length) {
    return `
      <header class="topbar"><div class="topbar-inner"><b class="brand">🧳 出差报销助手</b></div></header>
      <div class="page">
        <div class="empty">
          <div class="big">🧳</div>
          <p>还没有出差记录<br><span class="muted sm">先新建一次出差，开始记录费用和资料</span></p>
          <div class="empty-btns">
            <button class="btn primary block" data-action="new-trip">＋ 新增出差</button>
            <button class="btn block" data-action="load-demo">体验示例数据</button>
          </div>
        </div>
      </div>`;
  }

  return `
    <header class="topbar">
      <div class="topbar-inner">
        <b class="brand">🧳 出差报销助手</b>
        <button class="btn sm" data-action="new-trip">＋ 新增出差</button>
      </div>
    </header>
    <div class="page">
      ${syncCardHTML()}
      ${quickTarget ? quickAddHTML(quickTarget) : ''}

      <h2 class="section-title">当前出差</h2>
      ${active.length ? active.map(tripCardHTML).join('') : `<div class="card muted sm center">暂无进行中的出差</div>`}

      ${history.length ? `<h2 class="section-title">历史出差</h2>${history.map(tripCardHTML).join('')}` : ''}
    </div>`;
}

function syncCardHTML() {
  const s = syncStatus();
  const stateText = !s.enabled ? '未启用'
    : s.syncing ? '同步中…'
    : s.connected ? '已连接'
    : '未连接';
  const cls = !s.enabled ? 'gray' : s.connected ? 'green' : 'red';
  const desc = !s.enabled
    ? '开启后，手机与电脑将自动保持数据一致（需在同一局域网，电脑先运行同步服务器）。'
    : s.lastSyncAt
      ? '上次同步：' + new Date(s.lastSyncAt).toLocaleString() + (s.dirty ? '（有本地改动待推送）' : '')
      : '等待首次同步…';
  return `
    <div class="card sync-card">
      <div class="sync-head">
        <b>☁️ 设备同步</b>
        <span class="pill ${cls}" id="syncPill">${stateText}</span>
      </div>
      <div class="muted sm" id="syncDesc">${esc(desc)}</div>
      <div class="sync-row">
        <input id="syncUrl" type="text" value="${esc(s.serverUrl)}" placeholder="http://电脑IP:8787">
      </div>
      <div class="row2">
        <button class="btn primary" data-action="sync-connect">${s.enabled ? '更新并同步' : '连接并同步'}</button>
        <button class="btn" data-action="sync-now">立即同步</button>
      </div>
      ${s.enabled ? `<button class="btn sm danger block" data-action="sync-disable">断开同步（数据仍保留在本地）</button>` : ''}
    </div>`;
}

function updateSyncUI() {
  const s = syncStatus();
  const pill = document.getElementById('syncPill');
  const desc = document.getElementById('syncDesc');
  if (!pill || !desc) return;
  const stateText = !s.enabled ? '未启用'
    : s.syncing ? '同步中…'
    : s.connected ? '已连接'
    : '未连接';
  pill.textContent = stateText;
  pill.className = 'pill ' + (!s.enabled ? 'gray' : s.connected ? 'green' : 'red');
  desc.textContent = !s.enabled
    ? '开启后，手机与电脑将自动保持数据一致（需在同一局域网，电脑先运行同步服务器）。'
    : s.lastSyncAt
      ? '上次同步：' + new Date(s.lastSyncAt).toLocaleString() + (s.dirty ? '（有本地改动待推送）' : '')
      : '等待首次同步…';
}

function quickAddHTML(trip) {
  return `
    <div class="card quick-card">
      <div class="quick-title">快速记一笔 <span class="muted sm">→ ${esc(trip.name)}</span></div>
      <div class="quick-grid">
        ${EXPENSE_TYPES.map(type => `
          <button class="quick-item" data-action="quick-expense" data-id="${trip.id}" data-type="${esc(type)}">
            <span class="qi-ico">${EXPENSE_ICONS[type]}</span><span>${type}</span>
          </button>`).join('')}
      </div>
    </div>`;
}

function tripCardHTML(t) {
  const chk = tripCheck(t, state.rates);
  const atts = (t.expenses || []).reduce((s, e) => s + (e.attachments || []).length, 0);
  const locs = (t.locations || []).map(l => l.city).filter(Boolean).join(' → ') || '未设置城市';
  return `
    <div class="card trip-card">
      <div class="trip-main" data-action="open-trip" data-id="${t.id}">
        <div class="trip-name">${esc(t.name)} <span class="pill" style="background:${statusColor(t.status)}">${esc(t.status)}</span></div>
        <div class="muted sm">${fmtDate(t.startDate)} 至 ${fmtDate(t.endDate)} · ${t.region === '海外' ? '🌏 海外' : '🏠 国内'} · ${esc(locs)}</div>
        <div class="muted sm">${(t.expenses || []).length} 笔费用 · ${atts} 个附件 · 资料完整 ${chk.done}/${chk.total}（${chk.pct}%）</div>
      </div>
      <div class="trip-actions">
        <button class="btn sm" data-action="edit-trip" data-id="${t.id}">编辑</button>
        <button class="btn sm danger" data-action="delete-trip" data-id="${t.id}">删除</button>
      </div>
    </div>`;
}

/* ---------- 出差详情页 ---------- */

function renderTripPage() {
  const trip = currentTrip();
  if (!trip) {
    view = { page: 'home', tripId: null, tab: 'expenses', expenseId: null };
    return renderHome();
  }
  const tab = view.tab || 'expenses';
  const chk = tripCheck(trip, state.rates);
  const atts = (trip.expenses || []).reduce((s, e) => s + (e.attachments || []).length, 0);
  const locs = (trip.locations || []).map(l => l.city).filter(Boolean).join(' → ') || '未设置城市';
  const statusOpts = STATUSES.map(s =>
    `<option value="${s}" ${s === trip.status ? 'selected' : ''}>${s}</option>`).join('');

  return `
    <header class="topbar">
      <div class="topbar-inner">
        <button class="icon-btn" data-action="back-home" aria-label="返回">‹</button>
        <div class="tb-title">出差详情</div>
        <div class="tb-spacer"></div>
      </div>
    </header>
    <div class="page">
      <div class="card trip-head">
        <div class="trip-name lg">${esc(trip.name)} <span class="pill" style="background:${statusColor(trip.status)}">${esc(trip.status)}</span></div>
        <div class="muted sm">${fmtDate(trip.startDate)} 至 ${fmtDate(trip.endDate)} · ${trip.region === '海外' ? '🌏 海外' : '🏠 国内'} · ${esc(locs)}</div>
        <div class="head-row">
          <select id="statusSelect" class="select sm">${statusOpts}</select>
          <button class="btn sm" data-action="edit-trip" data-id="${trip.id}">编辑出差</button>
        </div>
      </div>

      ${statusFlowHTML(trip)}

      <div class="stats">
        <div class="stat"><div class="num">${(trip.expenses || []).length}</div><div class="lbl">费用笔数</div></div>
        <div class="stat"><div class="num">${atts}</div><div class="lbl">附件数</div></div>
        <div class="stat full"><div class="num sm-num">${sumText(trip)}</div><div class="lbl">合计金额</div></div>
        <div class="stat"><div class="num">${chk.done}/${chk.total}</div><div class="lbl">资料完整</div></div>
        <div class="stat"><div class="num">${chk.pct}%</div><div class="lbl">完整度</div></div>
      </div>

      <div class="tabbar">
        <button class="tab ${tab === 'expenses' ? 'active' : ''}" data-action="set-tab" data-tab="expenses">费用记录</button>
        <button class="tab ${tab === 'check' ? 'active' : ''}" data-action="set-tab" data-tab="check">资料检查</button>
        <button class="tab ${tab === 'export' ? 'active' : ''}" data-action="set-tab" data-tab="export">导出</button>
      </div>

      ${tab === 'expenses' ? renderExpensesTab(trip) : ''}
      ${tab === 'check' ? renderCheckTab(trip) : ''}
      ${tab === 'export' ? renderExportTab(trip) : ''}
    </div>
    ${tab === 'expenses' ? `<button class="fab" data-action="add-expense" aria-label="新增费用">＋</button>` : ''}`;
}

function statusFlowHTML(trip) {
  let inner = '';
  switch (trip.status) {
    case '出差中':
      inner = `<p class="muted sm">出差进行中，先记录费用、上传附件。</p>
        <button class="btn primary block" data-action="set-status" data-status="整理资料中">进入整理资料</button>`;
      break;
    case '整理资料中':
      inner = `<p class="muted sm">补齐资料后，生成报销资料包（ZIP + 报销明细）。</p>
        <button class="btn primary block" data-action="go-export">生成报销资料包</button>`;
      break;
    case '已生成报销包':
      inner = `<p class="remind">请提交公司报销系统</p>
        <button class="btn primary block" data-action="set-status" data-status="审核中">✅ 已提交报销</button>`;
      break;
    case '已提交报销':
    case '审核中':
      inner = `<p class="muted sm">等待公司审核、打款。</p>
        <button class="btn primary block" data-action="finish-paid">💰 已完成收款</button>`;
      break;
    case '已完成收款':
      inner = `<p class="muted sm">收款完成，附件已按需清理，可归档。</p>
        <button class="btn block" data-action="set-status" data-status="已归档">归档</button>`;
      break;
    default:
      inner = `<p class="muted sm">已归档，记录长期保留。</p>`;
  }
  return `<div class="card flow-card"><div class="flow-label">下一步</div>${inner}</div>`;
}

function sumText(trip) {
  const map = {};
  (trip.expenses || []).forEach(e => {
    const c = e.currency || 'CNY';
    map[c] = (map[c] || 0) + Number(e.amount || 0);
  });
  const parts = Object.keys(map).map(c => fmtMoney(map[c]) + ' ' + c);
  let cny = 0;
  (trip.expenses || []).forEach(e => cny += toCny(e, state.rates));
  return parts.join(' + ') + (parts.length ? '　≈ ' + fmtMoney(cny) + ' CNY' : '暂无');
}

function renderExpensesTab(trip) {
  const list = (trip.expenses || []).slice()
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || (b.createdAt || 0) - (a.createdAt || 0));
  if (!list.length) {
    return `<div class="empty small"><div class="big">🧾</div><p>还没有费用记录</p>
      <button class="btn primary block" data-action="add-expense">＋ 记录第一笔费用</button></div>`;
  }
  return list.map(e => expenseCardHTML(trip, e)).join('');
}

function expenseCardHTML(trip, e) {
  const chk = checkExpense(e, state.rates);
  const item = itemLabel(e);
  return `
    <div class="card exp-card">
      <div class="exp-top" data-action="edit-expense" data-id="${e.id}">
        <span class="exp-ico">${EXPENSE_ICONS[e.type] || '📦'}</span>
        <div class="exp-info">
          <div class="exp-type">${esc(e.type)}${e.subType ? `<span class="sub">${esc(e.subType)}</span>` : ''}<span class="pill light">${esc(e.country)}</span></div>
          <div class="muted sm">${esc(e.date)} · ${esc(e.city || '-')}${item ? ' · ' + esc(item) : ''}</div>
          <div class="sm ${chk.complete ? 'ok' : 'warn'}">${chk.complete ? '✓ 资料完整' : '✗ 缺 ' + chk.missing.map(esc).join('、')} · ${(e.attachments || []).length} 个附件</div>
        </div>
        <div class="exp-amt">${fmtMoney(e.amount)} <span class="cur">${esc(e.currency)}</span></div>
      </div>
      ${(e.attachments || []).length ? `<div class="attach-row">${e.attachments.map(attThumbHTML).join('')}</div>` : ''}
      <div class="exp-actions">
        <button class="btn sm" data-action="edit-expense" data-id="${e.id}">编辑 / 补资料</button>
        <button class="btn sm danger" data-action="delete-expense" data-id="${e.id}">删除</button>
      </div>
    </div>`;
}

function attThumbHTML(a) {
  const isImg = a.mime && a.mime.startsWith('image/') && a.mime !== 'image/heic';
  return `<a class="att-thumb" data-att="${a.id}" href="#" target="_blank" rel="noopener" title="${esc(a.filename)}">
    ${isImg ? '<img data-att="' + a.id + '" alt="">' : '<span class="att-ico">📄</span>'}
    <span class="att-tag">${esc(a.docType || '附件')}</span>
  </a>`;
}

function renderCheckTab(trip) {
  const chk = tripCheck(trip, state.rates);
  if (!chk.total) {
    return `<div class="empty small"><div class="big">✅</div><p>还没有费用，无法检查</p></div>`;
  }
  const barColor = chk.pct === 100 ? '#16a34a' : chk.pct >= 60 ? '#d97706' : '#dc2626';
  return `
    <div class="card summary-card">
      <div class="progress-label"><span>资料完整度</span><b>${chk.done}/${chk.total} 笔齐全（${chk.pct}%）</b></div>
      <div class="progress"><div class="progress-inner" style="width:${chk.pct}%;background:${barColor}"></div></div>
      <div class="muted sm">齐全后可生成报销资料包</div>
    </div>
    ${chk.items.map(i => {
      const e = i.expense, c = i.check;
      const chips = c.req.map(d =>
        `<span class="doc-chip ${c.missing.includes(d) ? 'miss' : 'done'}">${c.missing.includes(d) ? '✗' : '✓'} ${esc(d)}</span>`).join('') ||
        '<span class="muted sm">无强制资料要求</span>';
      return `
      <div class="card check-card">
        <div class="check-head">
          <span class="exp-ico">${EXPENSE_ICONS[e.type] || '📦'}</span>
          <div class="check-info">
            <div class="exp-type">${esc(e.type)}${e.subType ? `<span class="sub">${esc(e.subType)}</span>` : ''}</div>
            <div class="muted sm">${esc(e.date)} · ${esc(e.city || '-')} · ${fmtMoney(e.amount)} ${esc(e.currency)}</div>
          </div>
          <span class="check-result ${c.complete ? 'ok' : 'warn'}">${c.complete ? '齐全' : c.missing.length + ' 项缺失'}</span>
        </div>
        <div class="docs">${chips}</div>
      </div>`;
    }).join('')}`;
}

function renderExportTab(trip) {
  const rateInputs = CURRENCIES.filter(c => c !== 'CNY').map(c => `
    <div class="rate-item">
      <label>${c}</label>
      <input class="rate-input" data-currency="${c}" type="number" step="0.0001" min="0" value="${state.rates[c] || ''}">
      <span class="muted sm">1 ${c} = ? CNY</span>
    </div>`).join('');
  return `
    <div class="card export-card">
      <div class="ec-ico">📦</div>
      <b>生成报销资料包</b>
      <p class="muted sm">自动生成：报销明细.xlsx + 按费用类型分类的附件，文件名按规则重命名。生成后状态变为「已生成报销包」。</p>
      <button class="btn primary block" data-action="export-zip">生成 ZIP 资料包</button>
    </div>
    <div class="card export-card">
      <div class="ec-ico">📊</div>
      <b>报销明细（Excel）</b>
      <p class="muted sm">单独导出 .xlsx：序号 / 费用类型 / 日期 / 国家 / 城市 / 项目 / 金额 / 币种 / 人民币金额 / 资料状态。</p>
      <button class="btn block" data-action="export-excel">导出报销明细.xlsx</button>
    </div>
    <div class="card export-card">
      <div class="ec-ico">💱</div>
      <b>汇率设置（人民币估算）</b>
      <p class="muted sm">用于估算人民币金额，可按实际汇率手动更新，保存后立即生效。</p>
      <div class="rate-grid">${rateInputs}</div>
      <button class="btn block" data-action="save-rates">保存汇率</button>
    </div>
    <div class="card export-card">
      <div class="ec-ico">💾</div>
      <b>数据备份与迁移</b>
      <p class="muted sm">导出当前出差（含附件）为 JSON，可换设备后导入恢复。</p>
      <div class="row2">
        <button class="btn block" data-action="export-json">导出备份</button>
        <button class="btn block" data-action="import-json">导入备份</button>
      </div>
      <input type="file" id="jsonInput" accept=".json,application/json" hidden>
    </div>
    <details class="rules">
      <summary>资料检查规则</summary>
      <div class="rule-block">
        <b>客情宴请</b>：国内：账单、发票、付款截图；海外：收据；海外超过 1000 元：增加发票、支付记录
      </div>
      <div class="rule-block">
        <b>个人餐费</b>：国内：账单、发票；海外：收据；超过 1000 元：增加发票、支付记录
      </div>
      <div class="rule-block">
        <b>住宿费用</b>：国内：酒店账单、发票；海外：收据
      </div>
      <div class="rule-block">
        <b>交通费用</b>：出租车 / 高铁：发票；个人滴滴 / 飞机：发票、行程单
      </div>
    </details>`;
}

/* ---------- 费用表单页 ---------- */

function initForm(trip) {
  const isEdit = !!view.expenseId;
  const e = isEdit ? (trip.expenses || []).find(x => x.id === view.expenseId) : null;
  if (isEdit && !e) {
    navigate('#/trip/' + trip.id);
    return;
  }
  const d = {
    type: view.type || (e ? e.type : '客情宴请'),
    subType: e && e.subType || '出租车',
    date: e ? e.date : today(),
    country: e ? e.country : (trip.region === '海外' ? '海外' : '国内'),
    countryName: e ? (e.countryName || '') : (trip.region === '海外' ? '' : '中国'),
    city: e ? e.city : ((trip.locations || [])[0] && (trip.locations[0].city) || ''),
    amount: e ? e.amount : '',
    currency: e ? e.currency : 'CNY',
    note: e ? (e.note || '') : '',
    restaurant: e ? (e.restaurant || '') : '',
    guests: e ? (e.guests || '') : '',
    client: e ? (e.client || '') : '',
    hotel: e ? (e.hotel || '') : '',
    checkIn: e ? (e.checkIn || '') : '',
    checkOut: e ? (e.checkOut || '') : '',
    from: e ? (e.from || '') : '',
    to: e ? (e.to || '') : '',
    depCity: e ? (e.depCity || '') : '',
    arrCity: e ? (e.arrCity || '') : '',
    flightNo: e ? (e.flightNo || '') : '',
    stationFrom: e ? (e.stationFrom || '') : '',
    stationTo: e ? (e.stationTo || '') : '',
    item: e ? (e.item || '') : '',
    attachments: e ? (e.attachments || []).map(a => ({ ...a })) : []
  };
  form = {
    tripId: trip.id,
    expenseId: isEdit ? e.id : null,
    draft: d,
    newIds: new Set(),
    originalIds: new Set((e ? e.attachments : []).map(a => a.id))
  };
}

function collectFormValues() {
  if (!form) return;
  const d = form.draft;
  const val = (id, prop) => {
    const el = document.getElementById(id);
    return el ? el.value : (d[prop] !== undefined ? d[prop] : '');
  };
  d.type = val('fType', 'type') || d.type;
  d.subType = val('fSubType', 'subType') || '出租车';
  d.date = val('fDate', 'date');
  d.country = val('fCountry', 'country') || d.country;
  d.countryName = val('fCountryName', 'countryName');
  d.city = val('fCity', 'city');
  d.amount = val('fAmount', 'amount');
  d.currency = val('fCurrency', 'currency') || d.currency;
  d.note = val('fNote', 'note');
  d.restaurant = val('fRestaurant', 'restaurant');
  d.guests = val('fGuests', 'guests');
  d.client = val('fClient', 'client');
  d.hotel = val('fHotel', 'hotel');
  d.checkIn = val('fCheckIn', 'checkIn');
  d.checkOut = val('fCheckOut', 'checkOut');
  d.from = val('fFrom', 'from');
  d.to = val('fTo', 'to');
  d.depCity = val('fDepCity', 'depCity');
  d.arrCity = val('fArrCity', 'arrCity');
  d.flightNo = val('fFlightNo', 'flightNo');
  d.stationFrom = val('fStationFrom', 'stationFrom');
  d.stationTo = val('fStationTo', 'stationTo');
  d.item = val('fItem', 'item');
}

function renderExpenseForm() {
  const trip = state.trips.find(t => t.id === view.tripId);
  if (!trip) {
    navigate('#/');
    return '';
  }
  const needInit = !form || form.tripId !== trip.id ||
    (view.expenseId && form.expenseId !== view.expenseId) ||
    (!view.expenseId && !!form.expenseId);
  if (needInit) initForm(trip);
  if (!form) return '';
  collectFormValues();
  const d = form.draft;

  const typeOpts = EXPENSE_TYPES.map(t =>
    `<option value="${t}" ${t === d.type ? 'selected' : ''}>${EXPENSE_ICONS[t]} ${t}</option>`).join('');
  const transportOpts = TRANSPORT_TYPES.map(t =>
    `<option value="${t}" ${t === d.subType ? 'selected' : ''}>${t}</option>`).join('');
  const curOpts = [...CURRENCIES, '其他'].map(c =>
    `<option ${c === d.currency ? 'selected' : ''}>${c}</option>`).join('');
  const cityOpts = [...new Set((trip.locations || []).map(l => l.city).filter(Boolean))]
    .map(c => `<option value="${esc(c)}"></option>`).join('');
  const countryOpts = ['中国', '日本', '美国', '韩国', '新加坡', '泰国', '英国', '德国', '法国', '澳大利亚']
    .map(c => `<option value="${esc(c)}"></option>`).join('');

  const typeBlock = typeFieldsHTML(d);
  const cny = toCny({ amount: Number(d.amount) || 0, currency: d.currency }, state.rates);

  return `
    <header class="topbar">
      <div class="topbar-inner">
        <button class="icon-btn" data-action="cancel-expense" aria-label="返回">‹</button>
        <div class="tb-title">${form.expenseId ? '编辑费用' : '记录费用'}</div>
        <button class="btn sm primary" data-action="save-expense">保存</button>
      </div>
    </header>
    <div class="page">
      <form class="card form-card" onsubmit="return false">
        <label>费用类型
          <select id="fType" class="select">${typeOpts}</select>
        </label>

        ${d.type === '交通费用' ? `<label>交通类型
          <select id="fSubType" class="select">${transportOpts}</select>
        </label>` : ''}

        ${typeBlock}

        <div class="row2">
          <label>日期<input type="date" id="fDate" value="${esc(d.date)}" min="${esc(trip.startDate || '')}" max="${esc(trip.endDate || '')}"></label>
          <label>国家/地区
            <select id="fCountry" class="select">
              <option ${d.country === '国内' ? 'selected' : ''}>国内</option>
              <option ${d.country === '海外' ? 'selected' : ''}>海外</option>
            </select>
          </label>
        </div>
        <div class="row2">
          <label>国家名称<input id="fCountryName" list="countryList" value="${esc(d.countryName)}" placeholder="${d.country === '海外' ? '例如：日本' : '例如：中国'}"></label>
          <label>城市<input id="fCity" list="cityList" value="${esc(d.city)}" placeholder="例如：东京"></label>
        </div>
        <datalist id="countryList">${countryOpts}</datalist>
        <datalist id="cityList">${cityOpts}</datalist>

        <div class="row2">
          <label>金额<input type="number" id="fAmount" min="0" step="0.01" value="${esc(d.amount)}" placeholder="0.00"></label>
          <label>币种<select id="fCurrency" class="select">${curOpts}</select></label>
        </div>
        ${d.currency && d.currency !== 'CNY' ? `<div class="muted sm">≈ ${fmtMoney(cny)} 人民币（按已保存汇率估算）</div>` : ''}

        <label>备注<input id="fNote" value="${esc(d.note)}" placeholder="可选"></label>

        <div class="hint" id="fHint"></div>
      </form>

      <div class="card form-card">
        <div class="attach-title">附件（${d.attachments.length} 个）</div>
        <div id="attachSlots">${attachSlotsHTML()}</div>
      </div>

      <div class="form-actions">
        <button class="btn block" data-action="cancel-expense">取消</button>
        <button class="btn primary block" data-action="save-expense">保存费用</button>
      </div>
    </div>`;
}

function typeFieldsHTML(d) {
  let html = '';
  if (d.type === '客情宴请') {
    html = `
      <label>餐厅名称<input id="fRestaurant" value="${esc(d.restaurant)}" placeholder="例如：银座怀石"></label>
      <div class="row2">
        <label>人数<input id="fGuests" type="number" min="1" step="1" value="${esc(d.guests)}" placeholder="可选"></label>
        <label>客户名称<input id="fClient" value="${esc(d.client)}" placeholder="可选"></label>
      </div>`;
  } else if (d.type === '个人餐费') {
    html = `<label>餐厅名称<input id="fRestaurant" value="${esc(d.restaurant)}" placeholder="例如：一兰拉面"></label>`;
  } else if (d.type === '住宿费用') {
    html = `
      <label>酒店名称<input id="fHotel" value="${esc(d.hotel)}" placeholder="例如：东京站酒店"></label>
      <div class="row2">
        <label>入住日期<input type="date" id="fCheckIn" value="${esc(d.checkIn)}"></label>
        <label>退房日期<input type="date" id="fCheckOut" value="${esc(d.checkOut)}"></label>
      </div>`;
  } else if (d.type === '交通费用') {
    if (d.subType === '出租车' || d.subType === '个人滴滴') {
      html = `
        <div class="row2">
          <label>起点<input id="fFrom" value="${esc(d.from)}" placeholder="例如：酒店"></label>
          <label>终点<input id="fTo" value="${esc(d.to)}" placeholder="例如：机场"></label>
        </div>`;
    } else if (d.subType === '飞机') {
      html = `
        <div class="row2">
          <label>出发城市<input id="fDepCity" value="${esc(d.depCity)}" placeholder="例如：上海"></label>
          <label>目的城市<input id="fArrCity" value="${esc(d.arrCity)}" placeholder="例如：东京"></label>
        </div>
        <label>航班号<input id="fFlightNo" value="${esc(d.flightNo)}" placeholder="例如：MU539"></label>`;
    } else {
      html = `
        <div class="row2">
          <label>出发站<input id="fStationFrom" value="${esc(d.stationFrom)}" placeholder="例如：东京"></label>
          <label>到达站<input id="fStationTo" value="${esc(d.stationTo)}" placeholder="例如：新大阪"></label>
        </div>`;
    }
  } else if (d.type === '其他费用') {
    html = `<label>项目 / 说明<input id="fItem" value="${esc(d.item)}" placeholder="例如：签证费"></label>`;
  }
  return html;
}

function attachSlotsHTML() {
  if (!form) return '';
  const d = form.draft;
  const amountCny = toCny({ amount: Number(d.amount) || 0, currency: d.currency }, state.rates);
  const req = requiredDocs(d.type, d.subType, d.country, amountCny);
  const present = [...new Set(d.attachments.map(a => a.docType).filter(Boolean))];
  const slotTypes = [...new Set([...req, ...present, '其他'])];
  return slotTypes.map(dt => {
    const files = d.attachments.filter(a => a.docType === dt);
    const isReq = req.includes(dt);
    return `
      <div class="slot ${isReq && !files.length ? 'slot-miss' : ''}">
        <div class="slot-head">
          <b>${esc(dt)}</b>
          ${isReq ? '<span class="req-tag">必传</span>' : (dt === '其他' ? '<span class="req-tag neutral">补充</span>' : '')}
          <span class="slot-count">${files.length} 个</span>
        </div>
        <div class="slot-files">
          ${files.map(fileBoxHTML).join('')}
          <label class="add-file"><span>＋</span>上传
            <input type="file" class="file-input" data-doctype="${esc(dt)}" multiple
              accept="image/jpeg,image/png,image/heic,application/pdf,.heic,.HEIC,.pdf" hidden>
          </label>
        </div>
      </div>`;
  }).join('');
}

function fileBoxHTML(a) {
  const isImg = a.mime && a.mime.startsWith('image/') && a.mime !== 'image/heic';
  return `
    <a class="file-box" data-att="${a.id}" href="#" target="_blank" rel="noopener" title="${esc(a.filename)}">
      ${isImg ? '<img class="fb-img" data-att="' + a.id + '" alt="">' : '<span class="fb-ico">📄</span>'}
      <span class="fb-name">${esc(a.filename)}</span>
      <span class="fb-del" data-action="form-file-del" data-id="${a.id}" title="移除">×</span>
    </a>`;
}

function updateExpenseHint() {
  const el = document.getElementById('fHint');
  if (!el || !form) return;
  collectFormValues();
  const d = form.draft;
  const amountCny = toCny({ amount: Number(d.amount) || 0, currency: d.currency }, state.rates);
  const req = requiredDocs(d.type, d.subType, d.country, amountCny);
  let warn = '';
  const trip = state.trips.find(t => t.id === view.tripId);
  if (trip) {
    const issues = validateExpense(trip, { date: d.date, city: d.city.trim() });
    if (issues.length) warn = '<div class="hint-warn">⚠ ' + issues.map(esc).join('<br>') + '</div>';
  }
  el.innerHTML = '所需资料：' + (req.length ? req.map(esc).join('、') : '无强制要求') +
    (d.currency !== 'CNY' && d.amount ? `<span class="muted">（≈${fmtMoney(amountCny)} 元触发规则）</span>` : '') +
    warn;
}

/* ---------- 出差弹窗 ---------- */

function openTripModal(trip) {
  modal = {
    kind: 'trip',
    tripId: trip ? trip.id : null,
    draft: trip ? {
      name: trip.name, region: trip.region || '国内',
      startDate: trip.startDate || today(), endDate: trip.endDate || today(),
      locations: (trip.locations || []).length ? trip.locations.map(l => ({ ...l })) : [{ city: '', startDate: '', endDate: '' }]
    } : {
      name: '', region: '国内', startDate: today(), endDate: today(),
      locations: [{ city: '', startDate: '', endDate: '' }]
    }
  };
  render();
}

function modalHTML() {
  if (!modal) return '';
  if (modal.kind === 'trip') {
    const d = modal.draft;
    const locRows = d.locations.map((l, i) => `
      <div class="loc-row">
        <input class="loc-city" value="${esc(l.city)}" placeholder="城市">
        <input type="date" class="loc-start" value="${l.startDate}">
        <input type="date" class="loc-end" value="${l.endDate}">
        <button type="button" class="btn sm danger" data-action="location-remove">×</button>
      </div>`).join('');
    return `
      <div class="modal-mask">
        <div class="modal">
          <h3>${modal.tripId ? '编辑出差' : '新增出差'}</h3>
          <label>出差名称<input id="mName" value="${esc(d.name)}" placeholder="例如：日本客户拜访"></label>
          <label>地区类型
            <select id="mRegion" class="select">
              <option ${d.region === '国内' ? 'selected' : ''}>国内</option>
              <option ${d.region === '海外' ? 'selected' : ''}>海外</option>
            </select>
          </label>
          <div class="row2">
            <label>开始日期<input type="date" id="mStart" value="${d.startDate}"></label>
            <label>结束日期<input type="date" id="mEnd" value="${d.endDate}"></label>
          </div>
          <label class="sm">行程城市（支持多个）</label>
          <div id="locRows">${locRows}</div>
          <button type="button" class="btn sm block" data-action="location-add">＋ 添加城市</button>
          <div class="modal-actions">
            <button type="button" class="btn" data-action="modal-close">取消</button>
            <button type="button" class="btn primary" data-action="modal-save-trip">保存</button>
          </div>
        </div>
      </div>`;
  }
  if (modal.kind === 'dialog') {
    return `
      <div class="modal-mask">
        <div class="modal">
          <h3>${esc(modal.title)}</h3>
          <div class="dialog-body">${modal.body}</div>
          <div class="modal-actions">
            ${modal.actions.map((a, i) => `
              <button type="button" class="btn ${a.primary ? 'primary' : ''} ${a.danger ? 'danger' : ''}" data-dialog-action="${i}">${esc(a.label)}</button>`).join('')}
          </div>
        </div>
      </div>`;
  }
  return '';
}

function showDialog(title, body, actions) {
  modal = { kind: 'dialog', title, body, actions };
  render();
}

function closeModal() {
  modal = null;
  render();
}

function collectTripModal() {
  if (!modal || modal.kind !== 'trip') return;
  modal.draft.name = document.getElementById('mName').value;
  modal.draft.region = document.getElementById('mRegion').value;
  modal.draft.startDate = document.getElementById('mStart').value;
  modal.draft.endDate = document.getElementById('mEnd').value;
  modal.draft.locations = [...document.querySelectorAll('#locRows .loc-row')].map(row => ({
    city: row.querySelector('.loc-city').value.trim(),
    startDate: row.querySelector('.loc-start').value,
    endDate: row.querySelector('.loc-end').value
  })).filter(l => l.city);
}

function saveTripModal() {
  collectTripModal();
  const d = modal.draft;
  if (!d.name) { toast('请填写出差名称'); return; }
  if (!d.locations.length) { toast('请至少填写一个城市'); return; }
  if (!d.startDate || !d.endDate) { toast('请填写开始/结束日期'); return; }
  const tripIssues = validateTrip(d);
  if (tripIssues.length) { toast(tripIssues[0]); return; }
  if (modal.tripId) {
    const t = state.trips.find(x => x.id === modal.tripId);
    if (t) {
      const probe = { startDate: d.startDate, endDate: d.endDate, locations: d.locations };
      const violating = (t.expenses || []).filter(e => validateExpense(probe, e).length);
      if (violating.length && !confirm('调整后，有 ' + violating.length + ' 笔费用的日期或城市超出新的出差范围（如日期不在新周期内、城市不在行程中），仍要保存？')) return;
      Object.assign(t, {
        name: d.name, region: d.region, startDate: d.startDate, endDate: d.endDate, locations: d.locations
      });
    }
  } else {
    state.trips.unshift({
      id: uid('t'), name: d.name, region: d.region,
      startDate: d.startDate, endDate: d.endDate, locations: d.locations,
      status: '出差中', createdAt: Date.now(), expenses: []
    });
  }
  save();
  closeModal();
  toast('已保存出差');
}

/* ---------- 事件处理 ---------- */

function handleAction(action, el) {
  const trip = currentTrip();
  switch (action) {
    case 'back-home':
      navigate('#/');
      break;
    case 'new-trip':
      openTripModal(null);
      break;
    case 'edit-trip': {
      const t = state.trips.find(x => x.id === el.dataset.id);
      if (t) openTripModal(t);
      break;
    }
    case 'delete-trip': {
      const t = state.trips.find(x => x.id === el.dataset.id);
      if (t && confirm('删除出差「' + t.name + '」及其全部费用、附件？此操作不可恢复。')) {
        const ids = [];
        (t.expenses || []).forEach(e => (e.attachments || []).forEach(a => ids.push(a.id)));
        dbDeleteMany(ids);
        state.trips = state.trips.filter(x => x.id !== t.id);
        save(); render(); toast('已删除');
      }
      break;
    }
    case 'open-trip':
      view = { page: 'trip', tripId: el.dataset.id, tab: 'expenses', expenseId: null };
      navigate('#/trip/' + el.dataset.id);
      break;
    case 'quick-expense':
      view = { page: 'expense-form', tripId: el.dataset.id, expenseId: null, tab: 'expenses', type: el.dataset.type };
      navigate('#/trip/' + el.dataset.id + '/expense/new?type=' + encodeURIComponent(el.dataset.type));
      break;
    case 'add-expense':
      view = { page: 'expense-form', tripId: view.tripId, expenseId: null, tab: 'expenses' };
      navigate('#/trip/' + view.tripId + '/expense/new');
      break;
    case 'edit-expense':
      view = { page: 'expense-form', tripId: view.tripId, expenseId: el.dataset.id, tab: 'expenses' };
      navigate('#/trip/' + view.tripId + '/expense/' + el.dataset.id);
      break;
    case 'delete-expense': {
      const t = currentTrip();
      const e = t && (t.expenses || []).find(x => x.id === el.dataset.id);
      if (e && confirm('删除这笔费用（' + e.type + ' ' + e.date + '）及其附件？')) {
        dbDeleteMany((e.attachments || []).map(a => a.id));
        t.expenses = t.expenses.filter(x => x.id !== e.id);
        save(); render(); toast('已删除');
      }
      break;
    }
    case 'set-tab':
      view.tab = el.dataset.tab;
      navigate('#/trip/' + view.tripId + '?tab=' + view.tab);
      break;
    case 'go-export':
      view.tab = 'export';
      navigate('#/trip/' + view.tripId + '?tab=export');
      break;
    case 'set-status': {
      const t = currentTrip();
      if (t) { t.status = el.dataset.status; save(); render(); toast('状态已更新：' + t.status); }
      break;
    }
    case 'finish-paid': {
      const t = currentTrip();
      if (!t) return;
      showDialog('已完成收款', `
        <p>确认已收到报销款？是否删除本次出差的全部附件（图片 / PDF / 截图）？</p>
        <p class="muted sm">文字记录、金额统计会保留，可随时归档。</p>`, [
        { label: '删除附件并完成', primary: true, onClick: () => { clearTripAttachments(t); setTripStatus(t, '已完成收款'); } },
        { label: '保留附件', onClick: () => setTripStatus(t, '已完成收款') },
        { label: '取消' }
      ]);
      break;
    }
    case 'export-zip': {
      if (!trip) return;
      exportTripZip(trip, state.rates).then(() => {
        if (['出差中', '整理资料中'].includes(trip.status)) {
          trip.status = '已生成报销包';
          save();
        }
        toast('已生成报销资料包');
        render();
      }).catch(err => { console.error(err); toast('导出失败，请重试'); });
      break;
    }
    case 'export-excel':
      if (trip) exportTripExcel(trip, state.rates);
      break;
    case 'export-json':
      if (trip) exportBackup(trip);
      break;
    case 'import-json':
      document.getElementById('jsonInput').click();
      break;
    case 'save-rates': {
      document.querySelectorAll('.rate-input').forEach(inp => {
        const v = parseFloat(inp.value);
        if (inp.dataset.currency && v > 0) state.rates[inp.dataset.currency] = v;
      });
      save(); toast('汇率已保存'); render();
      break;
    }
    case 'sync-connect': {
      const url = (document.getElementById('syncUrl') || {}).value;
      if (!url) { toast('请输入服务器地址，例如 http://192.168.1.5:8787'); return; }
      syncSetServer(url);
      syncSetEnabled(true);
      toast('正在连接同步服务器…');
      setTimeout(() => render(), 300);
      break;
    }
    case 'sync-now':
      syncNow(false).then(() => updateSyncUI());
      break;
    case 'sync-disable':
      syncDisable();
      toast('已断开同步，本地数据保留');
      render();
      break;
    case 'load-demo': {
      if (confirm('载入示例数据将覆盖当前全部数据，确定继续？')) {
        const ids = [];
        state.trips.forEach(t => (t.expenses || []).forEach(e => (e.attachments || []).forEach(a => ids.push(a.id))));
        dbDeleteMany(ids);
        state = demoState();
        save();
        view = { page: 'trip', tripId: state.trips[0].id, tab: 'expenses', expenseId: null };
        navigate('#/trip/' + state.trips[0].id);
      }
      break;
    }
    case 'save-expense':
      saveExpense();
      break;
    case 'cancel-expense':
      cancelExpense();
      break;
    case 'form-file-del': {
      const id = el.dataset.id;
      form.draft.attachments = form.draft.attachments.filter(a => a.id !== id);
      if (form.newIds.has(id)) {
        form.newIds.delete(id);
        dbDelete(id).catch(() => null);
      }
      const slots = document.getElementById('attachSlots');
      if (slots) slots.innerHTML = attachSlotsHTML();
      hydrate(slots);
      break;
    }
    case 'modal-close':
      closeModal();
      break;
    case 'modal-save-trip':
      saveTripModal();
      break;
    case 'location-add': {
      const rows = document.getElementById('locRows');
      const div = document.createElement('div');
      div.className = 'loc-row';
      div.innerHTML = `
        <input class="loc-city" placeholder="城市">
        <input type="date" class="loc-start">
        <input type="date" class="loc-end">
        <button type="button" class="btn sm danger" data-action="location-remove">×</button>`;
      rows.appendChild(div);
      break;
    }
    case 'location-remove':
      el.closest('.loc-row').remove();
      break;
  }
}

function setTripStatus(t, status) {
  t.status = status;
  save();
  closeModal();
  toast('状态已更新：' + status);
}

function clearTripAttachments(t) {
  const ids = [];
  (t.expenses || []).forEach(e => (e.attachments || []).forEach(a => ids.push(a.id)));
  dbDeleteMany(ids);
  (t.expenses || []).forEach(e => e.attachments = []);
}

function saveExpense() {
  collectFormValues();
  const d = form.draft;
  const trip = state.trips.find(t => t.id === form.tripId);
  if (!trip) return;
  if (!d.type || !d.date || !d.country) { toast('请填写费用类型、日期、国家/地区'); return; }
  const amount = parseFloat(d.amount);
  if (!(amount > 0)) { toast('请填写正确的金额'); return; }
  const issues = validateExpense(trip, { date: d.date, city: d.city.trim() });
  if (issues.length) { toast(issues[0]); return; }

  const expense = {
    id: form.expenseId || uid('e'),
    type: d.type,
    subType: d.type === '交通费用' ? d.subType : undefined,
    date: d.date,
    country: d.country,
    countryName: d.countryName.trim(),
    city: d.city.trim(),
    amount,
    currency: d.currency,
    note: d.note.trim(),
    attachments: d.attachments.map(a => ({
      id: a.id, filename: a.filename, mime: a.mime, docType: a.docType,
      size: a.size, createdAt: a.createdAt
    })),
    createdAt: Date.now()
  };
  if (d.type === '客情宴请') {
    expense.restaurant = d.restaurant.trim();
    expense.guests = d.guests ? Number(d.guests) : null;
    expense.client = d.client.trim();
  }
  if (d.type === '个人餐费') expense.restaurant = d.restaurant.trim();
  if (d.type === '住宿费用') {
    expense.hotel = d.hotel.trim();
    expense.checkIn = d.checkIn;
    expense.checkOut = d.checkOut;
  }
  if (d.type === '交通费用') {
    if (d.subType === '出租车' || d.subType === '个人滴滴') {
      expense.from = d.from.trim();
      expense.to = d.to.trim();
    }
    if (d.subType === '飞机') {
      expense.depCity = d.depCity.trim();
      expense.arrCity = d.arrCity.trim();
      expense.flightNo = d.flightNo.trim();
    }
    if (d.subType === '高铁') {
      expense.stationFrom = d.stationFrom.trim();
      expense.stationTo = d.stationTo.trim();
    }
  }
  if (d.type === '其他费用') expense.item = d.item.trim();

  if (form.expenseId) {
    const idx = trip.expenses.findIndex(x => x.id === form.expenseId);
    if (idx >= 0) trip.expenses[idx] = Object.assign({}, trip.expenses[idx], expense);
  } else {
    trip.expenses.push(expense);
  }

  const finalIds = new Set(expense.attachments.map(a => a.id));
  const removed = [...form.originalIds].filter(id => !finalIds.has(id));
  if (removed.length) dbDeleteMany(removed);

  const backTripId = form.tripId;
  form = null;
  save();
  toast('已保存费用');
  navigate('#/trip/' + backTripId + '?tab=expenses');
}

function cancelExpense() {
  if (form) {
    const pending = [...form.newIds];
    if (pending.length) dbDeleteMany(pending);
  }
  const backTripId = form ? form.tripId : view.tripId;
  form = null;
  navigate('#/trip/' + backTripId + '?tab=expenses');
}

/* ---------- 附件：上传与预览 ---------- */

function onFormFiles(input) {
  const docType = input.dataset.doctype;
  [...input.files].forEach(f => {
    const id = uid('a');
    const reader = new FileReader();
    reader.onload = () => {
      const b64 = String(reader.result).split(',')[1] || '';
      dbPut(id, b64).catch(err => { console.error(err); toast('附件保存失败'); });
      form.draft.attachments.push({
        id, filename: f.name, mime: f.type || 'application/octet-stream',
        docType, size: f.size, createdAt: Date.now()
      });
      form.newIds.add(id);
      const slots = document.getElementById('attachSlots');
      if (slots) {
        slots.innerHTML = attachSlotsHTML();
        hydrate(slots);
      }
    };
    reader.readAsDataURL(f);
  });
  input.value = '';
}

function findAttachmentMeta(id) {
  if (form) {
    const a = form.draft.attachments.find(x => x.id === id);
    if (a) return a;
  }
  const t = currentTrip() || state.trips.find(x => x.id === (form ? form.tripId : null));
  if (t) {
    for (const e of t.expenses || []) {
      const a = (e.attachments || []).find(x => x.id === id);
      if (a) return a;
    }
  }
  return null;
}

const blobUrls = new Map();

async function hydrate(root) {
  if (!root) return;
  const els = root.querySelectorAll('[data-att]');
  for (const el of els) {
    const id = el.dataset.att;
    const att = findAttachmentMeta(id);
    if (!att) continue;
    const raw = await dbGet(id).catch(() => null);
    if (!raw) continue;
    let url = blobUrls.get(id);
    if (!url) {
      const blob = new Blob([base64ToBytes(raw)], { type: att.mime || 'application/octet-stream' });
      url = URL.createObjectURL(blob);
      blobUrls.set(id, url);
    }
    if (el.tagName === 'IMG') el.src = url;
    else if (el.tagName === 'A') el.href = url;
  }
}

/* ---------- 全局事件 ---------- */

document.addEventListener('click', e => {
  const actionEl = e.target.closest('[data-action]');
  if (actionEl) {
    e.preventDefault();
    handleAction(actionEl.dataset.action, actionEl);
    return;
  }
  const da = e.target.closest('[data-dialog-action]');
  if (da && modal && modal.kind === 'dialog') {
    e.preventDefault();
    const idx = Number(da.dataset.dialogAction);
    const act = modal.actions[idx];
    closeModal();
    if (act && act.onClick) act.onClick();
  }
});

document.addEventListener('change', e => {
  const t = e.target;
  if (t.classList.contains('file-input')) {
    onFormFiles(t);
  } else if (t.id === 'statusSelect') {
    const trip = currentTrip();
    if (trip) { trip.status = t.value; save(); render(); toast('状态已更新：' + trip.status); }
  } else if (t.id === 'jsonInput') {
    if (t.files[0]) {
      if (confirm('导入将覆盖当前全部数据，确定继续？')) {
        importBackup(t.files[0], ok => {
          if (ok) {
            toast('导入成功');
            view = { page: 'home', tripId: null, tab: 'expenses', expenseId: null };
            navigate('#/');
          }
        });
      }
    }
    t.value = '';
  } else if (t.id === 'fType' || t.id === 'fSubType') {
    collectFormValues();
    render();
    updateExpenseHint();
  }
});

document.addEventListener('input', e => {
  const t = e.target;
  if (t.id && (t.id.startsWith('f') || t.id === 'fHint')) {
    if (t.id === 'fAmount' || t.id === 'fCurrency' || t.id === 'fCountry' || t.id === 'fType' || t.id === 'fSubType') {
      updateExpenseHint();
    }
  }
});

/* ---------- 启动 ---------- */

function init() {
  state = load();
  view = parseHash();
  render();
  const qs = new URLSearchParams(location.search);
  const autoSync = qs.get('syncServer');
  if (autoSync) {
    syncSetServer(autoSync);
    syncSetEnabled(true);
  }
  syncInit({
    onStatusChange: updateSyncUI,
    onRemoteUpdate: () => {
      view = parseHash();
      render();
      toast('已同步其他设备的数据');
    }
  });
  render();
}

window.addEventListener('hashchange', () => {
  view = parseHash();
  render();
});

init();
