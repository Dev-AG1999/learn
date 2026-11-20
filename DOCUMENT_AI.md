# Shared upload review and Ask Paydesk

HR and employees use **Ask Paydesk**, a floating conversation panel inside the existing workspace. There is no separate Document assistant sidebar tab. Existing assistant URLs redirect to the workspace with chat open. AI is advisory: code validates required fields, calculates payroll and applies authorization; HR explicitly confirms imports and approves claims.

## Local setup

1. Keep Ollama running on the application host. On this Mac it was installed with Homebrew and started with `brew services run ollama` (without login startup).
2. Install `qwen3:4b` and `nomic-embed-text:v1.5` using `ollama pull` for each model. Both are already installed and verified on this development Mac.
3. Install OCR dependencies. On macOS: `brew install tesseract poppler`. On Debian/Ubuntu: install `tesseract-ocr`, `tesseract-ocr-eng` and `poppler-utils`. These are already installed on this Mac. The runtime uses English OCR. Optional executable paths are shown in `.env.example`.
4. Keep existing authentication, encrypted database, Google Drive and ClamAV settings. Configure:

```dotenv
AI_DOCUMENTS_ENABLED=true
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_CHAT_MODEL=qwen3:4b
LANGSMITH_TRACING=false
LANGCHAIN_TRACING_V2=false
LANGCHAIN_TRACING=false
```

5. Run `npm run ai:check`, restart Next.js, and sign in. Upload through the existing salary sheet, HR document or claim form, or attach a PDF/image inside Ask Paydesk. Expand AI review results or answer sources to inspect them. HR selects an employee ID and payroll period for personal salary questions; employees are restricted to their authenticated employee ID.

An OpenAI key, paid inference subscription and separate vector server are not required. The supported smaller Qwen3 1.7b model can be selected if 4b is too slow, at a quality tradeoff. Model download is an operator setup task, never triggered by application requests.

## Upload pipeline

Existing browser compression, server decompression, ClamAV scan, format normalization, deterministic validation, server compression and second scan are preserved. Only scan-passed content reaches AI. Review runs before private Google Drive storage; PDF/image indexing follows a successful ready file. The same service serves every attachment field, including chat uploads. Files retain their owner and signed application downloads.

Reviews distinguish `reviewed`, `needs-review`, `unavailable` and `disabled`, with a summary and field observations. **AI outages or capacity limits do not block otherwise valid uploads.** Index failures also preserve the original file and review, with a visible index status and retry from chat. Scanner failures and required-field errors still reject uploads. An AI review is not a malware clearance or a payroll approval.

Salary CSV/XLSX imports keep all-row code validation and explicit HR preview/confirmation. AI receives a bounded first-five-row sample and schema report, clearly labelled as a sample review. Invalid sheets can receive an explanation of code-reported errors, but remain rejected. AI never supplies replacement payroll amounts or silently maps columns. Policy reviews check readability/purpose; receipt reviews compare readable fields with the claim's expected values and flag uncertainty. Other documents receive a purpose/readability summary.

## Chat, sources and security

LangChain connects local Qwen and Nomic models and splits document text. LangGraph gathers authorized context and generates a structured answer. Extracted passages and 768-dimensional embeddings are stored in encrypted SQLite. Exact vector search considers up to 100 ready documents for the selected owner plus two explicitly selected attachments, each bounded to 240 passages. It avoids a separate vector deployment for this scope; retained Qdrant/OpenAI adapters are not selected by runtime.

The chatbot reads the selected employee's saved payslip, leave and claim records, and same-currency previous-month comparison. Stored payroll figures and application equations are authoritative. Other deduction reasons are not recorded, so the model must say when a reason is unknown. Pending claims are not paid reimbursements. HR must explicitly select an employee; employees cannot change identity through prompts or request parameters.

Policy text is searchable through a bounded SQLite full-text query. Employees receive only text HR explicitly marks **Allow employees to ask the chatbot about this policy text**. New or updated policy text defaults to private, and body/publication changes save atomically. Sharing policy text does not expose HR's private Drive attachment. Uploaded personal documents remain unverified evidence, not approved policy. Ownership and ready status are checked independently of the model before retrieval and every explicit attachment request.

The conversation supports general explanations, authorized document questions, and code-based arithmetic such as `calculate 20% of 5000` or `(1000-100)/2`. The bounded rational calculator never executes code or asks the model to perform financial arithmetic. Source indexes and sourced numeric claims are checked, and citations show the source text. General explanations are labelled. If a personal salary explanation lacks verifiable citations, the application shows its own saved-payroll summary with a clear fallback label, or requests more context when no usable record exists. These checks reduce errors but cannot prove a model's interpretation is correct.

Questions and document text are untrusted data. The model has no payroll-writing, approval, browser or arbitrary database tools. Only loopback Ollama and supported local models are accepted; external tracing is disabled. Requests use existing session/bearer authorization and CSRF controls, no-store responses, rate limits, concurrency bounds and timeouts without automatic model retries. Chat history is bounded to six turns; system roles are rejected. Answers render as plain text.

## OCR and limits

Chat supports PDF up to 5 MiB and PNG/JPEG up to 8 MiB, subject to the shared file limits. Text PDFs use a bounded parser worker. Image-only PDFs and images use Poppler/Tesseract through bounded stdin/stdout pipes; OCR does not write plaintext document files to temporary storage. Scanned PDFs support up to 10 pages and a 60-second OCR deadline. Text extraction is limited to 200,000 characters and 240 passages. Mixed PDFs with a readable text layer use that layer; handwritten text, complex layouts and poor scans may be incomplete. OCR is text recognition, not unrestricted visual interpretation.

Conversations stay in browser memory and reset on full page navigation; attachment records and indexes persist in encrypted storage. Existing files are available through the chat selector, and already indexed files reuse their passages. There is no persistent conversation history, document-retention UI or background job runner. A process crash can leave an indexing record requiring administrative recovery. Notifications are a separate milestone.

Ollama must run on the same host under the loopback-only configuration. A hosted deployment cannot use localhost to reach this laptop. Production needs persistent encrypted SQLite storage, sufficient model memory/compute, the OCR binaries, ClamAV and Drive OAuth configuration. Free model weights do not make hosted compute free.

## Verification

Unit/integration checks cover role isolation, policy publication, source and number validation, bounded arithmetic, conversation request validation, upload scan/review ordering and nonblocking AI failures. Browser checks use synthetic payroll, Drive/scanner and local model fixtures rather than personal documents. Native OCR and actual local-model smoke tests use synthetic documents. See the milestone handoff for final executed checks. No Git commits are created automatically.

Final validation for this milestone: 310 tests in 49 files passed, along with TypeScript and the production build. Chrome checks passed for both role workspaces, automatic review, secure chat image upload with native OCR, citations and responsive layouts. Native OCR passed synthetic PNG and image-only PDF checks. Actual Qwen3/Nomic checks passed on a synthetic payslip (extraction, embeddings, encrypted vector retrieval and cited answer); the real chatbot also cited saved synthetic payroll and explicitly stated the missing deduction reason. Real-model sample sheet review and code-based arithmetic passed. Google/scanner browser integration uses isolated protocol fixtures; these checks do not certify every real document or model interpretation.
