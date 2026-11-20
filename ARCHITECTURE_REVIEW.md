# Paydesk — current architecture decisions

Current system review, 21 November 2026. This file describes implemented architecture decisions and their tradeoffs. The one-page [ARCHITECTURE.md](ARCHITECTURE.md) and [architecture PDF](docs/architecture-one-page.pdf) summarize the entire system.

## Implemented boundaries and decisions

| Area | Current implementation and reason | Boundary / tradeoff |
|---|---|---|
| Application | One Next.js/React/TypeScript application; HR and employee routes share presentation primitives. Route handlers and server actions delegate to services/repositories. | Every protected entry point checks authorization; hiding UI is not access control. |
| Payroll domain | One tested computation uses integer minor units, explicit rounding and saved monthly snapshots. Version checks reject stale edits. | AI/UI do not compute processed pay. Other deduction reasons and statutory tax rules are not inferred. |
| Persistence | One SQLCipher-mode encrypted SQLite database on persistent disk; repository boundary and indexes support pagination/aggregates. | One app writer; move the adapter to PostgreSQL for multiple writers. Seed/import counts are not throughput benchmarks. |
| Import | CSV/XLSX → bounded deterministic validation → owner-bound draft → HR review/confirmation → atomic batch commit. | All rows are checked by code; replay is idempotent for committed drafts, not every POST. Old claims/months survive updates. |
| Identity | Salted scrypt; signed 10-minute access JWTs plus hashed rotating refresh credentials and revocable session families. | 30-minute idle/8-hour absolute limits remain; refresh is a usability/security tradeoff, not unlimited login. Accounts are explicitly provisioned. |
| Confidentiality | Database page encryption, AES-256-GCM Drive credential protection, separate secrets, HTTPS/secure cookies and server access checks. | Running server decrypts data; compromised hosts, leaked keys and plaintext backups remain risks. JWT signatures do not conceal payloads. |
| Attachments | Shared existing-form/chat upload service: browser gzip → scan → normalize/validate → gzip → scan → advisory review → private Drive → document indexing. | Scanning fails closed. AI outage does not block otherwise valid uploads. Drive/SQLite consistency needs reconciliation after crashes. |
| Downloads | Authenticated application endpoint with owner/HR access, byte integrity checks and user-bound five-minute signature. | No public Drive permissions or raw AI-download bypass. |
| Client data | SSR seeds React state and a 15-second/50-entry JSON memory read cache; pending request sharing, debounce/throttle and response sequence checks. | Focused directory cache, no persistent payroll browser storage, no generic mutation cache or instantaneous cross-user invalidation. |
| Request control | Bounded payloads, login/request quotas, local concurrency/time limits, pending submits and safe aggregate diagnostics. | No distributed queue/rate service or complete production tracing platform. |
| AI | Local Qwen3/Nomic through LangChain and LangGraph; role-scoped payroll/policy/document context; code arithmetic and cited plain-text answers. | No autonomous tools, writes or claim approvals. Numeric/source checks cannot prove semantic correctness. |
| Retrieval | Encrypted SQLite passages/vectors, bounded exact cosine search; SQLite FTS for policy text. | No active Qdrant deployment; bounded retrieval can omit relevant evidence at larger scale. |
| Document audience | Employee documents remain owner/HR scoped; employee policy access requires explicit HR publication of text. | Sharing text does not expose an HR attachment. Body/publication updates save atomically. |
| OCR | Bounded PDF parser plus native English Poppler/Tesseract through memory pipes for image-only PDFs/images. | Printed text recognition, not arbitrary vision; scan/handwriting/layout quality affects results. |
| UX | Floating Ask Paydesk in both workspaces; no separate Document assistant/Files tab. Named months and server-supplied currency metadata. | Chat history resets on full navigation; saved attachments/indexes remain. |

## Critical workflows

1. **Salary save:** authorize HR → validate/confirm → compare expected version → compute through domain function → commit monthly inputs/snapshot/leave/claims together → revalidate views.
2. **Sheet import:** secure upload/scan → parse/validate every row → advisory sample review → stage owner-bound draft → paginated HR review → explicit confirmation/current-version checks → all-or-nothing commit.
3. **Claim:** authenticated employee submits pending claim → no net-pay increase → HR confirms approval → affected saved month recalculated; other employees/months remain unchanged.
4. **Upload/chat:** scan-passed normalized content → purpose review → private storage → OCR/extraction/index; questions gather authorized saved context and passages → bounded model response → source/number checks → answer or safe fallback.
5. **Renewal:** short access expires → coordinated same-origin refresh → atomic token rotation within idle/absolute limits; replay/logout/reset/disable revokes the appropriate family.

## Deployment and operational gaps

Deploy one app writer with persistent encrypted disk, separate protected secrets, HTTPS, a configured Google OAuth connection, reachable ClamAV, same-host loopback Ollama/models and native OCR executables. Localhost in production is not the developer's laptop. A typical ephemeral serverless deployment does not automatically supply these prerequisites.

No distributed transaction spans Drive and SQLite. Durable jobs, cleanup/reconciliation, retention administration, automated backup/restore/key escrow, notifications, persistent chat history, broader model evaluation and measured concurrency/performance targets remain follow-up work. See [security](SECURITY.md), [upload operation](SECURE_UPLOADS.md) and [AI deployment](DOCUMENT_AI.md).

## Acceptance evidence

[Current test cases](docs/CURRENT_TEST_CASES.md) maps the final requirements to focused suites, added cross-feature integration cases and manual/deployment checks. Original automated tests remain in `test/`. Cross-feature acceptance tests use an isolated encrypted database and synthetic users; external service fixtures are distinguished from live checks. Historical pass counts in milestone documents are snapshots, not fresh execution claims.
