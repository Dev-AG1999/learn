import { saveChatAttachment } from "../../../../src/files/jobs/chat.ts"
import { maybeQueueUpload } from "../../../../src/files/jobs/http.ts"
import { filePrincipal } from "../../../../src/files/auth.ts"
import { fileFailure } from "../../../../src/files/http.ts"
import { withFiles } from "../../../../src/files/repository.ts"
export const runtime = "nodejs"
export async function GET(request: Request) {
  try {
    const principal = await filePrincipal(request)
    const files = await withFiles((db) =>
      db
        .list(principal)
        .files.filter(
          (file) =>
            file.status === "ready" &&
            ["pdf", "png", "jpeg"].includes(file.kind ?? "")
        )
        .slice(0, 20)
        .map(({ id, name }) => ({ id, name }))
    )
    return Response.json(
      { files },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    return fileFailure(error)
  }
}
export async function POST(request: Request) {
  try {
    const principal = await filePrincipal(request)
    const queued = await maybeQueueUpload(request, principal, "chat")
    return queued ?? saveChatAttachment(request, principal)
  } catch (error) {
    return fileFailure(error)
  }
}
