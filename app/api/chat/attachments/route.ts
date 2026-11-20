import { filePrincipal } from "../../../../src/files/auth.ts"
import { fileFailure } from "../../../../src/files/http.ts"
import { withFiles } from "../../../../src/files/repository.ts"
import {
  attachmentForm,
  storeFormFile,
} from "../../../../src/files/attachments.ts"
import { requireDocumentAi } from "../../../../src/document-ai/config.ts"
import { DocumentError } from "../../../../src/document-ai/types.ts"
import { FileError } from "../../../../src/files/types.ts"
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
