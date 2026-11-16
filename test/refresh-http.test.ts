import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { beforeAll, beforeEach, afterEach, expect, test, vi } from "vitest"
import { hashPassword } from "../src/auth/password.ts"
import { withAuth } from "../src/auth/repository.ts"
import {
  loginResponse,
  refreshResponse,
  sessionResponse,
  logoutResponse,
} from "../src/auth/endpoints.ts"
import { requireRequest, AuthError, authFailure } from "../src/auth/http.ts"
import { COOKIE_NAME, REFRESH_COOKIE_NAME } from "../src/auth/config.ts"

let dir: string, hash: string
const origin = "http://localhost:3000",
  password = "Refresh HTTP test password!"
beforeAll(async () => {
  hash = await hashPassword(password)
})
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "refresh-http-"))
  vi.stubEnv("PAYROLL_DB", join(dir, "db.sqlite"))
  vi.stubEnv("AUTH_JWT_SECRET", "a1".repeat(32))
  vi.stubEnv("APP_ORIGIN", origin)
  await withAuth((db) => db.provision("hr@example.com", hash, "hr", null))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  vi.unstubAllEnvs()
})
const cookieJar = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ")
async function browserLogin() {
  return loginResponse(
    new Request(`${origin}/auth/login`, {
      method: "POST",
      headers: { Origin: origin },
      body: new URLSearchParams({ username: "hr@example.com", password }),
    }),
    false
  )
}
function ageTokens() {
  const raw = new DatabaseSync(process.env.PAYROLL_DB!)
  try {
    raw.exec(
      "UPDATE auth_sessions SET expires_at=0; UPDATE auth_refresh_tokens SET created_at=unixepoch()-600;"
    )
  } finally {
    raw.close()
  }
}
const browserRefresh = (cookie: string, from = origin) =>
  refreshResponse(
    new Request(`${origin}/auth/refresh`, {
      method: "POST",
      headers: { Origin: from, Cookie: cookie },
    }),
    false
  )

test("browser login sets two private cookies and refresh never exposes secrets in JSON", async () => {
  const signed = await browserLogin()
  expect(signed.headers.getSetCookie()).toHaveLength(2)
  const cookies = cookieJar(signed)
  expect(cookies).toContain(REFRESH_COOKIE_NAME)
  ageTokens()
  const refreshed = await browserRefresh(cookies)
  expect(refreshed.status).toBe(200)
  expect(refreshed.headers.get("cache-control")).toBe("no-store")
  for (const cookie of refreshed.headers.getSetCookie())
    expect(cookie).toContain("HttpOnly")
  const body = await refreshed.json()
  expect(body.session.renewable).toBe(true)
  expect(body.access_token).toBeUndefined()
  expect(body.refresh_token).toBeUndefined()
  const status = await sessionResponse(
    new Request(`${origin}/api/auth/session`, {
      headers: { Cookie: cookieJar(refreshed) },
    })
  )
  expect(status.status).toBe(200)
  expect((await status.json()).session.userId).toBe(body.session.userId)
})

test("browser refresh rejects foreign, null and missing origins", async () => {
  const cookie = cookieJar(await browserLogin())
  for (const from of ["https://evil.test", "null"]) {
    expect((await browserRefresh(cookie, from)).status).toBe(403)
  }
  expect(
    (
      await refreshResponse(
        new Request(`${origin}/auth/refresh`, {
          method: "POST",
          headers: { Cookie: cookie },
        }),
        false
      )
    ).status
  ).toBe(403)
})

test("copied consumed cookies revoke the session family and clear both browser cookies", async () => {
  const cookie = cookieJar(await browserLogin())
  ageTokens()
  const renewed = await browserRefresh(cookie)
  expect(renewed.status).toBe(200)
  const replay = await browserRefresh(cookie)
  expect(replay.status).toBe(401)
  expect(replay.headers.getSetCookie()).toHaveLength(2)
  expect(
    (
      await sessionResponse(
        new Request(`${origin}/api/auth/session`, {
          headers: { Cookie: cookieJar(renewed) },
        })
      )
    ).status
  ).toBe(401)
})

test("logout after access expiry revokes refresh credentials and clears cookies", async () => {
  const cookie = cookieJar(await browserLogin())
  ageTokens()
  const response = await logoutResponse(
    new Request(`${origin}/auth/logout`, {
      method: "POST",
      headers: { Origin: origin, Cookie: cookie },
    }),
    false
  )
  expect(response.status).toBe(303)
  expect(response.headers.getSetCookie()).toHaveLength(2)
  expect((await browserRefresh(cookie)).status).toBe(401)
})

test("expired cookie GET download requests go through safe renewal while bearer calls stay 401", async () => {
  const cookie = cookieJar(await browserLogin())
  ageTokens()
  const request = new Request(
    `${origin}/employee/emp-a/download?year=2026&month=1`,
    { headers: { Cookie: cookie } }
  )
  let failure: unknown
  try {
    await requireRequest(request, "employee", "emp-a")
  } catch (error) {
    failure = error
  }
  const redirect = authFailure(failure)
  expect(redirect.status).toBe(303)
  expect(redirect.headers.get("location")).toContain(
    "returnTo=%2Femployee%2Femp-a%2Fdownload"
  )
  const bearer = new Request(request.url, {
    headers: { Authorization: "Bearer a.b.c", Cookie: cookie },
  })
  await expect(
    requireRequest(bearer, "employee", "emp-a")
  ).rejects.toMatchObject({ status: 401 })
})

test("API clients can rotate explicit refresh tokens without browser cookies", async () => {
  const signed = await loginResponse(
    new Request(`${origin}/api/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "hr@example.com", password }),
    }),
    true
  )
  const initial = await signed.json()
  expect(signed.headers.get("set-cookie")).toBeNull()
  expect(initial.refresh_token).toMatch(/^[a-f0-9]{64}$/)
  ageTokens()
  const response = await refreshResponse(
    new Request(`${origin}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: initial.refresh_token }),
    }),
    true
  )
  expect(response.status).toBe(200)
  expect(response.headers.get("set-cookie")).toBeNull()
  const next = await response.json()
  expect(next.refresh_token).not.toBe(initial.refresh_token)
  const access = await requireRequest(
    new Request(`${origin}/hr/claims`, {
      headers: { Authorization: `Bearer ${next.access_token}` },
    }),
    "hr"
  )
  expect(access.role).toBe("hr")
})

test("explicit reauthentication replaces and revokes the previous browser family", async () => {
  const first = await browserLogin(),
    oldCookie = cookieJar(first)
  const response = await loginResponse(
    new Request(`${origin}/auth/login`, {
      method: "POST",
      headers: { Origin: origin, Cookie: oldCookie },
      body: new URLSearchParams({
        username: "hr@example.com",
        password,
        reauth: "yes",
      }),
    }),
    false
  )
  expect(response.status).toBe(303)
  expect(
    (
      await sessionResponse(
        new Request(`${origin}/api/auth/session`, {
          headers: { Cookie: oldCookie },
        })
      )
    ).status
  ).toBe(401)
  expect(
    (
      await sessionResponse(
        new Request(`${origin}/api/auth/session`, {
          headers: { Cookie: cookieJar(response) },
        })
      )
    ).status
  ).toBe(200)
})
