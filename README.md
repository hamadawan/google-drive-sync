# Google Drive Sync

A TypeScript package for personal, offline-first apps: SQLite stores working data and Google Drive's hidden `appDataFolder` exchanges immutable change batches between a user's devices. No application server is required. Used by ProSpend and Noor-e-Qalb.

## Install

After the public GitHub release is published:

```sh
npm install github:hamadawan/google-drive-sync#v0.1.0
```

For the prepared release before publishing, install `hamadawan-google-drive-sync-0.1.0.tgz`. Both apps currently include that exact archive under `vendor/` and use a `file:` dependency. This archive contains compiled JavaScript and TypeScript declarations; consumers do not need a TypeScript build step. The repository also commits `dist/` for GitHub installs.

## Database and schema

The core has no React, Expo, Drizzle, or Google SDK dependency. Supply a `SyncDatabase` implementing the small asynchronous SQLite interface (Expo SQLite satisfies it), a schema, and one shared write lock. Each database supports one schema/client/account binding. Table declarations are in parent-before-child order; cyclic references are unsupported.

```ts
import { SyncStore, SyncClient, createDatabaseLock, type SyncSchema } from '@hamadawan/google-drive-sync';

const schema: SyncSchema = {
  notes: {
    columns: ['title', 'body'],
    refs: {},
    validate: (_record, row) => typeof row.title === 'string' && typeof row.body === 'string',
  },
  settings: {
    primaryKey: { column: 'key', type: 'text' },
    columns: ['key', 'value'], refs: {},
    include: row => row.key === 'theme',
    identity: row => `setting:${row.key}`,
    validate: (record, row) => row.key === 'theme' && record.id === `setting:${row.key}` && typeof row.value === 'string',
  },
};
const lock = createDatabaseLock();
const store = new SyncStore(sqlite, schema);
const client = new SyncClient(store, googleAuth, lock, 'my-app-sync-v1-');
await client.initialize();
client.subscribe(() => console.log(client.getSnapshot()));
// Call connect directly from a button gesture (browser popup requirement).
// await client.connect();
// await client.sync(true); // manual: bypass retry backoff
// await client.disconnect();
```

All app reads that need a consistent snapshot and all writes must use the same lock as sync. Do not reacquire the lock inside an operation already holding it. Initialize app tables before initializing the client. Keep local IDs stable and never reuse deleted identities.

Integer primary keys default to `id` and are translated to global IDs in a side table. Text primary keys must be included in `columns`; give them an `identity` callback and globally unique values. For custom primary keys, set `primaryKey.column`. Use `refs: { parent_id: 'parents' }` for relationships. Missing/deleted parents hide their children until dependencies can be materialized. Each optional `validate` callback enforces the app's types and invariants on remote records. Optional `encode` transforms local values, e.g. receipt URIs to durable image data.

Local writes are captured by snapshot comparison when synchronization runs; saves remain durable in the application's SQLite tables until then. Change batches and download acknowledgments are committed transactionally. SQLite must provide real rollback semantics for `withTransactionAsync`.

## Google authentication

Use a separate Google Cloud project for each distinct app. Enable Drive API and configure consent for `openid`, `email`, and `https://www.googleapis.com/auth/drive.appdata`. Group an app's web, Android, and iOS clients in its project. The package never reads environment variables or embeds credentials.

Browser:

```ts
import { createWebGoogleAuth } from '@hamadawan/google-drive-sync/web-auth';
const googleAuth = createWebGoogleAuth({ webClientId: 'YOUR_WEB_CLIENT_ID' });
```

Copy the exported asset `@hamadawan/google-drive-sync/web/drive-auth.html` to the app's public folder. It uses a second user gesture to open Google Identity Services outside the SQLite page's isolation, and sends tokens through a random same-origin BroadcastChannel. Use HTTPS outside localhost. Tokens stay in memory; reload/expiry requires reconnecting. For a subpath deployment, set `helperPath` explicitly.

Serve app pages with:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

Serve **only `/drive-auth.html`** with:

```text
Cross-Origin-Opener-Policy: same-origin-allow-popups
Cross-Origin-Embedder-Policy: unsafe-none
```

The helper must be a real static page, never an SPA fallback. Configure these response headers on your host/CDN; meta tags do not suffice.

Native Expo:

```ts
import { createNativeGoogleAuth } from '@hamadawan/google-drive-sync/native-auth';
const googleAuth = createNativeGoogleAuth({
  webClientId: 'YOUR_WEB_CLIENT_ID',
  iosClientId: 'YOUR_IOS_CLIENT_ID', // required for iOS
  isIOS: Platform.OS === 'ios',
  isExpoGo: Constants.executionEnvironment === 'storeClient',
  loadSDK: async () => (await import('@react-native-google-signin/google-signin')).GoogleSignin,
});
```

The host app installs `@react-native-google-signin/google-signin`, configures Android package/SHA-1 and iOS bundle ID/URL scheme, and builds an installed native app. Expo Go cannot load the native sign-in SDK. Never put a Google client secret in a public app bundle.

Call `client.sync()` on foreground, network recovery, and a 30-second visible-app timer. The client deduplicates concurrent runs and backs off after failures. Scheduling is controlled by the host; sync does not run while an app is closed. Use `getSnapshot`/`subscribe` with React's `useSyncExternalStore` or adapt them to your state library. `revision` changes after remote data commits, including when a subsequent upload fails; reload visible app data when it changes.

## Conflict and recovery contract

- Edits merge per field using a logical clock, then device ID as a deterministic tie-breaker. This is not wall-clock last-write-wins. Put values that must change atomically (e.g. ordered steps) in one field, and compute derived totals locally.
- Deletion wins over offline edits. Tombstones and history are retained. Deleted IDs cannot be reused.
- Uploads are immutable. Retries discover already-uploaded batches by their stable names; duplicate downloads merge idempotently.
- Keep each app's file prefix and existing field format stable during extraction. The wire envelope is `format: 1`; validation rejects unknown schemas. Future incompatible schema changes need an explicit migration/compatibility plan, not just renamed columns or a changed prefix.
- A device is bound to one Google account. Disconnect keeps local records, pending changes, remote history, and the binding. Account switching/reset is not implemented.
- This release lists batch metadata during each poll and retains all history. Restoration/storage cost grows with history; compaction and encryption are not implemented. Avoid large inline attachments (record limit about 20 MB).
- Data is not end-to-end encrypted by this package. Users can revoke access or delete their app data. Drive storage and API quotas apply. Provide an independent export if archival recovery matters.
- `appDataFolder` cannot share files across users. This package targets personal-device sync, not collaborative workspaces or server-side authorization.

Google references: [app data](https://developers.google.com/workspace/drive/api/guides/appdata), [quotas](https://developers.google.com/workspace/drive/api/guides/limits), [web token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model).

## Develop and release

Use Node 22.13+ (tests use `node:sqlite`). Runtime consumers need fetch, AbortController, and their SQLite adapter.

```sh
npm ci
npm test
npm pack
```

See [RELEASING.md](RELEASING.md) for the initial GitHub publication and changing the two consumers to the release tag. CI builds, runs the SQLite/transport/client tests, checks committed output is current, and produces an installable tarball. No publish happens automatically.
