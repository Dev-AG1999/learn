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
name in production. Access JWTs last 10 minutes. A separate opaque refresh cookie
renews active sessions within a 30-minute inactivity limit and eight-hour absolute
work session. Sign-out is a POST and immediately revokes the entire session family.

API login: `POST /api/auth/token` with JSON `{ "username": "...", "password": "..." }`.
The response contains `access_token`, `refresh_token`, `token_type: "Bearer"`, and
`expires_in` (600 seconds for the access token).
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
Only hashed session IDs and refresh tokens are persisted. Families are bound to
the signing-key fingerprint; changing the signing key invalidates existing refresh
credentials as well as JWTs, so users must sign in again. The same secret must persist across restarts.

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
code and host administrators with the database key can still read application data. Application roles
do not replace host access controls.

SQLite now supports **database-at-rest encryption** through the shared connection factory; production requires DATABASE_ENCRYPTION_KEY. Existing plaintext databases need an offline migration; see DATABASE_ENCRYPTION.md. Also use encrypted persistent volumes and
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

The UI redesign preserves the same authorization checks. The shared navigation
shows each account's permitted workspace, and `/` routes directly to it; links
are not used as a substitute for server authorization. Mutating payroll routes
return relative redirect locations so HTTPS is preserved behind a reverse proxy.
For a deployment proxy, forward the original Host and X-Forwarded-Proto correctly.

`npm run test:ui:browser` tests the redesigned UI on an isolated production server
and local HTTPS proxy with synthetic data. Only its fresh Chrome profile ignores
the temporary certificate error; it does not relax application origin checks,
production cookies, or your normal browser's TLS settings. The shared Chrome
harness is also used by the native login-form regression test.

## Salary-sheet uploads

The HR upload endpoint `/hr/import/preview`, confirmation endpoint
`/hr/import/commit`, template downloads and manual-create action check HR access
independently. Cookie mutations require the configured Origin. Previews are
owner-bound SQLite records with random IDs and a 15-minute lifetime; confirmation
never accepts salary values from client hidden fields. It checks a snapshot
fingerprint for every employee/month, including leave and claims, then commits
all rows in one SQLite transaction. Successful confirmations are idempotent.

Upload bodies are bounded before multipart parsing; files are limited to 2 MiB
and 10,000 rows. Excel ZIP size, entry count, worksheet dimensions, formulas,
macros, external links and XML entities are checked before the XLSX reader runs.
Only normalized review inputs are stored, not the raw uploaded file. Up to three
recent reviews per account and 50 globally bound temporary storage. Expired data
is cleaned during subsequent staging; legacy plaintext databases and backup encryption remain a
host/deployment responsibility. Never log file contents. The opt-in local AI milestone below permits bounded scan-passed content and normalized samples to reach the local model; external AI/tracing services remain disabled.
Employee salary creation does not create authentication accounts or passwords.


## Rotating refresh sessions

`POST /auth/refresh` uses only the HttpOnly refresh cookie and requires the exact
application Origin. It returns timing metadata, never JWT or refresh secrets to
browser JavaScript. Both cookies are Secure and __Host-prefixed in production.
`POST /api/auth/refresh` accepts JSON `{ "refresh_token": "..." }` for explicit API
clients and returns the replacement access/refresh tokens without setting cookies.
If an Origin header is present on API refresh, it must match APP_ORIGIN.

Every successful refresh consumes the old token and creates a new random token in
one SQLite transaction. Only SHA-256 hashes of 256-bit random refresh secrets are
stored. Consumed hashes are retained until family expiry to detect replay. Reuse
revokes every access session in that family; separate device login families remain
independent. Rotation is limited to once per minute per token to bound growth;
normal browser renewal begins near access expiry. Absolute expiry never slides.
Expired families are removed on login; their tokens and sessions cascade-delete.

Actual authorized page/business requests and refreshes record activity. Status
polls do not extend inactivity. Browser proactive renewal happens only following
recent interaction in a visible tab. Web Locks serialize refresh across tabs, with
a second status check after acquiring the lock; BroadcastChannel shares only an
update notification. Tokens are never put in localStorage or channel messages.
A current browser with Web Locks over HTTPS (or localhost development) is required
for coordinated automatic renewal. Without it, the UI offers explicit sign-in.

Expired page/download navigation goes through a renewal screen that accepts only
safe same-origin HR/employee return paths. The full query and review ID are kept.
Forms wait for session verification before being submitted, retaining field values
on renewal or temporary network failure. No automatic replay of completed payroll
writes occurs. Inactivity/absolute-expiry warnings keep unsaved form details in
memory on the page; reload/close still discards unsaved data. The new-tab sign-in
link uses `/login?reauth=yes` so even a still-valid session can be reauthenticated
with a password before the absolute limit. A successful new browser login revokes
the prior cookie's family. A different account triggers a fresh workspace load
instead of submitting a previous user's form under the new identity.

Logout can revoke a family using the refresh cookie even after the access cookie
expires. API clients should present their access bearer token for logout; they may
also send their refresh token as JSON to revoke after access expiry. Password reset
and account disable revoke all families atomically with the account change.

The session schema migrates without deleting accounts or payroll. Existing old
30-minute JWT-only sessions require one new login to opt into the 10-minute JWT
plus refresh policy. Import review expiry remains 15 minutes and is not extended
by login renewal. A lost response after successful token rotation may require
sign-in again; replay is not accepted as an unsafe retry grace period.

Reference: https://www.rfc-editor.org/rfc/rfc9700.html#section-4.14

## Secure uploads in existing forms

See `SECURE_UPLOADS.md` for implementation, bounds, Google OAuth, antivirus,
retention and deployment details. Browser gzip preserves original bytes; server
bounded decompression precedes ClamAV scanning, format processing, final gzip and
another scan. Compression never substitutes for antivirus. Scanner outages,
stale signatures, errors, detections and oversized input fail closed.

Only Google Drive is used for new stored attachments and salary sheets. HR OAuth
uses drive.file scope, PKCE, user-bound single-use state and a matching HttpOnly
cookie. OAuth tokens and verifiers are encrypted with AES-256-GCM under a separate
server key. Folder/file permissions are checked; public/shared files are refused.
Application download URLs have five-minute signatures bound to the file, user and
expiry and still require a valid session and role/ownership. Checks include status,
private Drive access, size and SHA-256. URLs are not public Drive sharing links.
Redact OAuth codes, state, signed URL query values, tokens and file bodies from
reverse-proxy/access logs. Application errors do not expose provider secrets.

The changes apply to existing salary import, HR document attachments and employee
reimbursement attachments. Existing payroll calculations and claim approvals are
not delegated to storage or antivirus. Optional text-only forms still work. No new
Files tabs are introduced. AI upload/answer endpoints are gated by encrypted local-model configuration and reuse the secure upload pipeline or an already scan-passed file; no unscanned upload path is enabled.

Antivirus cannot establish that every file is harmless. The UI labels successful
checks as scans passed, not virus-free. Crashes/cleanup and provider quota failures
require operational reconciliation. Retention, scanner updates and encrypted
backups remain deployment responsibilities. No real Google credentials were
provisioned by this change; live Drive validation follows administrator setup.

Database encryption setup, migration, key management, and explicit limits are documented in [DATABASE_ENCRYPTION.md](DATABASE_ENCRYPTION.md).

## Shared upload review and chatbot

AI is opt-in and local only. API requests retain session/bearer and CSRF checks. Employee identity and source ownership/ready status are checked before retrieval; HR indexing does not transfer ownership. AI only receives scan-passed content or code-generated validation reports. Purpose review is advisory and unavailable AI does not bypass deterministic validation or block otherwise valid uploads. Extracted passages/vectors remain in encrypted SQLite. OCR uses bounded native memory pipes. Policy text is private unless HR explicitly publishes it; body/publication changes are atomic. The chatbot receives authorized payroll, published policies and bounded document context, with no writing, approval or browsing tools. External tracing must be disabled. Sources and numeric claims are checked; outputs remain advisory plain text. Original attachments survive index failures. See DOCUMENT_AI.md for setup, runtime limits and retention gaps.
