import { withFiles } from "../src/files/repository.ts"
import { scannerFixture } from "./scanner-fixture.ts"
import { openStorageDatabase } from "../src/db/connection.ts"
import assert from "node:assert/strict"
import { spawn, execFileSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import {
  createServer as createHttpServer,
  request as httpRequest,
} from "node:http"
import { createServer as createHttpsServer } from "node:https"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import type { Server } from "node:net"
import { openTestBrowser } from "./browser-session.ts"
import { hashPassword } from "../src/auth/password.ts"
import { withAuth } from "../src/auth/repository.ts"
import { withPayroll } from "../src/payroll-db.ts"
import { salaryCsv, salaryXlsx } from "../src/import/template.ts"
import { currentPeriod } from "../src/presentation.ts"

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (!address || typeof address === "string")
    throw new Error("Cannot allocate test port.")
  return address.port
}
async function stop(server?: Server) {
  if (server?.listening) {
    if ("closeAllConnections" in server)
      (server as ReturnType<typeof createHttpServer>).closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

const dir = mkdtempSync(join(tmpdir(), "paydesk-ui-fixture-"))
const screenshots =
  process.env.UI_SCREENSHOT_DIR ?? join(tmpdir(), "paydesk-ui-review")
mkdirSync(screenshots, { recursive: true, mode: 0o700 })
const originalEncryptionKey = process.env.DATABASE_ENCRYPTION_KEY
process.env.DATABASE_ENCRYPTION_KEY = randomBytes(32).toString("hex")
const originalDb = process.env.PAYROLL_DB
process.env.PAYROLL_DB = join(dir, "payroll.sqlite")
let server: ReturnType<typeof spawn> | undefined
let proxy: ReturnType<typeof createHttpsServer> | undefined
let scanner: ReturnType<typeof scannerFixture> | undefined
let browser: Awaited<ReturnType<typeof openTestBrowser>> | undefined
try {
  const portReservation = createHttpServer()
  const port = await listen(portReservation)
  await stop(portReservation)
  const keyFile = join(dir, "test-key.pem"),
    certFile = join(dir, "test-cert.pem")
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      keyFile,
      "-out",
      certFile,
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
    ],
    { stdio: "ignore" }
  )
  proxy = createHttpsServer(
    { key: readFileSync(keyFile), cert: readFileSync(certFile) },
    (request, response) => {
      const upstream = httpRequest(
        {
          hostname: "127.0.0.1",
          port,
          method: request.method,
          path: request.url,
          headers: {
            ...request.headers,
            "x-forwarded-proto": "https",
            "x-forwarded-host": request.headers.host,
          },
        },
        (incoming) => {
          response.writeHead(incoming.statusCode ?? 502, incoming.headers)
          incoming.pipe(response)
        }
      )
      upstream.on("error", () => {
        response.writeHead(502)
        response.end()
      })
      request.pipe(upstream)
    }
  )
  const securePort = await listen(proxy)
  const origin = `https://127.0.0.1:${securePort}`
  const password = randomBytes(24).toString("hex")
  const hash = await hashPassword(password)
  await withPayroll(async (db) => {
    await db.saveMonth({
      employeeId: "test-a",
      year: 2026,
      month: 1,
      annualCtcMinor: 12000000,
      currency: "INR",
      calendarDays: 31,
      unpaidLeaveDays: 0,
      otherDeductionsMinor: 0,
      confirmed: true,
      claims: [
        {
          id: "travel-claim",
          amountMinor: 150000,
          status: "pending",
          receipt: "Travel receipt reference",
        },
      ],
    })
    await db.saveMonth({
      employeeId: "test-b",
      year: 2026,
      month: 1,
      annualCtcMinor: 24000000,
      currency: "USD",
      calendarDays: 31,
      unpaidLeaveDays: 0,
      otherDeductionsMinor: 0,
      confirmed: true,
      claims: [],
    })
  })
  await withAuth((db) => {
    db.provision("test-hr", hash, "hr", null)
    db.provision("test-employee", hash, "employee", "test-a")
  })
  const tokenKey = randomBytes(32).toString("hex")
  process.env.DRIVE_TOKEN_SECRET = tokenKey
  await withFiles((db) =>
    db.saveConnection({
      userId: "browser-hr",
      driveUserId: "browser-google",
      folderId: "browser-folder",
      accessToken: "synthetic-access",
      refreshToken: "synthetic-refresh",
      expiresAt: Date.now() + 3600000,
    })
  )
  scanner = scannerFixture()
  const scannerPort = await listen(scanner)
  server = spawn(
    process.execPath,
    [
      "--import",
      new URL("./mock-drive-preload.mjs", import.meta.url).href,
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      env: {
        ...process.env,
        NODE_ENV: "production",
        AUTH_JWT_SECRET: randomBytes(32).toString("hex"),
        APP_ORIGIN: origin,
        FILE_UPLOADS_ENABLED: "true",
        GOOGLE_DRIVE_CLIENT_ID: "synthetic-unused-id",
        GOOGLE_DRIVE_CLIENT_SECRET: "synthetic-unused-secret",
        DRIVE_TOKEN_SECRET: tokenKey,
        CLAMAV_HOST: "127.0.0.1",
        CLAMAV_PORT: String(scannerPort),
        AI_DOCUMENTS_ENABLED: "false",
        LANGSMITH_TRACING: "false",
        LANGCHAIN_TRACING_V2: "false",
        LANGCHAIN_TRACING: "false",
      },
      stdio: "ignore",
    }
  )
  let launchError: Error | undefined
  server.on("error", (error) => {
    launchError = error
  })
  let ready = false
  for (let i = 0; i < 100; i++) {
    if (launchError) throw launchError
    if (server.exitCode !== null)
      throw new Error("Production UI test server exited.")
    try {
      if ((await fetch(`http://127.0.0.1:${port}/login`)).status === 200) {
        ready = true
        break
      }
    } catch {
      /* Wait for listener. */
    }
    await delay(100)
  }
  assert.ok(ready, "Production test server did not start.")
  browser = await openTestBrowser(true) // Only this isolated profile trusts the ephemeral test certificate.
  const hydrationFailures: string[] = []
  let driveCspBlocked = false
  let driveConnectRequests = 0
  browser.on((message) => {
    if (message.method === "Network.requestWillBeSent") {
      const request = (
        message.params as { request?: { url?: string; method?: string } }
      )?.request
      if (
        request?.url &&
        new URL(request.url).pathname === "/api/storage/drive/connect" &&
        request.method === "POST"
      )
        driveConnectRequests++
    }

    if (
      message.method === "Log.entryAdded" &&
      /form-action/.test(JSON.stringify(message.params))
    )
      driveCspBlocked = true
    if (
      [
        "Runtime.exceptionThrown",
        "Runtime.consoleAPICalled",
        "Log.entryAdded",
      ].includes(message.method ?? "") &&
      /hydration|hydrating|server rendered|#418|#425/i.test(
        JSON.stringify(message.params)
      )
    ) {
      // Capture only the event kind, not potentially sensitive console payloads.
      hydrationFailures.push(message.method ?? "hydration error")
    }
  })
  await browser.send("Log.enable")
  await browser.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `
    const originalSupportedValuesOf = Intl.supportedValuesOf.bind(Intl);
    Intl.supportedValuesOf = function(key) {
      const values = originalSupportedValuesOf(key);
      return key === "currency" ? [...values].reverse() : values;
    };
  `,
  })
  const noOverflow = async (page: string) => {
    assert.equal(
      await browser!.evaluate(
        "document.documentElement.scrollWidth <= innerWidth + 1"
      ),
      true,
      `${page} overflows the viewport.`
    )
  }
  const capture = async (name: string, width: number) => {
    await browser!.viewport(width, 1000)
    await noOverflow(name)
    await browser!.screenshot(join(screenshots, `${name}.png`))
  }
  const login = async (username: string, expectedPath: string) => {
    await browser!.navigate(`${origin}/login`)
    await browser!.evaluate(
      `document.querySelector('[name="username"]').value=${JSON.stringify(username)}; document.querySelector('[name="password"]').value=${JSON.stringify(password)}; document.querySelector('.login-form').requestSubmit()`
    )
    await browser!.waitFor(
      `location.pathname === ${JSON.stringify(expectedPath)} && !!document.querySelector('.workspace')`
    )
  }
  const checkInlineAttachment = async (employee: boolean) => {
    const path = employee
      ? "/employee/test-a?year=2026&month=1"
      : "/hr?year=2026&month=1"
    await browser!.navigate(`${origin}${path}`)
    const fixturePath = join(dir, "inline-receipt.pdf")
    const { payslipPdf } = await import("../src/payslip-document.ts")
    writeFileSync(
      fixturePath,
      payslipPdf({
        employeeId: "test-a",
        year: 2026,
        month: 1,
        currency: "INR",
        monthlyGrossMinor: 100000,
        unpaidDeductionMinor: 0,
        otherDeductionsMinor: 0,
        approvedReimbursementsMinor: 0,
        netMinor: 100000,
      })
    )
    const dom = await browser!.send<{ root: { nodeId: number } }>(
      "DOM.getDocument"
    )
    const input = await browser!.send<{ nodeId: number }>("DOM.querySelector", {
      nodeId: dom.root.nodeId,
      selector: 'input[name="attachment"]',
    })
    await browser!.send("DOM.setFileInputFiles", {
      nodeId: input.nodeId,
      files: [fixturePath],
    })
    await browser!.evaluate(
      employee
        ? `
      const form=document.querySelector('.reimbursement-form');
      form.querySelector('[name=amountMinor]').value='500';
      form.querySelector('[name=receipt]').value='Inline receipt browser check';
      form.querySelector('[name=confirmed]').checked=true;
      form.requestSubmit();
    `
        : `
      const form=document.querySelector('.hr-document-form');
      form.querySelector('[name=documentId]').value='browser-policy';
      form.querySelector('[name=body]').value='Browser policy text';
      form.requestSubmit();
    `
    )
    await browser!.waitFor(
      employee
        ? "location.search.includes('notice=claim-submitted')"
        : "location.search.includes('notice=document-saved')"
    )
    await browser!.waitFor(
      "!!document.querySelector('.attachment-links a[href*=signature]')"
    )
    assert.equal(
      await browser!.evaluate(
        '!!document.querySelector(\'a[href="/hr/files"],a[href*="/assistant"]\')'
      ),
      false
    )
    await capture(
      employee ? "employee-inline-attachment" : "hr-inline-attachment",
      1440
    )
    await capture(
      employee
        ? "employee-inline-attachment-mobile"
        : "hr-inline-attachment-mobile",
      390
    )
  }
  await browser.navigate(`${origin}/login`)
  await capture("login-desktop", 1440)
  await capture("login-mobile", 390)
  await login("test-hr", "/hr")
  await browser.waitFor(
    "document.body.innerText.includes('No payroll for this month')"
  )
  const checkDriveConnection = async () => {
    driveCspBlocked = false
    driveConnectRequests = 0
    await browser!.navigate(`${origin}/hr`)
    await browser!.send("Fetch.enable", {
      patterns: [
        {
          urlPattern: "https://accounts.google.com/*",
          requestStage: "Request",
        },
      ],
    })
    const stopDriveFixture = browser!.on((message) => {
      if (message.method !== "Fetch.requestPaused") return
      const params = message.params as {
        requestId: string
        request: { url: string }
      }
      if (new URL(params.request.url).origin !== "https://accounts.google.com")
        return
      void browser!.send("Fetch.fulfillRequest", {
        requestId: params.requestId,
        responseCode: 200,
        responseHeaders: [{ name: "Content-Type", value: "text/html" }],
        body: Buffer.from(
          "<html><body>Synthetic Google consent endpoint</body></html>"
        ).toString("base64"),
      })
    })
    await browser!.evaluate(`(() => {
    const original=window.fetch.bind(window);let fail=true;
    window.fetch=(input,init)=>{
      if(String(input)==='/api/storage/drive/connect'&&fail){fail=false;return Promise.resolve(Response.json({error:'Synthetic connection failure'},{status:503}));}
      return original(input,init);
    };
    document.querySelector('[data-drive-connect]').click();
  })()`)
    await browser!.waitFor(
      "document.body.innerText.includes('Synthetic connection failure') && !document.querySelector('[data-drive-connect]').disabled"
    )
    await browser!.evaluate(
      "const connectButton=document.querySelector('[data-drive-connect]'); connectButton.click(); connectButton.click()"
    )
    await browser!.waitFor(
      "location.origin === 'https://accounts.google.com' && document.body.innerText.includes('Synthetic Google consent endpoint')"
    )
    assert.equal(
      driveCspBlocked,
      false,
      "Google connection navigation must not violate form-action CSP"
    )
    assert.equal(
      driveConnectRequests,
      1,
      "Repeated clicks must start only one authorization request"
    )
    await browser!.navigate(`${origin}/hr`)
    stopDriveFixture()
    await browser!.send("Fetch.disable")
  }

  await capture("hr-empty", 1440)
  await checkInlineAttachment(false)
  await browser.navigate(`${origin}/hr`)
  const expireAccess = () => {
    const raw = openStorageDatabase(process.env.PAYROLL_DB!)
    try {
      raw.exec(
        "UPDATE auth_sessions SET expires_at=0; UPDATE auth_refresh_tokens SET created_at=unixepoch()-600 WHERE consumed_at IS NULL;"
      )
    } finally {
      raw.close()
    }
  }
  expireAccess()
  await browser.navigate(`${origin}/hr/employees?year=2026&month=1&q=test-a`)
  await browser.waitFor(
    "!!document.querySelector('tbody') && location.search.includes('q=test-a')"
  )
  const tabOne = await browser.newTab(),
    tabTwo = await browser.newTab()
  try {
    expireAccess()
    const target = `${origin}/auth/renew?returnTo=${encodeURIComponent("/hr/employees?year=2026&month=1&q=test-a")}`
    await Promise.all([tabOne.navigate(target), tabTwo.navigate(target)])
    let restored = false
    for (let i = 0; i < 150; i++) {
      try {
        restored =
          (await tabOne.evaluate<boolean>(
            "location.pathname === '/hr/employees' && !!document.querySelector('tbody')"
          )) &&
          (await tabTwo.evaluate<boolean>(
            "location.pathname === '/hr/employees' && !!document.querySelector('tbody')"
          ))
      } catch {}
      if (restored) break
      await delay(100)
    }
    assert.equal(
      restored,
      true,
      "Two tabs must coordinate one successful refresh without revoking the family."
    )
  } finally {
    await tabOne.close()
    await tabTwo.close()
  }
  await browser.navigate(`${origin}/hr?year=2026&month=1`)
  await browser.waitFor("document.body.innerText.includes('₹10,000.00')")
  assert.equal(
    await browser.evaluate(
      "document.querySelector('select[name=month]').selectedOptions[0].textContent"
    ),
    "January"
  )
  await capture("hr-desktop", 1440)
  await capture("hr-tablet", 768)
  await capture("hr-mobile", 390)
  await browser.viewport(1440)
  await browser.navigate(
    `${origin}/hr/salary?employeeId=test-a&year=2026&month=1`
  )
  await browser.waitFor("!!document.querySelector('.salary-editor')")
  await capture("salary-desktop", 1440)
  await capture("salary-mobile", 390)
  expireAccess()
  await browser.evaluate(
    "document.querySelector('.salary-editor [name=otherDeductionsMinor]').value='900'; document.querySelector('.salary-editor [name=confirmed]').checked=true; document.querySelector('.salary-editor').requestSubmit()"
  )
  await browser.waitFor("document.body.innerText.includes('Salary saved.')")
  assert.equal(
    (await withPayroll((db) => db.get("test-a", 2026, 1)))
      ?.otherDeductionsMinor,
    900
  )
  await browser.navigate(`${origin}/hr?year=2026&month=1`)
  await browser.evaluate(
    "document.querySelector('.claim-row [name=confirmed]').checked=true; document.querySelector('.claim-row').requestSubmit()"
  )
  await browser.waitFor(
    "document.body.innerText.includes('Claim approved and')"
  )
  assert.equal(
    (await withPayroll((db) => db.getClaims("test-a", 2026, 1)))[0]?.status,
    "approved"
  )
  await browser.navigate(`${origin}/hr/employees?year=2026&month=1`)
  await browser.waitFor(
    "document.querySelector('main').innerText.includes('test-a')"
  )
  // Verify actual browser requests: debounce rapid typing, then reuse a fresh result.
  await browser.evaluate(`(() => {
    window.__directoryRequests = 0;
    const original = window.fetch;
    window.fetch = (...args) => {
      if (String(args[0]).startsWith('/api/employees?')) window.__directoryRequests++;
      return original(...args);
    };
    const input = document.querySelector('input[name="q"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    for (const value of ['t', 'te', 'test-b']) {
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  })()`)
  await browser.waitFor("location.search.includes('q=test-b') && document.querySelector('tbody').innerText.includes('test-b')")
  assert.equal(await browser.evaluate("window.__directoryRequests"), 1)
  await browser.evaluate("document.querySelector('.employee-directory-filters').requestSubmit()")
  await delay(650)
  assert.equal(await browser.evaluate("window.__directoryRequests"), 1)
  await browser.evaluate("document.querySelector('.employee-directory-filters button[type=button]').click()")
  await browser.waitFor("window.__directoryRequests === 2 && !document.querySelector('[aria-busy=true]')")
  await capture("employee-directory-desktop", 1440)
  await capture("employee-directory-mobile", 390)
  await browser.navigate(
    `${origin}/hr/employees?year=2026&month=1&q=test-b&currency=USD`
  )
  assert.equal(
    await browser.evaluate(
      "document.querySelector('tbody').innerText.includes('test-a')"
    ),
    false
  )
  assert.equal(
    await browser.evaluate(
      "document.querySelector('tbody').innerText.includes('test-b')"
    ),
    true
  )
  await browser.navigate(`${origin}/hr/employees/new?year=2026&month=2`)
  await capture("add-employee-desktop", 1440)
  await capture("add-employee-mobile", 390)
  await browser.evaluate(
    "document.querySelector('.employee-create-form [name=employeeId]').value='MANUAL-BROWSER'; document.querySelector('.employee-create-form [name=annualCtc]').value='1200000.29'; document.querySelector('.employee-create-form [name=otherDeductions]').value='100.50'; document.querySelector('.employee-create-form').requestSubmit()"
  )
  await browser.waitFor(
    "location.pathname.startsWith('/hr/import/review/') && document.body.innerText.includes('Not saved yet')"
  )
  assert.equal(
    await withPayroll((db) => db.get("MANUAL-BROWSER", 2026, 2)),
    null
  )
  await capture("salary-review-mobile", 390)
  await browser.evaluate(
    "document.querySelector('.payroll-confirm-form [name=confirmed]').checked=true; document.querySelector('.payroll-confirm-form').requestSubmit()"
  )
  await browser.waitFor(
    "document.body.innerText.includes('1 employee salary saved')"
  )
  assert.equal(
    (await withPayroll((db) => db.getSalaryInputs("MANUAL-BROWSER", 2026, 2)))
      ?.annualCtcMinor,
    120000029
  )
  await browser.navigate(`${origin}/hr?year=2026&month=2`)
  await browser.waitFor("document.body.innerText.includes('₹99,899.52')")
  const upload = async (name: string, contents: Uint8Array) => {
    await browser!.navigate(`${origin}/hr/import`)
    const filePath = join(dir, name)
    writeFileSync(filePath, contents)
    const document = await browser!.send<{ root: { nodeId: number } }>(
      "DOM.getDocument"
    )
    const input = await browser!.send<{ nodeId: number }>("DOM.querySelector", {
      nodeId: document.root.nodeId,
      selector: "input[name=sheet]",
    })
    await browser!.send("DOM.setFileInputFiles", {
      nodeId: input.nodeId,
      files: [filePath],
    })
    await browser!.evaluate(
      "document.querySelector('.salary-upload-form').requestSubmit()"
    )
  }
  await browser.navigate(`${origin}/hr/import`)
  await capture("salary-upload-desktop", 1440)
  await capture("salary-upload-mobile", 390)
  await upload(
    "not-a-salary.pdf",
    new TextEncoder().encode("synthetic PDF test")
  )
  await browser.waitFor(
    "document.body.innerText.includes('PDF and .xls files cannot be imported')"
  )
  await upload("salary.xlsx", salaryXlsx(true))
  await browser.waitFor(
    "location.pathname.startsWith('/hr/import/review/') && document.body.innerText.includes('3 employees')"
  )
  const importedPeriod = currentPeriod()
  assert.equal(
    await withPayroll((db) =>
      db.get("DEMO-001", importedPeriod.year, importedPeriod.month)
    ),
    null
  )
  await capture("sheet-review-desktop", 1440)
  await browser.evaluate(
    "document.querySelector('.payroll-confirm-form [name=confirmed]').checked=true; document.querySelector('.payroll-confirm-form').requestSubmit()"
  )
  await browser.waitFor(
    "document.body.innerText.includes('3 employee salaries saved')"
  )
  assert.equal(
    (
      await withPayroll((db) =>
        db.orgTotals(importedPeriod.year, importedPeriod.month)
      )
    )[0].employeeCount,
    3
  )
  await upload(
    "salary-update.csv",
    new TextEncoder().encode(salaryCsv(true).replace("120000000", "144000000"))
  )
  await browser.waitFor(
    "location.pathname.startsWith('/hr/import/review/') && document.body.innerText.includes('Existing employee')"
  )
  await browser.evaluate(
    "document.querySelector('.payroll-confirm-form [name=confirmed]').checked=true; document.querySelector('.payroll-confirm-form').requestSubmit()"
  )
  await browser.waitFor(
    "document.body.innerText.includes('3 employee salaries saved')"
  )
  assert.equal(
    (
      await withPayroll((db) =>
        db.getSalaryInputs(
          "DEMO-001",
          importedPeriod.year,
          importedPeriod.month
        )
      )
    )?.annualCtcMinor,
    144000000
  )
  await checkDriveConnection()
  await browser.evaluate(
    "document.querySelector('.sidebar-account form').requestSubmit()"
  )
  await browser.waitFor(
    "location.pathname === '/login' && !!document.querySelector('.login-form')"
  )
  await login("test-employee", "/employee/test-a")
  assert.equal(
    await browser.evaluate("!!document.querySelector('a[href^=\"/hr\"]')"),
    false
  )
  await checkInlineAttachment(true)
  await browser.navigate(`${origin}/employee/test-a?year=2026&month=1`)
  await capture("employee-desktop", 1440)
  await capture("employee-mobile", 390)
  await browser.send("Page.navigate", { url: `${origin}/hr/employees` })
  await browser.waitFor("location.pathname === '/forbidden'")
  await browser.navigate(`${origin}/employee/test-a?year=2026&month=2`)
  await browser.waitFor(
    "document.body.innerText.includes('No payslip for this month')"
  )
  assert.equal(
    await browser.evaluate(
      "Array.from(document.querySelectorAll('a')).some(a => a.textContent.includes('Download PDF'))"
    ),
    false
  )
  assert.deepEqual(
    hydrationFailures,
    [],
    "Browser hydration must succeed even when browser and server currency metadata differ."
  )
  console.log(
    `UI browser checks passed: role landing, named months, empty states, salary save, claim approval, manual employee creation, CSV/Excel upload and confirmed import, silent session recovery and cross-tab refresh, inline compressed attachments, virus protocol checks and signed URLs, Google consent navigation and retry, desktop/tablet/mobile layouts. Screenshots: ${screenshots}`
  )
} catch (error) {
  if (browser) {
    await browser
      .screenshot(join(screenshots, "failure.png"))
      .catch(() => undefined)
    console.error(
      "UI test stopped at:",
      await browser
        .evaluate("location.origin + location.pathname")
        .catch(() => "unavailable")
    )
  }
  throw error
} finally {
  await browser?.close()
  if (server && server.exitCode === null) {
    server.kill("SIGTERM")
    await new Promise<void>((resolve) => server!.once("exit", () => resolve()))
  }
  await stop(scanner)
  await stop(proxy)
  rmSync(dir, { recursive: true, force: true })
  if (originalEncryptionKey === undefined) delete process.env.DATABASE_ENCRYPTION_KEY
  else process.env.DATABASE_ENCRYPTION_KEY = originalEncryptionKey
  if (originalDb === undefined) delete process.env.PAYROLL_DB
  else process.env.PAYROLL_DB = originalDb
}
