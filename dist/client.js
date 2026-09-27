"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SyncClient = void 0;
const drive_1 = require("./drive");
const engine_1 = require("./engine");
const http_1 = require("./http");
const model_1 = require("./model");
const message = (error) => error instanceof Error ? error.message : 'Could not sync. Your changes are saved on this device.';
/** One client per database/account. Call sync on foreground, online, and a visible-app timer. */
class SyncClient {
    store;
    auth;
    lock;
    prefix;
    state = { ready: false, connected: false, busy: false, email: '', error: '', lastSync: '', revision: 0 };
    listeners = new Set();
    engine;
    initialization;
    active;
    connecting = false;
    retryAfter = 0;
    failures = 0;
    constructor(store, auth, lock, prefix) {
        this.store = store;
        this.auth = auth;
        this.lock = lock;
        this.prefix = prefix;
    }
    getSnapshot = () => this.state;
    subscribe = (listener) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
    set(state) {
        this.state = { ...this.state, ...state };
        for (const listener of this.listeners)
            listener();
    }
    initialize() {
        return this.initialization ??= (async () => {
            await this.lock(async () => {
                await this.store.initialize();
                this.set({ email: await this.store.meta('email') || '', lastSync: await this.store.meta('last_sync') || '' });
            });
            if (await this.lock(() => this.store.meta('enabled')) === 'true') {
                try {
                    const account = await this.auth.restore();
                    if (account)
                        await this.attach(account);
                }
                catch {
                    await this.auth.disconnect().catch(() => undefined);
                }
            }
            this.set({ ready: true });
        })().catch(error => { this.set({ error: message(error) }); throw error; });
    }
    async attach(account) {
        await this.lock(async () => {
            await this.store.bindAccount(account.id, account.email);
            await this.store.setMeta('enabled', 'true');
        });
        this.engine = new engine_1.SyncEngine(this.store, new drive_1.GoogleDrive(this.auth.accessToken, this.prefix, text => (0, model_1.parseBatch)(text, this.store.schema)), this.lock, () => this.set({ revision: this.state.revision + 1 }), this.prefix);
        this.failures = 0;
        this.retryAfter = 0;
        this.set({ connected: true, email: account.email, error: '' });
    }
    connect = async () => {
        if (this.connecting || this.active || !this.state.ready)
            return;
        this.connecting = true;
        this.set({ busy: true, error: '' });
        try {
            await this.attach(await this.auth.connect());
        }
        catch (error) {
            this.engine = undefined;
            await this.auth.disconnect().catch(() => undefined);
            this.set({ connected: false, error: message(error) });
        }
        finally {
            this.connecting = false;
            this.set({ busy: false });
        }
        if (this.engine)
            await this.sync(true);
    };
    sync = (manual = false) => {
        if (this.active)
            return this.active;
        if (!this.engine || this.connecting || (!manual && Date.now() < this.retryAfter))
            return Promise.resolve();
        const engine = this.engine;
        this.set({ busy: true, error: '' });
        this.active = (async () => {
            try {
                await engine.sync();
                this.failures = 0;
                this.retryAfter = 0;
                this.set({ lastSync: new Date().toISOString() });
            }
            catch (error) {
                this.failures++;
                this.retryAfter = Date.now() + Math.min(300000, 15000 * 2 ** Math.min(this.failures, 5)) + Math.random() * 3000;
                if (error instanceof http_1.ReconnectRequired) {
                    await this.auth.invalidate().catch(() => undefined);
                    this.engine = undefined;
                    this.set({ connected: false });
                }
                this.set({ error: message(error) });
            }
            finally {
                this.set({ busy: false });
                this.active = undefined;
            }
        })();
        return this.active;
    };
    disconnect = async () => {
        if (this.connecting || this.active || this.state.busy || !this.state.ready)
            return;
        this.connecting = true;
        this.engine = undefined;
        this.set({ connected: false, busy: true });
        try {
            await this.lock(() => this.store.setMeta('enabled', 'false'));
            await this.auth.disconnect();
            this.set({ error: '' });
        }
        catch (error) {
            this.set({ error: message(error) });
        }
        finally {
            this.connecting = false;
            this.set({ busy: false });
        }
    };
}
exports.SyncClient = SyncClient;
