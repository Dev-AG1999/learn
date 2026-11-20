# Approach and design notes

This is a **retrospective summary** of the implementation and decisions, written for assessment review. It is not presented as an untouched plan written before development. [Current requirements](../REQUIREMENTS.md) describe final behavior; [architecture decisions](../ARCHITECTURE_REVIEW.md) describe the resulting system.

## Problem decomposition and delivery sequence

| Stage | Main concern | Resulting boundary |
|---|---|---|
| Payroll foundation and editing | Correct money, historical snapshots and safe updates. | Tested domain computation; integer minor units; monthly inputs/snapshots; confirmation, transactional persistence and stale-edit rejection. |
| Identity and employee access | HR authority versus employee ownership. | Explicit account provisioning; server-side guards; password hashing and revocable signed sessions. Payroll imports do not silently create accounts. |
| HR/employee workflows | Usable responsive screens and complete salary/claim journeys. | Shared workspace, named months, empty/error states, employee PDF, manual creation and HR-approved reimbursements. |
| Bulk entry and directory | Import up to 10,000 employees without partial writes or whole-table browser loads. | Bounded CSV/XLSX parsing, all-row validation, private staged review, atomic confirmed import and indexed cursor pagination. |
| Session usability and request control | Repeated logouts, duplicate search work and stale results. | Rotating refresh families with idle/absolute limits; account-scoped short-lived memory cache, in-flight sharing, debounce and sequence checks. |
| Sensitive storage and documents | Confidentiality and risky attachments. | Encrypted SQLite, encrypted Drive tokens, shared scan/normalization/compression pipeline and authenticated signed downloads. |
| Local AI integration | Explain saved data/documents without handing payroll authority to an LLM. | Authorized context collection, bounded retrieval/OCR, structured cited answers and advisory upload review; deterministic validation/calculation remains authoritative. |
| Release verification | Catch failures across component boundaries and expose remaining deployment constraints. | Cross-feature/adversarial tests, production HTTP/browser checks and synthetic real scanner/OCR/model checks. |

## Decisions and alternatives

**One app and one database.** The assessment target is 10,000 employees, not 10,000 concurrent requests. Next.js and an indexed SQLite repository keep the deployment and transactional model understandable. Multiple services/Redis/sharding would introduce coordination without demonstrated need. A persistent single writer is an explicit constraint; multi-writer hosting is a reason to replace the repository adapter, not to share one SQLite file across independent serverless instances.

**Money outside the model and UI.** Floating-point monetary input and LLM arithmetic can produce plausible but wrong amounts. Decimal input converts to integer minor units, a domain function applies the required rounding, and snapshots preserve processed salary. Neither a later CTC edit nor a chat response can silently rewrite history. Other deductions lack a structured reason, so the chatbot must acknowledge that gap.

**Preview before commit.** File parsing and schema validation are separate from payroll persistence. Owner-bound drafts let HR inspect normalized data and confirm, while current-version checks and the batch transaction prevent stale or partial imports. This costs staging/expiry logic but makes a large update reviewable and repeatable.

**Short-lived read cache.** A 15-second/50-entry memory cache and shared pending requests reduce repeated directory reads. Persistent browser storage would retain sensitive data longer; caching indefinitely would conceal changes. The chosen cache has bounded staleness and an explicit refresh. It does not provide instant cross-user synchronization or replace authorization checks.

**Google Drive for the assessment.** The project uses an explicitly connected account rather than provisioning S3 storage/billing. Drive is familiar and can use existing account storage, but introduces OAuth consent, quotas and private-folder constraints. It is not unlimited free storage or evidence that S3 is categorically expensive. The storage adapter can be reassessed for production lifecycle/retention needs.

**Local Ollama and encrypted SQLite vectors.** Local Qwen/Nomic avoid a paid inference API dependency in the implementation and keep inference on the controlled host. They still consume memory/compute and require model-quality evaluation. LangChain supplies adapters/splitting and LangGraph expresses bounded context/response steps. Exact vector search in the existing encrypted database avoids a separate vector deployment; it is bounded, not an unmeasured claim of large-scale ANN performance.

**Hard security gates versus advisory AI.** Scanner/format/schema failures block uploads. AI review can flag purpose/readability concerns but cannot approve payroll or override required fields. Valid uploads continue with a visible unavailable status on AI failure, preserving core HR operation. Sheet AI examines a labelled sample while code checks every row. Model output remains fallible even with citation/number checks.

## Lessons from integration checks

- Different server/browser currency metadata caused hydration mismatches; server-produced options/help provide a consistent first render.
- Generated PDF text originally showed ambiguous minor-unit numbers. Explicit currency-unit formatting and precision regressions now prevent a model/reviewer confusing INR 50.00 with 5,000 currency units.
- A scanner image's default health check reported unhealthy despite successful real scans. Using the configured socket aligned the health check with actual service behavior.
- Expiry/refresh races required tests of live session state and cross-tab coordination, not only valid-token tests.

These findings and recorded results are summarized in [TEST_RESULTS.md](TEST_RESULTS.md). They do not prove exhaustive correctness or production capacity.

## Hosting and outstanding work

A full deployment needs persistent encrypted storage, local model/scanner/OCR services, Google OAuth and sufficient resources. Environment variables do not install those services. A laptop tunnel is a temporary demonstration and stops when its host/tunnel stops; ordinary free serverless hosting does not satisfy the existing persistence/local-service assumptions.

Durable ingestion/reconciliation, backup/restore and key-recovery drills, notifications, persistent chat history, measured concurrent-load targets and broader model/OCR evaluation remain explicit follow-ups. The submission describes these limits rather than claiming they are implemented.
