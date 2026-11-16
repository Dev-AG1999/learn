import {
  appOrigin,
  SESSION_SECONDS,
  sessionCookie,
  refreshCookie,
} from "./config.ts"
import {
  AuthError,
  authFailure,
  enforceOrigin,
  requestToken,
  refreshFromRequest,
} from "./http.ts"
import { digest, withAuth } from "./repository.ts"
import { authenticate, login, logout, renew } from "./service.ts"

const privateHeaders = { "Cache-Control": "no-store", Pragma: "no-cache" }

async function credentials(
  request: Request,
  json: boolean
): Promise<{ username: string; password: string; reauth: boolean }> {
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
      if (size > 8192) {
        await reader.cancel()
        throw new Error("Body too large")
      }
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }
  const text = Buffer.concat(chunks).toString("utf8")
  const body: unknown = json
    ? JSON.parse(text)
    : Object.fromEntries(new URLSearchParams(text))
  if (
    !body ||
    typeof body !== "object" ||
    !("username" in body) ||
    !("password" in body) ||
    typeof body.username !== "string" ||
    typeof body.password !== "string"
  )
    throw new Error("Invalid credentials")
  return {
    username: body.username,
    password: body.password,
    reauth: "reauth" in body && body.reauth === "yes",
  }
}

export async function loginResponse(
  request: Request,
  bearer: boolean
): Promise<Response> {
  try {
    // Non-browser clients may omit Origin when obtaining a bearer token.
    if (!bearer || request.headers.has("origin")) enforceOrigin(request.headers)
  } catch (error) {
    return authFailure(error)
  }
  let input: { username: string; password: string; reauth: boolean }
  const contentType = request.headers.get("content-type")?.split(";")[0].trim()
  if (
    contentType !==
    (bearer ? "application/json" : "application/x-www-form-urlencoded")
  ) {
    return new Response("Unsupported content type.", {
      status: 415,
      headers: privateHeaders,
    })
  }
  try {
    input = await credentials(request, bearer)
  } catch {
    return new Response("Invalid login request.", {
      status: 400,
      headers: privateHeaders,
    })
  }
  const result = await withAuth((db) =>
    login(db, input.username, input.password)
  )
  if (!result.ok) {
    if (bearer)
      return Response.json(
        {
          error:
            result.status === 429
              ? "Too many attempts. Try again later."
              : "Invalid username or password.",
        },
        {
          status: result.status,
          headers: {
            ...privateHeaders,
            ...(result.status === 429 ? { "Retry-After": "900" } : {}),
          },
        }
      )
    return new Response(null, {
      status: 303,
      headers: {
        ...privateHeaders,
        Location: `${appOrigin()}/login?error=${result.status === 429 ? "limited" : "invalid"}${input.reauth ? "&reauth=yes" : ""}`,
      },
    })
  }
  if (bearer)
    return Response.json(
      {
        access_token: result.token,
        token_type: "Bearer",
        expires_in: SESSION_SECONDS,
        refresh_token: result.refreshToken,
      },
      { headers: privateHeaders }
    )
  const previousRefresh = refreshFromRequest(request.headers)
  if (previousRefresh)
    await withAuth((db) => db.revokeRefresh(digest(previousRefresh)))
  const responseHeaders = new Headers({
    ...privateHeaders,
    Location: `${appOrigin()}/`,
  })
  responseHeaders.append("Set-Cookie", sessionCookie(result.token))
  responseHeaders.append("Set-Cookie", refreshCookie(result.refreshToken))
  return new Response(null, { status: 303, headers: responseHeaders })
}

export async function logoutResponse(
  request: Request,
  api: boolean
): Promise<Response> {
  const credential = requestToken(request.headers)
  try {
    if (!api || !credential.bearer) enforceOrigin(request.headers)
    let refresh = !credential.bearer ? refreshFromRequest(request.headers) : ""
    if (
      api &&
      credential.bearer &&
      request.headers.get("content-type")?.startsWith("application/json")
    ) {
      try {
        refresh = (await refreshBody(request)).refresh_token
      } catch {
        return new Response("Invalid logout request.", {
          status: 400,
          headers: privateHeaders,
        })
      }
    }
    await withAuth(async (db) => {
      if (credential.token) await logout(db, credential.token)
      if (refresh) db.revokeRefresh(digest(refresh))
    })
    const responseHeaders = new Headers({
      ...privateHeaders,
      ...(!api ? { Location: `${appOrigin()}/login` } : {}),
    })
    if (!credential.bearer) {
      responseHeaders.append("Set-Cookie", sessionCookie("", 0))
      responseHeaders.append("Set-Cookie", refreshCookie("", 0))
    }
    return new Response(null, {
      status: api ? 204 : 303,
      headers: responseHeaders,
    })
  } catch (error) {
    return authFailure(error)
  }
}

export async function sessionResponse(request: Request): Promise<Response> {
  const credential = requestToken(request.headers)
  const principal = credential.token
    ? await withAuth((db) => authenticate(db, credential.token))
    : null
  if (!principal) return authFailure(new AuthError(401))
  const session = await withAuth(async (db) => {
    const { verifyToken } = await import("./tokens.ts")
    const claims = await verifyToken(credential.token)
    return claims
      ? db.sessionTiming(claims.sessionId, Math.floor(Date.now() / 1000))
      : null
  })
  return Response.json({ ...principal, session }, { headers: privateHeaders })
}

async function refreshBody(
  request: Request
): Promise<{ refresh_token: string }> {
  const reader = request.body?.getReader()
  if (!reader) return { refresh_token: "" }
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.length
      if (size > 8192) {
        await reader.cancel()
        throw new Error("Refresh request too large.")
      }
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }
  const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"))
  return {
    refresh_token:
      body &&
      typeof body === "object" &&
      "refresh_token" in body &&
      typeof body.refresh_token === "string"
        ? body.refresh_token
        : "",
  }
}

export async function refreshResponse(
  request: Request,
  api: boolean
): Promise<Response> {
  try {
    if (!api || request.headers.has("origin")) enforceOrigin(request.headers)
  } catch (error) {
    return authFailure(error)
  }
  let refresh = refreshFromRequest(request.headers)
  if (api) {
    if (
      request.headers.get("content-type")?.split(";")[0].trim() !==
      "application/json"
    )
      return new Response("Use JSON refresh_token.", {
        status: 415,
        headers: privateHeaders,
      })
    try {
      refresh = (await refreshBody(request)).refresh_token
    } catch {
      return new Response("Invalid refresh request.", {
        status: 400,
        headers: privateHeaders,
      })
    }
  }
  const result = await withAuth((db) => renew(db, refresh))
  const responseHeaders = new Headers(privateHeaders)
  if (!result.ok) {
    if (result.retryAfter)
      responseHeaders.set("Retry-After", String(result.retryAfter))
    if (!api && result.status === 401) {
      responseHeaders.append("Set-Cookie", sessionCookie("", 0))
      responseHeaders.append("Set-Cookie", refreshCookie("", 0))
    }
    return Response.json(
      {
        error:
          result.status === 429
            ? "Renewal was requested too soon. Try again shortly."
            : "Your session has expired. Please sign in again.",
      },
      { status: result.status, headers: responseHeaders }
    )
  }
  if (api)
    return Response.json(
      {
        access_token: result.token,
        refresh_token: result.refreshToken,
        token_type: "Bearer",
        expires_in: SESSION_SECONDS,
        session: result.timing,
      },
      { headers: responseHeaders }
    )
  responseHeaders.append("Set-Cookie", sessionCookie(result.token))
  responseHeaders.append(
    "Set-Cookie",
    refreshCookie(
      result.refreshToken,
      result.timing.absoluteExpiresAt - result.timing.serverNow
    )
  )
  return Response.json({ session: result.timing }, { headers: responseHeaders })
}
