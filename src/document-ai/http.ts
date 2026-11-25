import type { Principal } from "../auth/repository.ts"
import { maybeQueueUpload } from "../files/jobs/http.ts"
import { filePrincipal } from "../files/auth.ts"
import { fileFailure } from "../files/http.ts"
import { attachmentForm, storeFormFile } from "../files/attachments.ts"
import { boundedBytes } from "../files/bytes.ts"
import { FileError } from "../files/types.ts"
import { requireDocumentAi } from "./config.ts"
import { indexSecurePdf, answerSecurePdf } from "./runtime.ts"
import { DocumentError, MAX_PDF_BYTES } from "./types.ts"
const headers = { "Cache-Control": "no-store" }
function failure(error: unknown) {
  return error instanceof DocumentError
    ? Response.json({ error: error.message }, { status: error.status, headers })
    : fileFailure(error)
}
async function json(request: Request): Promise<Record<string, unknown>> {
  try { return JSON.parse(new TextDecoder().decode(await boundedBytes(request.body, 10000))) as Record<string, unknown> }
  catch { throw new DocumentError("Send a valid request up to 10 KB.") }
}
export async function uploadResponse(request: Request): Promise<Response> {
  try {
    const principal = await filePrincipal(request)
    const queued = await maybeQueueUpload(request, principal, "pdf")
    return queued ?? processPdfUpload(request, principal)
  } catch (error) { return failure(error) }
}
export async function processPdfUpload(request: Request, principal: Principal): Promise<Response> {
  try {
    requireDocumentAi()
    let fileId: unknown
    if (request.headers.get("content-type")?.includes("application/json")) {
      fileId = (await json(request))?.fileId
    } else {
      const form = await attachmentForm(request)
      const file = await storeFormFile(principal, form, "attachment", async (bytes, kind) => {
        if (kind !== "pdf" || bytes.length > MAX_PDF_BYTES)
          throw new FileError("Choose a PDF up to 5 MiB for AI questions.")
      })
      fileId = file.id
    }
    if (typeof fileId !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(fileId))
      throw new DocumentError("Choose a secure PDF attachment.")
    const document = await indexSecurePdf(principal, fileId)
    return Response.json({ document: { id: document.id, name: document.name, status: document.status, pages: document.pages } }, { headers })
  } catch (error) { return failure(error) }
}
export async function askResponse(request: Request, id: string): Promise<Response> {
  try {
    const principal = await filePrincipal(request)
    requireDocumentAi()
    const question = (await json(request))?.question
    if (typeof question !== "string") throw new DocumentError("Enter a question about this PDF.")
    return Response.json(await answerSecurePdf(principal, id, question), { headers })
  } catch (error) { return failure(error) }
}
export async function downloadResponse(request: Request, _id: string): Promise<Response> {
  try {
    await filePrincipal(request)
    return Response.json({ error: "Use the attachment's authenticated signed download link." }, { status: 410, headers })
  } catch (error) { return failure(error) }
}
