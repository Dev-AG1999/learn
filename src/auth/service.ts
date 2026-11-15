import { dummyPasswordHash, verifyPassword } from "./password.ts"
import type { AuthRepository } from "./repository.ts"
import { issueToken, verifyToken } from "./tokens.ts"

// Limit expensive password work within the supported single app process.
let activeLogins = 0
export async function login(db: AuthRepository, username: string, password: string, now = Math.floor(Date.now() / 1000)) {
  if (!username || username.length > 128 || !password || Buffer.byteLength(password) > 1024) {
    return { ok: false as const, status: 401 as const }
  }
  if (!db.consumeLoginAttempt(username, now) || activeLogins >= 2) return { ok: false as const, status: 429 as const }
  activeLogins += 1
  try {
    const user = db.findUser(username)
    const valid = await verifyPassword(password, user?.passwordHash ?? dummyPasswordHash)
    if (!valid || !user || user.disabled) return { ok: false as const, status: 401 as const }
    const session = await issueToken(user.userId, now)
    if (!db.createSession(user.userId, session.sessionId, session.expiresAt, now, user.passwordHash)) return { ok: false as const, status: 401 as const }
    return { ok: true as const, ...session, principal: { userId: user.userId, username: user.username, role: user.role, employeeId: user.employeeId } }
  } finally { activeLogins -= 1 }
}

export async function authenticate(db: AuthRepository, token: string, now = Math.floor(Date.now() / 1000)) {
  const claims = await verifyToken(token, now)
  return claims ? db.session(claims.sessionId, claims.userId, now) : null
}

export async function logout(db: AuthRepository, token: string) {
  const claims = await verifyToken(token)
  if (claims) db.revokeSession(claims.sessionId)
}
