#!/usr/bin/env node
'use strict';
/*
 * 本地 HTTP 服务（Node.js 版）：实时渲染报告 + 持久化删除。
 *
 * 让招聘核查报告由一个后端服务托管，浏览器端：
 *   - 「删除公司」按钮经 DELETE /api/company/<名称> 真实改写 job_calendar_data.json 并重渲染；
 *   - 「加入全量搜索」勾选框经 PUT /api/company/<名称>/scheduled 持久化到各 entry 的 scheduled 字段。
 * 仅使用 Node.js 标准库，无需 npm install、也无需 Python 环境。
 *
 * 启动：
 *   node job_calendar_server.js --data job_calendar_data.json --html job_calendar_report.html
 * 默认监听 http://127.0.0.1:8771/
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

// 模板与脚本同目录，确保从任意工作目录启动都能找到它
const TEMPLATE_PATH = path.join(__dirname, 'report_template.html');
const TEMPLATE = fs.readFileSync(TEMPLATE_PATH, 'utf-8');

// ---------- 参数解析 ----------
function parseArgs(argv) {
  const o = {
    data: 'job_calendar_data.json',
    html: 'job_calendar_report.html',
    host: '127.0.0.1',
    port: 8771,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--data') o.data = argv[++i];
    else if (a === '--html') o.html = argv[++i];
    else if (a === '--host') o.host = argv[++i];
    else if (a === '--port') o.port = parseInt(argv[++i], 10);
  }
  // data/html 相对当前工作目录解析，与 Python 版行为一致
  o.data = path.resolve(process.cwd(), o.data);
  o.html = path.resolve(process.cwd(), o.html);
  return o;
}

// ---------- 数据 / 渲染逻辑（1:1 移植自 build_report.py） ----------
function normCompany(s) {
  return (s || '').replace(/[（(][^)）]*[)）]/g, '').trim();
}

function parseDate(s) {
  if (!s) return null;
  let m =
    /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s) ||
    /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(s);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m =
    /^(\d{4})-(\d{1,2})$/.exec(s) ||
    /^(\d{4})\/(\d{1,2})$/.exec(s);
  if (m) return new Date(+m[1], +m[2] - 1, 1);
  m = /^(\d{4})$/.exec(s);
  if (m) return new Date(+m[1], 0, 1);
  return null;
}

function freshness(publish, query) {
  const pd = parseDate(publish);
  const qd = parseDate(query);
  if (!pd || !qd) return null;
  const a = Date.UTC(pd.getUTCFullYear(), pd.getUTCMonth(), pd.getUTCDate());
  const b = Date.UTC(qd.getUTCFullYear(), qd.getUTCMonth(), qd.getUTCDate());
  let days = Math.round((b - a) / 86400000);
  if (isNaN(days)) return null;
  if (days < 0) days = 0;
  if (days <= 7) return { fresh: 5, rot: 0 };
  if (days <= 15) return { fresh: 4, rot: 1 };
  if (days <= 30) return { fresh: 3, rot: 2 };
  if (days <= 60) return { fresh: 2, rot: 3 };
  if (days <= 90) return { fresh: 1, rot: 4 };
  return { fresh: 0, rot: 5 };
}

function loadData(p) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (e) {
    data = [];
  }
  if (!Array.isArray(data)) data = [];
  return data;
}

function computeFreshness(data) {
  for (const d of data) {
    for (const p of d.localPositions || []) {
      const fr = freshness(p.publishDate, d.queryDate);
      if (fr) p.freshness = fr;
    }
    for (const p of d.otherCityPositions || []) {
      const fr = freshness(p.publishDate, d.queryDate);
      if (fr) p.freshness = fr;
    }
  }
  return data;
}

function buildHtml(data) {
  // 用函数式替换，避免 JSON 文本里的 $ 被当成特殊替换标记
  return TEMPLATE.replace('___DATA___', () => JSON.stringify(data, null, 2));
}

function renderReport(dataPath, htmlPath, write) {
  const data = computeFreshness(loadData(dataPath));
  const out = buildHtml(data);
  if (write && htmlPath) fs.writeFileSync(htmlPath, out, 'utf-8');
  return out;
}

function deleteCompany(dataPath, htmlPath, name) {
  const data = loadData(dataPath);
  const co = normCompany(name);
  const before = data.length;
  const filtered = data.filter((e) => {
    const cn = normCompany(e.company);
    return !(cn === co || cn.includes(co));
  });
  const removed = before - filtered.length;
  fs.writeFileSync(dataPath, JSON.stringify(filtered, null, 2), 'utf-8');
  renderReport(dataPath, htmlPath, true);
  return { deleted: removed, remaining: filtered.length, name: co, ok: true };
}

// 设置某公司的「加入全量搜索」状态，写入其全部 entry 的 scheduled 字段并持久化
function setScheduled(dataPath, htmlPath, name, value) {
  const data = loadData(dataPath);
  const co = normCompany(name);
  let n = 0;
  for (const e of data) {
    if (normCompany(e.company) === co) {
      e.scheduled = !!value;
      n++;
    }
  }
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf-8');
  renderReport(dataPath, htmlPath, true);
  return { ok: true, scheduled: !!value, name: co, updated: n };
}

// 汇总「已勾选全量搜索」的公司（按归一化公司名去重），并取每家最近一次搜索的条件
function scheduledCompanies(dataPath) {
  const data = loadData(dataPath);
  const byLabel = {};
  for (const e of data) {
    if (!e.scheduled) continue;
    const label = normCompany(e.company);
    const cur = byLabel[label];
    // 保留 queryDate 最大（最近）的那条 entry 作为「最后一次搜索条件」
    if (!cur || (e.queryDate || '') > (cur.queryDate || '')) {
      byLabel[label] = {
        label: label,
        full: e.company,
        position: e.position,
        location: e.location,
        recruitType: e.recruitType || '社招',
        lastQueryDate: e.queryDate || '',
      };
    }
  }
  return Object.keys(byLabel).map((k) => byLabel[k]);
}

// ---------- HTTP 服务 ----------
function send(res, code, body, ctype) {
  if (typeof body !== 'string') body = String(body);
  const buf = Buffer.from(body, 'utf-8');
  res.writeHead(code, {
    'Content-Type': ctype || 'text/html; charset=utf-8',
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
  });
  res.end(buf);
}

const cfg = parseArgs(process.argv.slice(2));

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url);
  const p = parsed.pathname;
  try {
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
      const html = renderReport(cfg.data, cfg.html, false);
      send(res, 200, html);
    } else if (req.method === 'GET' && p === '/api/data') {
      send(res, 200, JSON.stringify(loadData(cfg.data)), 'application/json; charset=utf-8');
    } else if (req.method === 'GET' && p === '/api/scheduled') {
      const list = scheduledCompanies(cfg.data);
      send(
        res,
        200,
        JSON.stringify({ count: list.length, companies: list }),
        'application/json; charset=utf-8'
      );
    } else if (req.method === 'DELETE' && p.indexOf('/api/company/') === 0) {
      const parts = p.split('/').filter(Boolean);
      const name = decodeURIComponent(parts[2] || '');
      const result = deleteCompany(cfg.data, cfg.html, name);
      send(res, 200, JSON.stringify(result), 'application/json; charset=utf-8');
    } else if (req.method === 'PUT' && p.indexOf('/api/company/') === 0 && p.endsWith('/scheduled')) {
      const parts = p.split('/').filter(Boolean);
      const name = decodeURIComponent(parts[2] || '');
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        let value = false;
        try {
          value = !!JSON.parse(body || '{}').value;
        } catch (e) {
          value = false;
        }
        try {
          const result = setScheduled(cfg.data, cfg.html, name, value);
          send(res, 200, JSON.stringify(result), 'application/json; charset=utf-8');
        } catch (e) {
          send(
            res,
            500,
            JSON.stringify({ ok: false, error: e.message }),
            'application/json; charset=utf-8'
          );
        }
      });
      return; // 异步读取 body，避免落到下方 404
    } else {
      send(res, 404, 'Not found');
    }
  } catch (e) {
    send(
      res,
      500,
      JSON.stringify({ ok: false, error: e.message }),
      'application/json; charset=utf-8'
    );
  }
});

server.listen(cfg.port, cfg.host, () => {
  console.log('招聘信息核查服务已启动： http://' + cfg.host + ':' + cfg.port + '/');
  console.log('  数据文件： ' + cfg.data);
  console.log('  报告文件： ' + cfg.html);
  console.log('  Ctrl+C 停止');
});

server.on('error', (e) => {
  console.error('服务启动失败：' + e.message);
  process.exit(1);
});
