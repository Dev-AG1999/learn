import { randomBytes, randomUUID } from "node:crypto"
import { digest } from "./repository.ts"
import { ABSOLUTE_SECONDS, IDLE_SECONDS } from "./policy.ts"
import { dummyPasswordHash, verifyPassword } from "./password.ts"
import type { AuthRepository } from "./repository.ts"
import { issueToken, verifyToken } from "./tokens.ts"

// Limit expensive password work within the supported single app process.
let activeLogins = 0
export async function login(
  db: AuthRepository,
  username: string,
  password: string,
  now = Math.floor(Date.now() / 1000)
) {
  if (
    !username ||
    username.length > 128 ||
    !password ||
    Buffer.byteLength(password) > 1024
  ) {
    return { ok: false as const, status: 401 as const }
  }
  if (!db.consumeLoginAttempt(username, now) || activeLogins >= 2)
    return { ok: false as const, status: 429 as const }
  activeLogins += 1
  try {
    const user = db.findUser(username)
    const valid = await verifyPassword(
      password,
      user?.passwordHash ?? dummyPasswordHash
    )
    if (!valid || !user || user.disabled)
      return { ok: false as const, status: 401 as const }
    const session = await issueToken(user.userId, now)
    const refreshToken = randomBytes(32).toString("hex")
    if (
      !db.createFamily(
        user.userId,
        randomUUID(),
        session.sessionId,
        digest(refreshToken),
        session.expiresAt,
        now,
        user.passwordHash
      )
    )
      return { ok: false as const, status: 401 as const }
    return {
      ok: true as const,
      ...session,
      refreshToken,
      timing: {
        userId: user.userId,
        accessExpiresAt: session.expiresAt,
        absoluteExpiresAt: now + ABSOLUTE_SECONDS,
        idleExpiresAt: now + IDLE_SECONDS,
        serverNow: now,
        renewable: true,
      },
      principal: {
        userId: user.userId,
        username: user.username,
        role: user.role,
        employeeId: user.employeeId,
      },
    }
  } finally {
    activeLogins -= 1
  }
}

export async function authenticate(
  db: AuthRepository,
  token: string,
  now = Math.floor(Date.now() / 1000),
  touch = false
) {
  const claims = await verifyToken(token, now)
  return claims ? db.session(claims.sessionId, claims.userId, now, touch) : null
}

export async function logout(db: AuthRepository, token: string) {
  const claims = await verifyToken(token)
  if (claims) db.revokeSession(claims.sessionId)
}

export async function renew(
  db: AuthRepository,
  refreshToken: string,
  now = Math.floor(Date.now() / 1000)
) {
  if (!/^[a-f0-9]{64}$/.test(refreshToken))
    return { ok: false as const, status: 401 as const }
  const hash = digest(refreshToken)
  const userId = db.refreshSubject(hash)
  if (!userId) return { ok: false as const, status: 401 as const }
  const session = await issueToken(userId, now)
  const nextRefresh = randomBytes(32).toString("hex")
  const result = db.rotateRefresh(
    hash,
    digest(nextRefresh),
    session.sessionId,
    session.expiresAt,
    now
  )
  if (!result.ok)
    return {
      ok: false as const,
      status: result.reason === "too-soon" ? (429 as const) : (401 as const),
      retryAfter: result.retryAfter,
    }
  return {
    ok: true as const,
    ...session,
    refreshToken: nextRefresh,
    timing: {
      userId,
      accessExpiresAt: session.expiresAt,
      absoluteExpiresAt: result.absoluteExpiresAt,
      idleExpiresAt: result.idleExpiresAt,
      serverNow: now,
      renewable: true,
    },
  }
}
