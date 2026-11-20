# Secure uploads in the existing forms

This milestone adds no Files or upload navigation tabs. It applies one shared
pipeline to the existing HR salary-sheet import, HR document form, and employee
reimbursement form. Optional PDF/JPEG/PNG attachment fields live in those forms.
Payroll math, salary editing, approval and confirmed import remain unchanged.
AI routes are opt-in and reuse this upload foundation. See DOCUMENT_AI.md for local-model setup.

## Pipeline and response

1. The browser losslessly gzips the original selected file using CompressionStream.
   It does not decode an untrusted image before antivirus checks. Compression does
   not disinfect a file and may not make an already compressed file smaller.
2. The server authenticates/authorizes the caller, checks cookie Origin, bounds
   multipart input and decompresses with a hard output limit. Client encoding,
   filenames, MIME types and claims of a scan are never trusted as proof of safety.
3. ClamAV scans the original decompressed bytes before PDF/image parsers run.
   Unknown/error/timeout results, missing scanner, detection and signatures older
   than 72 hours fail closed. The daemon must use UTC for its signature timestamp.
4. Isolated worker validates PDFs or decodes/re-encodes JPEG/PNG, omitting metadata.
   Images retain their dimensions and orientation; JPEG quality is 85, PNG uses
   compression level 9. Keep originals for records because re-encoding can change
   image appearance. Plain PDFs retain their bytes to preserve document text and
   fidelity. PDFs with forms, encryption, scripts, opening actions or embedded
   files are rejected. PDF validation is conservative, not complete CDR.
5. Salary CSV/XLSX retains its original bytes and passes the existing deterministic
   parser/ZIP/formula/row validations before storage. Only HR's salary import can
   accept these formats; it still requires separate review and confirmed commit.
6. The server gzip-compresses accepted output, scans those exact compressed bytes,
   allocates a Drive ID, uploads privately, verifies permissions and marks metadata
   ready. No Drive file upload happens before both scans succeed.
7. JSON responses include `signedUrl`: a relative application download URL with
   a five-minute HMAC signature bound to file ID, expiry and the logged-in user.
   It is not a public Google URL. The download additionally checks the current
   session/role/ownership, scan-ready status, Drive privacy, size and SHA-256.
   The compressed .gz response is an attachment with nosniff and sandbox headers.

HR documents and reimbursement JSON responses also include `redirectUrl` back to
that existing workflow. Salary import retains `reviewUrl` and adds `signedUrl`.
Links appear with the policy, claim or import review. HR gets its own signed link
when reviewing an employee attachment. Ordinary clicks renew/check the session
and request a fresh signature so a long-open page can still download; copied links
expire after five minutes. Existing generated payslip PDFs are server output,
not untrusted uploads, and keep their existing authorized download behavior.

Text-only policy saves and receipt references continue without uploading anything.
For a selected file, upload validation/scanning/storage must succeed before the
policy/claim/import operation proceeds. Failed domain operations attempt cleanup;
no failed file is downloadable. File upload alone never approves a claim.

## Google Drive setup (personal Google account)

No S3 account or AWS credentials are used. One HR-authorized Google account stores
organization uploads in an app-created private My Drive folder. Other HR users
can access files only through the application's HR checks; employees do not need
Google accounts and never receive Drive credentials.

1. Create a Google Cloud project and enable **Google Drive API**.
2. In Google Auth Platform configure Branding/Audience and an external OAuth app.
   For initial testing, add the Google account you will connect as a test user.
3. Create an OAuth client of type **Web application**. Register this exact redirect:

   ```text
   http://localhost:3000/api/storage/drive/callback
   ```

   For deployment use your exact HTTPS APP_ORIGIN followed by the same path.
   Do not use Google API keys or service-account JSON as a replacement for OAuth.
4. Keep existing authentication settings in `.env.local`. Add:

   ```dotenv
   FILE_UPLOADS_ENABLED=true
   GOOGLE_DRIVE_CLIENT_ID=your-web-client-id
   GOOGLE_DRIVE_CLIENT_SECRET=your-web-client-secret
   DRIVE_TOKEN_SECRET=your-separate-64-hex-character-key
   CLAMAV_HOST=127.0.0.1
   CLAMAV_PORT=3310
   AI_DOCUMENTS_ENABLED=false
   ```

   Generate DRIVE_TOKEN_SECRET with `openssl rand -hex 32`. Keep it separate from
   AUTH_JWT_SECRET and out of Git. It encrypts OAuth tokens/PKCE verifiers and signs
   downloads. Back it up securely. Reconnect the same Google account after a lost
   key; existing Drive identity/folder metadata is retained for that recovery.
5. Restart Next.js. Log in as HR and use **Connect Google Drive** inside the existing
   **HR policy library** section on `/hr`. Consent requests only `drive.file`,
   offline access and PKCE. OAuth state is hashed, single-use, 10-minute, user-bound
   and requires a matching HttpOnly/SameSite cookie. Tokens are AES-256-GCM encrypted
   in SQLite, never sent to the browser. Access tokens refresh on the server.
6. Keep the app-created folder and its files private. Do not share them with
   employees or enable anyone-with-link access. The application refuses shared
   folders/files; checks do not prevent the Google account owner from changing
   permissions outside the app, so organizational account control still matters.
7. Reconnect the same Google account when authorization expires/revokes. Switching
   to another account is rejected to avoid silently losing stored documents.
   External OAuth apps in Google's Testing mode can have short-lived refresh
   authorization (commonly seven days); configure publishing/verification as
   appropriate before production. Do not promise permanent testing credentials.

## Antivirus setup

Start Docker Desktop, then from the project directory:

```sh
docker compose -f compose.uploads.yml up -d
docker compose -f compose.uploads.yml logs --tail=30 clamav
```

The official pinned ClamAV image runs freshclam and clamd, persists signatures and
binds port 3310 only to loopback. It uses amd64 emulation on Apple Silicon because
this release has no ARM64 image. Allocate sufficient Docker RAM (the container
limit is 4 GiB). Initial startup and signature loading can take minutes.

If freshclam updates during the initial engine load, reload its downloaded database:

```sh
docker compose -f compose.uploads.yml exec -T clamav clamdscan --reload
```

Wait for the reload to complete; uploads are deliberately blocked while signatures
are old or the engine cannot answer. Self-check/update services keep running.
The application's freshness threshold is not disabled to make setup pass.

Run the real-engine regression (only synthetic data and harmless EICAR test text):

```sh
npm run test:uploads:scanner
```

Expected: plain/gzip synthetic PDF accepted; plain/gzip EICAR rejected. No real
malware is used and no Google Drive upload is made by this command.

## Bounds, deployment and limitations

- Images/PDFs: original up to 8 MiB; PDF up to 100 pages; images up to 20 million
  pixels, single JPEG/PNG only. Salary sheets retain the 2 MiB/10,000-row limits.
  Browser compression is lossless; final storage is gzip. No arbitrary archives,
  SVG, executables, HEIC, DOCX, animated images or encrypted PDFs are accepted.
- Multipart bodies and gzip expansion are bounded. Scan TCP commands have 20-second
  deadlines; format workers have 15-second/128-MiB JS-heap limits plus image pixel
  limits. Two active processing uploads per app process, 10 upload attempts per
  user per UTC hour and 100 file records per uploader cap resource use.
- ClamAV config enables PDF/archive scanning, encrypted-file alerts and limit alerts.
  Infections/rejections are not persisted as binaries. SQL retains failure status;
  Drive upload failure triggers best-effort deletion of its preallocated ID.
- SHA-256 prevents downloading content modified directly in Drive after its scan.
  Scans reduce risk; they do not prove that all malware/unknown exploits are absent.
  File parser isolation is worker-level, not a hardened OS sandbox.
- Deployment needs the Node runtime, worker threads, platform-correct sharp binaries
  and a local/private scanner. Next file tracing includes worker/dependency assets
  for each existing upload route. Build on the deployment platform.
- Drive, payroll and file metadata are not one distributed transaction. Crashes or
  cleanup failures can leave orphaned Drive files or processing records. Retention,
  reconciliation, administrative deletion, backup and durable ingestion queues are
  operational follow-ups before high-volume production; no new file-management UI
  is introduced in this milestone. Metadata links are bounded to 25 recent items
  per displayed context. Drive storage/API quotas still apply.
- Existing text-only routes do not require Drive setup, but importing an actual
  salary sheet now does. Binary upload clients must gzip each file and provide
  `<fieldName>Encoding=gzip`; raw-file requests cannot bypass the pipeline.
- Tests use a mocked Drive service. A live authorization/upload/download test with
  approved synthetic data remains necessary after your OAuth setup. No Google
  account was connected automatically. Browser tests use isolated Drive and ClamAV
  protocol fixtures; the separate scanner regression exercises the real engine.
- AI endpoints require encrypted local-model configuration and use this same secure upload service or existing scan-passed PDF/image attachments. Notifications remain a separate milestone. See DOCUMENT_AI.md.

References: [OWASP upload guidance](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html),
[ClamAV scanning](https://docs.clamav.net/manual/Usage/Scanning.html),
[Google Drive file scope](https://developers.google.com/workspace/drive/api/guides/api-specific-auth),
[Google server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server).

### Google connection navigation

The HR Connect/Reconnect control requests the authorization URL using a same-origin
JSON POST, sets the HttpOnly OAuth state cookie, and then navigates the current tab
to the exact Google authorization endpoint. Native form redirects to Google were
blocked by Chrome under the existing `form-action 'self'` CSP. The JSON/navigation
flow fixes that without widening the policy. Loading/error states and an immediate
in-flight guard make repeated clicks and setup failures visible. The authorization
endpoint continues to enforce HR access, Origin, state and PKCE; its original 303
response remains available for non-JSON callers. Tests cover the JSON contract,
destination validation, browser error/retry, repeated clicks and consent navigation
with a synthetic Google endpoint. No Google account is contacted by that test.

### Google Drive storage quota

A connected account can authorize successfully while new uploads fail with Google's `storageQuotaExceeded` error. Paydesk now reports this as HTTP 507 with a specific storage-limit message. HR must free storage in the connected Google account, including trash, and retry. Reconnecting the same account does not increase its quota. The import remains unsaved when storage fails. Provider response bodies are bounded and only known reason codes are mapped to safe user messages; raw Google messages, credentials and file identifiers are not displayed. Rate limits and expired authorization have separate retry/reconnect messages. See Google's [Drive error guide](https://developers.google.com/workspace/drive/api/guides/handle-errors#storageQuotaExceeded).

## Advisory upload review

All existing attachment fields now request local AI purpose/readability review after both malware scans and deterministic validation. Salary-sheet AI receives a bounded sample and validation report; code validates all rows. AI unavailable/disabled status is visible and does not block valid uploads. PDF/image indexing follows private Drive storage and preserves the file if it fails. Chat attachments use this same pipeline. OCR dependencies and limits are documented in DOCUMENT_AI.md.
