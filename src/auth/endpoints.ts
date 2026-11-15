import { appOrigin, SESSION_SECONDS, sessionCookie } from "./config.ts"
import { AuthError, authFailure, enforceOrigin, requestToken } from "./http.ts"
import { withAuth } from "./repository.ts"
import { authenticate, login, logout } from "./service.ts"

const privateHeaders = { "Cache-Control": "no-store", Pragma: "no-cache" }

async function credentials(request: Request, json: boolean): Promise<{ username: string; password: string }> {
  // Bound request bodies before parsing or allocating expensive password work.
  const reader = request.body?.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  if (!reader) throw new Error("Invalid credentials")
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > 8192) { await reader.cancel(); throw new Error("Body too large") }
      chunks.push(next.value)
    }
  } finally { reader.releaseLock() }
  const text = Buffer.concat(chunks).toString("utf8")
  const body: unknown = json ? JSON.parse(text) : Object.fromEntries(new URLSearchParams(text))
  if (!body || typeof body !== "object" || !("username" in body) || !("password" in body) ||
      typeof body.username !== "string" || typeof body.password !== "string") throw new Error("Invalid credentials")
  return { username: body.username, password: body.password }
}

export async function loginResponse(request: Request, bearer: boolean): Promise<Response> {
  try {
    // Non-browser clients may omit Origin when obtaining a bearer token.
    if (!bearer || request.headers.has("origin")) enforceOrigin(request.headers)
  } catch (error) { return authFailure(error) }
  let input: { username: string; password: string }
  const contentType = request.headers.get("content-type")?.split(";")[0].trim()
  if (contentType !== (bearer ? "application/json" : "application/x-www-form-urlencoded")) {
    return new Response("Unsupported content type.", { status: 415, headers: privateHeaders })
  }
  try { input = await credentials(request, bearer) } catch {
    return new Response("Invalid login request.", { status: 400, headers: privateHeaders })
  }
  const result = await withAuth(db => login(db, input.username, input.password))
  if (!result.ok) {
    if (bearer) return Response.json({ error: result.status === 429 ? "Too many attempts. Try again later." : "Invalid username or password." }, {
      status: result.status, headers: { ...privateHeaders, ...(result.status === 429 ? { "Retry-After": "900" } : {}) },
    })
    return new Response(null, { status: 303, headers: { ...privateHeaders, Location: `${appOrigin()}/login?error=${result.status === 429 ? "limited" : "invalid"}` } })
  }
  if (bearer) return Response.json({ access_token: result.token, token_type: "Bearer", expires_in: SESSION_SECONDS }, { headers: privateHeaders })
  return new Response(null, { status: 303, headers: {
    ...privateHeaders, "Set-Cookie": sessionCookie(result.token), Location: `${appOrigin()}/`,
  } })
}

export async function logoutResponse(request: Request, api: boolean): Promise<Response> {
  const credential = requestToken(request.headers)
  try {
    if (!api || !credential.bearer) enforceOrigin(request.headers)
    if (credential.token) await withAuth(db => logout(db, credential.token))
    return new Response(null, { status: api ? 204 : 303, headers: {
      ...privateHeaders, ...(!credential.bearer ? { "Set-Cookie": sessionCookie("", 0) } : {}),
      ...(!api ? { Location: `${appOrigin()}/login` } : {}),
    } })
  } catch (error) { return authFailure(error) }
}

export async function sessionResponse(request: Request): Promise<Response> {
  const credential = requestToken(request.headers)
  const principal = credential.token ? await withAuth(db => authenticate(db, credential.token)) : null
  if (!principal) return authFailure(new AuthError(401))
  return Response.json(principal, { headers: privateHeaders })
}
