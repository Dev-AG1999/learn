import type { Principal } from "../../auth/repository.ts"
import { fileFailure } from "../../files/http.ts"
import { withFiles } from "../../files/repository.ts"
import {
  attachmentForm,
  storeFormFile,
} from "../../files/attachments.ts"
import { requireDocumentAi } from "../../document-ai/config.ts"
import { DocumentError } from "../../document-ai/types.ts"
import { FileError } from "../../files/types.ts"
export async function saveChatAttachment(request: Request, principal: Principal) {
  try {
    requireDocumentAi()
    const form = await attachmentForm(request)
    const file = await storeFormFile(
      principal,
      form,
      "attachment",
      async (bytes, kind) => {
        if (!["pdf", "png", "jpeg"].includes(kind))
          throw new FileError("Chat accepts PDF, PNG and JPEG documents.")
        if (kind === "pdf" && bytes.length > 5 * 1024 * 1024)
          throw new FileError("Choose a PDF up to 5 MiB for chat.")
      },
      { purpose: "chat" }
    )
    const review = await withFiles((db) => db.review(principal, file.id))
    return Response.json(
      { file: { id: file.id, name: file.name }, review },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    return error instanceof DocumentError
      ? Response.json(
          { error: error.message },
          { status: error.status, headers: { "Cache-Control": "no-store" } }
        )
      : fileFailure(error)
  }
}
