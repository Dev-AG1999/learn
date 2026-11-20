# Test results

Recorded verification baseline: 21 November 2026. These are executed local checks for the implemented application; documentation cleanup does not constitute a fresh test run. Detailed acceptance cases and reproduction commands are in [CURRENT_TEST_CASES.md](CURRENT_TEST_CASES.md).

## Recorded checks

| Check | Result and scope |
|---|---|
| Automated suite | **316 tests across 51 files passed**, covering payroll rounding/persistence, validation, atomic imports, role isolation, refresh sessions, encryption, cache behavior, secure uploads and AI boundaries. |
| Static analysis/build | TypeScript no-emit check and production Next.js build passed. |
| Production HTTP | Login/cookies, protected pages, employee isolation/PDF, CSRF, bearer authentication and revocation passed on an isolated production server. |
| Browser workflows | HR/employee navigation, responsive layouts, hydration, salary editing, claim approval, manual creation, CSV/XLSX confirmation, search reuse, cross-tab/session recovery, secure attachments and workspace chat passed. Model/Drive/scanner protocol responses use fixtures in this harness. |
| Real antivirus | Current ClamAV signatures accepted plain/gzip synthetic PDFs and rejected plain/gzip harmless EICAR test signatures. The configured container health probe reported healthy. |
| Native OCR | Synthetic receipt PNG and image-only PDF yielded readable text/page references with local Tesseract/Poppler. |
| Local AI | Synthetic saved-payroll answers cited sources and acknowledged missing deduction reasons. Actual PDF extraction, Nomic embeddings, encrypted retrieval, cited Qwen output, advisory sample review and code arithmetic passed. |
| Adversarial inputs | Malformed/unsafe salary cells and code-like/resource-bounded calculator inputs were rejected or safely declined; 400 deterministic integer/percentage comparisons passed. This is bounded regression coverage, not exhaustive fuzzing. |

## Financial-document regression

Generated payslips format explicit currency units rather than ambiguous minor-unit integers. Coverage includes zero-, two- and three-decimal currencies, negative amounts and safe-integer bounds. In the real-model synthetic PDF check, 5,000 INR minor units were correctly explained as **INR 50.00**, with a page citation. Stored payroll calculations were unchanged.

## Verification limits

Tests use synthetic data and isolated databases. No live malware or destructive operation on personal payroll was used. Local checks do not certify a deployed HTTPS service, real Google OAuth/quota behavior, production load capacity, backup/restore recovery or all possible model/OCR interpretations. Passing tests does not establish that the application cannot fail.

The full-feature deployment requires persistent encrypted storage, appropriate host resources, configured Google Drive, ClamAV and local model/OCR services. See [deployment requirements](DEPLOYMENT.md) and [security](../SECURITY.md). Notifications, durable ingestion/reconciliation and broader model/load evaluation remain separate work.
