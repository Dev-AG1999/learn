import { randomBytes } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { openStorageDatabase } from "../src/db/connection.ts"
import { encryptDatabase } from "../src/db/encrypt.ts"
import { openPayrollDatabase } from "../src/db/sqlite-payroll.ts"
import { openAuthRepository } from "../src/auth/repository.ts"
import { openFileRepository } from "../src/files/repository.ts"
let dir: string
let secret: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "paydesk-encryption-"))
  secret = randomBytes(32).toString("hex")
  vi.stubEnv("DATABASE_ENCRYPTION_KEY", secret)
})
afterEach(() => { vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }) })

test("encrypted payroll persists and supports indexed search and analytics", async () => {
  const path = join(dir, "payroll.sqlite")
  let db = openPayrollDatabase(path)
  await db.saveMonth({ employeeId: "PRIVATE-EMPLOYEE", year: 2026, month: 1, annualCtcMinor: 1200000, currency: "INR", calendarDays: 31, unpaidLeaveDays: 0, otherDeductionsMinor: 0, claims: [], confirmed: true })
  db.close()
  expect(readFileSync(path).includes(Buffer.from("PRIVATE-EMPLOYEE"))).toBe(false)
  const plain = new DatabaseSync(path)
  expect(() => plain.prepare("SELECT * FROM employees").all()).toThrow()
  plain.close()
  db = openPayrollDatabase(path)
  expect((await db.get("PRIVATE-EMPLOYEE", 2026, 1))?.employeeId).toBe("PRIVATE-EMPLOYEE")
  expect((await db.listEmployees({ year: 2026, month: 1, prefix: "PRIVATE", currency: "", cursor: null, limit: 25 })).employees).toHaveLength(1)
  expect(await db.orgTotals(2026, 1)).toHaveLength(1)
  db.close()
  vi.stubEnv("DATABASE_ENCRYPTION_KEY", randomBytes(32).toString("hex"))
  expect(() => openPayrollDatabase(path)).toThrow("Cannot open encrypted database")
})

test("auth and file repositories share the encrypted SQLite database", () => {
  const path = join(dir, "shared.sqlite")
  const auth = openAuthRepository(path)
  auth.provision("private-hr", "password-hash", "hr", null)
  auth.close()
  const files = openFileRepository(path)
  files.close()
  const reopened = openAuthRepository(path)
  expect(reopened.findUser("private-hr")?.username).toBe("private-hr")
  reopened.close()
  expect(readFileSync(path).includes(Buffer.from("private-hr"))).toBe(false)
})

test("migration preserves source, encrypts destination and refuses overwrite", async () => {
  const source = join(dir, "plain.sqlite"), destination = join(dir, "encrypted.sqlite")
  const raw = new DatabaseSync(source)
  raw.exec("CREATE TABLE secrets(value TEXT); INSERT INTO secrets VALUES('private-value')")
  raw.close()
  const original = readFileSync(source)
  await encryptDatabase(source, destination, Buffer.from(secret, "hex"))
  expect(readFileSync(source)).toEqual(original)
  expect(readFileSync(destination).includes(Buffer.from("private-value"))).toBe(false)
  expect(statSync(destination).mode & 0o777).toBe(0o600)
  const db = openStorageDatabase(destination)
  expect(db.prepare("SELECT value FROM secrets").get()).toMatchObject({ value: "private-value" })
  db.close()
  const saved = readFileSync(destination)
  await expect(encryptDatabase(source, destination, Buffer.from(secret, "hex"))).rejects.toThrow()
  expect(readFileSync(destination)).toEqual(saved)
  expect(readFileSync(source)).toEqual(original)
})

test("configuration fails closed and existing plaintext is never silently migrated", () => {
  const path = join(dir, "plain.sqlite")
  const raw = new DatabaseSync(path)
  raw.exec("CREATE TABLE example(id INTEGER)")
  raw.close()
  expect(() => openStorageDatabase(path)).toThrow("migrate existing plaintext")
  vi.stubEnv("DATABASE_ENCRYPTION_KEY", "invalid")
  expect(() => openStorageDatabase(path)).toThrow("32-byte")
  vi.stubEnv("DATABASE_ENCRYPTION_KEY", "")
  vi.stubEnv("NODE_ENV", "production")
  expect(() => openStorageDatabase(path)).toThrow("required in production")
})

test("session renewal still rotates hashed refresh tokens in an encrypted database", async () => {
  const { hashPassword } = await import("../src/auth/password.ts")
  const { login, renew, authenticate } = await import("../src/auth/service.ts")
  vi.stubEnv("AUTH_JWT_SECRET", "d1".repeat(32))
  const path = join(dir, "renew.sqlite")
  const auth = openAuthRepository(path)
  try {
    const password = "Encrypted session integration password!"
    auth.provision("hr-renew", await hashPassword(password), "hr", null)
    const now = Math.floor(Date.now() / 1000)
    const signed = await login(auth, "hr-renew", password, now)
    expect(signed.ok).toBe(true)
    if (!signed.ok) return
    const refreshed = await renew(auth, signed.refreshToken, now + 601)
    expect(refreshed.ok).toBe(true)
    if (!refreshed.ok) return
    expect(auth.sessionTiming(refreshed.sessionId, now + 601)).toEqual(refreshed.timing)
    expect((await authenticate(auth, refreshed.token, now + 601))?.role).toBe("hr")
    expect((await renew(auth, signed.refreshToken, now + 602)).ok).toBe(false)
  } finally { auth.close() }
})
