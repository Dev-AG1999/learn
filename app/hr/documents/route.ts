import { requireRequest, authFailure } from "../../../src/auth/http.ts"
import { hrAccess } from "../../../src/access/roles.ts"
import { withPayroll } from "../../../src/payroll-db.ts"
import { readPeriod } from "../../../src/period.ts"
import {
  attachmentForm,
  hasAttachment,
  storeFormFile,
  discardFile,
  attachmentResult,
} from "../../../src/files/attachments.ts"
import { withFiles } from "../../../src/files/repository.ts"
import { FileError, type StoredFile } from "../../../src/files/types.ts"
export async function POST(request: Request) {
  let principal
  try {
    principal = await requireRequest(request, "hr")
  } catch (error) {
    return authFailure(error)
  }
  const back = new URL("/hr", request.url)
  back.hash = "documents"
  let stored: StoredFile | undefined
  try {
    const form = await attachmentForm(request),
      period = readPeriod(
        String(form.get("year") ?? ""),
        String(form.get("month") ?? "")
      )
    if (period) {
      back.searchParams.set("year", String(period.year))
      back.searchParams.set("month", String(period.month))
    }
    const documentId = String(form.get("documentId") ?? "").trim(),
      body = String(form.get("body") ?? "").trim()
    if (
      !documentId ||
      documentId.length > 100 ||
      body.length > 200000 ||
      (!body && !hasAttachment(form))
    )
      throw new FileError(
        "Document ID and policy text or an attachment are required."
      )
    if (hasAttachment(form))
      stored = await storeFormFile(principal, form, "attachment")
    if (stored)
      await withFiles((db) => db.link("document", documentId, stored!.id))
    if (body)
      await withPayroll((db) =>
        hrAccess(db).uploadDocument({ documentId, body })
      )
    back.searchParams.set(
      "notice",
      body ? "document-saved" : "attachment-saved"
    )
    return attachmentResult(
      request,
      `${back.pathname}${back.search}${back.hash}`,
      stored
    )
  } catch (error) {
    if (stored) await discardFile(stored)
    const message =
      error instanceof FileError
        ? error.message
        : "Document could not be saved. Please retry."
    back.searchParams.set("failure", message)
    return attachmentResult(
      request,
      `${back.pathname}${back.search}${back.hash}`,
      undefined,
      message,
      error instanceof FileError ? error.status : 503
    )
  }
}
