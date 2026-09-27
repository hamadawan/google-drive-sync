import { GoogleAuth } from './auth';
import { SyncStore } from './database';
import { DatabaseLock } from './lock';
export type SyncState = {
    ready: boolean;
    connected: boolean;
    busy: boolean;
    email: string;
    error: string;
    lastSync: string;
    revision: number;
};
/** One client per database/account. Call sync on foreground, online, and a visible-app timer. */
export declare class SyncClient {
    readonly store: SyncStore;
    private auth;
    private lock;
    readonly prefix: string;
    private state;
    private listeners;
    private engine?;
    private initialization?;
    private active?;
    private connecting;
    private retryAfter;
    private failures;
    constructor(store: SyncStore, auth: GoogleAuth, lock: DatabaseLock, prefix: string);
    getSnapshot: () => SyncState;
    subscribe: (listener: () => void) => () => void;
    private set;
    initialize(): Promise<void>;
    private attach;
    connect: () => Promise<void>;
    sync: (manual?: boolean) => Promise<void>;
    disconnect: () => Promise<void>;
}
