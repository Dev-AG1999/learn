import { AuthError, enforceOrigin, requestToken } from "../auth/http.ts"
import { withAuth, type Principal } from "../auth/repository.ts"
import { authenticate } from "../auth/service.ts"
export async function filePrincipal(request: Request): Promise<Principal> {
  const credential = requestToken(request.headers)
  if (request.method !== "GET" && !credential.bearer)
    enforceOrigin(request.headers)
  const principal = credential.token
    ? await withAuth((db) =>
        authenticate(db, credential.token, Math.floor(Date.now() / 1000), true)
      )
    : null
  if (!principal) throw new AuthError(401)
  if (principal.role === "employee" && !principal.employeeId)
    throw new AuthError(403)
  return principal
}
