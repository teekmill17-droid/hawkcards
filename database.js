const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || __dirname;
const DB_PATH = path.join(DATA_DIR, 'card_vault.db');
let db = null;

async function initDB() {
  const SQL = await initSqlJs();

  // Load existing DB or create new one
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_name TEXT NOT NULL DEFAULT '',
      team TEXT DEFAULT '',
      year INTEGER,
      sport TEXT DEFAULT 'Baseball',
      brand TEXT DEFAULT '',
      card_number TEXT DEFAULT '',
      set_name TEXT DEFAULT '',
      subset TEXT DEFAULT '',
      parallel TEXT DEFAULT '',
      condition_grade TEXT DEFAULT 'Near Mint',
      psa_grade TEXT DEFAULT '',
      estimated_value REAL DEFAULT 0,
      purchase_price REAL DEFAULT 0,
      notes TEXT DEFAULT '',
      is_duplicate INTEGER DEFAULT 0,
      is_wishlist INTEGER DEFAULT 0,
      is_graded INTEGER DEFAULT 0,
      image_path TEXT DEFAULT '',
      ai_confidence TEXT DEFAULT '',
      lookup_source TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run("CREATE INDEX IF NOT EXISTS idx_sport ON cards(sport)");
  db.run("CREATE INDEX IF NOT EXISTS idx_player ON cards(player_name)");
  db.run("CREATE INDEX IF NOT EXISTS idx_year ON cards(year)");

  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  saveDB();
  return db;
}

function saveDB() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function getDB() { return db; }

// Helper: run a SELECT and return array of objects
function query(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

// Helper: run a SELECT and return first row
function queryOne(sql, params = []) {
  const rows = query(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

// Helper: run INSERT/UPDATE/DELETE and return info
function run(sql, params = []) {
  db.run(sql, params);
  // Capture last insert id before save (export can reset it)
  const result = db.exec("SELECT last_insert_rowid() as id");
  const lid = (result.length > 0 && result[0].values.length > 0) ? result[0].values[0][0] : null;
  saveDB();
  return lid;
}

// Get last insert id (call right after run)
function lastId() {
  const result = db.exec("SELECT last_insert_rowid() as id");
  if (result.length > 0 && result[0].values.length > 0) {
    return result[0].values[0][0];
  }
  return null;
}

module.exports = { initDB, getDB, saveDB, query, queryOne, run, lastId, DB_PATH };
