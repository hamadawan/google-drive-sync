export type Value = string | number | null;
export type Values = Record<string, Value>;
export type Cell = {
    value: Value;
    clock: number;
    device: string;
};
export type SyncRecord = {
    table: string;
    id: string;
    deleted: boolean;
    fields: Record<string, Cell>;
};
export type Batch = {
    format: 1;
    id: string;
    records: SyncRecord[];
};
export type LocalId = string | number;
export type TableDefinition = {
    columns: readonly string[];
    refs: Readonly<Record<string, string>>;
    primaryKey?: {
        column: string;
        type: 'integer' | 'text';
    };
    include?: (row: Values) => boolean;
    identity?: (row: Values, resolve: (table: string, localId: Value) => string | undefined) => string | undefined;
    encode?: (column: string, value: Value) => Promise<Value>;
    validate?: (record: SyncRecord, values: Values) => boolean;
};
export type SyncSchema = Readonly<Record<string, TableDefinition>>;
export declare const validId: (value: unknown) => value is string;
export declare const recordKey: (record: Pick<SyncRecord, "table" | "id">) => string;
export declare const valuesOf: (record: SyncRecord) => Values;
export declare function validateSchema(schema: SyncSchema): void;
export declare function mergeRecord(a: SyncRecord | undefined, b: SyncRecord): SyncRecord;
export declare function parseBatch(text: string, schema: SyncSchema): Batch;
