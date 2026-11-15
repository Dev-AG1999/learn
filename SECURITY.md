# Authentication and payroll data security

## Local setup

Use Node 22+. Install dependencies with `npm install`, then:

1. Copy `.env.example` to `.env.local`.
2. Set `AUTH_JWT_SECRET` to a unique value produced by `openssl rand -hex 32`.
3. Set `APP_ORIGIN` to the exact browser origin (no trailing slash). The default
   development origin is `http://localhost:3000`. Production requires HTTPS.
4. Run `npm run seed` if you need synthetic employees. No login accounts are seeded.
5. Provision HR and employee accounts with the commands below.
6. Run `npm run dev` and visit `/login`.

Accounts have no default passwords and there is no public registration. A person
with trusted host/SQLite access provisions accounts. Employee accounts must link
to an existing employee; each session uses that stored link, never a client claim.
The provisioning password must contain at least 12 characters and at most 1024
bytes. Pass it through `AUTH_USER_PASSWORD`, not a command-line argument. For zsh:

```sh
read -rs 'AUTH_USER_PASSWORD?New account password: '
export AUTH_USER_PASSWORD
npm run auth:user -- create hr@example.com hr
unset AUTH_USER_PASSWORD
```

Repeat the prompt/export/unset steps around these commands as appropriate:

```sh
npm run auth:user -- create employee@example.com employee syn-00001
npm run auth:user -- reset-password employee@example.com
npm run auth:user -- disable employee@example.com
```

Password reset revokes every session for the account. Disable revokes every
session and prevents future login; a password reset does not re-enable it.
Passwords use per-user random salts and scrypt N=131072, r=8, p=1. Only hashes are
stored. The service limits concurrent password checks to two to bound memory.

## Sessions and API clients

Browser login: `POST /auth/login` with URL-encoded username/password. The signed
JWT is stored only in an HttpOnly, SameSite=Lax cookie, with Secure and a __Host-
name in production. Sessions expire after 30 minutes, without sliding renewal.
Sign-out is a POST and immediately revokes the server session.

API login: `POST /api/auth/token` with JSON `{ "username": "...", "password": "..." }`.
The response contains `access_token`, `token_type: "Bearer"`, and `expires_in`.
Send `Authorization: Bearer <access_token>` on protected route handlers. There is
no token storage in localStorage and no token in a URL. API token issuance never
uses an existing cookie or returns a browser session cookie.

`GET /api/auth/session` returns the authenticated account identity and role.
`POST /api/auth/logout` revokes the presented session. API requests with a bearer
token may omit Origin; when authenticating through cookies, mutation requests
must carry an exact matching Origin. Browser login/logout require a matching
Origin. Next.js origin checks and an explicit check protect the salary action.
No cross-origin API access is enabled. Invalid Authorization headers do not fall
back to browser cookies.

JWT verification pins HS256, issuer, audience, type, required claims, and a fixed
lifetime. Tokens contain only opaque account/session IDs and timestamps. No
salary, password, username, role or employee data is put in JWTs. Every request
also checks the unexpired SQLite session and current account role/disabled state.
Only hashed session IDs are persisted. Changing the signing key invalidates all
JWTs; users must sign in again. The same secret must persist across restarts.

Five login attempts per normalized username are allowed in a 15-minute window,
including successful attempts. Throttling is persisted in SQLite, applies equally
to unknown accounts, and bounds stored buckets. Unknown users use a dummy scrypt
verification and login errors never disclose whether the account exists.
Authentication input bodies are limited to 8 KiB. Add trusted reverse-proxy
traffic limits appropriate to your deployment for broader denial-of-service
protection; no extra service or Redis is needed by this application.

## Access boundaries and storage

Every HR page, HR mutation route, and salary server action requires an HR account.
Employee pages, PDF downloads and claim submission require an employee account
whose linked ID matches the requested employee. HR users do not impersonate
employee accounts; HR payroll editing stays in the HR area. Authorization runs
before reading a form or opening the payroll repository, independently on each
entry point. No reliance on middleware-only or client-only checks.

User-specific pages are dynamic. Auth responses and PDF downloads use no-store.
All responses set frame protection, nosniff, a strict-origin-when-cross-origin referrer policy and restrictive
browser permissions. Production adds HSTS. The CSP prevents framing, foreign form
submissions, object embeds and foreign base URLs; it is not a complete script-src
policy. There is no runtime logging of credentials, JWTs or payroll values.

The application sets its SQLite file to owner-read/write (0600), creates new
parent directories as 0700, and rejects a symlink for the database file. Keep the
persistent directory private, run as a dedicated OS user and keep backups private.
`.env*` (except the example) and database files are ignored by Git. Trusted local
code and host administrators can still open SQLite directly. Application roles
do not replace host access controls.

SQLite remains **unencrypted at rest**. Use encrypted persistent volumes and
backups supplied by the deployment environment, HTTPS termination, a secret
manager for the signing key and restricted host access. Do not claim database
file permissions or JWT signing encrypt payroll data. Validate these deployment
settings before putting real employee data into the system.

This milestone does not add MFA/SSO, self-service registration, email recovery,
field encryption, or an audit-event store. Account recovery is an administrator
password reset. The existing payroll formula and salary snapshot semantics are
unchanged. One app process writes SQLite, as required by the repository design.

## Verification

Run `npm test`, `npx tsc --noEmit`, and `npx next build`. After building, run
`npm run test:auth:http`. The HTTP smoke test starts a local production server on
an available loopback port with a temporary synthetic database and random test
credentials. It checks cookies, HR and employee pages, PDF access, CSRF, API
bearer tokens and logout revocation, then stops the server and deletes its test
data. The HTTPS public origin is simulated in headers; configure and verify real
TLS at deployment. No real employee data or configured production database is
used by the tests.


Native browser form submissions require a referrer policy that preserves their
Origin header. `no-referrer` can turn the Origin into `null` on form POSTs,
causing legitimate login/logout/claim forms to fail strict CSRF validation.
Use `strict-origin-when-cross-origin`; never work around this by allowing
`Origin: null` or dropping Origin validation. After changing `next.config.ts`,
reload the login page so the browser receives the new response policy.

Run `npm run test:auth:browser` while the local app is running to exercise a
native login form submission in an isolated headless Chrome profile. This
regression check submits a random nonexistent account, verifies that Origin is
preserved, and expects the normal invalid-credentials screen. It does not use
your account, password, or browser profile. Set `CHROME_PATH` if Chrome is not in
the default macOS location. The diagnostic accepts only loopback APP_ORIGINs.
