# v0.1.0

- Extract the SQLite record sync engine from ProSpend with configurable schemas and app-specific validation/identity hooks.
- Preserve ProSpend v1 wire format, metadata tables, durable outbox, and existing Drive file names.
- Support integer and text primary keys, relationship remapping, per-field merging, and delete-wins tombstones.
- Provide Google Drive transport, native/browser authentication factories, a shared sync client, and a database lock.
- Add generic SQLite, retry, account binding, and transport tests.
- Integrate both ProSpend and Noor-e-Qalb through the shared versioned package.

Limitations: no background sync while apps are closed, account switching, history compaction, conflict-review UI, or end-to-end encryption. Live Google OAuth/device verification remains an application setup step.
