export class ReconnectRequired extends Error {
  constructor() { super("Reconnect Google Drive to continue syncing. Your changes are saved on this device."); }
}
export async function request(url: string, init: RequestInit = {}) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 45000);
  try { return await fetch(url, { ...init, signal: abort.signal }); }
  finally { clearTimeout(timer); }
}
export async function checkResponse(response: Response) {
  if (response.status === 401) throw new ReconnectRequired();
  if (!response.ok) {
    if (response.status === 429 || response.status >= 500) throw new Error("Google Drive is busy. Sync will retry automatically.");
    const error = await response.json().catch(() => ({}));
    const reason = error?.error?.errors?.[0]?.reason;
    if (reason === "storageQuotaExceeded") throw new Error("Your Google Drive is full. Free some space and sync again.");
    if (reason === "rateLimitExceeded" || reason === "userRateLimitExceeded") throw new Error("Google Drive's request limit was reached. Sync will retry automatically.");
    throw new Error("Google Drive could not complete sync. Check Drive permission and try reconnecting.");
  }
  return response;
}
