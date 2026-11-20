# Deployment and environment configuration

Verified against the implemented application and official hosting documentation on 21 November 2026. This is an operator guide, not a claim that a public deployment has already been performed.

## Choose a compatible host first

This application needs **one application writer and persistent local SQLite storage**, plus local-loopback Ollama and ClamAV, native OCR tools, outbound Google access and HTTPS. A free model is not free hosted compute. Start with a persistent Linux VM sized for Node, ClamAV, Qwen3:4b/Nomic and model context memory; 16 GiB is a planning starting point, not a measured capacity guarantee. Benchmark on the actual host and budget disk for model weights, signatures and backups.

An open-source stack that fits the current code is **Ubuntu + Node 22 + systemd + Caddy**, with Ollama and ClamAV on that same VM. You pay for the VM unless you already have a suitable server/free allocation. [Caddy provides HTTPS reverse proxying](https://caddyserver.com/docs/quick-starts/reverse-proxy).

[Coolify is an open-source self-hostable deployment platform](https://coolify.io/docs/core/what-is-coolify). Its Git/Docker Compose workflows can manage a future containerized deployment, but this repository does not yet include a complete application Dockerfile/production Compose stack. `compose.uploads.yml` starts a local scanner; `compose.ai.yml` is optional inactive vector-service scaffolding, **not the app deployment**. Do not assume separate containers can satisfy the current loopback-only model/scanner checks without a deliberate shared-network configuration.

**Render:** it is a managed hosting service, not the open-source option above. [Free Render web services cannot attach persistent disks](https://render.com/docs/free), so the current SQLite application must not use a free ephemeral service for payroll. [Persistent disks](https://render.com/docs/disks) require a compatible paid service and only mounted-path data persists. Full AI/upload support also needs an appropriate container image/process setup and sufficient memory for local Ollama/ClamAV/OCR. The current repository does not provide that complete Render container. A native Next.js deploy alone does not supply those dependencies.

## Option A: full-feature single Linux VM

The following uses `/opt/paydesk`, `/var/lib/paydesk` and a dedicated `paydesk` service account. Replace the example public domain. Commands are a deployment procedure for your chosen server; they have not been executed on a remote host by this change.

### 1. Prepare runtime and checkout

Install Node **22 or a compatible supported newer version** globally on the target Linux architecture, Git, build tools (`python3`, `make`, C/C++ compiler), Tesseract with English data, Poppler, Caddy and the scanner runtime. Use the official distribution/install instructions for the host. Never copy macOS `node_modules` to Linux; native SQLite/Sharp packages must install for the server architecture.

Create the `paydesk` service user, `/opt/paydesk` checkout owned by that user, and `/var/lib/paydesk` owned by that user with mode 0700. Clone `https://github.com/Dev-AG1999/learn.git` using an authorized deploy key/GitHub integration (the repository is private). Never put an access token in the clone URL or repository files.

As the application user in `/opt/paydesk`:

```sh
npm ci --include=dev
npm test
npx tsc --noEmit
npx next build
```

Use `npx next start`, not `next dev`, in production. There is currently no `npm start` script. Keep exactly one application writer. Plan a maintenance window/backups for updates; rebuilding/restarting the only process is not zero downtime.

### 2. Run private dependencies

- Install [Ollama on Linux](https://github.com/ollama/ollama/blob/main/docs/linux.mdx), keep its API bound to `127.0.0.1:11434`, and enable its system service. Pull `qwen3:4b` and `nomic-embed-text:v1.5` on this server. Confirm readiness with `ollama list` and application `npm run ai:check` after configuring the environment. A deployment cannot reach the developer laptop through localhost.
- Run ClamAV with current signatures on `127.0.0.1:3310`. If Docker is installed, the repository's `docker compose -f compose.uploads.yml up -d` publishes only the loopback scanner port and persists signatures. The Compose definition pins `linux/amd64`; use a compatible host/image architecture. Its health check uses the configured clamd socket. First signature download can take time.
- Confirm Tesseract English language data and `pdfinfo`/`pdftoppm` are available in the application's PATH. Linux paths differ from `/opt/homebrew`.
- Restrict public inbound traffic to HTTPS/HTTP and administrator SSH. Do not expose Node 3000, Ollama 11434, ClamAV 3310 or a vector service publicly. Ollama/ClamAV are unauthenticated local dependencies, not public APIs.

### 3. Create the server environment file

Create `/etc/paydesk/paydesk.env`, owned by root with group `paydesk` and mode 0640 (or an equivalently protected secret-manager injection). Keep the directory appropriately restricted. Generate **three independent** 32-byte hex keys with `openssl rand -hex 32`; do not use the example placeholder text as a key.

```dotenv
NODE_ENV=production
APP_ORIGIN=https://paydesk.example.com
AUTH_JWT_SECRET=<independent 64-character hexadecimal key>
DATABASE_ENCRYPTION_KEY=<different 64-character hexadecimal key>
DRIVE_TOKEN_SECRET=<another independent 64-character hexadecimal key>
PAYROLL_DB=/var/lib/paydesk/payroll.sqlite
FILE_UPLOADS_ENABLED=true
GOOGLE_DRIVE_CLIENT_ID=<your deployed OAuth web-client ID>
GOOGLE_DRIVE_CLIENT_SECRET=<your deployed OAuth client secret>
CLAMAV_HOST=127.0.0.1
CLAMAV_PORT=3310
AI_DOCUMENTS_ENABLED=true
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_CHAT_MODEL=qwen3:4b
LANGSMITH_TRACING=false
LANGCHAIN_TRACING_V2=false
LANGCHAIN_TRACING=false
```

`APP_ORIGIN` is the exact HTTPS origin without a trailing slash. Do not prefix secrets with `NEXT_PUBLIC_`. `AUTH_USER_PASSWORD` is only a temporary provisioning value, not a permanent service setting. Qdrant/OpenAI credentials are unnecessary for the current local runtime. Optional `TESSERACT_PATH`, `PDFINFO_PATH`, `PDFTOPPM_PATH` must point to valid **server** binaries.

For a fresh assessment deployment, start with an empty encrypted database and synthetic employee data. Local accounts/Drive connection do not automatically exist on the server. If deliberately migrating an existing database, follow [DATABASE_ENCRYPTION.md](../DATABASE_ENCRYPTION.md), preserve its exact key and reconcile stored Drive objects; do not copy personal payroll or generate a replacement key blindly. Never commit or upload the environment file to GitHub.

### 4. Start one application service

Create `/etc/systemd/system/paydesk.service` (adjust `/usr/local/bin/node` to the globally installed absolute Node path on your host):

```ini
[Unit]
Description=Paydesk salary application
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=paydesk
Group=paydesk
WorkingDirectory=/opt/paydesk
EnvironmentFile=/etc/paydesk/paydesk.env
ExecStart=/usr/local/bin/node /opt/paydesk/node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3000
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now paydesk
sudo systemctl status paydesk
```

Inspect private logs if startup fails; do not paste secrets/document contents into public reports. A process being active is not proof its dependent services work.

### 5. Configure HTTPS and Google OAuth

Point `paydesk.example.com` DNS to the server and configure Caddy's site:

```caddyfile
paydesk.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Validate/reload Caddy using its installed service commands. HTTPS certificate issuance requires correct DNS and reachable ports 80/443. Check the real public `/login`; cookies must be Secure and mutation requests must match `APP_ORIGIN`.

In the Google Cloud OAuth web client, add exactly:

```text
https://paydesk.example.com/api/storage/drive/callback
```

Keep your localhost redirect too if you still develop locally. Add approved Google test users while the OAuth app is in testing. Create the hosted HR account (next step), log in as HR and connect Drive through HR documents. Only server-held OAuth credentials are used; ordinary HR/employee users do not receive the client secret. Uploaded files consume the connected Drive account's quota.

### 6. Provision dedicated accounts against the deployed database

In a trusted administrator shell with the server environment loaded as the application user, run:

```sh
node --experimental-strip-types scripts/auth-user.ts create reviewer.hr hr
```

Set `AUTH_USER_PASSWORD` temporarily via a hidden prompt before running that command, and unset it afterwards; minimum 12 characters. The trusted application user must have the environment variables in step 3, including the **deployed database path/key**, available to this CLI. systemd's EnvironmentFile is not automatically loaded in your interactive terminal. Do not place the password in shell history.

Log in as HR, add/import and confirm synthetic employees, then provision a linked employee account using that saved employee ID. See [employee access](EMPLOYEE_ACCESS.md). Share only those account credentials privately with the reviewer, not Google credentials or environment secrets. Restrict/disable test accounts after use.

### 7. Gate the deployed demo

Verify login/role denial, named month, directory filters, salary save/reload, employee PDF, scan-passed upload/download, Drive reconnect, pending/approved claim and cited chatbot response. Confirm AI outage shows unavailable review while a valid upload proceeds, but scanner failure blocks it. Restart and verify persistent data, and rehearse backup/key restore before using real payroll.

Current tests are listed in [CURRENT_TEST_CASES.md](CURRENT_TEST_CASES.md). Local/browser fixtures do not establish deployed success. No load/SLA guarantee is implied by passing them.

## Where to enter variables on Render (if you choose a compatible container deployment)

1. Push GitHub commits first and connect the private repository through Render's GitHub integration.
2. Choose **Web Service**, not Static Site. A plain native service can run Next.js but does not implement the full local AI/scanner/OCR stack described above. Prepare/test a complete Docker image before choosing Docker runtime for all features.
3. Attach a persistent disk, for example `/var/data`, and set `PAYROLL_DB=/var/data/payroll.sqlite`. If containerized Ollama model files are kept locally, persist their configured directory as well; do not assume unmounted model downloads survive replacement.
4. In **Environment**, add the names from step 3 individually. Render supports environment variables and secret files; use its runtime secret controls, not a committed `.env.local`. See [Render's environment-variable documentation](https://render.com/docs/configure-environment-variables).
5. Set `APP_ORIGIN` to the actual `https://your-service.onrender.com` origin and add its exact Google callback URL. Do not leave localhost values.
6. Render requires the HTTP server to bind `0.0.0.0` on its assigned `PORT`; a Next.js command would be `npx next start --hostname 0.0.0.0 --port "$PORT"`. Keep model/scanner services private within the deployment's permitted loopback/shared-network arrangement.
7. Select sufficient paid compute/disk resources; keep one application writer. Provision accounts in the deployed service context and reconnect Drive. Verify every external dependency and deployed acceptance case.

Do not disable encryption, scanning or ownership checks to fit a free hosting tier. A UI-only deployment with broken uploads/AI is not the complete assessment demonstration. The single-host Linux route above is the deployment procedure supplied for the current architecture; Render/Coolify app-container packaging remains an explicit additional deployment task.
