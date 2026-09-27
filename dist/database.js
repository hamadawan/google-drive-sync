"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SyncStore = void 0;
const model_1 = require("./model");
const stable = (values) => JSON.stringify(Object.fromEntries(Object.entries(values).sort(([a], [b]) => a.localeCompare(b))));
class SyncStore {
    db;
    schema;
    tableNames;
    constructor(db, schema) {
        this.db = db;
        this.schema = schema;
        (0, model_1.validateSchema)(schema);
        this.tableNames = Object.keys(schema);
    }
    primaryKey(table) { return this.schema[table].primaryKey ?? { column: 'id', type: 'integer' }; }
    async initialize() {
        await this.db.execAsync(`
      CREATE TABLE IF NOT EXISTS drive_sync_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS drive_sync_records (
        table_name TEXT NOT NULL, global_id TEXT NOT NULL, local_id BLOB,
        snapshot TEXT, record TEXT NOT NULL,
        PRIMARY KEY (table_name, global_id), UNIQUE (table_name, local_id)
      );
      CREATE TABLE IF NOT EXISTS drive_sync_outbox (id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS drive_sync_seen (id TEXT PRIMARY KEY);
    `);
        if (!await this.meta("device"))
            await this.setMeta("device", await this.uuid());
    }
    async uuid() {
        return (await this.db.getFirstAsync("SELECT lower(hex(randomblob(16))) AS id")).id;
    }
    async meta(key) {
        return (await this.db.getFirstAsync("SELECT value FROM drive_sync_meta WHERE key = ?", key))?.value;
    }
    async setMeta(key, value) {
        await this.db.runAsync("INSERT INTO drive_sync_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, value);
    }
    async bindAccount(id, email) {
        const owner = await this.meta("owner");
        if (owner && owner !== id)
            throw new Error(`This device's data is connected to ${await this.meta("email")}. Reconnect that Google account to avoid mixing accounts.`);
        await this.setMeta("owner", id);
        await this.setMeta("email", email);
    }
    async all() { return this.db.getAllAsync("SELECT * FROM drive_sync_records"); }
    async put(record, localId, snapshot) {
        await this.db.runAsync(`INSERT INTO drive_sync_records (table_name, global_id, local_id, snapshot, record)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(table_name, global_id) DO UPDATE SET
      local_id = excluded.local_id, snapshot = excluded.snapshot, record = excluded.record`, record.table, record.id, localId, snapshot, JSON.stringify(record));
    }
    async queue(records) {
        // Bound individual upload sizes, including inline receipts. Outbox bodies
        // are immutable and survive crashes and ambiguous network responses.
        let chunk = [], size = 0;
        const flush = async () => {
            if (!chunk.length)
                return;
            const batch = { format: 1, id: await this.uuid(), records: chunk };
            const body = JSON.stringify(batch);
            (0, model_1.parseBatch)(body, this.schema); // Reject invalid local data before committing its snapshot/outbox.
            await this.db.runAsync("INSERT INTO drive_sync_outbox VALUES (?, ?)", batch.id, body);
            chunk = [];
            size = 0;
        };
        for (const record of records) {
            const bytes = JSON.stringify(record).length;
            if (bytes > 20 * 1024 * 1024)
                throw new Error("A record is too large to sync. Reduce attachments and try again.");
            if (chunk.length >= 100 || size + bytes > 20 * 1024 * 1024)
                await flush();
            chunk.push(record);
            size += bytes;
        }
        await flush();
    }
    // Caller holds the database lock. Snapshot differences capture *all* write
    // paths, including app upgrades and deletes, without networking in a save.
    async capture() {
        await this.db.withTransactionAsync(async () => {
            const stored = await this.all();
            const byLocal = new Map(stored.filter((r) => r.local_id !== null).map((r) => [`${r.table_name}/${r.local_id}`, r]));
            const byGlobal = new Map(stored.map((r) => [`${r.table_name}/${r.global_id}`, r]));
            const rows = new Map();
            // Assign every ID before translating any foreign keys.
            for (const table of this.tableNames) {
                const selected = await this.db.getAllAsync(`SELECT ${this.primaryKey(table).column} AS __sync_id, ${this.schema[table].columns.join(", ")} FROM ${table}`);
                rows.set(table, selected.filter((r) => this.schema[table].include?.(r) ?? true));
                for (const row of rows.get(table)) {
                    if (byLocal.has(`${table}/${row.__sync_id}`))
                        continue;
                    let id = await this.uuid();
                    const candidate = this.schema[table].identity?.(row, (parent, localId) => byLocal.get(`${parent}/${localId}`)?.global_id);
                    if (candidate && !byGlobal.has(`${table}/${candidate}`))
                        id = candidate;
                    if (!(0, model_1.validId)(id))
                        throw new Error('Invalid stable record identity.');
                    const record = { table, id, deleted: false, fields: {} };
                    const item = { table_name: table, global_id: id, local_id: row.__sync_id, snapshot: null, record: JSON.stringify(record) };
                    byLocal.set(`${table}/${row.__sync_id}`, item);
                    byGlobal.set(`${table}/${id}`, item);
                }
            }
            let clock = Number(await this.meta("clock") || 0);
            const device = (await this.meta("device"));
            const changed = [];
            for (const table of this.tableNames) {
                const present = new Set();
                for (const row of rows.get(table)) {
                    present.add(row.__sync_id);
                    const item = byLocal.get(`${table}/${row.__sync_id}`);
                    const raw = Object.fromEntries(this.schema[table].columns.map((key) => [key, row[key]]));
                    const snapshot = stable(raw);
                    if (item.snapshot === snapshot)
                        continue;
                    const record = JSON.parse(item.record);
                    if (record.deleted)
                        continue;
                    const previous = item.snapshot ? JSON.parse(item.snapshot) : {};
                    const fields = { ...record.fields };
                    clock++;
                    for (const column of this.schema[table].columns) {
                        if (raw[column] === previous[column] && fields[column])
                            continue;
                        let value = raw[column];
                        const referenced = this.schema[table].refs[column];
                        if (referenced && value !== null) {
                            const reference = byLocal.get(`${referenced}/${value}`);
                            if (!reference)
                                throw new Error("A local record has a missing reference. Your data has not been uploaded.");
                            value = reference.global_id;
                        }
                        if (this.schema[table].encode)
                            value = await this.schema[table].encode(column, value);
                        fields[column] = { value, clock, device };
                    }
                    const next = { ...record, fields };
                    await this.put(next, row.__sync_id, snapshot);
                    changed.push(next);
                }
                for (const item of stored.filter((r) => r.table_name === table)) {
                    if (item.local_id === null || item.snapshot === null || present.has(item.local_id))
                        continue;
                    const record = { ...JSON.parse(item.record), deleted: true };
                    await this.put(record, item.local_id, null);
                    changed.push(record);
                }
            }
            await this.setMeta("clock", String(clock));
            await this.queue(changed);
        });
    }
    async apply(files) {
        await this.db.withTransactionAsync(async () => {
            let clock = Number(await this.meta("clock") || 0);
            for (const { id, batch } of files) {
                for (const incoming of batch.records) {
                    const existing = await this.db.getFirstAsync("SELECT * FROM drive_sync_records WHERE table_name = ? AND global_id = ?", incoming.table, incoming.id);
                    const record = (0, model_1.mergeRecord)(existing ? JSON.parse(existing.record) : undefined, incoming);
                    for (const cell of Object.values(record.fields))
                        clock = Math.max(clock, cell.clock);
                    await this.put(record, existing?.local_id ?? null, existing?.snapshot ?? null);
                }
                await this.db.runAsync("INSERT OR IGNORE INTO drive_sync_seen VALUES (?)", id);
            }
            await this.setMeta("clock", String(clock));
            await this.materialize();
        });
    }
    async materialize() {
        const stored = await this.all();
        const byKey = new Map(stored.map((r) => [`${r.table_name}/${r.global_id}`, r]));
        const records = new Map(stored.map((r) => [`${r.table_name}/${r.global_id}`, JSON.parse(r.record)]));
        const live = new Set();
        // Table order is topological; children of deleted or not-yet-downloaded
        // parents remain retained in metadata but hidden from the local app.
        for (const table of this.tableNames)
            for (const item of stored.filter((r) => r.table_name === table)) {
                const key = `${table}/${item.global_id}`, record = records.get(key);
                const values = (0, model_1.valuesOf)(record);
                const dependenciesPresent = Object.entries(this.schema[table].refs).every(([column, parent]) => values[column] === null || live.has(`${parent}/${values[column]}`));
                if (!record.deleted && dependenciesPresent)
                    live.add(key);
            }
        // Remove children before parents, respecting SQLite foreign keys.
        for (const table of [...this.tableNames].reverse())
            for (const item of stored.filter((r) => r.table_name === table)) {
                if (live.has(`${table}/${item.global_id}`) || item.local_id === null)
                    continue;
                await this.db.runAsync(`DELETE FROM ${table} WHERE ${this.primaryKey(table).column} = ?`, item.local_id);
                await this.put(records.get(`${table}/${item.global_id}`), item.local_id, null);
            }
        for (const table of this.tableNames)
            for (const item of stored.filter((r) => r.table_name === table)) {
                const key = `${table}/${item.global_id}`;
                if (!live.has(key))
                    continue;
                const record = records.get(key), values = (0, model_1.valuesOf)(record);
                for (const [column, parent] of Object.entries(this.schema[table].refs)) {
                    if (values[column] !== null)
                        values[column] = byKey.get(`${parent}/${values[column]}`).local_id;
                }
                // A downloaded data URI works on native and web without an auth URL.
                const snapshot = stable(values);
                if (item.snapshot === snapshot)
                    continue;
                const columns = this.schema[table].columns;
                if (item.local_id !== null && await this.db.getFirstAsync(`SELECT ${this.primaryKey(table).column} FROM ${table} WHERE ${this.primaryKey(table).column} = ?`, item.local_id)) {
                    await this.db.runAsync(`UPDATE ${table} SET ${columns.map((c) => `${c} = ?`).join(", ")} WHERE ${this.primaryKey(table).column} = ?`, ...columns.map((c) => values[c]), item.local_id);
                }
                else {
                    const result = await this.db.runAsync(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`, ...columns.map((c) => values[c]));
                    item.local_id = this.primaryKey(table).type === 'text' ? values[this.primaryKey(table).column] : result.lastInsertRowId;
                }
                item.snapshot = snapshot;
                await this.put(record, item.local_id, snapshot);
            }
    }
    async pending() { return this.db.getAllAsync("SELECT * FROM drive_sync_outbox ORDER BY rowid"); }
    async seen(id) { return !!await this.db.getFirstAsync("SELECT id FROM drive_sync_seen WHERE id = ?", id); }
    async acknowledge(batchId, fileId) {
        await this.db.withTransactionAsync(async () => {
            await this.db.runAsync("DELETE FROM drive_sync_outbox WHERE id = ?", batchId);
            await this.db.runAsync("INSERT OR IGNORE INTO drive_sync_seen VALUES (?)", fileId);
        });
    }
}
exports.SyncStore = SyncStore;
