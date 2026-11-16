import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { DatabaseSync } from "node:sqlite"
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest"
import { hashPassword } from "../src/auth/password.ts"
import {
  openAuthRepository,
  digest,
  type AuthRepository,
} from "../src/auth/repository.ts"
import { login, renew, authenticate } from "../src/auth/service.ts"
import {
  SESSION_SECONDS,
  IDLE_SECONDS,
  ABSOLUTE_SECONDS,
} from "../src/auth/policy.ts"
import { safeReturnTo } from "../src/auth/http.ts"

const password = "Long refresh session test password!"
let hash: string, dir: string, path: string, db: AuthRepository
const start = 1800000000
beforeAll(async () => {
  hash = await hashPassword(password)
})
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "paydesk-refresh-"))
  path = join(dir, "db.sqlite")
  vi.stubEnv("AUTH_JWT_SECRET", "a1".repeat(32))
  db = openAuthRepository(path)
  db.provision("hr@example.com", hash, "hr", null)
})
afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
  vi.unstubAllEnvs()
})
async function signedIn() {
  const result = await login(db, "hr@example.com", password, start)
  if (!result.ok) throw new Error("Test login failed")
  return result
}

test("login stores only hashed refresh secrets and an access session in one family", async () => {
  const signed = await signedIn()
  const raw = new DatabaseSync(path, { readOnly: true })
  try {
    const token = raw
      .prepare("SELECT token_hash FROM auth_refresh_tokens")
      .get() as { token_hash: string }
    expect(token.token_hash).toBe(digest(signed.refreshToken))
    expect(token.token_hash).not.toBe(signed.refreshToken)
    expect(signed.timing.absoluteExpiresAt).toBe(start + ABSOLUTE_SECONDS)
    expect((await authenticate(db, signed.token, start))?.role).toBe("hr")
  } finally {
    raw.close()
  }
})

test("rotation replaces refresh secrets and extends active session without extending the workday", async () => {
  const signed = await signedIn()
  expect(
    await authenticate(db, signed.token, start + SESSION_SECONDS)
  ).toBeNull()
  const next = await renew(db, signed.refreshToken, start + SESSION_SECONDS)
  expect(next.ok).toBe(true)
  if (!next.ok) return
  expect(next.refreshToken).not.toBe(signed.refreshToken)
  expect(next.timing.absoluteExpiresAt).toBe(start + ABSOLUTE_SECONDS)
  expect(next.timing.idleExpiresAt).toBe(start + SESSION_SECONDS + IDLE_SECONDS)
  expect(
    (await authenticate(db, next.token, start + SESSION_SECONDS))?.role
  ).toBe("hr")
  db.close()
  db = openAuthRepository(path)
  expect(
    (await authenticate(db, next.token, start + SESSION_SECONDS))?.role
  ).toBe("hr")
})

test("reusing a consumed refresh token revokes all access tokens in that family", async () => {
  const signed = await signedIn()
  const next = await renew(db, signed.refreshToken, start + 100)
  if (!next.ok) throw new Error("Refresh failed")
  expect((await renew(db, signed.refreshToken, start + 101)).ok).toBe(false)
  expect(await authenticate(db, signed.token, start + 101)).toBeNull()
  expect(await authenticate(db, next.token, start + 101)).toBeNull()
  expect((await renew(db, next.refreshToken, start + 200)).ok).toBe(false)
})

test("replay revocation does not invalidate another independently logged-in session", async () => {
  const first = await signedIn(),
    second = await signedIn()
  await renew(db, first.refreshToken, start + 100)
  await renew(db, first.refreshToken, start + 101)
  expect((await authenticate(db, second.token, start + 101))?.role).toBe("hr")
})

test("idle expiry denies refresh and access and cannot be kept alive by status reads", async () => {
  const signed = await signedIn()
  for (const now of [start + 100, start + 200])
    expect(await authenticate(db, signed.token, now)).not.toBeNull()
  expect((await renew(db, signed.refreshToken, start + IDLE_SECONDS)).ok).toBe(
    false
  )
  expect(
    db.refreshAvailable(digest(signed.refreshToken), start + IDLE_SECONDS)
  ).toBe(false)
})

test("active rotations can continue for a workday but never past eight hours", async () => {
  let signed = await signedIn(),
    current = signed.refreshToken
  for (
    let elapsed = SESSION_SECONDS;
    elapsed < ABSOLUTE_SECONDS;
    elapsed += SESSION_SECONDS
  ) {
    const next = await renew(db, current, start + elapsed)
    if (!next.ok) throw new Error("Active renewal failed")
    current = next.refreshToken
    expect(next.timing.absoluteExpiresAt).toBe(start + ABSOLUTE_SECONDS)
  }
  expect((await renew(db, current, start + ABSOLUTE_SECONDS)).ok).toBe(false)
})

test("early refresh is bounded without consuming or revoking the token", async () => {
  const signed = await signedIn()
  expect(await renew(db, signed.refreshToken, start + 1)).toMatchObject({
    ok: false,
    status: 429,
    retryAfter: 59,
  })
  expect(await authenticate(db, signed.token, start + 2)).not.toBeNull()
  expect((await renew(db, signed.refreshToken, start + 61)).ok).toBe(true)
})

test("concurrent use of one refresh secret detects replay and leaves no valid successor", async () => {
  const signed = await signedIn()
  const results = await Promise.all([
    renew(db, signed.refreshToken, start + 100),
    renew(db, signed.refreshToken, start + 100),
  ])
  expect(results.filter((result) => result.ok)).toHaveLength(1)
  for (const result of results)
    if (result.ok)
      expect(await authenticate(db, result.token, start + 100)).toBeNull()
})

test.each(["reset", "disable", "access-revoke", "refresh-logout"])(
  "%s revokes the refresh family",
  async (action) => {
    const signed = await signedIn()
    if (action === "reset") db.resetPassword("hr@example.com", hash)
    if (action === "disable") db.disable("hr@example.com")
    if (action === "access-revoke") db.revokeSession(signed.sessionId)
    if (action === "refresh-logout")
      db.revokeRefresh(digest(signed.refreshToken))
    expect((await renew(db, signed.refreshToken, start + 100)).ok).toBe(false)
    expect(await authenticate(db, signed.token, start + 100)).toBeNull()
  }
)

test("pre-existing auth schema is migrated without removing user accounts", () => {
  const legacyPath = join(dir, "legacy.sqlite"),
    raw = new DatabaseSync(legacyPath)
  raw.exec(
    "CREATE TABLE auth_users(user_id TEXT PRIMARY KEY, username TEXT UNIQUE, password_hash TEXT, role TEXT, employee_id TEXT, disabled INTEGER DEFAULT 0); CREATE TABLE auth_sessions(session_hash TEXT PRIMARY KEY,user_id TEXT,expires_at INTEGER); INSERT INTO auth_users VALUES('old','old@example.com','hash','hr',NULL,0);"
  )
  raw.close()
  const migrated = openAuthRepository(legacyPath)
  try {
    expect(migrated.findUser("old@example.com")?.userId).toBe("old")
  } finally {
    migrated.close()
  }
})

test.each([
  "https://evil.test",
  "//evil.test",
  "/\\evil.test",
  "/auth/renew",
  "/api/auth/token",
  "/hr/../../evil",
])("unsafe return target %s is rejected", (path) => {
  expect(safeReturnTo(path)).toBe("/")
})
test("renewal preserves a safe review URL and selected page", () => {
  expect(safeReturnTo("/hr/import/review/abc?page=2")).toBe(
    "/hr/import/review/abc?page=2"
  )
})

test("changing the signing key invalidates old refresh credentials as well as access tokens", async () => {
  const signed = await signedIn()
  vi.stubEnv("AUTH_JWT_SECRET", "b2".repeat(32))
  expect(db.refreshAvailable(digest(signed.refreshToken), start + 100)).toBe(
    false
  )
  expect((await renew(db, signed.refreshToken, start + 100)).ok).toBe(false)
  expect(await authenticate(db, signed.token, start + 100)).toBeNull()
})
