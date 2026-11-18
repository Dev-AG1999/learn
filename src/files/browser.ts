"use client"
import { MAX_ORIGINAL_BYTES, MAX_COMPRESSED_BYTES } from "./types.ts"
export async function compressFormFiles(
  form: FormData,
  fields: readonly string[]
): Promise<void> {
  for (const field of fields) {
    const file = form.get(field)
    if (!(file instanceof File) || !file.size) continue
    if (file.size > MAX_ORIGINAL_BYTES)
      throw new Error("Choose a file up to 8 MB.")
    if (typeof CompressionStream === "undefined")
      throw new Error("Use a current browser with gzip upload support.")
    const compressed = await new Response(
      file.stream().pipeThrough(new CompressionStream("gzip"))
    ).blob()
    if (compressed.size > MAX_COMPRESSED_BYTES)
      throw new Error("Compressed file exceeds the upload limit.")
    form.set(field, compressed, file.name)
    form.set(`${field}Encoding`, "gzip")
  }
}
