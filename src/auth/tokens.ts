import { randomBytes } from "node:crypto"
import { jwtVerify, SignJWT } from "jose"
import { jwtKey, SESSION_SECONDS } from "./config.ts"

const issuer = "payroll-app"
const audience = "payroll-session"

export async function issueToken(userId: string, now = Math.floor(Date.now() / 1000)) {
  const sessionId = randomBytes(32).toString("hex")
  const expiresAt = now + SESSION_SECONDS
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(issuer).setAudience(audience).setSubject(userId).setJti(sessionId)
    .setIssuedAt(now).setExpirationTime(expiresAt).sign(jwtKey())
  return { token, sessionId, expiresAt }
}

export async function verifyToken(token: string, now = Math.floor(Date.now() / 1000)) {
  // Missing configuration is a deployment failure, not an invalid credential.
  const key = jwtKey()
  if (token.length > 4096) return null
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["HS256"], typ: "JWT", issuer, audience,
      requiredClaims: ["sub", "jti", "iat", "exp"], currentDate: new Date(now * 1000),
    })
    if (typeof payload.sub !== "string" || !payload.sub || typeof payload.jti !== "string" ||
        !/^[a-f0-9]{64}$/.test(payload.jti) || typeof payload.iat !== "number" ||
        typeof payload.exp !== "number" || payload.iat > now || payload.exp - payload.iat !== SESSION_SECONDS) return null
    return { userId: payload.sub, sessionId: payload.jti }
  } catch { return null }
}
