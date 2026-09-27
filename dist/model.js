"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.valuesOf = exports.recordKey = exports.validId = void 0;
exports.validateSchema = validateSchema;
exports.mergeRecord = mergeRecord;
exports.parseBatch = parseBatch;
const validId = (value) => typeof value === 'string' && /^[a-zA-Z0-9:._-]{1,240}$/.test(value);
exports.validId = validId;
const recordKey = (record) => `${record.table}/${record.id}`;
exports.recordKey = recordKey;
const valuesOf = (record) => Object.fromEntries(Object.entries(record.fields).map(([key, cell]) => [key, cell.value]));
exports.valuesOf = valuesOf;
function validateSchema(schema) {
    const visited = new Set();
    const identifier = (s) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s);
    for (const [name, table] of Object.entries(schema)) {
        if (!identifier(name) || name.startsWith('drive_sync_') || !table.columns.length || table.columns.some(c => !identifier(c)) || new Set(table.columns).size !== table.columns.length)
            throw new Error('Invalid sync table or column identifier.');
        const pk = table.primaryKey ?? { column: 'id', type: 'integer' };
        if (!identifier(pk.column) || (pk.type === 'text' && !table.columns.includes(pk.column)))
            throw new Error('Text primary keys must be included in synchronized columns.');
        for (const [column, parent] of Object.entries(table.refs)) {
            if (!table.columns.includes(column) || !visited.has(parent))
                throw new Error('Declare referenced tables before their children.');
        }
        visited.add(name);
    }
}
function mergeRecord(a, b) {
    if (!a)
        return b;
    if (a.table !== b.table || a.id !== b.id)
        throw new Error('Mismatched sync records.');
    const fields = { ...a.fields };
    for (const [key, cell] of Object.entries(b.fields)) {
        const previous = fields[key];
        if (!previous || cell.clock > previous.clock || (cell.clock === previous.clock && cell.device > previous.device))
            fields[key] = cell;
    }
    return { ...a, deleted: a.deleted || b.deleted, fields };
}
function parseBatch(text, schema) {
    if (text.length > 24 * 1024 * 1024)
        throw new Error('Drive sync file is too large.');
    const fail = () => { throw new Error('Unsupported or damaged sync data. Update the app and retry.'); };
    let batch;
    try {
        batch = JSON.parse(text);
    }
    catch {
        return fail();
    }
    if (!batch || batch.format !== 1 || !(0, exports.validId)(batch.id) || !Array.isArray(batch.records) || batch.records.length > 500)
        fail();
    for (const record of batch.records) {
        if (!record || !Object.hasOwn(schema, record.table) || !(0, exports.validId)(record.id) || typeof record.deleted !== 'boolean' || !record.fields || typeof record.fields !== 'object' || Array.isArray(record.fields))
            fail();
        const definition = schema[record.table];
        if (Object.keys(record.fields).length !== definition.columns.length)
            fail();
        for (const column of definition.columns) {
            const cell = record.fields[column];
            if (!cell || !Number.isSafeInteger(cell.clock) || cell.clock < 0 || !(0, exports.validId)(cell.device))
                fail();
            if (cell.value !== null && typeof cell.value !== 'string' && typeof cell.value !== 'number')
                fail();
            if (typeof cell.value === 'number' && !Number.isFinite(cell.value))
                fail();
            if (Object.hasOwn(definition.refs, column) && cell.value !== null && !(0, exports.validId)(cell.value))
                fail();
        }
        const values = (0, exports.valuesOf)(record);
        if (definition.primaryKey?.type === 'text' && typeof values[definition.primaryKey.column] !== 'string')
            fail();
        if (definition.validate && !definition.validate(record, values))
            fail();
    }
    return batch;
}
