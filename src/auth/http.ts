import { appOrigin, COOKIE_NAME, REFRESH_COOKIE_NAME } from "./config.ts"
import type { Principal, Role } from "./repository.ts"
import { digest, withAuth } from "./repository.ts"
import { authenticate } from "./service.ts"

export class AuthError extends Error {
  readonly status: 401 | 403

  constructor(status: 401 | 403) {
    super(status === 401 ? "Authentication required." : "Access denied.")
    this.status = status
  }
}

export function cookieValue(headers: Headers, name: string): string {
  return (
    (headers.get("cookie") ?? "")
      .split(";")
      .map((value) => value.trim())
      .find((value) => value.startsWith(`${name}=`))
      ?.slice(name.length + 1) ?? ""
  )
}

export function refreshFromRequest(headers: Headers): string {
  return cookieValue(headers, REFRESH_COOKIE_NAME)
}

export function safeReturnTo(value: string): string {
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\u0000-\u0020]/.test(value)
  )
    return "/"
  try {
    const url = new URL(value, "https://payroll.invalid")
    if (
      url.origin !== "https://payroll.invalid" ||
      !(
        url.pathname === "/" ||
        /^\/hr(?:\/|$)/.test(url.pathname) ||
        /^\/employee\//.test(url.pathname)
      )
    )
      return "/"
    return url.pathname + url.search + url.hash
  } catch {
    return "/"
  }
}

export class SessionRenewRequired extends AuthError {
  readonly returnTo: string
  constructor(returnTo: string) {
    super(401)
    this.returnTo = safeReturnTo(returnTo)
  }
}

export function requestToken(headers: Headers): {
  token: string
  bearer: boolean
} {
  const authorization = headers.get("authorization")
  // An invalid Authorization header must never silently fall back to cookies.
  if (authorization !== null) {
    const match =
      /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(
        authorization
      )
    return { token: match?.[1] ?? "", bearer: true }
  }
  const token =
    (headers.get("cookie") ?? "")
      .split(";")
      .map((value) => value.trim())
      .find((value) => value.startsWith(`${COOKIE_NAME}=`))
      ?.slice(COOKIE_NAME.length + 1) ?? ""
  return { token, bearer: false }
}

export function enforceOrigin(headers: Headers): void {
  if (headers.get("origin") !== appOrigin()) throw new AuthError(403)
  const site = headers.get("sec-fetch-site")
  if (site && site !== "same-origin" && site !== "none")
    throw new AuthError(403)
}

export function authorize(
  principal: Principal | null,
  role: Role,
  employeeId?: string
): Principal {
  if (!principal) throw new AuthError(401)
  if (
    principal.role !== role ||
    (role === "employee" &&
      (!employeeId || principal.employeeId !== employeeId))
  )
    throw new AuthError(403)
  return principal
}

export async function requireRequest(
  request: Request,
  role: Role,
  employeeId?: string
): Promise<Principal> {
  const credential = requestToken(request.headers)
  if (
    !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
    !credential.bearer
  )
    enforceOrigin(request.headers)
  const principal = credential.token
    ? await withAuth((db) =>
        authenticate(db, credential.token, Math.floor(Date.now() / 1000), true)
      )
    : null
  if (!principal && request.method === "GET" && !credential.bearer) {
    const refresh = refreshFromRequest(request.headers)
    if (
      refresh &&
      (await withAuth((db) =>
        db.refreshAvailable(digest(refresh), Math.floor(Date.now() / 1000))
      ))
    ) {
      const url = new URL(request.url)
      throw new SessionRenewRequired(url.pathname + url.search)
    }
  }
  return authorize(principal, role, employeeId)
}

export function authFailure(error: unknown): Response {
  if (error instanceof SessionRenewRequired)
    return new Response(null, {
      status: 303,
      headers: {
        "Cache-Control": "no-store",
        Location: `/auth/renew?returnTo=${encodeURIComponent(error.returnTo)}`,
      },
    })
  if (!(error instanceof AuthError)) throw error
  return new Response(error.message, {
    status: error.status,
    headers: {
      "Cache-Control": "no-store",
      ...(error.status === 401 ? { "WWW-Authenticate": "Bearer" } : {}),
    },
  })
}
