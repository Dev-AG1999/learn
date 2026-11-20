# Assessment artifacts

This index maps the assessment's requested artifacts to the project documents and implementation evidence. It describes the completed implementation and its limits; personal interview study notes are excluded.

| Requested artifact | Project evidence | What to review |
|---|---|---|
| Requirements | [REQUIREMENTS.md](REQUIREMENTS.md) | Roles, monetary rules, validation, imports, security, AI authority and explicit exclusions. |
| Planning / design notes | [Approach and design notes](docs/DESIGN_NOTES.md) | Retrospective delivery sequence, decisions, alternatives and lessons from verification. |
| Architecture diagrams | [One-page architecture PDF](docs/architecture-one-page.pdf), [editable overview](ARCHITECTURE.md) | Components, data flow, security boundaries and deployment assumptions. |
| AI prompts / instructions | [AI use and prompts](docs/AI_USAGE.md) | Development assistance, representative actual project instructions, runtime prompts and validation responsibilities. |
| Tradeoffs | [Architecture decisions](ARCHITECTURE_REVIEW.md), [design notes](docs/DESIGN_NOTES.md) | SQLite/single writer, local AI, Google Drive, bounded retrieval, privacy and operational costs. |
| Performance considerations | [API_OPTIMIZATION.md](API_OPTIMIZATION.md) | Indexed pagination, bounded cache, request sharing, debounce/throttle, freshness and measurement limits. |
| Tests and results | [Acceptance cases](docs/CURRENT_TEST_CASES.md), [recorded results](docs/TEST_RESULTS.md), [executable tests](test/) | Positive/failure cases, cross-feature flows, synthetic fixtures versus real dependency checks, and untested production concerns. |
| Operating the solution | [README](README.md), [deployment](docs/DEPLOYMENT.md), [employee access](docs/EMPLOYEE_ACCESS.md) | Setup, explicit account provisioning and full-feature hosting dependencies. |
| Security detail | [SECURITY.md](SECURITY.md), [encryption](DATABASE_ENCRYPTION.md), [secure uploads](SECURE_UPLOADS.md) | Authentication/authorization, encryption versus hashing, malware checks, private storage and key management limits. |
| AI operation | [DOCUMENT_AI.md](DOCUMENT_AI.md) | Local model setup, citations, scope enforcement, OCR, advisory review and failure behavior. |
| Example inputs | [Salary sample](artifacts/employee-salary-sample.csv), [blank template](artifacts/employee-salary-template.csv), [sample policy](artifacts/sample-hr-policy.pdf) | Synthetic inputs for understanding import/document workflows; not real employee data. |

Suggested reading order: README → requirements → one-page architecture → design/AI notes → test results. Detailed operational documents support deeper inspection.

These documents are intentionally part of the submission. Environment secrets, personal payroll databases, reviewer passwords, personal learning guides and raw private conversation logs are not submission artifacts. No public demo URL by itself establishes a durable production deployment.
