import { Batch, SyncRecord, SyncSchema, LocalId } from "./model";
export interface SyncDatabase {
    execAsync(sql: string): Promise<void>;
    runAsync(sql: string, ...params: any[]): Promise<{
        lastInsertRowId: number;
        changes: number;
    }>;
    getAllAsync<T>(sql: string, ...params: any[]): Promise<T[]>;
    getFirstAsync<T>(sql: string, ...params: any[]): Promise<T | null>;
    withTransactionAsync(task: () => Promise<void>): Promise<void>;
}
type Stored = {
    table_name: string;
    global_id: string;
    local_id: LocalId | null;
    snapshot: string | null;
    record: string;
};
export declare class SyncStore {
    readonly db: SyncDatabase;
    readonly schema: SyncSchema;
    readonly tableNames: string[];
    constructor(db: SyncDatabase, schema: SyncSchema);
    private primaryKey;
    initialize(): Promise<void>;
    uuid(): Promise<string>;
    meta(key: string): Promise<string | undefined>;
    setMeta(key: string, value: string): Promise<void>;
    bindAccount(id: string, email: string): Promise<void>;
    all(): Promise<Stored[]>;
    put(record: SyncRecord, localId: LocalId | null, snapshot: string | null): Promise<void>;
    queue(records: SyncRecord[]): Promise<void>;
    capture(): Promise<void>;
    apply(files: {
        id: string;
        batch: Batch;
    }[]): Promise<void>;
    private materialize;
    pending(): Promise<{
        id: string;
        body: string;
    }[]>;
    seen(id: string): Promise<boolean>;
    acknowledge(batchId: string, fileId: string): Promise<void>;
}
export {};
