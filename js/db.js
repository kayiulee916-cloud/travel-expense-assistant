'use strict';

/* =========================================================
 * 本地存储：
 * - 结构化数据（出差/费用/附件元信息） → localStorage
 * - 附件二进制（Base64）              → IndexedDB
 * ========================================================= */

const STORAGE_KEY = 'travelExpenseAssistantData_v1';
const DB_NAME = 'travelExpenseAssistant';
const DB_VERSION = 1;

let state = { version: 1, trips: [], rates: Object.assign({}, DEFAULT_RATES) };

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: 1, trips: [], rates: Object.assign({}, DEFAULT_RATES) };
    const parsed = JSON.parse(raw);
    return {
      version: parsed.version || 1,
      trips: Array.isArray(parsed.trips) ? parsed.trips : [],
      rates: Object.assign({}, DEFAULT_RATES, parsed.rates || {})
    };
  } catch (err) {
    console.error('读取本地数据失败', err);
    return { version: 1, trips: [], rates: Object.assign({}, DEFAULT_RATES) };
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: state.version || 1,
      trips: state.trips || [],
      rates: state.rates || {}
    }));
    if (typeof syncMarkDirty === 'function') syncMarkDirty();
  } catch (err) {
    console.error('保存本地数据失败', err);
    alert('保存失败：浏览器本地存储不可用（可能是隐私模式或存储已满）。');
  }
}

/* ---------- IndexedDB ---------- */

let _dbPromise = null;

function openDB() {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('当前浏览器不支持 IndexedDB'));
  }
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = ev.target.result;
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function dbPut(id, b64) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').put({ id, data: b64 });
    tx.oncomplete = () => resolve(id);
    tx.onerror = () => reject(tx.error);
  }));
}

function dbGet(id) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction('files', 'readonly');
    const req = tx.objectStore('files').get(id);
    req.onsuccess = () => resolve(req.result ? req.result.data : null);
    req.onerror = () => reject(req.error);
  }));
}

function dbDelete(id) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

function dbDeleteMany(ids) {
  return Promise.all((ids || []).map(id => dbDelete(id).catch(() => null)));
}
