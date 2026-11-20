# Pre-push verification — 21 November 2026

Scope: the local assessment code, three ordered feature commits, and publication safety before the authorized push to the existing private `Dev-AG1999/learn` GitHub repository. This is not a remote deployment or a guarantee against all defects.

## Executed checks

| Check | Evidence / boundary |
|---|---|
| Automated regression | Final complete Vitest suite, TypeScript no-emit check and production Next.js build; final results recorded below. Synthetic isolated databases, including encrypted storage, auth, imports, failure rollback, cache and AI request guards. |
| Production HTTP | Login/cookies, protected pages, employee isolation/PDF, CSRF, bearer authentication and revocation passed against an isolated server/database. |
| Production Chrome | Role landing, responsive desktop/tablet/mobile layout, hydration, salary save, claim approval, manual create, CSV/XLSX import/confirmation, search reuse, silent/cross-tab renewal, compressed attachments, scan protocol fixture, signed links, Drive consent/retry and HR/employee chat passed. External responses are fixtures. |
| Real ClamAV | Fresh signatures; plain/gzip synthetic PDF accepted; plain/gzip harmless EICAR rejected. Repeated after health-probe correction and container restart; container reported healthy. |
| Native OCR | Synthetic receipt PNG and image-only PDF produced readable text/page references with local Tesseract/Poppler. |
| Real local model | Readiness passed; synthetic saved-payroll chatbot cited its source and stated the missing deduction reason; advisory sample review and code arithmetic passed. Actual generated-PDF extraction, Nomic embeddings, encrypted vector retrieval and Qwen cited-answer checks also executed. PDF currency correction recheck recorded below. |
| Hostile-input corpus | Salary cells with traversal/script/SQL-like/prototype-like text, invalid periods, unsafe/fractional numbers and formula-like values rejected. Calculator checked 400 independent integer/percentage comparisons plus code-like/oversized/division-by-zero cases. Deterministic bounded corpus, not exhaustive fuzzing. |
| Publication audit | Working files eligible for Git and 411 pre-existing history blobs checked for current configured secret values, private-key material and local sensitive-file paths. No matches. Personal-learning notes remain ignored; no environment/database is included. This does not prove absence of every unknown historical secret. |
| Commit boundaries | Backend-only and backend-plus-UI snapshots tested separately before committing; results recorded below. |

## Findings fixed before release

1. **Scanner health probe:** image default used `localhost` while configured ClamAV bound IPv4; it reported unhealthy despite working scans. Compose now uses `clamdscan --config-file=/etc/clamav/clamd.conf --ping=1`. Validated Compose, restarted the existing scanner preserving its signature volume, verified healthy and reran real scanner checks.
2. **PDF currency units:** generated payslip text displayed raw minor-unit values without labelling them, allowing an INR 50.00 deduction to be misread as INR 5,000. PDF text now emits explicit currency-unit amounts with exact integer-based decimal placement, respecting zero/two/three-decimal currencies, negative values and safe-integer bounds. Focused PDF/extraction regressions cover this behavior. No payroll formula or stored amount was changed.
3. **Test expectation correction:** the new adversarial test initially expected an oversized calculator expression to throw. The implemented safe behavior is to decline it (`null`); the test now asserts that existing contract. No unsafe expression execution was found.

## Limits and release gates

No arbitrary live attack, personal-document upload or destructive database test was performed. Tests cannot establish that the system is unbreakable. Google Drive browser tests use fixtures; no new live Drive authorization/quota experiment was performed here. Real deployment cookies, remote OAuth callback, persistent-disk restart/restore, public-site security, concurrency benchmarks, broader model/OCR evaluation and notification delivery are not certified. The dedicated `test:auth:browser` local-login diagnostic is covered by the broader native login browser workflow rather than separately run against the personal development database.

The repository is private: reviewers need access or an intentionally shared code snapshot. No visibility change is authorized or made. Secrets belong in protected runtime environment settings; full deployment instructions and prerequisites are in [DEPLOYMENT.md](DEPLOYMENT.md).

## Final execution record

- Final local suite: **316/316 tests across 51 files passed**. TypeScript and production Next.js build passed after the PDF fix.
- Real-model PDF recheck: extraction, Nomic vectors, encrypted retrieval and page citation passed; Qwen now answers **INR 50.00**, correctly, with the missing reason acknowledged.
- Backend-only commit snapshot: **311 tests / 49 files and TypeScript passed**. Backend-plus-UI snapshot: **311 tests / 49 files and TypeScript passed**.
- Final production HTTP and Chrome browser suites both passed again after the PDF fix.
- Documentation links, one-page PDF, explicit commit manifests and final Git-index publication audit are checked before push. See [commit groups](COMMIT_GROUPS.md).
