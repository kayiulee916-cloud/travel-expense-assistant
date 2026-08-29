'use strict';

/* =========================================================
 * 导出：ZIP 资料包 + XLSX 报销明细
 * 全部本地生成，无外部库、无需联网。
 * ========================================================= */

function download(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/* ---------- CRC32 ---------- */

let CRC_TABLE = null;
function crc32(bytes) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/* ---------- ZIP 写入（STORE 模式，UTF-8 文件名） ---------- */

function makeZip(entries) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

  for (const en of entries) {
    const nameBytes = enc.encode(en.name);
    const data = en.data || new Uint8Array(0);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);          // version needed
    local.setUint16(6, 0x0800, true);      // UTF-8 filename flag
    local.setUint16(8, 0, true);           // method: store
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);
    chunks.push(local, nameBytes, data);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);             // version made by
    cd.setUint16(6, 20, true);             // version needed
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);             // method
    cd.setUint16(12, dosTime, true);
    cd.setUint16(14, dosDate, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, data.length, true);
    cd.setUint32(24, data.length, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint16(30, 0, true);             // extra len
    cd.setUint16(32, 0, true);             // comment len
    cd.setUint16(34, 0, true);             // disk start
    cd.setUint16(36, 0, true);             // internal attrs
    cd.setUint32(38, 0, true);             // external attrs
    cd.setUint32(42, offset, true);        // local header offset
    central.push(cd, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }

  const cdStart = offset;
  const cdSize = central.reduce((s, ch) => s + (ch.length || ch.byteLength), 0);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(4, 0, true);
  eocd.setUint16(6, 0, true);
  eocd.setUint16(8, entries.length, true);
  eocd.setUint16(10, entries.length, true);
  eocd.setUint32(12, cdSize, true);
  eocd.setUint32(16, cdStart, true);
  eocd.setUint16(20, 0, true);

  const out = new Uint8Array(cdStart + cdSize + 22);
  let p = 0;
  for (const ch of chunks) {
    if (ch instanceof DataView) {
      out.set(new Uint8Array(ch.buffer, ch.byteOffset, ch.byteLength), p);
    } else {
      out.set(ch, p);
    }
    p += ch.length || ch.byteLength;
  }
  for (const ch of central) {
    if (ch instanceof DataView) {
      out.set(new Uint8Array(ch.buffer, ch.byteOffset, ch.byteLength), p);
    } else {
      out.set(ch, p);
    }
    p += ch.length || ch.byteLength;
  }
  out.set(new Uint8Array(eocd.buffer), p);
  return out;
}

/* ---------- XLSX 生成（内联字符串，无需共享字符串表） ---------- */

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function colName(i) {
  let s = '';
  let n = i;
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

function buildXlsx(rows) {
  let sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>';
  rows.forEach((row, ri) => {
    sheet += '<row r="' + (ri + 1) + '">';
    row.forEach((cell, ci) => {
      const ref = colName(ci) + (ri + 1);
      if (typeof cell === 'number' && isFinite(cell)) {
        sheet += '<c r="' + ref + '"><v>' + cell + '</v></c>';
      } else {
        sheet += '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' +
          xmlEscape(cell == null ? '' : cell) + '</t></is></c>';
      }
    });
    sheet += '</row>';
  });
  sheet += '</sheetData></worksheet>';

  const parts = [
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '</Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>' },
    { name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="报销明细" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '</Relationships>' },
    { name: 'xl/worksheets/sheet1.xml', data: sheet }
  ];

  const enc = new TextEncoder();
  return makeZip(parts.map(p => ({ name: p.name, data: enc.encode(p.data) })));
}

/* ---------- 报销明细行 ---------- */

function typeLabelForExcel(e) {
  return e.type === '交通费用' ? '交通费用（' + (e.subType || '未分类') + '）' : e.type;
}

function buildExcelRows(trip, rates) {
  const rows = [['序号', '费用类型', '日期', '国家', '城市', '项目', '金额', '币种', '人民币金额', '资料状态']];
  (trip.expenses || []).forEach((e, i) => {
    const chk = checkExpense(e, rates);
    rows.push([
      i + 1,
      typeLabelForExcel(e),
      e.date,
      countryLabel(e),
      e.city,
      itemLabel(e) || '-',
      e.amount,
      e.currency,
      toCny(e, rates),
      chk.complete ? '完整' : '缺少：' + chk.missing.join('、')
    ]);
  });
  return rows;
}

/* ---------- 导出动作 ---------- */

async function exportTripZip(trip, rates) {
  const rows = buildExcelRows(trip, rates);
  const xlsx = buildXlsx(rows);
  const base = ((trip.startDate || '').slice(0, 7) || '未定日期') + '-' + safeName(trip.name) + '-报销资料包';
  const empty = new Uint8Array(0);
  const entries = [
    { name: base + '/', data: empty },
    { name: base + '/报销明细.xlsx', data: xlsx }
  ];
  EXPENSE_TYPES.forEach(t => entries.push({ name: base + '/' + t + '/', data: empty }));

  const used = new Set();
  for (const e of trip.expenses || []) {
    for (const a of e.attachments || []) {
      const raw = await dbGet(a.id).catch(() => null);
      if (!raw) continue;
      let name = base + '/' + e.type + '/' + fileNameFor(e, a);
      if (used.has(name)) {
        const dot = name.lastIndexOf('.');
        name = dot > 0 ? name.slice(0, dot) + '(2)' + name.slice(dot) : name + '(2)';
      }
      used.add(name);
      entries.push({ name, data: base64ToBytes(raw) });
    }
  }

  const zipBytes = makeZip(entries);
  download(base + '.zip', new Blob([zipBytes], { type: 'application/zip' }));
  return zipBytes;
}

function exportTripExcel(trip, rates) {
  const xlsx = buildXlsx(buildExcelRows(trip, rates));
  const name = ((trip.startDate || '').slice(0, 7) || '未定日期') + '-' + safeName(trip.name) + '-报销明细.xlsx';
  download(name, new Blob([xlsx], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
}

/* ---------- JSON 备份 / 恢复 ---------- */

async function exportBackup(trip) {
  const trips = trip ? [trip] : state.trips;
  const copy = JSON.parse(JSON.stringify(trips));
  for (const t of copy) {
    for (const e of t.expenses || []) {
      for (const a of e.attachments || []) {
        a.data = await dbGet(a.id).catch(() => null) || '';
      }
    }
  }
  const payload = { version: 1, exportedAt: new Date().toISOString(), rates: state.rates, trips: copy };
  download('出差报销助手_备份_' + today() + '.json',
    new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
}

function importBackup(file, onDone) {
  const reader = new FileReader();
  reader.onload = () => {
    (async () => {
      let parsed;
      try {
        parsed = JSON.parse(reader.result);
        if (!parsed || !Array.isArray(parsed.trips)) throw new Error('格式不对');
      } catch (err) {
        alert('导入失败：文件不是有效的备份 JSON。');
        onDone && onDone(false);
        return;
      }
      const tasks = [];
      for (const t of parsed.trips) {
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
      state.trips = parsed.trips;
      state.rates = Object.assign({}, DEFAULT_RATES, parsed.rates || {});
      save();
      onDone && onDone(true);
    })();
  };
  reader.readAsText(file);
}
