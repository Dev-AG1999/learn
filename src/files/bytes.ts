import { FileError } from "./types.ts"
export async function boundedBytes(
  stream: ReadableStream<Uint8Array> | null,
  limit: number
): Promise<Uint8Array<ArrayBuffer>> {
  if (!stream) throw new FileError("A file body is required.")
  const reader = stream.getReader(),
    parts: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.length
      if (length > limit) {
        await reader.cancel()
        throw new FileError("File exceeds the size limit.", 413)
      }
      parts.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.length
  }
  return bytes
}
