# Paydesk — current requirements

Current implementation baseline, 21 November 2026. Defines the implemented product behavior, validation rules, security boundaries and deployment limitations.

See [system architecture](ARCHITECTURE.md), [architecture decisions](ARCHITECTURE_REVIEW.md), [one-page diagram](docs/architecture-one-page.pdf) and [current acceptance test cases](docs/CURRENT_TEST_CASES.md).

## Product and access

One Next.js/React/TypeScript application has HR and employee workspaces. HR creates employees, edits monthly salary inputs, imports sheets, approves pending claims, views currency-grouped totals and manages policy text/attachments. Employees view/download only their own saved payslips and submit pending reimbursement claims. Both roles use the same role-scoped chatbot.

Employee records and login accounts are separate. A trusted administrator provisions/resets/disables accounts; employee accounts link to existing employee IDs. There is no public signup, universal password or automatic account creation from imports. See [employee access](docs/EMPLOYEE_ACCESS.md).

## Payroll correctness and editing

- Store money as safe integer minor units plus supported ISO currency. Manual employee entry converts decimal currency units exactly; the salary editor and sheet schema use minor units.
- The tested domain function computes monthly gross = annual CTC / 12; daily rate = monthly gross / calendar days; unpaid deduction = unpaid days × daily rate; net = gross − unpaid deduction − other deductions + approved reimbursements. Each division rounds half away from zero before the next step. Paid leave does not reduce pay; negative net is permitted by the formula.
- Validate employee ID, year 1900–9999, month 1–12, required monetary inputs, calendar/leave bounds, currency and claim fields. Currency changes with existing claims are restricted. Explicit confirmation is required for payroll writes and claim approval.
- Persist monthly inputs, payslip snapshot, leave and claims transactionally. Salary editing preserves existing claims; stale versions reject overwrite. A later CTC/month change must not rewrite an earlier snapshot.
- Pending claims do not increase pay; HR approval recalculates the affected month from its saved inputs. Legacy months missing original monthly inputs have a documented fallback to current employee CTC; HR must verify these records.
- Other deductions record an amount, not a structured reason. No invented tax, PF, ESI or rejection-reason calculation is provided.

## Employee creation, search and imports

HR can manually stage a new employee's first monthly salary or upload CSV/single-sheet XLSX, review it and explicitly confirm. The sheet has exactly seven columns: `employeeId,year,month,annualCtcMinor,currency,unpaidLeaveDays,otherDeductionsMinor`; one payroll month/file, at most 10,000 rows and 2 MiB. Code validates every row, duplicate IDs, headers, safe numbers, currency, leave and period; unsafe workbook structures/formulas/links are rejected. See [import guide](IMPORT_GUIDE.md).

Drafts are owner-bound, expire after 15 minutes and use 25-row review pages with bounded retention. Confirmation checks current versions and commits the whole batch atomically. Replaying a successful confirmation is idempotent; failures must not partially commit payroll. Import never creates authentication accounts.

The HR-only employee directory uses case-sensitive employee-ID prefix search, current-CTC currency filtering and indexed 25-row keyset pagination. Employees remain listed without a payslip in the selected month. Current CTC and historical snapshot currencies are distinguished. Org totals are grouped by currency, never summed across currencies. Directory headers and cells use the same column definitions in code for every employee.

## Authentication and sensitive data

Access JWTs are HS256-signed, contain identity/session references rather than salary data, and expire after 10 minutes. Server-side sessions remain revocable. Rotating opaque refresh credentials enforce a 30-minute idle and 8-hour absolute limit; consumed-token replay revokes the family. Logout, disable and password reset revoke appropriate sessions. Status reads alone do not keep a session active. Browser renewal coordinates tabs and preserves unsaved form/review navigation when recoverable.

Passwords use salted scrypt; stored session/refresh identifiers are hashed. Production cookies are HttpOnly, SameSite and Secure; mutation Origin checks and server-side role/employee ownership checks apply independently of navigation. Login attempts and expensive work are bounded. No salary/document contents or credentials belong in logs.

Production requires encrypted SQLite with a separate database key; development can explicitly run without encryption, but AI requires encrypted configuration. Drive credentials use AES-256-GCM with a separate secret. JWT signing is not encryption. Existing plaintext databases require explicit migration; backup, disk/host security, key escrow and restore procedures remain operational responsibilities. See [security](SECURITY.md) and [database encryption](DATABASE_ENCRYPTION.md).

## Attachments and private storage

Existing salary-sheet, HR-document, employee-claim and chat attachment fields share browser gzip, bounded server decompression, raw malware scan, normalization/required validation, server gzip, final malware scan, advisory AI review and private Google Drive persistence. AI receives only scan-passed content or code-generated validation reports. There is no extra Files or Document assistant sidebar tab.

ClamAV/format/required-validation failures reject the file; compression is not antivirus and passed scans do not guarantee harmlessness. Drive OAuth uses state/PKCE and the configured app credentials; server-held credentials are not shared with users. Downloads require authentication, owner/HR access, integrity checks and a user-bound application signature valid for five minutes. They are not public Drive sharing URLs. See [secure uploads](SECURE_UPLOADS.md).

## AI review and conversational assistance

Local Ollama Qwen3/Nomic, LangChain and a bounded LangGraph flow provide advisory review and grounded answers. PDF/image passages and vectors persist in encrypted SQLite; exact cosine retrieval is bounded by document/chunk limits. Policy text uses SQLite FTS; employees see only policy text HR explicitly publishes. Publishing policy text does not publish the private attachment.

Chat uses the authenticated employee's saved payroll, leave, claims and owned documents; HR chooses an employee explicitly. It supports bounded history, citations, labelled general explanations and safe code-based arithmetic. It has no payroll-writing, approval, browser or arbitrary SQL tools. Missing reasons remain unknown; invalid citations/unsupported sourced numbers are rejected or a saved-payroll summary is used where appropriate.

Salary-sheet AI reviews a bounded first-five-row sample/report, not every row. **Valid uploads proceed with a visible unavailable/disabled review status if AI cannot run.** Index failure preserves the original file for retry. Deterministic validation and HR confirmation remain mandatory.

Chat accepts PDFs up to 5 MiB and PNG/JPEG up to the shared 8 MiB limit. Text PDFs use a bounded parser; English OCR supports images/image-only PDFs up to 10 scanned pages with time/size/text limits. Model calls are local-loopback only, bounded/rate-limited, and external tracing is disabled. Conversation history is browser-memory only and resets on full navigation. See [AI operation and limits](DOCUMENT_AI.md).

## UI, state and optimization

Responsive role-specific navigation, accessible labels, named months and explicit empty/error/success states must reflect saved records. Initial month uses Asia/Kolkata; invalid explicit periods must not display a different month's pay. Server-supplied currency options/help prevent server/client Intl differences from causing hydration mismatches.

Directory SSR seeds React state and an account-scoped JSON memory cache (15-second TTL, 50 entries). Identical pending reads share work; canonical query keys, 300 ms debounce, 500 ms filter-submit throttle, explicit refresh, lifecycle aborts/clearing and sequence guards limit redundant work and stale displays. Mutation/auth/AI responses are not generically cached. Cache freshness is bounded; other users' writes are not pushed instantly to all tabs. Aggregate request diagnostics do not claim full server observability. See [API optimization](API_OPTIMIZATION.md).

## Deployment, verification and explicit limits

One application writer uses encrypted SQLite on persistent disk. The 10,000-row seed/import is tested; this is not a concurrent-load benchmark. A PostgreSQL adapter becomes appropriate when multiple app writers are required; Redis, sharding and a second database engine are not part of this implementation. Same-host Ollama, OCR binaries, ClamAV, HTTPS and Drive OAuth are deployment prerequisites for the full feature set.

SQLite, Drive and AI are not a distributed transaction. Durable ingestion/retry jobs, orphan reconciliation, retention/deletion tooling, automated backup/restore operations, notifications, MFA/invitations, persistent chat history, employee-name/profile management, complete payroll tax compliance and broader model evaluation are not delivered features.

Acceptance coverage and execution evidence are maintained separately in [current test cases](docs/CURRENT_TEST_CASES.md). Existing focused tests remain intact; new cross-feature tests supplement them. Unit/HTTP/browser fixtures must not be presented as production deployment, live-provider, malware-certification or load-test evidence.
