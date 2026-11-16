import { jwtKey } from "./config.ts"
import { createHash, randomUUID } from "node:crypto"
import { DatabaseSync } from "node:sqlite"
import { openPayrollDatabase } from "../db/sqlite-payroll.ts"
import {
  ABSOLUTE_SECONDS,
  IDLE_SECONDS,
  MIN_REFRESH_SECONDS,
  type SessionTiming,
} from "./policy.ts"
import { preparePayrollPath } from "../payroll-db.ts"

export type Role = "hr" | "employee"
export type Principal = {
  userId: string
  username: string
  role: Role
  employeeId: string | null
}
export type AuthUser = Principal & { passwordHash: string; disabled: boolean }

export function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase()
}

export type RefreshResult =
  | { ok: true; absoluteExpiresAt: number; idleExpiresAt: number }
  | {
      ok: false
      reason: "invalid" | "reused" | "expired" | "too-soon"
      retryAfter?: number
    }

export type AuthRepository = {
  createFamily(
    userId: string,
    familyId: string,
    sessionId: string,
    tokenHash: string,
    expiresAt: number,
    now: number,
    passwordHash: string
  ): boolean
  refreshSubject(tokenHash: string): string | null
  refreshAvailable(tokenHash: string, now: number): boolean
  rotateRefresh(
    oldHash: string,
    newHash: string,
    sessionId: string,
    accessExpiresAt: number,
    now: number
  ): RefreshResult
  revokeRefresh(tokenHash: string): void
  sessionTiming(sessionId: string, now: number): SessionTiming | null
  findUser(username: string): AuthUser | null
  provision(
    username: string,
    passwordHash: string,
    role: Role,
    employeeId: string | null
  ): void
  consumeLoginAttempt(username: string, now: number): boolean
  createSession(
    userId: string,
    sessionId: string,
    expiresAt: number,
    now: number,
    expectedPasswordHash?: string
  ): boolean
  session(
    sessionId: string,
    userId: string,
    now: number,
    touch?: boolean
  ): Principal | null
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
    CREATE TABLE IF NOT EXISTS auth_session_families (
      family_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES auth_users(user_id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL, last_activity_at INTEGER NOT NULL, revoked_at INTEGER, signing_key_tag TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_auth_family_user ON auth_session_families(user_id);
    CREATE INDEX IF NOT EXISTS idx_auth_family_expiry ON auth_session_families(expires_at);
    CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
      token_hash TEXT PRIMARY KEY,
      family_id TEXT NOT NULL REFERENCES auth_session_families(family_id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL, consumed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_auth_refresh_family ON auth_refresh_tokens(family_id);
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

  const familyColumns = db
    .prepare("PRAGMA table_info(auth_session_families)")
    .all() as Array<{ name: string }>
  if (!familyColumns.some((column) => column.name === "signing_key_tag"))
    db.exec(
      "ALTER TABLE auth_session_families ADD COLUMN signing_key_tag TEXT NOT NULL DEFAULT ''"
    )
  const keyTag = () => digest(Buffer.from(jwtKey()).toString("hex"))
  const sessionColumns = db
    .prepare("PRAGMA table_info(auth_sessions)")
    .all() as Array<{ name: string }>
  if (!sessionColumns.some((column) => column.name === "family_id"))
    db.exec(
      "ALTER TABLE auth_sessions ADD COLUMN family_id TEXT REFERENCES auth_session_families(family_id) ON DELETE CASCADE"
    )
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_auth_session_family ON auth_sessions(family_id)"
  )
  type RefreshRow = {
    user_id: string
    signing_key_tag: string
    family_id: string
    expires_at: number
    last_activity_at: number
    revoked_at: number | null
    disabled: number
    consumed_at: number | null
    created_at: number
  }
  const refreshRow =
    db.prepare(`SELECT f.*, t.consumed_at, t.created_at, u.disabled FROM auth_refresh_tokens t
    JOIN auth_session_families f ON f.family_id=t.family_id JOIN auth_users u ON u.user_id=f.user_id WHERE t.token_hash=?`)
  function revokeFamily(familyId: string, now: number) {
    db.prepare(
      "UPDATE auth_session_families SET revoked_at=COALESCE(revoked_at,?) WHERE family_id=?"
    ).run(now, familyId)
    db.prepare("DELETE FROM auth_sessions WHERE family_id=?").run(familyId)
  }
  function usable(row: RefreshRow, now: number) {
    return (
      row.signing_key_tag === keyTag() &&
      !row.disabled &&
      row.revoked_at === null &&
      row.expires_at > now &&
      row.last_activity_at + IDLE_SECONDS > now
    )
  }

  return {
    createFamily(
      userId,
      familyId,
      sessionId,
      tokenHash,
      expiresAt,
      now,
      passwordHash
    ) {
      db.exec("BEGIN IMMEDIATE")
      try {
        db.prepare("DELETE FROM auth_session_families WHERE expires_at<=?").run(
          now
        )
        const created = db
          .prepare(
            "INSERT INTO auth_session_families(family_id,user_id,expires_at,last_activity_at,signing_key_tag) SELECT ?,user_id,?,?,? FROM auth_users WHERE user_id=? AND disabled=0 AND password_hash=?"
          )
          .run(
            familyId,
            now + ABSOLUTE_SECONDS,
            now,
            keyTag(),
            userId,
            passwordHash
          )
        if (created.changes !== 1) {
          db.exec("ROLLBACK")
          return false
        }
        db.prepare(
          "INSERT INTO auth_refresh_tokens(token_hash,family_id,created_at) VALUES(?,?,?)"
        ).run(tokenHash, familyId, now)
        db.prepare(
          "INSERT INTO auth_sessions(session_hash,user_id,expires_at,family_id) VALUES(?,?,?,?)"
        ).run(digest(sessionId), userId, expiresAt, familyId)
        db.exec("COMMIT")
        return true
      } catch (error) {
        db.exec("ROLLBACK")
        throw error
      }
    },
    refreshSubject(tokenHash) {
      const row = refreshRow.get(tokenHash) as RefreshRow | undefined
      return row?.user_id ?? null
    },
    refreshAvailable(tokenHash, now) {
      const row = refreshRow.get(tokenHash) as RefreshRow | undefined
      return !!row && row.consumed_at === null && usable(row, now)
    },
    rotateRefresh(oldHash, newHash, sessionId, accessExpiresAt, now) {
      db.exec("BEGIN IMMEDIATE")
      try {
        const row = refreshRow.get(oldHash) as RefreshRow | undefined
        if (!row) {
          db.exec("COMMIT")
          return { ok: false, reason: "invalid" }
        }
        if (row.consumed_at !== null) {
          revokeFamily(row.family_id, now)
          db.exec("COMMIT")
          return { ok: false, reason: "reused" }
        }
        if (!usable(row, now)) {
          revokeFamily(row.family_id, now)
          db.exec("COMMIT")
          return { ok: false, reason: "expired" }
        }
        if (now - row.created_at < MIN_REFRESH_SECONDS) {
          db.exec("COMMIT")
          return {
            ok: false,
            reason: "too-soon",
            retryAfter: MIN_REFRESH_SECONDS - (now - row.created_at),
          }
        }
        db.prepare(
          "UPDATE auth_refresh_tokens SET consumed_at=? WHERE token_hash=?"
        ).run(now, oldHash)
        db.prepare(
          "INSERT INTO auth_refresh_tokens(token_hash,family_id,created_at) VALUES(?,?,?)"
        ).run(newHash, row.family_id, now)
        db.prepare(
          "UPDATE auth_session_families SET last_activity_at=? WHERE family_id=?"
        ).run(now, row.family_id)
        // Previously issued access JWTs retain their short lifetime; family revocation affects all of them.
        db.prepare("DELETE FROM auth_sessions WHERE expires_at<=?").run(now)
        db.prepare(
          "INSERT INTO auth_sessions(session_hash,user_id,expires_at,family_id) VALUES(?,?,?,?)"
        ).run(digest(sessionId), row.user_id, accessExpiresAt, row.family_id)
        db.exec("COMMIT")
        return {
          ok: true,
          absoluteExpiresAt: row.expires_at,
          idleExpiresAt: now + IDLE_SECONDS,
        }
      } catch (error) {
        db.exec("ROLLBACK")
        throw error
      }
    },
    revokeRefresh(tokenHash) {
      const row = refreshRow.get(tokenHash) as RefreshRow | undefined
      if (row) revokeFamily(row.family_id, Math.floor(Date.now() / 1000))
    },
    sessionTiming(sessionId, now) {
      const row = db
        .prepare(
          `SELECT s.user_id, s.expires_at AS access_expiry, f.expires_at AS family_expiry, f.last_activity_at, f.revoked_at FROM auth_sessions s LEFT JOIN auth_session_families f ON f.family_id=s.family_id WHERE s.session_hash=? AND s.expires_at>?`
        )
        .get(digest(sessionId), now) as
        | {
            user_id: string
            access_expiry: number
            family_expiry: number | null
            last_activity_at: number | null
            revoked_at: number | null
          }
        | undefined
      if (
        !row ||
        row.revoked_at !== null ||
        (row.family_expiry !== null &&
          (row.family_expiry <= now ||
            row.last_activity_at! + IDLE_SECONDS <= now))
      )
        return null
      return {
        userId: row.user_id,
        accessExpiresAt: row.access_expiry,
        idleExpiresAt:
          row.last_activity_at === null
            ? row.access_expiry
            : row.last_activity_at + IDLE_SECONDS,
        absoluteExpiresAt: row.family_expiry ?? row.access_expiry,
        serverNow: now,
        renewable: row.family_expiry !== null,
      }
    },
    findUser(username: string): AuthUser | null {
      const row = db
        .prepare("SELECT * FROM auth_users WHERE username = ?")
        .get(normalizeUsername(username)) as
        | {
            user_id: string
            username: string
            password_hash: string
            role: Role
            employee_id: string | null
            disabled: number
          }
        | undefined
      return row
        ? {
            userId: row.user_id,
            username: row.username,
            passwordHash: row.password_hash,
            role: row.role,
            employeeId: row.employee_id,
            disabled: row.disabled === 1,
          }
        : null
    },
    provision(
      username: string,
      passwordHash: string,
      role: Role,
      employeeId: string | null
    ): void {
      if (!/^[a-z0-9][a-z0-9@._+-]{2,127}$/.test(normalizeUsername(username)))
        throw new Error(
          "Username must be 3–128 letters, digits, or @ . _ + - characters."
        )
      db.prepare(
        "INSERT INTO auth_users (user_id, username, password_hash, role, employee_id) VALUES (?, ?, ?, ?, ?)"
      ).run(
        randomUUID(),
        normalizeUsername(username),
        passwordHash,
        role,
        employeeId
      )
    },
    consumeLoginAttempt(username: string, now: number): boolean {
      db.exec("BEGIN IMMEDIATE")
      try {
        db.prepare("DELETE FROM auth_login_limits WHERE expires_at <= ?").run(
          now
        )
        const bucket = digest(normalizeUsername(username))
        const count = db
          .prepare("SELECT COUNT(*) AS count FROM auth_login_limits")
          .get() as { count: number }
        const existing = db
          .prepare("SELECT attempts FROM auth_login_limits WHERE bucket = ?")
          .get(bucket) as { attempts: number } | undefined
        // Bound storage even when an attacker supplies many random account names.
        if (
          (!existing && count.count >= 10000) ||
          (existing && existing.attempts >= 5)
        ) {
          db.exec("COMMIT")
          return false
        }
        db.prepare(
          "INSERT INTO auth_login_limits (bucket, attempts, expires_at) VALUES (?, 1, ?) ON CONFLICT(bucket) DO UPDATE SET attempts = attempts + 1"
        ).run(bucket, now + 900)
        db.exec("COMMIT")
        return true
      } catch (error) {
        db.exec("ROLLBACK")
        throw error
      }
    },
    createSession(
      userId: string,
      sessionId: string,
      expiresAt: number,
      now: number,
      expectedPasswordHash?: string
    ): boolean {
      db.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?").run(now)
      // A disable or password reset during verification must prevent session creation.
      return (
        db
          .prepare(
            "INSERT INTO auth_sessions (session_hash, user_id, expires_at) SELECT ?, user_id, ? FROM auth_users WHERE user_id = ? AND disabled = 0 AND (? IS NULL OR password_hash = ?)"
          )
          .run(
            digest(sessionId),
            expiresAt,
            userId,
            expectedPasswordHash ?? null,
            expectedPasswordHash ?? null
          ).changes === 1
      )
    },
    session(
      sessionId: string,
      userId: string,
      now: number,
      touch?: boolean
    ): Principal | null {
      const row = db
        .prepare(
          `SELECT u.user_id, u.username, u.role, u.employee_id FROM auth_sessions s
        JOIN auth_users u ON u.user_id = s.user_id
        LEFT JOIN auth_session_families f ON f.family_id=s.family_id
        WHERE s.session_hash = ? AND s.user_id = ? AND s.expires_at > ? AND u.disabled = 0 AND (s.family_id IS NULL OR (f.revoked_at IS NULL AND f.expires_at>? AND f.last_activity_at+?>?))`
        )
        .get(digest(sessionId), userId, now, now, IDLE_SECONDS, now) as
        | {
            user_id: string
            username: string
            role: Role
            employee_id: string | null
          }
        | undefined
      if (row && touch)
        db.prepare(
          "UPDATE auth_session_families SET last_activity_at=MAX(last_activity_at,?) WHERE family_id IN (SELECT family_id FROM auth_sessions WHERE session_hash=?)"
        ).run(now, digest(sessionId))
      return row
        ? {
            userId: row.user_id,
            username: row.username,
            role: row.role,
            employeeId: row.employee_id,
          }
        : null
    },
    revokeSession(sessionId: string): void {
      const family = db
        .prepare("SELECT family_id FROM auth_sessions WHERE session_hash=?")
        .get(digest(sessionId)) as { family_id: string | null } | undefined
      if (family?.family_id)
        revokeFamily(family.family_id, Math.floor(Date.now() / 1000))
      else
        db.prepare("DELETE FROM auth_sessions WHERE session_hash = ?").run(
          digest(sessionId)
        )
    },
    resetPassword(username: string, passwordHash: string): void {
      db.exec("BEGIN IMMEDIATE")
      try {
        const changed = db
          .prepare("UPDATE auth_users SET password_hash = ? WHERE username = ?")
          .run(passwordHash, normalizeUsername(username))
        if (changed.changes !== 1) throw new Error("Account not found.")
        db.prepare(
          "UPDATE auth_session_families SET revoked_at=unixepoch() WHERE user_id IN (SELECT user_id FROM auth_users WHERE username=?)"
        ).run(normalizeUsername(username))
        db.prepare(
          "DELETE FROM auth_sessions WHERE user_id IN (SELECT user_id FROM auth_users WHERE username = ?)"
        ).run(normalizeUsername(username))
        db.exec("COMMIT")
      } catch (error) {
        db.exec("ROLLBACK")
        throw error
      }
    },
    disable(username: string): void {
      db.exec("BEGIN IMMEDIATE")
      try {
        db.prepare("UPDATE auth_users SET disabled = 1 WHERE username = ?").run(
          normalizeUsername(username)
        )
        db.prepare(
          "UPDATE auth_session_families SET revoked_at=unixepoch() WHERE user_id IN (SELECT user_id FROM auth_users WHERE username=?)"
        ).run(normalizeUsername(username))
        db.prepare(
          "DELETE FROM auth_sessions WHERE user_id IN (SELECT user_id FROM auth_users WHERE username = ?)"
        ).run(normalizeUsername(username))
        db.exec("COMMIT")
      } catch (error) {
        db.exec("ROLLBACK")
        throw error
      }
    },
    close(): void {
      db.close()
    },
  }
}

export async function withAuth<T>(
  run: (db: AuthRepository) => Promise<T> | T
): Promise<T> {
  const db = openAuthRepository(preparePayrollPath())
  try {
    return await run(db)
  } finally {
    db.close()
  }
}
