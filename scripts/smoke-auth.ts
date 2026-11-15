import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { hashPassword } from "../src/auth/password.ts"
import { withAuth } from "../src/auth/repository.ts"
import { withPayroll } from "../src/payroll-db.ts"

// Runs against a production build using an isolated synthetic database.
const dir = mkdtempSync(join(tmpdir(), "payroll-http-smoke-"))
const originalDb = process.env.PAYROLL_DB
process.env.PAYROLL_DB = join(dir, "payroll.sqlite")
let server: ReturnType<typeof spawn> | undefined
try {
const portServer = createServer()
await new Promise<void>((resolve, reject) => { portServer.once("error", reject); portServer.listen(0, "127.0.0.1", resolve) })
const address = portServer.address()
if (!address || typeof address === "string") throw new Error("Cannot allocate test port")
const port = address.port
await new Promise<void>(resolve => portServer.close(() => resolve()))
const origin = `http://127.0.0.1:${port}`
// HTTPS public origin is simulated only in request headers; local traffic is HTTP.
const publicOrigin = "https://payroll.test"
const password = randomBytes(24).toString("hex")
const hash = await hashPassword(password)
await withPayroll(async db => {
  for (const employeeId of ["test-a", "test-b"]) await db.saveMonth({ employeeId, year: 2026, month: 1, annualCtcMinor: 1200000, currency: "INR", calendarDays: 31, unpaidLeaveDays: 0, otherDeductionsMinor: 0, claims: [], confirmed: true })
})
await withAuth(db => { db.provision("test-hr", hash, "hr", null); db.provision("test-employee", hash, "employee", "test-a") })
server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
  env: { ...process.env, NODE_ENV: "production", AUTH_JWT_SECRET: randomBytes(32).toString("hex"), APP_ORIGIN: publicOrigin }, stdio: ["ignore", "pipe", "pipe"],
})
let serverOutput = ""
server.stdout?.on("data", chunk => { serverOutput = (serverOutput + String(chunk)).slice(-4000) })
server.stderr?.on("data", chunk => { serverOutput = (serverOutput + String(chunk)).slice(-4000) })
const get = (path: string, cookie?: string) => fetch(`${origin}${path}`, { redirect: "manual", headers: cookie ? { Cookie: cookie } : {} })
  let ready = false
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(`Server exited: ${serverOutput}`)
    try { if ((await get("/login")).status === 200) { ready = true; break } } catch { /* Wait for the listener. */ }
    await delay(100)
  }
  assert.ok(ready, "Production server did not become ready")
  assert.equal((await get("/hr?year=2026&month=1")).status, 307)
  const browserLogin = async (username: string) => {
    const response = await fetch(`${origin}/auth/login`, { method: "POST", redirect: "manual", headers: { Origin: publicOrigin }, body: new URLSearchParams({ username, password }) })
    assert.equal(response.status, 303)
    const setCookie = response.headers.get("set-cookie")!
    assert.ok(setCookie.startsWith("__Host-payroll_session="))
    assert.ok(setCookie.includes("Secure")); assert.ok(setCookie.includes("HttpOnly"))
    return setCookie.split(";")[0]
  }
  const hrCookie = await browserLogin("test-hr")
  const employeeCookie = await browserLogin("test-employee")
  const hrPage = await get("/hr?year=2026&month=1", hrCookie)
  assert.equal(hrPage.status, 200)
  assert.ok(hrPage.headers.get("cache-control")?.includes("no-store"))
  assert.equal(hrPage.headers.get("x-frame-options"), "DENY")
  assert.equal(hrPage.headers.get("referrer-policy"), "strict-origin-when-cross-origin")
  assert.equal((await get("/hr/salary?employeeId=test-a&year=2026&month=1", hrCookie)).status, 200)
  assert.equal((await get("/hr?year=2026&month=1", employeeCookie)).status, 307)
  assert.equal((await get("/employee/test-a?year=2026&month=1", employeeCookie)).status, 200)
  assert.equal((await get("/employee/test-b?year=2026&month=1", employeeCookie)).status, 307)
  assert.equal((await get("/employee/test-a/download?year=2026&month=1", employeeCookie)).status, 200)
  assert.equal((await get("/employee/test-b/download?year=2026&month=1", employeeCookie)).status, 403)
  const denied = await fetch(`${origin}/hr/documents`, { method: "POST", headers: { Cookie: hrCookie, Origin: "https://evil.test" }, body: new URLSearchParams({ documentId: "x", body: "x" }) })
  assert.equal(denied.status, 403)
  const api = await fetch(`${origin}/api/auth/token`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "test-employee", password }) })
  assert.equal(api.status, 200)
  const { access_token } = await api.json() as { access_token: string }
  const apiHeaders = { Authorization: `Bearer ${access_token}` }
  assert.equal((await fetch(`${origin}/employee/test-a/download?year=2026&month=1`, { headers: apiHeaders })).status, 200)
  assert.equal((await fetch(`${origin}/api/auth/logout`, { method: "POST", headers: apiHeaders })).status, 204)
  assert.equal((await fetch(`${origin}/api/auth/session`, { headers: apiHeaders })).status, 401)
  const signout = await fetch(`${origin}/auth/logout`, { method: "POST", redirect: "manual", headers: { Cookie: employeeCookie, Origin: publicOrigin } })
  assert.equal(signout.status, 303)
  assert.equal((await get("/employee/test-a/download?year=2026&month=1", employeeCookie)).status, 401)
  console.log("Production HTTP authentication checks passed: login, cookies, pages, employee isolation, PDF, CSRF, bearer tokens and revocation.")
} finally {
  server?.kill("SIGTERM")
  if (server && server.exitCode === null) await new Promise<void>(resolve => server!.once("exit", () => resolve()))
  rmSync(dir, { recursive: true, force: true })
  if (originalDb === undefined) delete process.env.PAYROLL_DB
  else process.env.PAYROLL_DB = originalDb
}
