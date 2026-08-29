#!/usr/bin/env node
'use strict';

/* =========================================================
 * 出差报销助手 - 局域网同步服务器
 *
 * 纯 Node 标准库实现，无需安装任何依赖：
 *   1) 托管 Web 工具本身（手机 / 电脑浏览器访问 http://电脑IP:8787）
 *   2) 提供 /api/state 同步接口，数据保存在 data/sync-state.json
 *
 * 运行：
 *   node server/sync-server.js            （默认端口 8787）
 *   PORT=9000 node server/sync-server.js  （自定义端口）
 *   DATA_DIR=/path node server/sync-server.js
 *
 * 注意：仅限可信局域网使用，没有账号鉴权，不要把端口暴露到公网。
 * ========================================================= */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA_DIR, 'sync-state.json');
const MAX_BODY = 200 * 1024 * 1024; // 200MB，附件以 Base64 传输

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (err) {
    return { rev: 0, updatedAt: 0, data: null };
  }
}

function saveState(s) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(s));
  fs.renameSync(tmp, STATE_FILE);
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  let filePath = path.normalize(path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403, { 'Access-Control-Allow-Origin': '*' });
    res.end('Forbidden');
    return;
  }
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end('Not Found');
      return;
    }
    const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': st.size,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store'
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const urlPath = req.url.split('?')[0];

  if (req.method === 'GET' && urlPath === '/api/state/meta') {
    const s = loadState();
    sendJson(res, 200, { rev: s.rev, updatedAt: s.updatedAt });
    return;
  }

  if (req.method === 'GET' && urlPath === '/api/state') {
    sendJson(res, 200, loadState());
    return;
  }

  if (req.method === 'PUT' && urlPath === '/api/state') {
    try {
      const body = JSON.parse(await readBody(req));
      const data = body && body.data;
      if (!data || typeof data !== 'object') {
        sendJson(res, 400, { error: 'invalid payload' });
        return;
      }
      const cur = loadState();
      const baseRev = Number(body.baseRev || 0);
      const force = !!body.force;
      if (!force && baseRev !== cur.rev) {
        sendJson(res, 409, { conflict: true, server: cur });
        return;
      }
      const next = { rev: cur.rev + 1, updatedAt: Date.now(), data };
      saveState(next);
      sendJson(res, 200, { ok: true, rev: next.rev });
    } catch (err) {
      sendJson(res, 400, { error: 'bad request: ' + err.message });
    }
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
  console.log('出差报销助手同步服务器已启动');
  console.log('  本机访问:   http://localhost:' + PORT);
  const nets = os.networkInterfaces();
  Object.keys(nets).forEach(name => {
    (nets[name] || []).forEach(n => {
      if (n.family === 'IPv4' && !n.internal) {
        console.log('  手机访问:   http://' + n.address + ':' + PORT + '   （手机与电脑连接同一 WiFi）');
      }
    });
  });
  console.log('  数据文件:   ' + STATE_FILE);
});
