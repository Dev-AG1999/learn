import { SESSION_SECONDS, ABSOLUTE_SECONDS } from "./policy.ts"
export { SESSION_SECONDS } from "./policy.ts"
export const REFRESH_COOKIE_NAME =
  process.env.NODE_ENV === "production"
    ? "__Host-payroll_refresh"
    : "payroll_refresh"
export const COOKIE_NAME =
  process.env.NODE_ENV === "production"
    ? "__Host-payroll_session"
    : "payroll_session"

export function jwtKey(): Uint8Array {
  const value = process.env.AUTH_JWT_SECRET ?? ""
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error(
      "AUTH_JWT_SECRET must be a random 32-byte key encoded as 64 hexadecimal characters."
    )
  }
  return Buffer.from(value, "hex")
}

export function appOrigin(): string {
  const value =
    process.env.APP_ORIGIN ??
    (process.env.NODE_ENV === "production" ? "" : "http://localhost:3000")
  const url = new URL(value)
  if (
    url.origin !== value ||
    (url.protocol !== "https:" &&
      (process.env.NODE_ENV === "production" || url.protocol !== "http:"))
  ) {
    throw new Error(
      "APP_ORIGIN must be an exact origin and must use HTTPS in production."
    )
  }
  return url.origin
}

export function sessionCookie(token: string, maxAge = SESSION_SECONDS): string {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`
}

export function refreshCookie(
  token: string,
  maxAge = ABSOLUTE_SECONDS
): string {
  return `${REFRESH_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(maxAge))}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`
}
