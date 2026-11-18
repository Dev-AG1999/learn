// AI is deliberately deferred until the scanned Google Drive upload foundation
// has been reviewed. Keep the earlier AI domain implementation for that milestone.
import { filePrincipal } from "../files/auth.ts"
import { fileFailure } from "../files/http.ts"
async function deferredResponse(request: Request): Promise<Response> {
  try {
    await filePrincipal(request)
    return Response.json(
      {
        error:
          "Document AI is deferred. Use Files for scanned Google Drive uploads.",
      },
      { status: 409, headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    return fileFailure(error)
  }
}
export const uploadResponse = deferredResponse
export const askResponse = (request: Request, _id: string) =>
  deferredResponse(request)
export const downloadResponse = (request: Request, _id: string) =>
  deferredResponse(request)
