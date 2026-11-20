# Paydesk

An HR salary-management assessment application built with Next.js, React, TypeScript and encrypted SQLite. HR manages monthly salary inputs, employee creation, CSV/XLSX imports, claims and documents. Employees view/download their own payslips and submit claims. A role-scoped local chatbot explains authorized records and uploaded documents.

## Project documentation

- [Current requirements](REQUIREMENTS.md)
- [One-page system architecture](ARCHITECTURE.md) and [PDF](docs/architecture-one-page.pdf)
- [Architecture decisions and limits](ARCHITECTURE_REVIEW.md)
- [Deployment and environment setup](docs/DEPLOYMENT.md)
- [Employee login/account provisioning](docs/EMPLOYEE_ACCESS.md)
- [Acceptance cases](docs/CURRENT_TEST_CASES.md) and [test results](docs/TEST_RESULTS.md)
- [Security](SECURITY.md), [database encryption/migration](DATABASE_ENCRYPTION.md), [secure uploads](SECURE_UPLOADS.md), [local AI](DOCUMENT_AI.md), [salary import](IMPORT_GUIDE.md)

## Local setup

Use Node 22+ and install packages with `npm ci`. Create a private `.env.local` from `.env.example`, generate independent strong signing/database/Drive secrets, and set the local origin/database path. Existing plaintext data requires explicit migration before enabling the database key; do not replace an existing key.

For attachments, configure Google OAuth, connect Drive through HR documents, and run ClamAV (`docker compose -f compose.uploads.yml up -d`). For local AI, install Ollama, `qwen3:4b`, `nomic-embed-text:v1.5`, Tesseract English data and Poppler; follow [DOCUMENT_AI.md](DOCUMENT_AI.md), then run `npm run ai:check`.

```sh
npm run dev
```

Visit `http://localhost:3000/login`. There are no default credentials or public signup. Provision an HR account through `npm run auth:user` with a temporary `AUTH_USER_PASSWORD` supplied privately; see [account instructions](docs/EMPLOYEE_ACCESS.md). Employee accounts link to saved employee IDs and are not created automatically by salary imports. Do not seed a database containing real payroll.

## Verify

```sh
npm test
npx tsc --noEmit
npx next build
npm run test:auth:http
npm run test:ui:browser
npm run test:uploads:scanner
npm run ai:check
```

Browser checks require Chrome and native OCR. Real scanner/model checks require those local services. Automated tests use synthetic isolated data; see the test-results document for recorded executions and limitations. Passing tests does not prove the application cannot fail or establish production load capacity.

## Deployment boundary

Use one app writer and persistent encrypted disk. The full feature set needs same-host/private-loopback Ollama and ClamAV, OCR binaries, HTTPS and a configured Drive connection. An ordinary ephemeral/free web deployment does not supply these. Follow [DEPLOYMENT.md](docs/DEPLOYMENT.md); no deployed URL is provisioned by this repository. No complete production app Dockerfile/Compose stack is currently supplied.

Payroll amounts are integer minor units internally; generated PDFs format explicit currency units. AI is advisory and cannot change salary or approve claims. Notifications, durable ingestion jobs, persistent conversation history and statutory tax calculations remain outside the delivered scope.
