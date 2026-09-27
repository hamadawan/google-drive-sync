import { DRIVE_SCOPE, googleAccount, GoogleAuth } from './auth';
import { ReconnectRequired } from './http';
/** Inject the native GoogleSignin SDK from the host app; core has no React Native dependency. */
export interface GoogleSigninSDK {
  configure(options: { webClientId: string; iosClientId?: string; scopes: string[]; offlineAccess: boolean }): void;
  hasPlayServices(options: { showPlayServicesUpdateDialog: boolean }): Promise<unknown>;
  signIn(): Promise<{ type: string; data?: { scopes: string[]; user: { id: string } } | null }>;
  signInSilently(): Promise<{ type: string; data?: { user: { id: string } } | null }>;
  getCurrentUser(): { user: { id: string } } | null;
  getTokens(): Promise<{ accessToken: string }>;
  signOut(): Promise<unknown>;
  clearCachedAccessToken(token: string): Promise<unknown>;
}
export function createNativeGoogleAuth(options: {
  webClientId: string; iosClientId?: string; isIOS?: boolean; isExpoGo?: boolean;
  loadSDK: () => Promise<GoogleSigninSDK>;
}): GoogleAuth {
  let configured = false, signedInId: string | undefined;
  const available = !!options.webClientId && (!options.isIOS || !!options.iosClientId);
  async function sdk() {
    if (options.isExpoGo) throw new Error('Google Drive needs an installed app build. It is not available in Expo Go.');
    if (!available) throw new Error('Google Drive connection is not available in this build.');
    const google = await options.loadSDK();
    if (!configured) {
      google.configure({ webClientId: options.webClientId, iosClientId: options.iosClientId, scopes: [DRIVE_SCOPE], offlineAccess: false });
      configured = true;
    }
    return google;
  }
  async function accessToken() {
    const google = await sdk();
    if (!signedInId || google.getCurrentUser()?.user.id !== signedInId) throw new ReconnectRequired();
    return (await google.getTokens()).accessToken;
  }
  return {
    configured: available,
    accessToken,
    async connect() {
      const google = await sdk();
      await google.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const result = await google.signIn();
      if (result.type !== 'success' || !result.data) throw new Error('Google connection was cancelled.');
      if (!result.data.scopes.includes(DRIVE_SCOPE)) throw new Error('Allow this app to save its app data in Google Drive, then reconnect.');
      signedInId = result.data.user.id;
      return googleAccount(await accessToken());
    },
    async restore() {
      if (!available || options.isExpoGo) return null;
      const result = await (await sdk()).signInSilently();
      if (result.type !== 'success' || !result.data) return null;
      signedInId = result.data.user.id;
      return googleAccount(await accessToken());
    },
    async disconnect() { signedInId = undefined; if (configured) await (await sdk()).signOut(); },
    async invalidate() { const google = await sdk(); await google.clearCachedAccessToken((await google.getTokens()).accessToken); },
  };
}
