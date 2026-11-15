import { headers } from "next/headers.js"
import { redirect } from "next/navigation.js"
import { AuthError, authorize, enforceOrigin, requestToken } from "./http.ts"
import { withAuth, type Principal, type Role } from "./repository.ts"
import { authenticate } from "./service.ts"

export async function currentPrincipal(): Promise<Principal | null> {
  const credential = requestToken(new Headers(await headers()))
  return credential.token ? withAuth(db => authenticate(db, credential.token)) : null
}

export async function requirePage(role: Role, employeeId?: string): Promise<Principal> {
  const principal = await currentPrincipal()
  if (!principal) redirect("/login")
  try { return authorize(principal, role, employeeId) } catch (error) {
    if (error instanceof AuthError) redirect("/forbidden")
    throw error
  }
}

export async function requireHrAction(): Promise<Principal> {
  const requestHeaders = new Headers(await headers())
  enforceOrigin(requestHeaders)
  return authorize(await currentPrincipal(), "hr")
}
