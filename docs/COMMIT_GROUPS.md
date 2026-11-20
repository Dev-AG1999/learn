# Release commit groups

Three ordered commits keep service implementation, user workflow integration, and release documentation/tests separately reviewable. Explicit paths exclude private environment/database files and personal learning notes. Backend-only and backend-plus-UI snapshots each passed their 311-test suite and TypeScript checks.

## 1. `feat(ai): add secure local document review and role-scoped chat services`

43 files.

```text
.env.example
app/api/chat/attachments/route.ts
app/api/chat/route.ts
compose.ai.yml
compose.uploads.yml
next.config.ts
package.json
scripts/check-local-ai.ts
scripts/ollama-fixture.ts
scripts/pdf-extract-worker.mjs
src/ai/calculator.ts
src/ai/chat.ts
src/ai/context.ts
src/ai/extract.ts
src/ai/local.ts
src/ai/review.ts
src/db/sqlite-payroll.ts
src/document-ai/config.ts
src/document-ai/extract.ts
src/document-ai/http.ts
src/document-ai/repository.ts
src/document-ai/runtime.ts
src/document-ai/service.ts
src/document-ai/sqlite-vectors.ts
src/document-ai/types.ts
src/files/attachments.ts
src/files/repository.ts
src/files/service.ts
src/payslip-document.ts
test/assistant.test.ts
test/chat-calculator.test.ts
test/chat-context.test.ts
test/chat-http.test.ts
test/chat-service.test.ts
test/document-ai-enabled-http.test.ts
test/document-ai-http.test.ts
test/document-ai-ollama.test.ts
test/document-ai-runtime.test.ts
test/document-ai-sqlite-vectors.test.ts
test/document-ai.test.ts
test/payslip-document.test.ts
test/secure-files.test.ts
test/upload-ai-review.test.ts
```

## 2. `feat(ui): integrate workspace chat and upload review feedback`

13 files.

```text
app/components/attachment-links.tsx
app/components/chatbot.tsx
app/components/workspace.tsx
app/employee/[employeeId]/assistant/page.tsx
app/employee/[employeeId]/claims/route.ts
app/globals.css
app/hr/assistant/page.tsx
app/hr/documents/route.ts
app/hr/import/preview/route.ts
app/hr/import/upload-form.tsx
app/hr/page.tsx
scripts/check-ui-browser.ts
test/dashboard-pages.test.ts
```

## 3. `docs: consolidate architecture, deployment and release verification`

20 files.

```text
.gitignore
ARCHITECTURE.md
ARCHITECTURE_REVIEW.md
DOCUMENT_AI.md
README.md
REQUIREMENTS.md
SECURE_UPLOADS.md
SECURITY.md
docs/ARCHITECTURE_HISTORY.md
docs/COMMIT_GROUPS.md
docs/CURRENT_TEST_CASES.md
docs/DEPLOYMENT.md
docs/EMPLOYEE_ACCESS.md
docs/IMPLEMENTATION_HISTORY.md
docs/RELEASE_VERIFICATION.md
docs/architecture-one-page.html
docs/architecture-one-page.pdf
test/adversarial-inputs.test.ts
test/current-implementation.test.ts
test/seed.test.ts
```

## Verification

The final tree passed 316 tests across 51 files, TypeScript, production build and production HTTP/browser checks. Real scanner, OCR and local-model checks also passed with synthetic content. See [release verification](RELEASE_VERIFICATION.md) for findings, fixes and limitations and [deployment](DEPLOYMENT.md) for the next operational steps.
