import { AuthError, requestToken } from "./http.ts"
import { withAuth, type Principal } from "./repository.ts"
import { authenticate } from "./service.ts"

/** Authenticate an API read without extending the idle session. */
export async function requireReadPrincipal(request: Request): Promise<Principal> {
  const credential = requestToken(request.headers)
  const principal = credential.token
    ? await withAuth((db) =>
        authenticate(db, credential.token, Math.floor(Date.now() / 1000), false)
      )
    : null
  if (!principal) throw new AuthError(401)
  return principal
}
