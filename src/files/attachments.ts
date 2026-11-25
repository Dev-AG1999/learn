import { documentAiConfigured } from "../document-ai/config.ts"
import { indexSecurePdf } from "../document-ai/runtime.ts"
import { reviewUpload, type UploadContext } from "../ai/review.ts"
import type { Principal } from "../auth/repository.ts"
import { FileError, MAX_CONCURRENT_UPLOADS, type StoredFile } from "./types.ts"
import { boundedForm } from "../import/request.ts"
import { requireUploadsEnabled } from "./config.ts"
import { withFiles } from "./repository.ts"
import { secureUpload, type UploadDependencies } from "./service.ts"
import { clamAvScanner } from "./scanner.ts"
import { googleDriveStore } from "./drive.ts"
import { signedFileUrl } from "./signing.ts"
export const attachmentForm = (request: Request) =>
  boundedForm(request, 9 * 1024 * 1024 + 64 * 1024)
export function hasAttachment(form: FormData): boolean {
  const file = form.get("attachment")
  return file instanceof File && file.size > 0
}
let activeUploads = 0
export async function storeFormFile(
  principal: Principal,
  form: FormData,
  field: string,
  validate?: UploadDependencies["validate"],
  context: UploadContext = {
    purpose: field === "sheet" ? "salary-sheet" : "chat",
  }
): Promise<StoredFile> {
  requireUploadsEnabled()
  const file = form.get(field)
  if (
    !(file instanceof File) ||
    !file.size ||
    form.getAll(field).length !== 1 ||
    form.get(`${field}Encoding`) !== "gzip"
  )
    throw new FileError("Choose one browser-compressed file.")
  if (activeUploads >= MAX_CONCURRENT_UPLOADS)
    throw new FileError("Upload processing is busy. Please retry shortly.", 429)
  activeUploads++
  try {
    return await withFiles(async (repository) => {
      if (!repository.connected())
        throw new FileError(
          "HR must connect Google Drive before uploading files.",
          503
        )
      repository.consume(principal)
      const stored = await secureUpload(
        principal,
        file.name,
        new Uint8Array(await file.arrayBuffer()),
        {
          repository,
          scanner: clamAvScanner(),
          store: googleDriveStore(repository),
          validate,
          review: (bytes, kind) => reviewUpload(bytes, kind, context),
        }
      )
      if (
        documentAiConfigured() &&
        ["pdf", "png", "jpeg"].includes(stored.kind ?? "")
      ) {
        try {
          await indexSecurePdf(principal, stored.id)
          const review = repository.review(principal, stored.id)
          if (review)
            repository.saveReview(stored.id, {
              ...review,
              indexStatus: "ready",
            })
        } catch {
          const review = repository.review(principal, stored.id)
          repository.saveReview(stored.id, {
            status: review?.status ?? "unavailable",
            indexStatus: "unavailable",
            summary: `${review?.summary ?? "Required upload checks completed."} Chat indexing could not complete; retry from the chatbot.`,
            checks: review?.checks ?? [],
          })
        }
      }
      return stored
    })
  } finally {
    activeUploads--
  }
}
export async function discardFile(file: StoredFile) {
  await withFiles(async (repository) => {
    repository.fail(file.id, "failed")
    if (file.driveId)
      await googleDriveStore(repository)
        .remove(file.driveId)
        .catch(() => {})
  })
}
export function attachmentResult(
  request: Request,
  redirectUrl: string,
  file?: StoredFile,
  error?: string,
  status = 400
): Response {
  if (request.headers.get("accept")?.includes("application/json"))
    return Response.json(
      error
        ? { error }
        : {
            redirectUrl,
            signedUrl: file ? signedFileUrl(file.id, file.ownerId) : null,
          },
      { status: error ? status : 200, headers: { "Cache-Control": "no-store" } }
    )
  return new Response(null, {
    status: 303,
    headers: { Location: redirectUrl, "Cache-Control": "no-store" },
  })
}
