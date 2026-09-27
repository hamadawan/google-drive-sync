const { DatabaseSync } = require('node:sqlite');
const { SyncStore, SyncEngine, parseBatch, createDatabaseLock } = require('../dist');
function device(schema, sql) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(sql);
  const db = {
    execAsync: async sql => { sqlite.exec(sql); },
    runAsync: async (sql, ...params) => { const r = sqlite.prepare(sql).run(...params); return { lastInsertRowId: Number(r.lastInsertRowid), changes: Number(r.changes) }; },
    getAllAsync: async (sql, ...params) => sqlite.prepare(sql).all(...params),
    getFirstAsync: async (sql, ...params) => sqlite.prepare(sql).get(...params) ?? null,
    withTransactionAsync: async task => { sqlite.exec('BEGIN'); try { await task(); sqlite.exec('COMMIT'); } catch (e) { sqlite.exec('ROLLBACK'); throw e; } },
  };
  const store = new SyncStore(db, schema), lock = createDatabaseLock();
  return { sqlite, db, store, lock, rows: table => sqlite.prepare(`SELECT * FROM ${table}`).all().map(r => ({ ...r })), engine: drive => new SyncEngine(store, drive, lock, undefined, 'test-sync-v1-') };
}
class MemoryDrive {
  constructor(schema) { this.schema = schema; this.files = new Map(); }
  async list() { return [...this.files].map(([id, f]) => ({ id, name: f.name })); }
  async download(file) { return parseBatch(this.files.get(file.id).body, this.schema); }
  async upload(id, body) {
    parseBatch(body, this.schema);
    const fileId = `file-${this.files.size}`;
    this.files.set(fileId, { name: `test-sync-v1-${id}.json`, body });
    if (this.loseResponse) { this.loseResponse = false; throw new Error('Lost upload response'); }
    return fileId;
  }
}
module.exports = { device, MemoryDrive };
