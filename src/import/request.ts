import { MAX_FILE_BYTES } from "./types.ts"

export class BodyLimitError extends Error {
  readonly status: 400 | 413 | 415
  constructor(message: string, status: 400 | 413 | 415 = 413) {
    super(message)
    this.status = status
  }
}

export async function boundedForm(
  request: Request,
  limit = MAX_FILE_BYTES + 64 * 1024
): Promise<FormData> {
  const type = request.headers.get("content-type") ?? ""
  if (
    !type.startsWith("multipart/form-data") &&
    !type.startsWith("application/x-www-form-urlencoded")
  )
    throw new BodyLimitError(
      "Submit the salary form or choose a CSV/Excel file.",
      415
    )
  if (Number(request.headers.get("content-length")) > limit)
    throw new BodyLimitError(
      "The upload is too large. Choose a file up to 2 MiB."
    )
  const reader = request.body?.getReader()
  if (!reader) throw new BodyLimitError("No form data was received.", 400)
  let length = 0
  const chunks: Uint8Array[] = []
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      length += next.value.byteLength
      if (length > limit) {
        await reader.cancel()
        throw new BodyLimitError(
          "The upload is too large. Choose a file up to 2 MiB."
        )
      }
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }
  const copy = new Request(request.url, {
    method: "POST",
    headers: { "Content-Type": type },
    body: Buffer.concat(chunks),
  })
  try {
    return await copy.formData()
  } catch {
    throw new BodyLimitError(
      "The form data could not be read. Choose the sheet again.",
      400
    )
  }
}
