'use strict';

/* =========================================================
 * 常量与业务规则
 * ========================================================= */

const EXPENSE_TYPES = ['客情宴请', '个人餐费', '住宿费用', '交通费用', '其他费用'];
const EXPENSE_ICONS = {
  '客情宴请': '🍽',
  '个人餐费': '🍚',
  '住宿费用': '🏨',
  '交通费用': '🚕',
  '其他费用': '📦'
};
const TRANSPORT_TYPES = ['出租车', '个人滴滴', '飞机', '高铁'];
const CURRENCIES = ['CNY', 'JPY', 'USD', 'EUR', 'KRW', 'HKD', 'TWD', 'SGD', 'THB', 'GBP', 'AUD'];
const DOC_TYPES = ['账单', '发票', '付款截图', '收据', '支付记录', '酒店账单', '行程单', '其他'];

const STATUSES = ['出差中', '整理资料中', '已生成报销包', '已提交报销', '审核中', '已完成收款', '已归档'];
const ACTIVE_STATUSES = ['出差中', '整理资料中', '已生成报销包', '已提交报销', '审核中'];
const STATUS_COLORS = ['#2563eb', '#d97706', '#7c3aed', '#4f46e5', '#ea580c', '#16a34a', '#6b7280'];

const DEFAULT_RATES = {
  CNY: 1, JPY: 0.05, USD: 7.2, EUR: 7.8, KRW: 0.0053,
  HKD: 0.92, TWD: 0.23, SGD: 5.4, THB: 0.21, GBP: 9.3, AUD: 4.8
};

/* 各费用类型所需资料规则 */
function requiredDocs(type, subType, country, amountCny) {
  const add = (arr, item) => { if (!arr.includes(item)) arr.push(item); };
  const docs = [];
  if (type === '客情宴请') {
    if (country === '海外') {
      docs.push('收据');
      if (amountCny > 1000) {
        add(docs, '发票');
        add(docs, '支付记录');
      }
    } else {
      docs.push('账单', '发票', '付款截图');
    }
  } else if (type === '个人餐费') {
    if (country === '海外') docs.push('收据');
    else docs.push('账单', '发票');
    if (amountCny > 1000) {
      add(docs, '发票');
      add(docs, '支付记录');
    }
  } else if (type === '住宿费用') {
    if (country === '海外') docs.push('收据');
    else docs.push('酒店账单', '发票');
  } else if (type === '交通费用') {
    if (subType === '个人滴滴' || subType === '飞机') docs.push('发票', '行程单');
    else docs.push('发票'); // 出租车 / 高铁
  }
  return docs;
}

/* 人民币估算：amount × 汇率（CNY 为 1） */
function toCny(expense, rates) {
  const r = rates && rates[expense.currency] ? rates[expense.currency] : 1;
  return Math.round(expense.amount * r * 100) / 100;
}

/* 单笔费用资料检查 */
function checkExpense(expense, rates) {
  const amountCny = toCny(expense, rates || {});
  const req = requiredDocs(expense.type, expense.subType, expense.country, amountCny);
  const have = new Set((expense.attachments || []).map(a => a.docType).filter(Boolean));
  const missing = req.filter(d => !have.has(d));
  return { req, have: [...have], missing, complete: missing.length === 0 };
}

/* 出差整体检查 */
function tripCheck(trip, rates) {
  const items = (trip.expenses || []).map(e => ({ expense: e, check: checkExpense(e, rates) }));
  const done = items.filter(i => i.check.complete).length;
  const total = items.length;
  const pct = total ? Math.round(done / total * 100) : 0;
  return { items, done, total, pct };
}

/* 字段辅助 */
function transportRoute(e) {
  if (e.type !== '交通费用') return '';
  switch (e.subType) {
    case '出租车':
    case '个人滴滴': return [e.from, e.to].filter(Boolean).join(' → ');
    case '飞机': return [e.depCity, e.arrCity].filter(Boolean).join(' → ');
    case '高铁': return [e.stationFrom, e.stationTo].filter(Boolean).join(' → ');
  }
  return '';
}

/* Excel「项目」列：餐厅 / 酒店 / 行程 / 说明 */
function itemLabel(e) {
  if (e.type === '客情宴请' || e.type === '个人餐费') return e.restaurant || '';
  if (e.type === '住宿费用') return e.hotel || '';
  if (e.type === '交通费用') return transportRoute(e) || (e.flightNo ? '航班 ' + e.flightNo : '');
  return e.item || '';
}

/* 地点：海外显示「国家+城市」，国内显示城市 */
function placeLabel(e) {
  if (e.country === '海外') return (e.countryName || e.country || '海外') + (e.city || '');
  return e.city || '';
}

/* Excel「国家」列：优先显示国家名称 */
function countryLabel(e) {
  if (e.countryName) return e.countryName;
  return e.country === '海外' ? '海外' : '国内';
}

/* 附件命名规则：费用类型-日期-地点-项目-金额-资料类型.ext */
function extFor(att) {
  const mime = att.mime || '';
  if (mime === 'application/pdf') return '.pdf';
  if (mime.startsWith('image/')) {
    const t = mime.split('/')[1] || 'jpg';
    return '.' + t.replace('jpeg', 'jpg').replace('x-heic', 'heic');
  }
  const m = /\.([a-z0-9]+)$/i.exec(att.filename || '');
  return m ? '.' + m[1].toLowerCase() : '';
}

function fileNameFor(expense, att) {
  const item = itemLabel(expense) || '未填项目';
  const place = placeLabel(expense) || '未知地点';
  const base = `${expense.type}-${expense.date}-${place}-${item}-${expense.amount}${expense.currency}-${att.docType || '附件'}`;
  return safeName(base) + extFor(att);
}

function safeName(s) {
  return String(s).replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim() || '未命名';
}

function uid(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function today() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function fmtDate(iso) {
  return iso ? String(iso).slice(0, 10) : '';
}

function fmtMoney(n) {
  return Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

function statusColor(status) {
  const i = STATUSES.indexOf(status);
  return i >= 0 ? STATUS_COLORS[i] : '#6b7280';
}

/* ---------- 合理性校验 ---------- */

function tripCities(trip) {
  return new Set((trip.locations || []).map(l => l.city).filter(Boolean));
}

/* 出差周期 / 城市行程本身是否合理 */
function validateTrip(trip) {
  const issues = [];
  if (trip.startDate && trip.endDate && trip.endDate < trip.startDate) {
    issues.push('结束日期不能早于开始日期');
  }
  (trip.locations || []).forEach(l => {
    if (l.city && l.startDate && l.endDate && l.endDate < l.startDate) {
      issues.push('城市「' + l.city + '」的结束日期早于开始日期');
    }
  });
  return issues;
}

/* 单笔费用是否落在出差周期内、城市是否在行程城市中 */
function validateExpense(trip, expense) {
  const issues = [];
  if (trip.startDate && trip.endDate && expense.date) {
    if (expense.date < trip.startDate || expense.date > trip.endDate) {
      issues.push('费用日期 ' + expense.date + ' 不在出差周期（' + trip.startDate + ' 至 ' + trip.endDate + '）内');
    }
  }
  const cities = tripCities(trip);
  if (cities.size && expense.city && !cities.has(expense.city)) {
    issues.push('费用城市「' + expense.city + '」不在本次行程城市（' + [...cities].join('、') + '）中');
  }
  return issues;
}

/* 示例数据 */
function demoState() {
  const now = Date.now();
  const trip = {
    id: uid('t'),
    name: '日本客户拜访',
    region: '海外',
    startDate: '2026-09-01',
    endDate: '2026-09-07',
    locations: [
      { city: '东京', startDate: '2026-09-01', endDate: '2026-09-03' },
      { city: '大阪', startDate: '2026-09-03', endDate: '2026-09-05' },
      { city: '京都', startDate: '2026-09-05', endDate: '2026-09-07' }
    ],
    status: '出差中',
    createdAt: now,
    expenses: [
      {
        id: uid('e'), type: '客情宴请', date: '2026-09-02', country: '海外', countryName: '日本', city: '东京',
        restaurant: '银座怀石 みかづき', guests: 4, client: '田中株式会社', amount: 68000, currency: 'JPY',
        note: '客户晚餐', attachments: [], createdAt: now
      },
      {
        id: uid('e'), type: '住宿费用', date: '2026-09-01', country: '海外', countryName: '日本', city: '东京',
        hotel: '东京站酒店', checkIn: '2026-09-01', checkOut: '2026-09-03', amount: 54000, currency: 'JPY',
        note: '', attachments: [], createdAt: now
      },
      {
        id: uid('e'), type: '交通费用', subType: '飞机', date: '2026-09-01', country: '海外', countryName: '日本', city: '东京',
        depCity: '上海', arrCity: '东京', flightNo: 'MU539', amount: 2680, currency: 'CNY',
        note: '', attachments: [], createdAt: now
      },
      {
        id: uid('e'), type: '个人餐费', date: '2026-09-04', country: '海外', countryName: '日本', city: '大阪',
        restaurant: '一兰拉面', amount: 1450, currency: 'JPY', note: '', attachments: [], createdAt: now
      },
      {
        id: uid('e'), type: '交通费用', subType: '高铁', date: '2026-09-03', country: '海外', countryName: '日本', city: '大阪',
        stationFrom: '东京', stationTo: '新大阪', amount: 14560, currency: 'JPY', note: '', attachments: [], createdAt: now
      }
    ]
  };
  return { version: 1, trips: [trip], rates: Object.assign({}, DEFAULT_RATES) };
}
