export type DatabaseLock = <T>(task: () => Promise<T>) => Promise<T>;
export declare function createDatabaseLock(): DatabaseLock;
