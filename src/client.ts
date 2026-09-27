import { GoogleAuth, GoogleAccount } from './auth';
import { SyncStore } from './database';
import { GoogleDrive } from './drive';
import { SyncEngine } from './engine';
import { ReconnectRequired } from './http';
import { DatabaseLock } from './lock';
import { parseBatch } from './model';
export type SyncState = {
  ready: boolean; connected: boolean; busy: boolean; email: string;
  error: string; lastSync: string; revision: number;
};
const message = (error: unknown) => error instanceof Error ? error.message : 'Could not sync. Your changes are saved on this device.';
/** One client per database/account. Call sync on foreground, online, and a visible-app timer. */
export class SyncClient {
  private state: SyncState = { ready: false, connected: false, busy: false, email: '', error: '', lastSync: '', revision: 0 };
  private listeners = new Set<() => void>();
  private engine?: SyncEngine;
  private initialization?: Promise<void>;
  private active?: Promise<void>;
  private connecting = false;
  private retryAfter = 0;
  private failures = 0;
  constructor(readonly store: SyncStore, private auth: GoogleAuth, private lock: DatabaseLock, readonly prefix: string) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private set(state: Partial<SyncState>) {
    this.state = { ...this.state, ...state };
    for (const listener of this.listeners) listener();
  }
  initialize() {
    return this.initialization ??= (async () => {
      await this.lock(async () => {
        await this.store.initialize();
        this.set({ email: await this.store.meta('email') || '', lastSync: await this.store.meta('last_sync') || '' });
      });
      if (await this.lock(() => this.store.meta('enabled')) === 'true') {
        try { const account = await this.auth.restore(); if (account) await this.attach(account); }
        catch { await this.auth.disconnect().catch(() => undefined); }
      }
      this.set({ ready: true });
    })().catch(error => { this.set({ error: message(error) }); throw error; });
  }
  private async attach(account: GoogleAccount) {
    await this.lock(async () => {
      await this.store.bindAccount(account.id, account.email);
      await this.store.setMeta('enabled', 'true');
    });
    this.engine = new SyncEngine(this.store, new GoogleDrive(this.auth.accessToken, this.prefix, text => parseBatch(text, this.store.schema)), this.lock,
      () => this.set({ revision: this.state.revision + 1 }), this.prefix);
    this.failures = 0; this.retryAfter = 0;
    this.set({ connected: true, email: account.email, error: '' });
  }
  connect = async () => {
    if (this.connecting || this.active || !this.state.ready) return;
    this.connecting = true;
    this.set({ busy: true, error: '' });
    try { await this.attach(await this.auth.connect()); }
    catch (error) {
      this.engine = undefined;
      await this.auth.disconnect().catch(() => undefined);
      this.set({ connected: false, error: message(error) });
    } finally { this.connecting = false; this.set({ busy: false }); }
    if (this.engine) await this.sync(true);
  };
  sync = (manual = false): Promise<void> => {
    if (this.active) return this.active;
    if (!this.engine || this.connecting || (!manual && Date.now() < this.retryAfter)) return Promise.resolve();
    const engine = this.engine;
    this.set({ busy: true, error: '' });
    this.active = (async () => {
      try {
        await engine.sync();
        this.failures = 0; this.retryAfter = 0;
        this.set({ lastSync: new Date().toISOString() });
      } catch (error) {
        this.failures++;
        this.retryAfter = Date.now() + Math.min(300000, 15000 * 2 ** Math.min(this.failures, 5)) + Math.random() * 3000;
        if (error instanceof ReconnectRequired) {
          await this.auth.invalidate().catch(() => undefined);
          this.engine = undefined;
          this.set({ connected: false });
        }
        this.set({ error: message(error) });
      } finally { this.set({ busy: false }); this.active = undefined; }
    })();
    return this.active;
  };
  disconnect = async () => {
    if (this.connecting || this.active || this.state.busy || !this.state.ready) return;
    this.connecting = true;
    this.engine = undefined;
    this.set({ connected: false, busy: true });
    try {
      await this.lock(() => this.store.setMeta('enabled', 'false'));
      await this.auth.disconnect();
      this.set({ error: '' });
    } catch (error) { this.set({ error: message(error) }); }
    finally { this.connecting = false; this.set({ busy: false }); }
  };
}
