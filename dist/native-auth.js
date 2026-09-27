"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createNativeGoogleAuth = createNativeGoogleAuth;
const auth_1 = require("./auth");
const http_1 = require("./http");
function createNativeGoogleAuth(options) {
    let configured = false, signedInId;
    const available = !!options.webClientId && (!options.isIOS || !!options.iosClientId);
    async function sdk() {
        if (options.isExpoGo)
            throw new Error('Google Drive needs an installed app build. It is not available in Expo Go.');
        if (!available)
            throw new Error('Google Drive connection is not available in this build.');
        const google = await options.loadSDK();
        if (!configured) {
            google.configure({ webClientId: options.webClientId, iosClientId: options.iosClientId, scopes: [auth_1.DRIVE_SCOPE], offlineAccess: false });
            configured = true;
        }
        return google;
    }
    async function accessToken() {
        const google = await sdk();
        if (!signedInId || google.getCurrentUser()?.user.id !== signedInId)
            throw new http_1.ReconnectRequired();
        return (await google.getTokens()).accessToken;
    }
    return {
        configured: available,
        accessToken,
        async connect() {
            const google = await sdk();
            await google.hasPlayServices({ showPlayServicesUpdateDialog: true });
            const result = await google.signIn();
            if (result.type !== 'success' || !result.data)
                throw new Error('Google connection was cancelled.');
            if (!result.data.scopes.includes(auth_1.DRIVE_SCOPE))
                throw new Error('Allow this app to save its app data in Google Drive, then reconnect.');
            signedInId = result.data.user.id;
            return (0, auth_1.googleAccount)(await accessToken());
        },
        async restore() {
            if (!available || options.isExpoGo)
                return null;
            const result = await (await sdk()).signInSilently();
            if (result.type !== 'success' || !result.data)
                return null;
            signedInId = result.data.user.id;
            return (0, auth_1.googleAccount)(await accessToken());
        },
        async disconnect() { signedInId = undefined; if (configured)
            await (await sdk()).signOut(); },
        async invalidate() { const google = await sdk(); await google.clearCachedAccessToken((await google.getTokens()).accessToken); },
    };
}
