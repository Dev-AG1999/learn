import { headers } from "next/headers.js"
import { redirect } from "next/navigation.js"
import {
  AuthError,
  authorize,
  enforceOrigin,
  requestToken,
  refreshFromRequest,
  safeReturnTo,
} from "./http.ts"
import { digest, withAuth, type Principal, type Role } from "./repository.ts"
import { authenticate } from "./service.ts"

export async function currentPrincipal(
  touch = false
): Promise<Principal | null> {
  const credential = requestToken(new Headers(await headers()))
  return credential.token
    ? withAuth((db) =>
        authenticate(db, credential.token, Math.floor(Date.now() / 1000), touch)
      )
    : null
}

export async function pagePrincipal(returnTo = "/"): Promise<Principal | null> {
  const principal = await currentPrincipal(true)
  if (principal) return principal
  const requestHeaders = new Headers(await headers())
  const credential = requestToken(requestHeaders)
  const refresh = refreshFromRequest(requestHeaders)
  if (
    !credential.bearer &&
    refresh &&
    (await withAuth((db) =>
      db.refreshAvailable(digest(refresh), Math.floor(Date.now() / 1000))
    ))
  )
    redirect(
      `/auth/renew?returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`
    )
  return null
}

export function pageReturnTo(
  path: string,
  query: Record<string, string | undefined>
): string {
  const params = new URLSearchParams(
    Object.entries(query).filter(
      (pair): pair is [string, string] => pair[1] !== undefined
    )
  )
  return path + (params.size ? `?${params}` : "")
}

export async function requirePage(
  role: Role,
  employeeId?: string,
  returnTo?: string
): Promise<Principal> {
  const principal = await pagePrincipal(
    returnTo ??
      (role === "hr"
        ? "/hr"
        : `/employee/${encodeURIComponent(employeeId ?? "")}`)
  )
  if (!principal) redirect("/login")
  try {
    return authorize(principal, role, employeeId)
  } catch (error) {
    if (error instanceof AuthError) redirect("/forbidden")
    throw error
  }
}

export async function requireHrAction(): Promise<Principal> {
  const requestHeaders = new Headers(await headers())
  enforceOrigin(requestHeaders)
  return authorize(await currentPrincipal(true), "hr")
}
