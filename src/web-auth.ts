import { DRIVE_SCOPE, googleAccount, GoogleAuth } from "./auth";
import { ReconnectRequired } from "./http";

export function createWebGoogleAuth(options: { webClientId: string; helperPath?: string }): GoogleAuth {
const { webClientId, helperPath = '/drive-auth.html' } = options;
const authConfigured = !!webClientId;
let token: { access: string; expires: number } | undefined;
async function connectGoogle() {
  if (!authConfigured) throw new Error("Google Drive connection is not available in this build.");
  if (!globalThis.crypto?.getRandomValues || typeof BroadcastChannel === "undefined") throw new Error("Google Drive needs a modern browser and an HTTPS connection (or localhost).");
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(24)), (n) => n.toString(16).padStart(2, "0")).join("");
  const channel = new BroadcastChannel(`drive-sync-google-${nonce}`);
  const fragment = new URLSearchParams({ nonce, clientId: webClientId, scope: DRIVE_SCOPE });
  // The helper page permits Google's popup. The main SQLite page keeps its
  // existing COOP/COEP isolation. BroadcastChannel works without window.opener.
  const popup = window.open(`${helperPath}#${fragment}`, "_blank", "popup,width=500,height=650");
  if (!popup) { channel.close(); throw new Error("Allow the sign-in popup, then connect again."); }
  await new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer); channel.close();
      if (error) reject(error); else resolve();
    };
    const timer = setTimeout(() => finish(new Error("Google connection timed out. Try connecting again.")), 180000);
    channel.onmessage = ({ data }) => {
      if (data?.nonce !== nonce) return;
      if (data.error) return finish(new Error("Google connection was cancelled or denied. Try connecting again."));
      if (typeof data.access_token !== "string" || !Number.isFinite(Number(data.expires_in)) || Number(data.expires_in) <= 0) return finish(new Error("Google returned an invalid authorization response."));
      if (!String(data.scope).split(" ").includes(DRIVE_SCOPE)) return finish(new Error("Allow this app to save its app data in Google Drive, then reconnect."));
      token = { access: data.access_token, expires: Date.now() + Number(data.expires_in) * 1000 - 60000 };
      finish();
    };
  });
  return googleAccount(await accessToken());
}
async function accessToken() {
  if (!token || token.expires <= Date.now()) throw new ReconnectRequired();
  return token.access;
}
async function restoreGoogle() { return null; }
async function disconnectGoogle() { token = undefined; }
async function invalidateGoogleToken() { token = undefined; }

return { configured: authConfigured, connect: connectGoogle, restore: restoreGoogle, accessToken, disconnect: disconnectGoogle, invalidate: invalidateGoogleToken };
}
