# Employee access, sessions and AI: architecture review

Reviewed 16 November 2026. Only the employee-directory milestone is implemented
in this change. Session renewal and AI below are proposed next milestones.

## What exists today

- HR salary creation, CSV/XLSX validation, private review and atomic confirmed import.
- Role-bound authentication, revocation and a fixed 30-minute session lifetime.
- Employee-owned payslips and claims; HR approval through the tested payroll function.
- SQLite employee pagination, monthly snapshots, policy text and exact-text lookup.
- No live LLM integration, document extraction, semantic retrieval or conversational bot.
  The existing receipt flag checks text characters, not receipt images or OCR.
- Employee IDs and salary inputs are stored; employee names and deduction reasons
  are not stored. There is no honest way to fabricate those in a directory or chatbot.

## 1. Employee directory — implemented milestone

`/hr/employees` is HR-only and available as Employees in the sidebar and View
employees on the dashboard. It lists saved employees from manual entry and imports,
with current annual CTC, the selected month's saved net pay and an Edit salary link.
Employees without a payslip for that month remain visible with an explicit status.

Search is by case-sensitive employee ID prefix. Currency filtering applies to the
current CTC currency, not historical payslip currency. Both amounts are labelled
with their own currency. Results use 25-row keyset pages and existing payslip
indexes, with a new (currency, employee_id) employee index. The browser never loads
the entire employee table. No duplicate employee data or names are invented.

## 2. Session renewal — recommended next implementation milestone

Repeated logout is caused by a fixed absolute 30-minute expiry; there is currently
no renewal endpoint. Rotating refresh tokens are appropriate for keeping an
actively working user signed in. Simply increasing JWT expiry is insufficient.

Recommended starting policy, configurable and subject to acceptance:

- Short-lived access JWTs, e.g. 10 minutes.
- An opaque random refresh token in a separate HttpOnly, Secure, same-site cookie.
  Store only its hash and session-family metadata in the same SQLite database.
- Rotate the refresh token on every successful refresh in an atomic transaction.
  Detect replay and revoke the token family and associated access sessions.
- An 8-hour maximum working session, with a 30-minute inactivity limit. Background
  polling alone must not keep an unattended session alive indefinitely.
- Silent renewal during active use, with same-origin protection. No token in
  localStorage, a URL, an AI context or a log.
- Logout, password reset and account disable revoke both token types immediately.
  Recheck account state on every refresh and sensitive request.
- Serialize refresh across browser tabs and coordinate retries. Test concurrent
  refresh, expired access on page navigation, offline recovery and reuse detection.
- Warn before a genuine timeout without silently copying salary forms into
  persistent browser storage. Review-draft expiry remains independent of login.

This preserves the existing authorization and revocation controls, but an 8-hour
active session has a different exposure window from a fixed 30-minute session.
It cannot honestly be described as identical security. Absolute/idle limits and
rotation make that usability tradeoff explicit and bounded.

Reference: RFC 9700, refresh-token protection and replay prevention:
https://www.rfc-editor.org/rfc/rfc9700.html#section-4.14

## 3. Document foundation — before policy chat

Introduce real PDF/text document ingestion first, then supported DOCX/image/OCR
paths as separately tested additions. Accept explicit formats and sizes rather
than promising unrestricted 'any document' support. Extract text and preserve
file identity, document version and page/section references for citations.

Document ownership and audience must be established before retrieval:

- HR-only policies/documents default to HR-only access.
- HR can publish selected policies to employees explicitly.
- An employee's uploaded question/receipt/supporting file remains private to that
  employee and authorized HR; it never automatically becomes a company policy.
- Query ownership/visibility before retrieval, not after a model has seen content.
- Uploaded text is untrusted evidence, never instructions granting new permissions.

Keep binary files in private persistent storage and metadata/chunks in SQLite,
with authenticated file access and defined retention. Do not use a public folder
for employee documents. Provision the AI provider and data-handling settings
before sending any real payroll or document text to an external service.

## 4. Read-only, role-scoped chat — recommended AI starting point

Use one chat implementation with separate server-authorized tool sets. The model
must not decide the caller's role or employee ID. No arbitrary SQL or write tools.

Employee tools return only the caller's stored payslip, leave and claim data for
a selected month, plus policies explicitly published to employees and that caller's
private question documents. For 'why was my salary deducted?', the answer should
show the stored unpaid deduction, leave days, other deductions and reimbursements,
with a link/citation to the saved payslip. A missing reason must be acknowledged.

HR tools can retrieve authorized HR policies and, under the user's expanded
request, selected read-only payroll/claim records and currency-grouped totals.
Structured financial questions should use parameterized repository queries;
policy questions should use retrieved document passages. This expanded scope
must supersede the earlier document-only HR assistant rule in the AI milestone's
requirements, without granting a salary-writing capability.

The tested domain function remains the sole payroll calculator. A model explains
stored figures and may request a bounded application-calculated scenario; it does
not invent or overwrite salary arithmetic. No saved payslip means no assertion
about an employee's pay. No supporting policy passage means no policy answer.

Other deductions currently store an amount without a reason. To answer the
business reason accurately, HR must first be able to record a reason/category.
Claim status currently has pending/approved only, without rejection explanations.
Those domain fields need their own reviewed schema/UI changes before a chatbot
can claim to explain a rejection or the origin of an arbitrary deduction.

## 5. AI-assisted sheet review

Keep the mandatory path deterministic:

    Parse -> validate -> optional AI review -> HR preview -> explicit confirmation
                                                  -> atomic payroll commit

The current code already handles required fields, exact monetary values, duplicate
IDs, periods, currency, leave and conflicts. Those checks remain hard gates.
AI may explain errors, suggest a legacy-header mapping, summarize changes or flag
unusual changes for HR review. Suggested mappings must be approved and transformed
by deterministic code; a model must never silently change an amount or claim status.

Use explicit business thresholds when required, not a model-invented 'fair salary'
rule. Batch bounded features/differences, avoiding whole-table prompts. Return
structured warnings tied to source row numbers. Model warnings do not masquerade
as validation facts. An AI outage should leave deterministic validation available,
with a clearly labelled unavailable review; HR remains responsible for confirmation.

## LangChain, LangGraph and vector storage

Recommendation: retain Next.js/TypeScript and SQLite for this assessment.

- **LangChain:** optional. Use it if document/retriever/provider adapters simplify
  the tested implementation. A small typed AI-provider interface and read-only
  tools are sufficient initially; adding a framework alone does not add safety.
- **LangGraph:** defer until a workflow needs resumable multi-step execution,
  persisted human review or branching extraction/retrieval with retries. A simple
  policy Q&A request does not need a graph runtime. If introduced, checkpoint in
  the same database where feasible and keep payroll writes outside model tools.
- **Vector database:** not required because there are 10,000 employees. Employee
  data belongs in indexed structured queries, not approximate vector retrieval.
  Start policy retrieval with SQLite FTS5 and citations. Measure a representative
  question set; add embeddings/hybrid search within the same SQLite architecture
  if synonym/semantic recall is inadequate. Assess native extension/deployment
  support before choosing an embedding index. A separate vector service adds
  operations and access-control duplication without evidence that it is needed.

References:
https://www.sqlite.org/fts5.html
https://github.com/langchain-ai/docs/blob/main/src/oss/langgraph/overview.mdx

## Delivery sequence and release evidence

One committed milestone at a time:

1. Employee directory and salary navigation (this change).
2. Rotating refresh sessions and timeout UX.
3. Private document ingestion, visibility, citations and retrieval.
4. Role-scoped conversational assistant and provider integration.
5. Optional AI-assisted import review and any needed deduction/claim reason fields.

For session renewal, test rotation/replay, cross-tab races, idle/absolute expiry,
logout and account disable. For AI, test cross-employee and document isolation,
prompt-injection attempts, citation correctness, exact numeric grounding, missing
records/reasons, provider failure and a fixed evaluation question set. Model names,
provider credentials, permitted data sharing and cost budgets are required before
the live AI milestone, not before finishing the employee directory.


## Refresh milestone implementation update

The rotating-session proposal is now implemented in the subsequent refresh
milestone. See `SECURITY.md` for actual policy, API contracts and migration notes.
Document ingestion and live AI integration remain proposed future milestones.

## Clarified PDF scope and implementation update

The user's subsequent clarification requests Q&A over the selected uploaded PDF,
including S3 storage, rather than implicit policy retrieval. This milestone now
implements that path with LangChain splitters/model adapters, a bounded LangGraph
retrieval/generation graph, Qdrant vectors and private S3 objects. The earlier
FTS5/no-framework recommendation above is retained as review history, not the
implemented PDF architecture. Payroll stays in SQLite. See `DOCUMENT_AI.md` for
actual behavior, configuration, verification and limitations. Notifications and
AI-assisted salary-sheet review remain separate future milestones.

Local inference is now selectable through `AI_PROVIDER=ollama`, using LangChain's
Ollama adapters with Qwen3 and Nomic. LangGraph and S3 remain; Qdrant collections
are isolated by embedding profile. OpenAI remains an explicit alternative, with no
paid fallback from local mode. This extends the same uncommitted PDF milestone.

## Superseding user direction: secure uploads first, no additional upload tabs

The active milestone now secures file submissions within existing forms, replaces
S3 with private Google Drive, and returns signed application URLs. Google Drive
is storage only; client/server gzip is not a malware guarantee. ClamAV scans
original and final bytes with fail-closed behavior. AI is explicitly deferred;
earlier prototypes remain inactive. See SECURE_UPLOADS.md for current behavior.
