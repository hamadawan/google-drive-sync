import { checkResponse, request } from "./http";
import { Batch } from "./model";

export type DriveFile = { id: string; name: string };
export interface DriveTransport {
  list(): Promise<DriveFile[]>;
  download(file: DriveFile): Promise<Batch>;
  upload(id: string, body: string): Promise<string>;
}

export class GoogleDrive implements DriveTransport {
  constructor(private token: () => Promise<string>, readonly prefix: string, private parseBatch: (text: string) => Batch) {
    if (!/^[a-zA-Z0-9_-]+-$/.test(prefix)) throw new Error('Use a unique app prefix ending in a hyphen.');
  }
  private async call(path: string, init: RequestInit = {}, upload = false) {
    return checkResponse(await request(`https://www.googleapis.com/${upload ? "upload/" : ""}drive/v3/${path}`, {
      ...init, headers: { ...init.headers, Authorization: `Bearer ${await this.token()}` },
    }));
  }
  async list() {
    const files: DriveFile[] = [];
    let next: string | undefined;
    do {
      const query = new URLSearchParams({ spaces: "appDataFolder", q: `trashed = false and name contains '${this.prefix}'`, pageSize: "1000", fields: "nextPageToken,files(id,name)" });
      if (next) query.set("pageToken", next);
      const result = await (await this.call(`files?${query}`)).json();
      files.push(...(result.files || []).filter((file: DriveFile) => file.name.startsWith(this.prefix) && file.name.endsWith(".json")));
      next = result.nextPageToken;
    } while (next);
    return files;
  }
  async download(file: DriveFile) {
    const response = await this.call(`files/${encodeURIComponent(file.id)}?alt=media`);
    if (Number(response.headers.get("Content-Length")) > 24 * 1024 * 1024) throw new Error("Drive sync file is too large.");
    const batch = this.parseBatch(await response.text());
    if (file.name !== `${this.prefix}${batch.id}.json`) throw new Error("Drive sync file identity does not match its content.");
    return batch;
  }
  async upload(id: string, body: string) {
    const metadata = JSON.stringify({ name: `${this.prefix}${id}.json`, parents: ["appDataFolder"], mimeType: "application/json" });
    // Use an upload session because a batch containing receipts can exceed
    // the small-file multipart limit. Failed sessions are retried from the
    // durable outbox; completed uploads are discovered by batch name.
    const session = await this.call("files?uploadType=resumable&fields=id", {
      method: "POST", headers: { "Content-Type": "application/json", "X-Upload-Content-Type": "application/json" }, body: metadata,
    }, true);
    const location = session.headers.get("Location");
    if (!location || new URL(location).origin !== "https://www.googleapis.com" || !new URL(location).pathname.startsWith("/upload/drive/"))
      throw new Error("Google Drive did not return a valid upload session.");
    const result = await (await checkResponse(await request(location, {
      method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await this.token()}` }, body,
    }))).json();
    if (!result.id) throw new Error("Google Drive did not confirm the upload. Sync will retry.");
    return result.id as string;
  }
}
