import { checkResponse, request } from "./http";
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
export type GoogleAccount = { id: string; email: string };
export interface GoogleAuth {
  readonly configured: boolean;
  connect(): Promise<GoogleAccount>;
  restore(): Promise<GoogleAccount | null>;
  accessToken(): Promise<string>;
  disconnect(): Promise<void>;
  invalidate(): Promise<void>;
}
export async function googleAccount(token: string): Promise<GoogleAccount> {
  const response = await checkResponse(await request("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${token}` },
  }));
  const user = await response.json();
  if (typeof user.sub !== "string" || typeof user.email !== "string") throw new Error("Could not identify your Google account.");
  return { id: user.sub, email: user.email };
}
