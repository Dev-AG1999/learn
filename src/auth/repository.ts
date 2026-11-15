import { createHash, randomUUID } from "node:crypto"
import { DatabaseSync } from "node:sqlite"
import { openPayrollDatabase } from "../db/sqlite-payroll.ts"
import { preparePayrollPath } from "../payroll-db.ts"

export type Role = "hr" | "employee"
export type Principal = { userId: string; username: string; role: Role; employeeId: string | null }
export type AuthUser = Principal & { passwordHash: string; disabled: boolean }

export function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase()
}

export type AuthRepository = {
  findUser(username: string): AuthUser | null
  provision(username: string, passwordHash: string, role: Role, employeeId: string | null): void
  consumeLoginAttempt(username: string, now: number): boolean
  createSession(userId: string, sessionId: string, expiresAt: number, now: number, expectedPasswordHash?: string): boolean
  session(sessionId: string, userId: string, now: number): Principal | null
  revokeSession(sessionId: string): void
  resetPassword(username: string, passwordHash: string): void
  disable(username: string): void
  close(): void
}

export function openAuthRepository(path: string): AuthRepository {
  // Auth and payroll share the same SQLite engine and persistent file.
  openPayrollDatabase(path).close()
  const db = new DatabaseSync(path)
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS auth_users (
      user_id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('hr', 'employee')),
      employee_id TEXT REFERENCES employees(employee_id),
      disabled INTEGER NOT NULL DEFAULT 0 CHECK(disabled IN (0, 1)),
      CHECK((role = 'hr' AND employee_id IS NULL) OR (role = 'employee' AND employee_id IS NOT NULL))
    );
    CREATE TABLE IF NOT EXISTS auth_sessions (
      session_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES auth_users(user_id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_auth_session_user ON auth_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_auth_session_expiry ON auth_sessions(expires_at);
    CREATE TABLE IF NOT EXISTS auth_login_limits (
      bucket TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_auth_limits_expiry ON auth_login_limits(expires_at);
  `)

  return {
    findUser(username: string): AuthUser | null {
      const row = db.prepare("SELECT * FROM auth_users WHERE username = ?").get(normalizeUsername(username)) as {
        user_id: string; username: string; password_hash: string; role: Role; employee_id: string | null; disabled: number
      } | undefined
      return row ? { userId: row.user_id, username: row.username, passwordHash: row.password_hash, role: row.role, employeeId: row.employee_id, disabled: row.disabled === 1 } : null
    },
    provision(username: string, passwordHash: string, role: Role, employeeId: string | null): void {
      if (!/^[a-z0-9][a-z0-9@._+-]{2,127}$/.test(normalizeUsername(username))) throw new Error("Username must be 3–128 letters, digits, or @ . _ + - characters.")
      db.prepare("INSERT INTO auth_users (user_id, username, password_hash, role, employee_id) VALUES (?, ?, ?, ?, ?)")
        .run(randomUUID(), normalizeUsername(username), passwordHash, role, employeeId)
    },
    consumeLoginAttempt(username: string, now: number): boolean {
      db.exec("BEGIN IMMEDIATE")
      try {
        db.prepare("DELETE FROM auth_login_limits WHERE expires_at <= ?").run(now)
        const bucket = digest(normalizeUsername(username))
        const count = db.prepare("SELECT COUNT(*) AS count FROM auth_login_limits").get() as { count: number }
        const existing = db.prepare("SELECT attempts FROM auth_login_limits WHERE bucket = ?").get(bucket) as { attempts: number } | undefined
        // Bound storage even when an attacker supplies many random account names.
        if ((!existing && count.count >= 10000) || (existing && existing.attempts >= 5)) {
          db.exec("COMMIT")
          return false
        }
        db.prepare("INSERT INTO auth_login_limits (bucket, attempts, expires_at) VALUES (?, 1, ?) ON CONFLICT(bucket) DO UPDATE SET attempts = attempts + 1").run(bucket, now + 900)
        db.exec("COMMIT")
        return true
      } catch (error) {
        db.exec("ROLLBACK")
        throw error
      }
    },
    createSession(userId: string, sessionId: string, expiresAt: number, now: number, expectedPasswordHash?: string): boolean {
      db.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?").run(now)
      // A disable or password reset during verification must prevent session creation.
      return db.prepare("INSERT INTO auth_sessions (session_hash, user_id, expires_at) SELECT ?, user_id, ? FROM auth_users WHERE user_id = ? AND disabled = 0 AND (? IS NULL OR password_hash = ?)")
        .run(digest(sessionId), expiresAt, userId, expectedPasswordHash ?? null, expectedPasswordHash ?? null).changes === 1
    },
    session(sessionId: string, userId: string, now: number): Principal | null {
      const row = db.prepare(`SELECT u.user_id, u.username, u.role, u.employee_id FROM auth_sessions s
        JOIN auth_users u ON u.user_id = s.user_id
        WHERE s.session_hash = ? AND s.user_id = ? AND s.expires_at > ? AND u.disabled = 0`).get(digest(sessionId), userId, now) as {
          user_id: string; username: string; role: Role; employee_id: string | null
        } | undefined
      return row ? { userId: row.user_id, username: row.username, role: row.role, employeeId: row.employee_id } : null
    },
    revokeSession(sessionId: string): void {
      db.prepare("DELETE FROM auth_sessions WHERE session_hash = ?").run(digest(sessionId))
    },
    resetPassword(username: string, passwordHash: string): void {
      db.exec("BEGIN IMMEDIATE")
      try {
        const changed = db.prepare("UPDATE auth_users SET password_hash = ? WHERE username = ?").run(passwordHash, normalizeUsername(username))
        if (changed.changes !== 1) throw new Error("Account not found.")
        db.prepare("DELETE FROM auth_sessions WHERE user_id IN (SELECT user_id FROM auth_users WHERE username = ?)").run(normalizeUsername(username))
        db.exec("COMMIT")
      } catch (error) {
        db.exec("ROLLBACK")
        throw error
      }
    },
    disable(username: string): void {
      db.exec("BEGIN IMMEDIATE")
      try {
        db.prepare("UPDATE auth_users SET disabled = 1 WHERE username = ?").run(normalizeUsername(username))
        db.prepare("DELETE FROM auth_sessions WHERE user_id IN (SELECT user_id FROM auth_users WHERE username = ?)").run(normalizeUsername(username))
        db.exec("COMMIT")
      } catch (error) {
        db.exec("ROLLBACK")
        throw error
      }
    },
    close(): void { db.close() },
  }
}


export async function withAuth<T>(run: (db: AuthRepository) => Promise<T> | T): Promise<T> {
  const db = openAuthRepository(preparePayrollPath())
  try { return await run(db) } finally { db.close() }
}
