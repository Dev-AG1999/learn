import { beforeAll, beforeEach, afterEach, expect, test, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { hashPassword } from "../src/auth/password.ts"
import { withAuth } from "../src/auth/repository.ts"
import { loginResponse } from "../src/auth/endpoints.ts"
import { withPayroll } from "../src/payroll-db.ts"
const mock = vi.hoisted(() => ({ finish: vi.fn(async () => {}) }))
vi.mock("../src/files/drive.ts", () => ({
  DRIVE_SCOPE: "https://www.googleapis.com/auth/drive.file",
  driveCallbackUrl: () => "http://localhost:3000/api/storage/drive/callback",
  finishDriveAuthorization: mock.finish,
}))
import {
  connectDriveResponse,
  driveCallbackResponse,
} from "../src/files/oauth.ts"
let dir: string, hash: string, hr: string, employee: string
const origin = "http://localhost:3000",
  password = "OAuth connection test password!"
beforeAll(async () => {
  hash = await hashPassword(password)
})
async function login(username: string) {
  const result = await loginResponse(
    new Request(origin + "/auth/login", {
      method: "POST",
      headers: { Origin: origin },
      body: new URLSearchParams({ username, password }),
    }),
    false
  )
  return result.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ")
}
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "drive-oauth-http-"))
  vi.stubEnv("PAYROLL_DB", join(dir, "db.sqlite"))
  vi.stubEnv("AUTH_JWT_SECRET", "ab".repeat(32))
  vi.stubEnv("APP_ORIGIN", origin)
  vi.stubEnv("DRIVE_TOKEN_SECRET", "cd".repeat(32))
  vi.stubEnv("GOOGLE_DRIVE_CLIENT_ID", "test-client")
  vi.stubEnv("GOOGLE_DRIVE_CLIENT_SECRET", "test-secret")
  await withPayroll((db) =>
    db.saveMonth({
      employeeId: "emp-a",
      year: 2026,
      month: 1,
      annualCtcMinor: 1200000,
      currency: "INR",
      calendarDays: 31,
      unpaidLeaveDays: 0,
      otherDeductionsMinor: 0,
      confirmed: true,
      claims: [],
    })
  )
  await withAuth((db) => {
    db.provision("hr-a", hash, "hr", null)
    db.provision("emp-a", hash, "employee", "emp-a")
  })
  hr = await login("hr-a")
  employee = await login("emp-a")
  mock.finish.mockClear()
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  vi.unstubAllEnvs()
})
const connect = (cookie: string, from = origin) =>
  connectDriveResponse(
    new Request(origin + "/api/storage/drive/connect", {
      method: "POST",
      headers: { Cookie: cookie, Origin: from },
    })
  )
test("only HR with a valid same-origin request can start the Drive connection", async () => {
  expect((await connect(employee)).status).toBe(403)
  expect((await connect(hr, "https://evil.test")).status).toBe(403)
  const result = await connect(hr),
    url = new URL(result.headers.get("Location")!)
  expect(url.origin).toBe("https://accounts.google.com")
  expect(url.searchParams.get("scope")).toBe(
    "https://www.googleapis.com/auth/drive.file"
  )
  expect(url.searchParams.get("code_challenge_method")).toBe("S256")
  expect(result.headers.get("Set-Cookie")).toContain("HttpOnly")
  expect(url.searchParams.has("client_secret")).toBe(false)
})
test("callback requires the session-bound state cookie and consumes the PKCE state once", async () => {
  const started = await connect(hr),
    url = new URL(started.headers.get("Location")!),
    state = url.searchParams.get("state")!
  const stateCookie = started.headers.get("Set-Cookie")!.split(";")[0]
  const request = (cookie: string, queryState = state) =>
    new Request(
      `${origin}/api/storage/drive/callback?state=${queryState}&code=synthetic-code`,
      { headers: { Cookie: cookie } }
    )
  expect(
    (await driveCallbackResponse(request(hr))).headers.get("Location")
  ).toContain("connection-failed")
  expect(mock.finish).not.toHaveBeenCalled()
  const result = await driveCallbackResponse(request(`${hr}; ${stateCookie}`))
  expect(result.headers.get("Location")).toBe(
    `${origin}/hr?storage=connected#documents`
  )
  expect(mock.finish).toHaveBeenCalledTimes(1)
  const args = mock.finish.mock.calls[0] as unknown as [
    unknown,
    string,
    string,
    string,
  ]
  expect(args[2]).toBe("synthetic-code")
  expect(args[3]).toHaveLength(43)
  await driveCallbackResponse(request(`${hr}; ${stateCookie}`))
  expect(mock.finish).toHaveBeenCalledTimes(1)
})

test("JSON connection returns the Google URL and state cookie without a cross-origin form redirect", async () => {
  const result = await connectDriveResponse(
    new Request(origin + "/api/storage/drive/connect", {
      method: "POST",
      headers: { Cookie: hr, Origin: origin, Accept: "application/json" },
    })
  )
  expect(result.status).toBe(200)
  expect(result.headers.get("Location")).toBeNull()
  expect(result.headers.get("Set-Cookie")).toContain("HttpOnly")
  expect(result.headers.get("Cache-Control")).toBe("no-store")
  const { authorizationUrl } = await result.json()
  const url = new URL(authorizationUrl)
  expect(url.origin).toBe("https://accounts.google.com")
  expect(url.searchParams.get("code_challenge_method")).toBe("S256")
  expect(url.searchParams.has("client_secret")).toBe(false)
})

test("JSON connection exposes safe setup errors instead of silently redirecting to the dashboard", async () => {
  vi.stubEnv("GOOGLE_DRIVE_CLIENT_SECRET", "")
  const response = await connectDriveResponse(
    new Request(origin + "/api/storage/drive/connect", {
      method: "POST",
      headers: { Cookie: hr, Origin: origin, Accept: "application/json" },
    })
  )
  expect(response.status).toBe(503)
  expect((await response.json()).error).toContain("configure Google Drive")
})
