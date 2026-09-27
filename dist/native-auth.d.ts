import { GoogleAuth } from './auth';
/** Inject the native GoogleSignin SDK from the host app; core has no React Native dependency. */
export interface GoogleSigninSDK {
    configure(options: {
        webClientId: string;
        iosClientId?: string;
        scopes: string[];
        offlineAccess: boolean;
    }): void;
    hasPlayServices(options: {
        showPlayServicesUpdateDialog: boolean;
    }): Promise<unknown>;
    signIn(): Promise<{
        type: string;
        data?: {
            scopes: string[];
            user: {
                id: string;
            };
        } | null;
    }>;
    signInSilently(): Promise<{
        type: string;
        data?: {
            user: {
                id: string;
            };
        } | null;
    }>;
    getCurrentUser(): {
        user: {
            id: string;
        };
    } | null;
    getTokens(): Promise<{
        accessToken: string;
    }>;
    signOut(): Promise<unknown>;
    clearCachedAccessToken(token: string): Promise<unknown>;
}
export declare function createNativeGoogleAuth(options: {
    webClientId: string;
    iosClientId?: string;
    isIOS?: boolean;
    isExpoGo?: boolean;
    loadSDK: () => Promise<GoogleSigninSDK>;
}): GoogleAuth;
