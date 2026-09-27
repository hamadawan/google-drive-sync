"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DRIVE_SCOPE = void 0;
exports.googleAccount = googleAccount;
const http_1 = require("./http");
exports.DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
async function googleAccount(token) {
    const response = await (0, http_1.checkResponse)(await (0, http_1.request)("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${token}` },
    }));
    const user = await response.json();
    if (typeof user.sub !== "string" || typeof user.email !== "string")
        throw new Error("Could not identify your Google account.");
    return { id: user.sub, email: user.email };
}
