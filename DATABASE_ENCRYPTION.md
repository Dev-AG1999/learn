# Database encryption

Passwords are salted scrypt hashes and cannot be decrypted. Session identifiers and refresh tokens are SHA-256 hashes in SQLite. JWT access tokens are signed, not encrypted: keep salary information out of their claims. Google Drive OAuth tokens/verifiers already use AES-256-GCM under DRIVE_TOKEN_SECRET.

The application now supports encrypted SQLite pages through SQLite3 Multiple Ciphers in SQLCipher mode. This encrypts employee records, salary amounts, claims, policies, import drafts, authentication records and file metadata while retaining indexed searches, SQL aggregation, and the existing repository interfaces. All four repository openers use src/db/connection.ts. AI remains disabled.

DATABASE_ENCRYPTION_KEY is a separate, random 32-byte hexadecimal secret. Production refuses to open a database without it. Development retains the legacy plaintext mode only when no key is configured, so existing local databases are not automatically rewritten. Once a key is configured, failures never fall back to plaintext. The driver decrypts pages in server memory during authorized operations; responses and authorization behavior remain unchanged.

## Enable for an existing local database

1. Stop the application and other processes writing to its database. Keep it stopped through migration and configuration.
2. Generate a separate key with `openssl rand -hex 32`. Add it as DATABASE_ENCRYPTION_KEY in .env.local. Do not reuse AUTH_JWT_SECRET or DRIVE_TOKEN_SECRET. Do not commit the key.
3. Run `npm run db:encrypt -- data/payroll.sqlite data/payroll.encrypted.sqlite` (substitute your actual PAYROLL_DB source if different).
4. Set `PAYROLL_DB=data/payroll.encrypted.sqlite` in .env.local. Restart the app and verify login, employee records, documents and payroll totals.
5. The source database is deliberately preserved as a plaintext rollback copy. After verification, remove it from active storage and address plaintext backups/snapshots according to your retention policy. Migration cannot erase historical filesystem snapshots or guarantee secure deletion on SSDs.

The command copies a consistent SQLite backup into a private temporary file, encrypts it, checks integrity, then publishes a new destination atomically without overwriting existing files. It does not change source data. Run offline so subsequent source writes are not missed. A failed migration removes its temporary file. A crash during migration can leave a private .migration file; treat it as sensitive plaintext and remove it after checking the source. Do not migrate by merely changing PAYROLL_DB or setting a key on the existing plaintext file.

For a fresh deployment, set both DATABASE_ENCRYPTION_KEY and PAYROLL_DB before first use; no migration is required. Store the key in the hosting platform's server-only secret settings. Use the same key for every process accessing the database and preserve it separately in a secret manager. Losing it makes the encrypted database unrecoverable. Do not change it to rotate credentials: database rekeying is a separate offline operation, not an implemented UI feature.

## Limits and deployment

This is database-at-rest encryption, not end-to-end encryption. The running server must access plaintext to calculate salaries and answer authorized requests. TLS remains necessary in deployment. This change does not add application-level encryption to existing files in Google Drive, encrypt HTTP responses, encrypt browser memory, or replace RBAC. Google Drive files remain private and use the existing authenticated download flow. Existing plaintext files and backups are not encrypted automatically.

The native database package must be available for the deployment's Node/OS/CPU. It is explicitly externalized in Next.js so native loading works on the server. Use persistent storage for SQLite and keep encrypted backups with the key stored separately. Avoid storing the key beside database backups. Local settings have not been modified and your existing database has not been migrated automatically.

## Boundaries and operations

This encrypts database files, not data in process memory or API responses. Authorization still controls which employee data is returned. HTTPS protects transport. Google Drive attachment payloads retain the existing private Drive storage design and are not newly encrypted by this database change. Existing OAuth-token AES-GCM encryption remains independent.

Losing the database key loses access to encrypted data. Changing the environment key alone is not key rotation. Keep encrypted backups and their keys separately, test restoration, and rotate via a reviewed offline migration. Do not commit keys or send them to reviewers. The encrypted SQLite driver is a native dependency: install/build it for the hosting runtime’s OS, CPU and supported Node version. It is externalized in Next.js server packaging.

Driver documentation: https://github.com/m4heshd/better-sqlite3-multiple-ciphers

## Verification

282 tests across 41 files passed, including encrypted payroll persistence, indexed search and totals, shared auth/file storage, wrong-key rejection, plaintext migration and overwrite protection, refresh rotation and a session-status expiry race. TypeScript and the Next.js production build passed. Production HTTP security checks and the full Chrome workflow ran against isolated encrypted databases successfully. Local activation was subsequently completed: the encrypted copy was verified against all 20 source tables, the server-only local environment was switched to it, and payroll/auth/file repositories plus an integrity check passed. The original plaintext file remains a private rollback copy; environment and database files are ignored by Git.
