import { extractAttachment } from "../ai/extract.ts"
import { gunzipSync } from "node:zlib"
import type { Principal } from "../auth/repository.ts"
import { withFiles } from "../files/repository.ts"
import { googleDriveStore } from "../files/drive.ts"
import { fingerprint } from "../files/crypto.ts"
import { requireDocumentAi } from "./config.ts"
import { withDocuments, type DocumentRepository } from "./repository.ts"
import { ollamaProvider } from "./ollama.ts"
import { sqliteVectorIndex } from "./sqlite-vectors.ts"
import {
  uploadDocument,
  askDocument,
  type DocumentDependencies,
} from "./service.ts"
import { DocumentError, MAX_PDF_BYTES } from "./types.ts"

function dependencies(repository: DocumentRepository): DocumentDependencies {
  return {
    repository,
    language: ollamaProvider(),
    vectors: sqliteVectorIndex(repository),
    // Source bytes are already scan-passed and persisted by secure uploads.
    // AI failure must never delete the original receipt/policy in Drive.
    objects: {
      async put() {},
      async get() {
        throw new Error("Use authorized secure downloads.")
      },
      async remove() {},
    },
  }
}
let indexing = 0,
  answering = 0
export async function indexSecurePdf(principal: Principal, fileId: string) {
  requireDocumentAi()
  const file = await withFiles((db) => db.access(principal, fileId))
  if (
    file.status !== "ready" ||
    !["pdf", "png", "jpeg"].includes(file.kind ?? "") ||
    !file.driveId ||
    !file.sha256
  )
    throw new DocumentError("Choose a scan-passed PDF, PNG or JPEG attachment.", 409)
  if (
    (file.originalBytes ?? Infinity) >
    (file.kind === "pdf" ? MAX_PDF_BYTES : 8 * 1024 * 1024)
  )
    throw new DocumentError("Choose a PDF up to 5 MiB for AI questions.")
  if (indexing >= 1)
    throw new DocumentError("PDF indexing is busy. Please retry shortly.", 429)
  indexing++
  try {
    return await withDocuments(async (repository) => {
      const existing = repository.bySource(principal, `secure-files/${fileId}`)
      if (existing?.status === "ready") return existing
      if (existing) repository.resetFailed(principal, existing.id)
      const stored = await withFiles((db) =>
        googleDriveStore(db).get(file.driveId!)
      )
      if (
        stored.length !== file.storedBytes ||
        fingerprint(stored) !== file.sha256
      )
        throw new DocumentError("Stored PDF integrity check failed.", 409)
      const bytes = gunzipSync(stored, {
        maxOutputLength: file.kind === "pdf" ? MAX_PDF_BYTES : 8 * 1024 * 1024,
      })
      return uploadDocument(
        principal,
        file.name,
        bytes,
        {
          ...dependencies(repository),
          extract: (input) => extractAttachment(input, file.kind!),
        },
        {
          fileId,
          ownerId: file.ownerId,
          ownerName: file.ownerName,
        }
      )
    })
  } catch (error) {
    if (error instanceof DocumentError && error.status !== 503) throw error
    throw new DocumentError(
      "This document could not be indexed. Check Drive and the local AI models. Your scan-passed attachment is saved; retry it from the chat saved-document picker.",
      503
    )
  } finally {
    indexing--
  }
}
export async function answerSecurePdf(
  principal: Principal,
  id: string,
  question: string
) {
  requireDocumentAi()
  if (answering >= 2)
    throw new DocumentError(
      "The document assistant is busy. Please retry shortly.",
      429
    )
  answering++
  try {
    return await withDocuments(async (repository) => {
      const document = repository.access(principal, id)
      const fileId = document.objectKey.startsWith("secure-files/")
        ? document.objectKey.slice(13)
        : ""
      if (!fileId)
        throw new DocumentError(
          "Reindex this PDF from a secure attachment.",
          409
        )
      await withFiles((db) => {
        const file = db.access(principal, fileId)
        if (file.status !== "ready")
          throw new DocumentError("The source attachment is unavailable.", 409)
      })
      return askDocument(principal, id, question, dependencies(repository))
    })
  } finally {
    answering--
  }
}
