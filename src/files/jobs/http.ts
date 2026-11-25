import type { Principal } from "../../auth/repository.ts"
import { MAX_FILE_BYTES } from "../../import/types.ts"
import { boundedBytes } from "../bytes.ts"
import { requireUploadsEnabled } from "../config.ts"
import { fileFailure } from "../http.ts"
import { FileError, MAX_COMPRESSED_BYTES } from "../types.ts"
import { withUploadJobs } from "./repository.ts"
import type { UploadKind } from "./types.ts"

const headers = { "Cache-Control": "no-store" }

export async function maybeQueueUpload(request: Request, principal: Principal, kind: UploadKind) {
  if (process.env.UPLOAD_QUEUE_ENABLED !== "true" || request.headers.get("prefer") !== "respond-async")
    return null
  const contentType = request.headers.get("content-type") ?? ""
  if (!contentType.startsWith("multipart/form-data")) return null
  try {
    requireUploadsEnabled()
    if (contentType.length > 256) throw new FileError("Invalid upload format.", 415)
    const limit = (kind === "import" ? MAX_FILE_BYTES : MAX_COMPRESSED_BYTES) + 64 * 1024
    if (Number(request.headers.get("content-length")) > limit)
      throw new FileError("File exceeds the size limit.", 413)
    const bytes = await boundedBytes(request.body, limit)
    const id = withUploadJobs((jobs) => jobs.enqueue(principal, kind, contentType, bytes))
    return Response.json({ jobId: id, statusUrl: `/uploads/${id}` }, {
      status: 202,
      headers: { ...headers, Location: `/api/uploads/${id}`, "Preference-Applied": "respond-async" },
    })
  } catch (error) {
    return fileFailure(error)
  }
}

export function uploadStatus(principal: Principal, id: string) {
  try {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new FileError("Upload job not found.", 404)
    const job = withUploadJobs((jobs) => jobs.status(principal.userId, id))
    if (!job) throw new FileError("Upload job not found.", 404)
    return Response.json(job, { headers })
  } catch (error) {
    return fileFailure(error)
  }
}
