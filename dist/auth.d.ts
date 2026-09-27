export declare const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
export type GoogleAccount = {
    id: string;
    email: string;
};
export interface GoogleAuth {
    readonly configured: boolean;
    connect(): Promise<GoogleAccount>;
    restore(): Promise<GoogleAccount | null>;
    accessToken(): Promise<string>;
    disconnect(): Promise<void>;
    invalidate(): Promise<void>;
}
export declare function googleAccount(token: string): Promise<GoogleAccount>;
