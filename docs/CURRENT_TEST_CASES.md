# Current implementation — acceptance test cases

Baseline: 21 November 2026. This is project QA documentation for the final implemented system, separate from personal learning notes and historical milestone descriptions. It supplements existing tests rather than replacing or duplicating the original suite. Scope: [current requirements](../REQUIREMENTS.md) and [current architecture](../ARCHITECTURE.md).

## Initial tests versus current coverage

The original focused tests covered the payslip formula/rounding, SQLite persistence and transactions, HR/employee access boundaries, pending/approved claims, saved-payslip PDF output and simple cited document explanations. They remain in `test/payslip.test.ts`, `sqlite-payroll.test.ts`, `hr-access.test.ts`, `claims.test.ts`, `payslip-document.test.ts` and `assistant.test.ts`.

The current suite additionally covers salary editing/actions, manual employee creation, CSV/XLSX staged imports, authentication/refresh, directory/pagination/cache, hydration, encrypted storage, private Drive/scanning/signatures, local document retrieval, advisory upload review and role-scoped workspace chat. Compatibility OpenAI/Qdrant adapter tests do not mean those services are active in the current local-AI runtime. Low-level text-only PDF extractor rejection tests coexist with the OCR fallback used by the current attachment runtime.

**New separate executable suite:** [`test/current-implementation.test.ts`](../test/current-implementation.test.ts). It connects real parsing, encrypted persistence, account login/authorization, claim approval and chat-context visibility across feature boundaries. It does not contact Google, a model or a real scanner; those boundaries have separate tests/checks below.

## Automated acceptance matrix

Paths in the evidence column are relative to `test/`. Each row groups closely related assertions; these are acceptance IDs, not an attempt to equate matrix rows with Vitest's individual/parameterized test count. Use synthetic accounts/data in an isolated temporary database.

### Payroll, creation and import

| ID | Input / action | Expected result | Automated evidence |
|---|---|---|---|
| PAY-01 | Calculate gross, unpaid leave, other deductions and approved reimbursements, including half-unit boundaries. | Integer minor-unit output, half-away-from-zero rounding at each division; paid leave does not reduce net; no invented statutory deductions. | `payslip.test.ts` |
| PAY-02 | Save a confirmed month; close/reopen storage; change a later month's CTC. | Saved snapshot persists; earlier snapshot remains unchanged; org totals stay grouped by currency. | `sqlite-payroll.test.ts` |
| PAY-03 | Save invalid leave, fractional/unsafe money, invalid period/currency or missing confirmation. | Actionable validation failure; no partial monthly writes. | `salary-editor.test.ts`, `salary-action.test.ts`, `sqlite-payroll.test.ts` |
| PAY-04 | Open two versions of a month; change claims/payroll before saving the old version. | Stale save rejected; current claims and other months/employees preserved. | `salary-editor.test.ts` |
| PAY-05 | Submit receipt claim, then approve only after explicit HR confirmation. | Pending claim does not increase net; approved claim recalculates only its month. | `claims.test.ts`, `hr-access.test.ts` |
| PAY-06 | Render/download saved or missing payslip. | Existing snapshot is displayed/downloaded; missing month is explicit, without recomputed/invented pay. | `payslip-document.test.ts`, `workspace-ui.test.ts` |
| IMP-01 | Manually create employee using decimal INR/JPY/three-decimal currency values; try an existing ID. | Exact minor-unit conversion; valid draft/first month; existing ID rejected; no automatic login account. | `salary-import-parse.test.ts`, `salary-import-db.test.ts`, `employee-create-action.test.ts` |
| IMP-02 | Parse valid CSV/BOM/CRLF/quotes and a real XLSX sample. | Exact seven-column values; successful supported-format parsing. | `salary-import-parse.test.ts` |
| IMP-03 | Upload malformed UTF-8/quotes, missing/extra/duplicate headers, duplicate employees, bad leave/currency/money. | Required validation fails with row context; payroll unchanged. | `salary-import-parse.test.ts`, `auth-http.test.ts` |
| IMP-04 | Supply formulas, external links/entities, oversized expansion/ranges or multiple sheets. | Unsafe/unsupported workbook rejected before normal payroll processing. | `salary-import-parse.test.ts` |
| IMP-05 | Stage draft; inspect with another owner; omit confirmation; expire it. | No payroll before confirmation; owner isolation and expiry enforced. | `salary-import-db.test.ts` |
| IMP-06 | Confirm valid batch; replay confirmation; introduce stale rows or a later-row database failure. | Atomic commit or rollback; committed-draft replay does not rewrite payroll; existing claims/months preserved. | `salary-import-db.test.ts` |
| IMP-07 | Validate, stage, paginate and confirm 10,000 synthetic employees. | All rows handled within file/row bounds; review pages bounded; no partial import. Not a load benchmark. | `salary-import-parse.test.ts`, `salary-import-db.test.ts`, `seed.test.ts` |

### Authentication, encryption and authorization

| ID | Input / action | Expected result | Automated evidence |
|---|---|---|---|
| SEC-01 | Hash/verify passwords, including unknown user, malformed hash and invalid password bounds. | Salted scrypt; no decryptable plaintext password; generic login failure and bounded verification. | `auth.test.ts`, `auth-http.test.ts` |
| SEC-02 | Tamper with JWT payload/signature, algorithm, issuer/audience, lifetime or signing key. | Invalid/expired token rejected; payload has opaque identity/session/time claims rather than salary. | `auth.test.ts` |
| SEC-03 | Call HR routes/actions as employee/anonymous; change route employee ID. | Server rejects role/ownership escalation before payroll mutation. | `auth-http.test.ts`, `auth-next.test.ts`, `salary-action.test.ts`, `employees-api.test.ts` |
| SEC-04 | Send cookie mutation with foreign/null/missing Origin; supply malformed bearer plus a valid cookie. | Origin checks enforced; invalid bearer cannot silently fall back to cookie authorization. | `auth-http.test.ts`, `refresh-http.test.ts`, `chat-http.test.ts` |
| SEC-05 | Refresh before/after permitted interval; reuse a consumed token; refresh concurrently. | Atomic rotation, bounded retry behavior and replay family revocation; another independent family remains isolated. | `refresh-session.test.ts`, `refresh-http.test.ts` |
| SEC-06 | Reach idle/absolute expiry; poll status; logout/reset/disable; copy old token. | Status alone does not extend activity; limits/revocation deny old credentials. | `refresh-session.test.ts`, `auth.test.ts`, `refresh-http.test.ts` |
| SEC-07 | Expire access during page/form navigation; request status during an expiry race. | Safe renewal path/status or 401; no malformed success or unsafe return URL. | `auth-next.test.ts`, `session-status-race.test.ts`, `browser-session-requests.test.ts` |
| SEC-08 | Persist payroll/auth/files with encryption; reopen and query; migrate plaintext source. | Encrypted repositories work together; explicit migration preserves source/refuses overwrite; invalid/missing production key fails closed. | `database-encryption.test.ts` |
| SEC-09 | Overrun login attempts or request limits; inspect database permissions. | Persistent throttling/safe retry guidance and private storage permissions. | `auth.test.ts`, `auth-http.test.ts`, `document-ai.test.ts` |

### Directory, UI and request optimization

| ID | Input / action | Expected result | Automated evidence |
|---|---|---|---|
| UX-01 | Search employee-ID prefix with currency and cursor; choose a month without payslip. | Case-sensitive bounded pagination, indexed query, no duplicates; employee still listed, CTC/snapshot distinction preserved. | `employee-directory.test.ts`, `employees-api.test.ts` |
| UX-02 | Repeat a directory query, overlap identical loads, advance TTL, exceed capacity and clear during a pending read. | SSR reuse/cached JSON, in-flight sharing, expiry/eviction; invalidated generations do not repopulate stale cache. | `client-api.test.ts` |
| UX-03 | Type rapidly and click filters repeatedly. | Debounce/throttle helpers enforce 300/500 ms behavior; browser test checks actual directory network reuse. | `client-api.test.ts`; `scripts/check-ui-browser.ts` |
| UX-04 | Make session requests overlap or change/expire account state. | Only in-flight status is coalesced; completed authorization status is not permanently cached. | `browser-session-requests.test.ts`, `session-status-race.test.ts` |
| UX-05 | Render role navigation, month selectors, missing payroll and saved salary amounts. | Correct role links, January–December labels, saved values, explicit empty states. | `workspace-ui.test.ts`, `dashboard-pages.test.ts`, `presentation.test.ts`, `salary-ui.test.ts` |
| UX-06 | Make client currency metadata differ from server metadata. | Initial render uses supplied server currency options/help without hydration mismatch. | `currency-hydration.test.ts`, `directory-hydration.test.ts`; browser harness |

### Uploads, Drive and AI

| ID | Input / action | Expected result | Automated evidence |
|---|---|---|---|
| FILE-01 | Upload supported gzip; spoof extension/type; exceed decompression/file limits; scan raw and final representations. | Correct bounded normalization/scanning order; malformed/unsafe content rejected. | `secure-files.test.ts`, `secure-upload-http.test.ts`, `file-scanner.test.ts` |
| FILE-02 | Malware is found at either scan, or scanner fails. | No AI review or Drive persistence for rejected content; safe failure. | `secure-files.test.ts`, `file-scanner.test.ts` |
| FILE-03 | Connect/reconnect Drive; tamper/reuse/expire OAuth state; inspect encrypted credential purpose binding. | HR-only state/PKCE flow, private credential storage, account/privacy restrictions. | `drive-oauth-http.test.ts`, `drive-storage.test.ts`, `connect-drive.test.ts` |
| FILE-04 | Drive quota/access/network failure; shared folder/file; expired access token. | Actionable safe error or bounded renewal; no public sharing or credential leakage. | `drive-storage.test.ts` |
| FILE-05 | Download own/other file; alter signature/user/expiry or stored bytes. | Session + ownership + five-minute signature/integrity checks; invalid request rejected. | `upload-signing.test.ts`, `secure-files.test.ts`, `secure-upload-http.test.ts` |
| AI-01 | Review a valid salary-sheet sample; disable/unplug local AI. | Advisory sample label; `needs-review`/`unavailable`/`disabled` is truthful; otherwise valid upload can remain ready. | `upload-ai-review.test.ts`, `secure-files.test.ts` |
| AI-02 | Enable AI with remote URL, tracing, no encryption or unsupported config; fail local provider. | Fail closed; no hidden paid/cloud fallback; bounded local SDK/schema behavior. | `document-ai-ollama.test.ts`, `document-ai-http.test.ts` |
| AI-03 | Index accessible ready PDF twice; fail indexing; tamper/deny source. | Reuse ready index; preserve original on failure; denied/tampered source never reaches model. | `document-ai-runtime.test.ts`, `document-ai-enabled-http.test.ts` |
| AI-04 | Persist vectors and query passage relevance/dimensions. | Exact per-document SQLite cosine retrieval uses valid vectors; ownership remains checked. | `document-ai-sqlite-vectors.test.ts`, `document-ai-runtime.test.ts` |
| AI-05 | Ask for another employee's payroll; HR selects an employee; publish/update/revoke policy text. | Scope is enforced before inference; employee sees only own payroll and explicitly published policy; updates/publication change together. | `chat-context.test.ts`, `chat-service.test.ts` |
| AI-06 | Return out-of-range source index, unsupported amount or uncited personal-finance claim. | Unsafe answer rejected or safe saved-payroll/missing-evidence response; no invented deduction cause. | `chat-service.test.ts`, `document-ai.test.ts` |
| AI-07 | Ask arithmetic/percentages, invalid expression, division by zero or code text. | Bounded code arithmetic without model/eval; unsafe/unsupported expressions reject or stay non-calculator input. | `chat-calculator.test.ts`, `chat-service.test.ts` |
| AI-08 | Chat anonymously/foreign Origin; send system-role history, >2 attachments, overlong question or invalid period. | Authentication/CSRF/shape limits enforced before bot invocation; responses no-store. | `chat-http.test.ts` |
| AI-09 | Open both workspaces and saved-document/chat attachment flows. | Ask Paydesk in workspace; no separate assistant sidebar; supported attachment uses shared safe pipeline and returns cited output. | `dashboard-pages.test.ts`; browser harness |

### Added cross-feature executable cases

| ID | Steps | Expected result | Evidence |
|---|---|---|---|
| CURRENT-01 | Parse two-employee CSV → stage/confirm → provision/login linked employee → pending claim → HR approval → save shared/private policies → reopen encrypted storage → generate payslip/read chat context. | No pre-confirmation pay; pending net unchanged; approved net correct; other employee untouched; PDF exists; chat uses saved approved figures/shared policy only; database is not plaintext SQLite. | `current-implementation.test.ts` |
| CURRENT-02 | Login imported employee → request another employee/HR area/context → logout → retry copied credential. | Cross-role/identity access denied, post-logout authentication denied, original payroll and other employee's claims unchanged. | `current-implementation.test.ts` |

## Browser, native and live/deployment acceptance

These complement unit/integration tests. A desired case is not a pass unless its corresponding check was executed. Use dedicated synthetic data; browser harness uses isolated model/Drive/scanner fixtures and does not certify real Google/ClamAV/model behavior.

| ID | Procedure | Expected result / execution boundary |
|---|---|---|
| BROWSER-01 | Run `npm run test:ui:browser` after the production build with Chrome available. | Desktop/tablet/mobile navigation, no horizontal overflow/hydration failures; save salary, approve claim, manual create, CSV/XLSX preview/confirm, empty states. |
| BROWSER-02 | Same harness: expire test access; renew concurrently in tabs and submit form. | Silent recovery where allowed, correct return URL and preserved values; idle/absolute limits still apply. |
| BROWSER-03 | Same harness: rapid directory typing/repeat/refresh and Drive connect/retry. | Bounded search calls, cached read reuse, explicit refresh refetch, OAuth navigation. |
| BROWSER-04 | Same harness: attach synthetic PDF/image through existing forms/chat; ask and expand sources. | Shared compression/scan fixtures, automatic review, native image OCR, signed downloads and role-scoped chat; fixture answer is not real-model quality evidence. |
| NATIVE-01 | On a prepared development host, process clear synthetic receipt PNG and image-only PDF with Tesseract/Poppler; try poor/oversized/missing-engine inputs. | Readable text/page references within OCR bounds, or visible unavailable/readability status; valid original upload preserved. Native success was checked previously; all failure/quality permutations require manual evaluation. |
| LIVE-01 | Run `npm run ai:check`; ask local Qwen about synthetic saved payroll and a known generated PDF; test sample review and arithmetic. | Installed Qwen/Nomic available, correct cited figures and missing-reason handling. Readiness alone does not evaluate answer quality. Previous synthetic real-model checks are historical evidence, not a fresh check in this documentation pass. |
| LIVE-02 | Run `npm run test:uploads:scanner` with an isolated reachable real ClamAV engine. | Safe synthetic content accepted and known test-virus signature rejected. Never use live malware. Not executed by ordinary Vitest. |
| DEPLOY-01 | On deployed HTTPS URL, log in with dedicated HR/employee accounts; test role isolation and employee PDF. | Deployed database/accounts/origin/cookie behavior correct. Local HTTP/browser fixtures are insufficient evidence. |
| DEPLOY-02 | On deployed URL, connect approved Drive test account; upload/download supported synthetic file; revoke consent or fill quota deliberately only in an isolated test account. | OAuth redirect/test-user settings, storage privacy, signed links and actionable recovery verified against real provider. |
| DEPLOY-03 | Verify persistent encrypted disk, restart/restore, separate keys, reachable scanner/Ollama/OCR and bounded failure behavior. | Data survives restart, correct key restore, no fallback to unscanned storage; documented operational prerequisites met. Restore/reconciliation drills are not automated by this suite. |
| PERF-01 | Measure concurrent search/save/import/OCR/model workload, cold/warm cache and lock waits on target host. | Establish measured latency/throughput targets. No capacity/SLA pass is claimed from employee count or seed tests alone. |

## Reproduction commands

```sh
# New cross-feature tests only
npx vitest run test/current-implementation.test.ts

# Existing and current tests together, followed by compilation/build
npm test
npx tsc --noEmit
npx next build

# Isolated production browser flow (Chrome/native OCR prerequisites)
npm run test:ui:browser

# Optional external/native checks; require running configured dependencies
npm run ai:check
npm run test:uploads:scanner
```

Vitest uses synthetic temporary databases; do not replace their paths with the personal database. The browser harness needs local port/Chrome permission. Do not run `npm run seed` on real payroll to prepare a test.

## Execution record

- Prior AI milestone: **310 tests / 49 files**, TypeScript/build/browser checks passed; separate synthetic native OCR and actual local-model checks passed. This is historical evidence.
- **21 November 2026 — executed:** new cross-feature suite: 2/2 passed; complete Vitest regression: **312/312 tests across 50 files passed**; `npx tsc --noEmit` and `npx next build` passed.
- **21 November 2026 — browser executed:** `npm run test:ui:browser` equivalent Node entry point passed for role landing, named months, empty states, salary save, claim approval, manual creation, CSV/XLSX confirmed imports, silent/cross-tab renewal, compression/scan protocol fixtures, signed links, consent/retry, HR/employee chat, native image OCR and responsive layouts. Synthetic model/Drive/scanner fixtures were used.
- Documentation links, acceptance-suite references and Git whitespace checks passed. The architecture PDF remains a one-page A4 artifact after regeneration.
- **Not executed in this pass:** deployed HTTPS/reviewer accounts, live Google/real ClamAV, actual-model quality checks, broader native OCR permutations, concurrency/load benchmarks and backup/restore drills. Earlier real-model/native checks are recorded as historical evidence only.

## Pre-push extended verification

A later pre-push pass added `test/adversarial-inputs.test.ts` (hostile salary cells, 400 deterministic arithmetic comparisons, code-like/resource-bounded inputs) and an exact currency-formatting regression for generated payslips. The final suite passed **316 tests across 51 files** with TypeScript and production build. The PDF amount fix also updates legacy stored-payslip explanation expectations to explicit currency units rather than ambiguous raw minor units; no original test case was removed. Real ClamAV/native OCR/actual local-model checks and production browser/HTTP evidence are recorded in [RELEASE_VERIFICATION.md](RELEASE_VERIFICATION.md). This does not replace the separate deployed-site and load/restore gates.
