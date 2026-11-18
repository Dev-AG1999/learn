import { authFailure, AuthError } from "../auth/http.ts"
import { filePrincipal } from "./auth.ts"
import { withFiles } from "./repository.ts"
import { FileError } from "./types.ts"
import { googleDriveStore } from "./drive.ts"
import { verifyFileUrl, signedFileUrl } from "./signing.ts"
import { fingerprint } from "./crypto.ts"
export function fileFailure(error: unknown): Response {
  if (error instanceof AuthError) return authFailure(error)
  return Response.json(
    {
      error:
        error instanceof FileError
          ? error.message
          : "File service is unavailable. Please retry.",
    },
    {
      status: error instanceof FileError ? error.status : 503,
      headers: { "Cache-Control": "no-store" },
    }
  )
}
export async function downloadFileResponse(
  request: Request,
  id: string
): Promise<Response> {
  try {
    const principal = await filePrincipal(request)
    verifyFileUrl(new URL(request.url), id, principal.userId)
    const result = await withFiles(async (repository) => {
      const file = repository.access(principal, id)
      if (file.status !== "ready" || !file.driveId || !file.sha256)
        throw new FileError("File has not passed upload checks.", 409)
      const bytes = await googleDriveStore(repository).get(file.driveId)
      if (
        bytes.length !== file.storedBytes ||
        fingerprint(bytes) !== file.sha256
      )
        throw new FileError(
          "Stored file integrity check failed. Download blocked.",
          409
        )
      return { file, bytes }
    })
    return new Response(Buffer.from(result.bytes), {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="document.gz"; filename*=UTF-8''${encodeURIComponent(result.file.name + ".gz").replaceAll("'", "%27")}`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'",
        "X-Frame-Options": "DENY",
      },
    })
  } catch (error) {
    return fileFailure(error)
  }
}

export async function signedLinkResponse(
  request: Request,
  id: string
): Promise<Response> {
  try {
    const principal = await filePrincipal(request)
    await withFiles((db) => {
      const file = db.access(principal, id)
      if (file.status !== "ready")
        throw new FileError("File is not available.", 409)
    })
    return Response.json(
      { signedUrl: signedFileUrl(id, principal.userId), expiresIn: 300 },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    return fileFailure(error)
  }
}
