import { SyncStore } from "./database";
import { DriveTransport } from "./drive";
import { Batch } from "./model";

export class SyncEngine {
  private running?: Promise<boolean>;
  constructor(readonly store: SyncStore, private drive: DriveTransport,
    private lock: <T>(task: () => Promise<T>) => Promise<T>, private onApplied = () => {}, private prefix = "sync-v1-") {}
  sync() {
    if (this.running) return this.running;
    this.running = this.run().finally(() => { this.running = undefined; });
    return this.running;
  }
  private async run() {
    await this.lock(() => this.store.capture());
    const files = await this.drive.list();
    const downloaded: { id: string; batch: Batch }[] = [];
    for (const file of files) {
      if (!await this.lock(() => this.store.seen(file.id))) downloaded.push({ id: file.id, batch: await this.drive.download(file) });
    }
    await this.lock(async () => {
      // Users may have saved while the network was in flight. Capture those
      // changes before merging, or a remote update could overwrite them.
      await this.store.capture();
      if (downloaded.length) await this.store.apply(downloaded);
    });
    // Downloads are already committed even if a subsequent upload fails.
    if (downloaded.length) this.onApplied();
    const pending = await this.lock(() => this.store.pending());
    for (const batch of pending) {
      // A previous upload may have succeeded even though its response was lost.
      const existing = files.find((file) => file.name === `${this.prefix}${batch.id}.json`);
      const fileId = existing?.id ?? await this.drive.upload(batch.id, batch.body);
      await this.lock(() => this.store.acknowledge(batch.id, fileId));
    }
    await this.lock(() => this.store.setMeta("last_sync", new Date().toISOString()));
    return downloaded.length > 0;
  }
}
