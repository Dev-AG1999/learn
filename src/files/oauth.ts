import { randomBytes, createHash } from "node:crypto"
import {
  requireRequest,
  authFailure,
  cookieValue,
  AuthError,
} from "../auth/http.ts"
import { withFiles } from "./repository.ts"
import { requireDriveConfig } from "./config.ts"
import { fingerprint } from "./crypto.ts"
import {
  DRIVE_SCOPE,
  driveCallbackUrl,
  finishDriveAuthorization,
} from "./drive.ts"
import { appOrigin } from "../auth/config.ts"
import { FileError } from "./types.ts"
export const DRIVE_STATE_COOKIE =
  process.env.NODE_ENV === "production"
    ? "__Host-paydesk_drive_oauth"
    : "paydesk_drive_oauth"
const stateCookie = (value: string, maxAge = 600) =>
  `${DRIVE_STATE_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`
export async function connectDriveResponse(
  request: Request
): Promise<Response> {
  try {
    const principal = await requireRequest(request, "hr")
    requireDriveConfig()
    const state = randomBytes(32).toString("base64url"),
      verifier = randomBytes(32).toString("base64url")
    await withFiles((db) =>
      db.saveState(fingerprint(state), principal.userId, verifier)
    )
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth")
    url.search = new URLSearchParams({
      client_id: process.env.GOOGLE_DRIVE_CLIENT_ID!,
      redirect_uri: driveCallbackUrl(),
      response_type: "code",
      scope: DRIVE_SCOPE,
      access_type: "offline",
      prompt: "consent",
      state,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    }).toString()
    if (request.headers.get("accept")?.includes("application/json"))
      return Response.json(
        { authorizationUrl: url.href },
        {
          headers: {
            "Set-Cookie": stateCookie(state),
            "Cache-Control": "no-store",
          },
        }
      )
    return new Response(null, {
      status: 303,
      headers: {
        Location: url.href,
        "Set-Cookie": stateCookie(state),
        "Cache-Control": "no-store",
      },
    })
  } catch (error) {
    if (error instanceof AuthError) return authFailure(error)
    if (request.headers.get("accept")?.includes("application/json"))
      return Response.json(
        {
          error:
            error instanceof FileError
              ? error.message
              : "Google authorization could not be started. Please retry.",
        },
        {
          status: error instanceof FileError ? error.status : 503,
          headers: { "Cache-Control": "no-store" },
        }
      )
    return new Response(null, {
      status: 303,
      headers: {
        Location: "/hr?storage=setup-required#documents",
        "Cache-Control": "no-store",
      },
    })
  }
}
export async function driveCallbackResponse(
  request: Request
): Promise<Response> {
  let notice = "connection-failed"
  try {
    const principal = await requireRequest(request, "hr")
    requireDriveConfig()
    const params = new URL(request.url).searchParams,
      state = params.get("state") ?? ""
    if (
      !/^[\w-]{43}$/.test(state) ||
      cookieValue(request.headers, DRIVE_STATE_COOKIE) !== state
    )
      throw new Error("state")
    const verifier = await withFiles((db) =>
      db.consumeState(fingerprint(state), principal.userId)
    )
    const code = params.get("code")
    if (!verifier || params.has("error") || !code || code.length > 4096)
      throw new Error("authorization")
    await withFiles((db) =>
      finishDriveAuthorization(db, principal.userId, code, verifier)
    )
    notice = "connected"
  } catch (error) {
    if (error instanceof AuthError) return authFailure(error)
  }
  return new Response(null, {
    status: 303,
    headers: {
      Location: new URL(`/hr?storage=${notice}#documents`, appOrigin()).href,
      "Set-Cookie": stateCookie("", 0),
      "Cache-Control": "no-store",
    },
  })
}
