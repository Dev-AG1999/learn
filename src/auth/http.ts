import { appOrigin, COOKIE_NAME } from "./config.ts"
import type { Principal, Role } from "./repository.ts"
import { withAuth } from "./repository.ts"
import { authenticate } from "./service.ts"

export class AuthError extends Error {
  readonly status: 401 | 403

  constructor(status: 401 | 403) {
    super(status === 401 ? "Authentication required." : "Access denied.")
    this.status = status
  }
}

export function requestToken(headers: Headers): { token: string; bearer: boolean } {
  const authorization = headers.get("authorization")
  // An invalid Authorization header must never silently fall back to cookies.
  if (authorization !== null) {
    const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(authorization)
    return { token: match?.[1] ?? "", bearer: true }
  }
  const token = (headers.get("cookie") ?? "").split(";").map(value => value.trim())
    .find(value => value.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1) ?? ""
  return { token, bearer: false }
}

export function enforceOrigin(headers: Headers): void {
  if (headers.get("origin") !== appOrigin()) throw new AuthError(403)
  const site = headers.get("sec-fetch-site")
  if (site && site !== "same-origin" && site !== "none") throw new AuthError(403)
}

export function authorize(principal: Principal | null, role: Role, employeeId?: string): Principal {
  if (!principal) throw new AuthError(401)
  if (principal.role !== role || (role === "employee" && (!employeeId || principal.employeeId !== employeeId))) throw new AuthError(403)
  return principal
}

export async function requireRequest(request: Request, role: Role, employeeId?: string): Promise<Principal> {
  const credential = requestToken(request.headers)
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && !credential.bearer) enforceOrigin(request.headers)
  const principal = credential.token ? await withAuth(db => authenticate(db, credential.token)) : null
  return authorize(principal, role, employeeId)
}

export function authFailure(error: unknown): Response {
  if (!(error instanceof AuthError)) throw error
  return new Response(error.message, {
    status: error.status,
    headers: { "Cache-Control": "no-store", ...(error.status === 401 ? { "WWW-Authenticate": "Bearer" } : {}) },
  })
}
