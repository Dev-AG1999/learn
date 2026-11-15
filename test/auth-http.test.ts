import { mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest"
import { hashPassword } from "../src/auth/password.ts"
import { withAuth } from "../src/auth/repository.ts"
import { issueToken } from "../src/auth/tokens.ts"
import {
  loginResponse,
  logoutResponse,
  sessionResponse,
} from "../src/auth/endpoints.ts"
import {
  AuthError,
  authorize,
  enforceOrigin,
  requestToken,
  requireRequest,
} from "../src/auth/http.ts"
import { COOKIE_NAME } from "../src/auth/config.ts"
import { withPayroll } from "../src/payroll-db.ts"
import { POST as approveClaim } from "../app/hr/claims/route.ts"
import { POST as uploadDocument } from "../app/hr/documents/route.ts"
import { POST as submitClaim } from "../app/employee/[employeeId]/claims/route.ts"
import { GET as download } from "../app/employee/[employeeId]/download/route.ts"

let dir: string, passwordHash: string
const password = "Long secure testing password!"
const origin = "http://localhost:3000"
let hrToken: string, employeeToken: string
const base = {
  employeeId: "emp-a",
  year: 2026,
  month: 1,
  annualCtcMinor: 1200000,
  currency: "INR",
  calendarDays: 31,
  unpaidLeaveDays: 0,
  otherDeductionsMinor: 0,
  claims: [],
  confirmed: true,
}
beforeAll(async () => {
  passwordHash = await hashPassword(password)
})
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "payroll-auth-http-"))
  vi.stubEnv("AUTH_JWT_SECRET", "a1".repeat(32))
  vi.stubEnv("APP_ORIGIN", origin)
  vi.stubEnv("PAYROLL_DB", join(dir, "private", "payroll.sqlite"))
  await withPayroll(async (db) => {
    await db.saveMonth(base)
    await db.saveMonth({ ...base, employeeId: "emp-b" })
  })
  await withAuth(async (db) => {
    db.provision("hr@example.com", passwordHash, "hr", null)
    db.provision("employee@example.com", passwordHash, "employee", "emp-a")
    for (const [name, role] of [
      ["hr@example.com", "hr"],
      ["employee@example.com", "employee"],
    ]) {
      const session = await issueToken(db.findUser(name)!.userId)
      db.createSession(
        db.findUser(name)!.userId,
        session.sessionId,
        session.expiresAt,
        Math.floor(Date.now() / 1000)
      )
      if (role === "hr") hrToken = session.token
      else employeeToken = session.token
    }
  })
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

function request(path: string, token?: string, form?: Record<string, string>) {
  return new Request(`${origin}${path}`, {
    method: form ? "POST" : "GET",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(form ? { Origin: origin } : {}),
    },
    ...(form ? { body: new URLSearchParams(form) } : {}),
  })
}

test("browser login issues a private HttpOnly cookie and generic failures", async () => {
  const response = await loginResponse(
    request("/auth/login", undefined, { username: "hr@example.com", password }),
    false
  )
  expect(response.status).toBe(303)
  expect(response.headers.get("set-cookie")).toContain("HttpOnly")
  expect(response.headers.get("location")).toBe(`${origin}/`)
  expect(response.headers.get("cache-control")).toBe("no-store")
  const failed = await loginResponse(
    request("/auth/login", undefined, { username: "unknown", password }),
    false
  )
  expect(failed.headers.get("location")).toBe(`${origin}/login?error=invalid`)
})

test("API login issues a bearer token without setting cookies", async () => {
  const response = await loginResponse(
    new Request(`${origin}/api/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "hr@example.com", password }),
    }),
    true
  )
  expect(response.status).toBe(200)
  expect(response.headers.get("set-cookie")).toBeNull()
  const data = await response.json()
  expect(data.token_type).toBe("Bearer")
  const session = await sessionResponse(
    request("/api/auth/session", data.access_token)
  )
  expect(session.status).toBe(200)
  expect((await session.json()).role).toBe("hr")
})

test("cookie mutations require exact Origin; malformed bearer cannot fall back to cookie", async () => {
  expect(() => enforceOrigin(new Headers())).toThrow(AuthError)
  expect(() => enforceOrigin(new Headers({ Origin: "null" }))).toThrow(
    AuthError
  )
  expect(() =>
    enforceOrigin(new Headers({ Origin: "http://evil.example" }))
  ).toThrow(AuthError)
  const headers = {
    cookie: `${COOKIE_NAME}=${hrToken}`,
    Origin: "http://evil.example",
  }
  await expect(
    requireRequest(
      new Request(`${origin}/hr/claims`, { method: "POST", headers }),
      "hr"
    )
  ).rejects.toMatchObject({ status: 403 })
  const malformed = requestToken(
    new Headers({ ...headers, Authorization: "Basic invalid" })
  )
  expect(malformed).toEqual({ token: "", bearer: true })
  expect(
    (
      await sessionResponse(
        new Request(`${origin}/api/auth/session`, {
          headers: { ...headers, Authorization: "Basic invalid" },
        })
      )
    ).status
  ).toBe(401)
  expect(
    (
      await loginResponse(
        new Request(`${origin}/auth/login`, { method: "POST", headers }),
        false
      )
    ).status
  ).toBe(403)
})

test("anonymous and employee requests cannot approve claims or upload HR documents", async () => {
  for (const token of [undefined, employeeToken]) {
    const expected = token ? 403 : 401
    expect(
      (
        await approveClaim(
          request("/hr/claims", token, { claimId: "x", confirmed: "yes" })
        )
      ).status
    ).toBe(expected)
    expect(
      (
        await uploadDocument(
          request("/hr/documents", token, {
            documentId: "secret",
            body: "confidential",
          })
        )
      ).status
    ).toBe(expected)
  }
  expect(
    await withPayroll((db) => db.answerFromDocuments("confidential"))
  ).toBeNull()
})

test("HR can upload a document using a bearer token", async () => {
  const response = await uploadDocument(
    request("/hr/documents", hrToken, {
      documentId: "policy",
      body: "confidential",
      year: "2026",
      month: "1",
    })
  )
  expect(response.status).toBe(303)
  expect(
    await withPayroll((db) => db.answerFromDocuments("confidential"))
  ).toMatchObject({ citation: "policy" })
})

test("employees can download only their own PDF; anonymous and HR access are denied", async () => {
  for (const [token, id, status] of [
    [undefined, "emp-a", 401],
    [employeeToken, "emp-b", 403],
    [hrToken, "emp-a", 403],
    [employeeToken, "emp-a", 200],
  ] as const) {
    const response = await download(
      request(`/employee/${id}/download?year=2026&month=1`, token),
      { params: Promise.resolve({ employeeId: id }) }
    )
    expect(response.status).toBe(status)
    if (status === 200) {
      expect(response.headers.get("cache-control")).toBe("no-store")
      expect(await response.text()).toContain("%PDF-1.4")
    }
  }
})

test("employee ID tampering cannot submit a claim for someone else", async () => {
  const form = {
    year: "2026",
    month: "1",
    amountMinor: "100",
    receipt: "receipt",
    confirmed: "yes",
  }
  const denied = await submitClaim(
    request("/employee/emp-b/claims", employeeToken, form),
    { params: Promise.resolve({ employeeId: "emp-b" }) }
  )
  expect(denied.status).toBe(403)
  expect(await withPayroll((db) => db.getClaims("emp-b", 2026, 1))).toEqual([])
  const allowed = await submitClaim(
    request("/employee/emp-a/claims", employeeToken, form),
    { params: Promise.resolve({ employeeId: "emp-a" }) }
  )
  expect(allowed.status).toBe(303)
  expect(
    (await withPayroll((db) => db.getClaims("emp-a", 2026, 1)))[0].status
  ).toBe("pending")
})

test("logout invalidates a copied bearer token immediately", async () => {
  const response = await logoutResponse(
    request("/api/auth/logout", employeeToken, {}),
    true
  )
  expect(response.status).toBe(204)
  expect(
    (await sessionResponse(request("/api/auth/session", employeeToken))).status
  ).toBe(401)
  expect(
    (
      await download(
        request("/employee/emp-a/download?year=2026&month=1", employeeToken),
        { params: Promise.resolve({ employeeId: "emp-a" }) }
      )
    ).status
  ).toBe(401)
})

test("login body size and content type are bounded", async () => {
  expect(
    (
      await loginResponse(
        new Request(`${origin}/api/auth/token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "x".repeat(8193),
        }),
        true
      )
    ).status
  ).toBe(400)
  expect(
    (
      await loginResponse(
        new Request(`${origin}/api/auth/token`, {
          method: "POST",
          body: "text",
        }),
        true
      )
    ).status
  ).toBe(415)
})

test("database and newly created parent directory are private", () => {
  expect(statSync(process.env.PAYROLL_DB!).mode & 0o777).toBe(0o600)
  expect(statSync(join(dir, "private")).mode & 0o777).toBe(0o700)
})

test("authorization rejects employee role escalation and ID mismatch", () => {
  const employee = {
    userId: "user",
    username: "employee",
    role: "employee" as const,
    employeeId: "emp-a",
  }
  expect(() => authorize(employee, "hr")).toThrow(AuthError)
  expect(() => authorize(employee, "employee", "emp-b")).toThrow(AuthError)
  expect(authorize(employee, "employee", "emp-a")).toBe(employee)
})

test("throttled API logins return retry guidance without account disclosure", async () => {
  await withAuth((db) => {
    const now = Math.floor(Date.now() / 1000)
    for (let i = 0; i < 5; i++)
      db.consumeLoginAttempt("unknown@example.com", now)
  })
  const response = await loginResponse(
    new Request(`${origin}/api/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "unknown@example.com", password }),
    }),
    true
  )
  expect(response.status).toBe(429)
  expect(response.headers.get("retry-after")).toBe("900")
  expect(await response.json()).toEqual({
    error: "Too many attempts. Try again later.",
  })
})

test("salary templates and preview are restricted to HR", async () => {
  const { GET: template } = await import("../app/hr/import/template/route.ts")
  const { POST: preview } = await import("../app/hr/import/preview/route.ts")
  for (const [token, status] of [
    [undefined, 401],
    [employeeToken, 403],
  ] as const) {
    expect((await template(request("/hr/import/template", token))).status).toBe(
      status
    )
    expect(
      (await preview(request("/hr/import/preview", token, {}))).status
    ).toBe(status)
  }
  const response = await template(
    request("/hr/import/template?sample=yes", hrToken)
  )
  expect(response.status).toBe(200)
  expect(response.headers.get("cache-control")).toBe("no-store")
  expect(await response.text()).toContain("annualCtcMinor")
})

test("salary upload preview and confirmation persist a real sheet and refresh totals", async () => {
  const { POST: preview } = await import("../app/hr/import/preview/route.ts")
  const { POST: commit } = await import("../app/hr/import/commit/route.ts")
  const csv =
    "employeeId,year,month,annualCtcMinor,currency,unpaidLeaveDays,otherDeductionsMinor\nNEW-HTTP,2026,11,120000000,INR,0,0"
  const form = new FormData()
  form.set("sheet", new File([csv], "salary.csv", { type: "text/csv" }))
  const response = await preview(
    new Request(`${origin}/hr/import/preview`, {
      method: "POST",
      headers: { Authorization: `Bearer ${hrToken}` },
      body: form,
    })
  )
  expect(response.status).toBe(200)
  const data = await response.json()
  const draftId = data.reviewUrl.split("/").pop()
  expect(await withPayroll((db) => db.get("NEW-HTTP", 2026, 11))).toBeNull()
  const missing = await commit(
    request("/hr/import/commit", hrToken, { draftId })
  )
  expect(missing.headers.get("location")).toContain("failure=")
  const saved = await commit(
    request("/hr/import/commit", hrToken, { draftId, confirmed: "yes" })
  )
  expect(saved.status).toBe(303)
  expect(saved.headers.get("location")).toBe(`/hr/import/review/${draftId}`)
  expect(
    (await withPayroll((db) => db.get("NEW-HTTP", 2026, 11)))?.netMinor
  ).toBe(10000000)
})

test("invalid uploads report row errors and cannot write payroll", async () => {
  const { POST: preview } = await import("../app/hr/import/preview/route.ts")
  const form = new FormData()
  form.set("sheet", new File(["wrong,headings\nA,1"], "salary.csv"))
  const response = await preview(
    new Request(`${origin}/hr/import/preview`, {
      method: "POST",
      headers: { Authorization: `Bearer ${hrToken}` },
      body: form,
    })
  )
  expect(response.status).toBe(422)
  expect((await response.json()).failures[0].message).toContain(
    "Required columns"
  )
  expect(
    (await withPayroll((db) => db.listEmployeeIds(20, null))).employeeIds
  ).toEqual(["emp-a", "emp-b"])
})

test("cookie upload mutations still reject null and foreign Origin", async () => {
  const { POST: preview } = await import("../app/hr/import/preview/route.ts")
  const { POST: commit } = await import("../app/hr/import/commit/route.ts")
  for (const mutation of [preview, commit]) {
    const response = await mutation(
      new Request(`${origin}/hr/import/preview`, {
        method: "POST",
        headers: { Cookie: `${COOKIE_NAME}=${hrToken}`, Origin: "null" },
        body: new URLSearchParams(),
      })
    )
    expect(response.status).toBe(403)
  }
})

test("upload body limits apply even without Content-Length", async () => {
  const { POST: preview } = await import("../app/hr/import/preview/route.ts")
  const response = await preview(
    new Request(`${origin}/hr/import/preview`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${hrToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "sheet=" + "x".repeat(2 * 1024 * 1024 + 65536),
    })
  )
  expect(response.status).toBe(413)
  const wrongType = await preview(
    new Request(`${origin}/hr/import/preview`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${hrToken}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    })
  )
  expect(wrongType.status).toBe(415)
})
