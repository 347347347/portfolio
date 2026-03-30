/**
 * タスク割当システム - サーバー
 * Node.js + Express + better-sqlite3
 *
 * 起動方法:
 *   npm install
 *   node server.js
 *
 * アクセス: http://localhost:3000
 */

const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.db');

app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname)); // serve index.html

// ── DB初期化 ──────────────────────────────────────────────────────────────
const db = new Database(':memory:');

db.exec(`
  PRAGMA journal_mode=WAL;

  CREATE TABLE IF NOT EXISTS members (
    id       INTEGER PRIMARY KEY,
    data     TEXT NOT NULL  -- JSON of member object
  );

  CREATE TABLE IF NOT EXISTS day_data (
    date_key TEXT PRIMARY KEY,  -- 'YYYY-MM-DD'
    data     TEXT NOT NULL       -- JSON of dayData entry
  );

  CREATE TABLE IF NOT EXISTS task_library (
    id   INTEGER PRIMARY KEY,
    data TEXT NOT NULL  -- JSON of library task
  );

  CREATE TABLE IF NOT EXISTS absent_override (
    member_id INTEGER PRIMARY KEY,
    count     INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS app_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// ── デフォルトメンバーの初期投入（初回のみ） ───────────────────────────
const DEFAULT_MEMBERS = [
    {id:1, name:'田中 英治',     category:'企画',  skill:'上級',shiftStart:10,shiftEnd:19,conditions:['週4~']},
    {id:2, name:'大橋 辰徳',     category:'デザイン',skill:'上級',shiftStart:10,shiftEnd:19,conditions:[]},
    {id:3, name:'藤川 芳雄',     category:'撮影',  skill:'上級',shiftStart:10,shiftEnd:19,conditions:[]},
    {id:4, name:'齋藤 純三',   category:'開発',skill:'上級',shiftStart:10,shiftEnd:19,conditions:['週5']},
    {id:5, name:'所沢 卓郎',   category:'開発',  skill:'上級',shiftStart:10,shiftEnd:19,conditions:['週5']},
    {id:6, name:'坂本 楓',   category:'営業',  skill:'上級',shiftStart:10,shiftEnd:19,conditions:[]},
    {id:7, name:'徳重 那月',   category:'営業',  skill:'上級',shiftStart:10,shiftEnd:19,conditions:[]},
];

const memberCount = db.prepare('SELECT COUNT(*) as c FROM members').get().c;
if (memberCount === 0) {
  const insertMember = db.prepare('INSERT OR REPLACE INTO members (id, data) VALUES (?, ?)');
  const insertMany = db.transaction((members) => {
    for (const m of members) insertMember.run(m.id, JSON.stringify(m));
  });
  insertMany(DEFAULT_MEMBERS);
  console.log('✅ デフォルトメンバーを初期投入しました');
}

// ── ヘルパー ──────────────────────────────────────────────────────────────
function getAllMembers() {
  return db.prepare('SELECT data FROM members ORDER BY id').all().map(r => JSON.parse(r.data));
}

function getAllDayData() {
  const result = {};
  db.prepare('SELECT date_key, data FROM day_data').all().forEach(r => {
    result[r.date_key] = JSON.parse(r.data);
  });
  return result;
}

function getAllTaskLibrary() {
  return db.prepare('SELECT data FROM task_library ORDER BY id').all().map(r => JSON.parse(r.data));
}

function getAllAbsentOverride() {
  const result = {};
  db.prepare('SELECT member_id, count FROM absent_override').all().forEach(r => {
    result[r.member_id] = r.count;
  });
  return result;
}

// 最終更新タイムスタンプ（ポーリング用）
let lastModified = Date.now();
function touch() { lastModified = Date.now(); }

// ── API: 全状態を取得 ──────────────────────────────────────────────────────
app.get('/api/state', (req, res) => {
  try {
    res.json({
      members: getAllMembers(),
      dayData: getAllDayData(),
      taskLibrary: getAllTaskLibrary(),
      memberAbsentOverride: getAllAbsentOverride(),
      lastModified,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── API: 更新確認（ポーリング用） ─────────────────────────────────────────
app.get('/api/ping', (req, res) => {
  const clientTs = parseInt(req.query.ts) || 0;
  res.json({ lastModified, changed: lastModified > clientTs });
});

// ── API: メンバー全保存 ───────────────────────────────────────────────────
app.post('/api/members', (req, res) => {
  try {
    const members = req.body;
    if (!Array.isArray(members)) return res.status(400).json({ error: 'array expected' });
    const upsert = db.prepare('INSERT OR REPLACE INTO members (id, data) VALUES (?, ?)');
    const del = db.prepare('DELETE FROM members WHERE id NOT IN (SELECT value FROM json_each(?))');
    const txn = db.transaction(() => {
      for (const m of members) upsert.run(m.id, JSON.stringify(m));
      const ids = JSON.stringify(members.map(m => m.id));
      del.run(ids);
    });
    txn();
    touch();
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── API: 特定日のdayData保存 ─────────────────────────────────────────────
app.post('/api/daydata/:dateKey', (req, res) => {
  try {
    const { dateKey } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return res.status(400).json({ error: 'invalid date' });
    db.prepare('INSERT OR REPLACE INTO day_data (date_key, data) VALUES (?, ?)').run(dateKey, JSON.stringify(req.body));
    touch();
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── API: dayData複数日まとめて保存（全量sync用） ────────────────────────
app.post('/api/daydata', (req, res) => {
  try {
    const dayData = req.body;
    const upsert = db.prepare('INSERT OR REPLACE INTO day_data (date_key, data) VALUES (?, ?)');
    const txn = db.transaction(() => {
      for (const [key, val] of Object.entries(dayData)) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(key)) upsert.run(key, JSON.stringify(val));
      }
    });
    txn();
    touch();
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── API: タスクライブラリ保存 ─────────────────────────────────────────────
app.post('/api/library', (req, res) => {
  try {
    const library = req.body;
    if (!Array.isArray(library)) return res.status(400).json({ error: 'array expected' });
    const txn = db.transaction(() => {
      db.prepare('DELETE FROM task_library').run();
      const ins = db.prepare('INSERT INTO task_library (id, data) VALUES (?, ?)');
      for (const t of library) ins.run(t.id, JSON.stringify(t));
    });
    txn();
    touch();
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── API: 欠勤回数override保存 ─────────────────────────────────────────────
app.post('/api/absent-override', (req, res) => {
  try {
    const overrides = req.body; // { memberId: count, ... }
    const upsert = db.prepare('INSERT OR REPLACE INTO absent_override (member_id, count) VALUES (?, ?)');
    const txn = db.transaction(() => {
      db.prepare('DELETE FROM absent_override').run();
      for (const [mid, count] of Object.entries(overrides)) {
        upsert.run(parseInt(mid), count);
      }
    });
    txn();
    touch();
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── フロントエンド ────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── 起動 ─────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 タスク割当システム起動`);
  console.log(`   URL: http://localhost:${PORT}`);
  console.log(`   DB:  ${DB_PATH}`);
  console.log(`\n   Ctrl+C で停止\n`);
});
