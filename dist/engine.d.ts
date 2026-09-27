import { SyncStore } from "./database";
import { DriveTransport } from "./drive";
export declare class SyncEngine {
    readonly store: SyncStore;
    private drive;
    private lock;
    private onApplied;
    private prefix;
    private running?;
    constructor(store: SyncStore, drive: DriveTransport, lock: <T>(task: () => Promise<T>) => Promise<T>, onApplied?: () => void, prefix?: string);
    sync(): Promise<boolean>;
    private run;
}
