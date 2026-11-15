import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { SignJWT } from "jose"
import { hashPassword, verifyPassword } from "../src/auth/password.ts"
import { jwtKey, SESSION_SECONDS, sessionCookie } from "../src/auth/config.ts"
import { openAuthRepository } from "../src/auth/repository.ts"
import { authenticate, login, logout } from "../src/auth/service.ts"
import { issueToken, verifyToken } from "../src/auth/tokens.ts"

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "payroll-auth-"))
  vi.stubEnv("AUTH_JWT_SECRET", "a1".repeat(32))
})
afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.unstubAllEnvs() })

const password = "Correct horse battery staple!"

test("passwords are salted, hashed and verified; weak and excessive inputs are rejected", async () => {
  const first = await hashPassword(password), second = await hashPassword(password)
  expect(first).not.toEqual(second)
  expect(first).not.toContain(password)
  expect(await verifyPassword(password, first)).toBe(true)
  expect(await verifyPassword("incorrect", first)).toBe(false)
  expect(await verifyPassword("x".repeat(1025), first)).toBe(false)
  expect(await verifyPassword(password, "invalid hash")).toBe(false)
  await expect(hashPassword("short")).rejects.toThrow("12 characters")
})

test("JWTs contain only opaque IDs and timestamps, enforce signatures and expiry", async () => {
  const now = 1800000000
  const session = await issueToken("user-a", now)
  expect(await verifyToken(session.token, now)).toEqual({ userId: "user-a", sessionId: session.sessionId })
  const payload = JSON.parse(Buffer.from(session.token.split(".")[1], "base64url").toString())
  expect(Object.keys(payload).sort()).toEqual(["aud", "exp", "iat", "iss", "jti", "sub"])
  expect(await verifyToken(session.token, now + SESSION_SECONDS)).toBeNull()
  expect(await verifyToken(session.token, now - 1)).toBeNull()
  const parts = session.token.split("."); parts[1] = Buffer.from(JSON.stringify({ ...payload, sub: "hr" })).toString("base64url")
  expect(await verifyToken(parts.join("."), now)).toBeNull()
  expect(await verifyToken("a.b.c", now)).toBeNull()
  vi.stubEnv("AUTH_JWT_SECRET", "b2".repeat(32))
  expect(await verifyToken(session.token, now)).toBeNull()
})

test.each([
  { alg: "HS512", iss: "payroll-app", aud: "payroll-session", life: SESSION_SECONDS },
  { alg: "HS256", iss: "other", aud: "payroll-session", life: SESSION_SECONDS },
  { alg: "HS256", iss: "payroll-app", aud: "other", life: SESSION_SECONDS },
  { alg: "HS256", iss: "payroll-app", aud: "payroll-session", life: SESSION_SECONDS + 1 },
])("JWT validation rejects invalid policy %j", async policy => {
  const now = 1800000000
  const token = await new SignJWT({}).setProtectedHeader({ alg: policy.alg, typ: "JWT" })
    .setSubject("user-a").setJti("11".repeat(32)).setIssuer(policy.iss).setAudience(policy.aud)
    .setIssuedAt(now).setExpirationTime(now + policy.life).sign(jwtKey())
  expect(await verifyToken(token, now)).toBeNull()
})

test("missing or weak signing secrets fail closed", async () => {
  vi.stubEnv("AUTH_JWT_SECRET", "development-secret")
  await expect(issueToken("user-a")).rejects.toThrow("32-byte")
  await expect(verifyToken("a.b.c")).rejects.toThrow("32-byte")
})

test("real login survives database reopen and logout revokes copied tokens", async () => {
  const path = join(dir, "db.sqlite")
  let db = openAuthRepository(path)
  db.provision("HR@Example.com", await hashPassword(password), "hr", null)
  const result = await login(db, " hr@example.com ", password)
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error("Login failed")
  db.close(); db = openAuthRepository(path)
  try {
    expect((await authenticate(db, result.token))?.role).toBe("hr")
    await logout(db, result.token)
    expect(await authenticate(db, result.token)).toBeNull()
  } finally { db.close() }
})

test("password reset and disable revoke all active sessions", async () => {
  const db = openAuthRepository(join(dir, "db.sqlite"))
  try {
    const hash = await hashPassword(password)
    db.provision("hr@example.com", hash, "hr", null)
    const user = db.findUser("hr@example.com")!
    const first = await issueToken(user.userId), second = await issueToken(user.userId)
    for (const token of [first, second]) db.createSession(user.userId, token.sessionId, token.expiresAt, Math.floor(Date.now() / 1000))
    db.resetPassword(user.username, hash)
    expect(await authenticate(db, first.token)).toBeNull()
    expect(await authenticate(db, second.token)).toBeNull()
    db.createSession(user.userId, first.sessionId, first.expiresAt, Math.floor(Date.now() / 1000))
    db.disable(user.username)
    expect(await authenticate(db, first.token)).toBeNull()
    expect(db.createSession(user.userId, second.sessionId, second.expiresAt, 0)).toBe(false)
    expect((await login(db, user.username, password)).ok).toBe(false)
  } finally { db.close() }
})

test("login throttling is normalized, persists across restart and expires", () => {
  const path = join(dir, "db.sqlite")
  let db = openAuthRepository(path)
  for (let attempt = 0; attempt < 5; attempt++) expect(db.consumeLoginAttempt("UNKNOWN@example.com", 100)).toBe(true)
  db.close(); db = openAuthRepository(path)
  try {
    expect(db.consumeLoginAttempt(" unknown@example.com ", 101)).toBe(false)
    expect(db.consumeLoginAttempt("unknown@example.com", 1000)).toBe(true)
  } finally { db.close() }
})

test("employee credentials require an existing employee and enforce role binding", () => {
  const db = openAuthRepository(join(dir, "db.sqlite"))
  try {
    expect(() => db.provision("emp@example.com", "hash", "employee", "missing")).toThrow()
    expect(() => db.provision("emp@example.com", "hash", "employee", null)).toThrow()
    expect(() => db.provision("hr@example.com", "hash", "hr", "emp-a")).toThrow()
  } finally { db.close() }
})

test("production session cookies are host-only, secure and HttpOnly", () => {
  vi.stubEnv("NODE_ENV", "production")
  const cookie = sessionCookie("test-token")
  expect(cookie).toContain("HttpOnly")
  expect(cookie).toContain("SameSite=Lax")
  expect(cookie).toContain("; Secure")
  expect(cookie).not.toContain("Domain=")
})

test("an in-flight login cannot create a session after the password changes", async () => {
  const db = openAuthRepository(join(dir, "db.sqlite"))
  try {
    const oldHash = await hashPassword(password)
    db.provision("hr@example.com", oldHash, "hr", null)
    const user = db.findUser("hr@example.com")!
    const session = await issueToken(user.userId)
    db.resetPassword(user.username, "replacement-password-hash")
    expect(db.createSession(user.userId, session.sessionId, session.expiresAt, Math.floor(Date.now() / 1000), oldHash)).toBe(false)
    expect(await authenticate(db, session.token)).toBeNull()
  } finally { db.close() }
})
