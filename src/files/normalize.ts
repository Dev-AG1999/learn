import { Worker } from "node:worker_threads"
import { resolve } from "node:path"
import { FileError, type FileKind } from "./types.ts"
export function normalizeUpload(
  bytes: Uint8Array,
  kind: FileKind
): Promise<Uint8Array> {
  return new Promise((resolveBytes, reject) => {
    const worker = new Worker(
      resolve(process.cwd(), "scripts/sanitize-upload-worker.mjs"),
      {
        workerData: { bytes, kind },
        resourceLimits: {
          maxOldGenerationSizeMb: 128,
          maxYoungGenerationSizeMb: 32,
        },
      }
    )
    let received = false
    const timer = setTimeout(() => {
      void worker.terminate()
      reject(new FileError("File validation timed out. Try a smaller file."))
    }, 15_000)
    worker.once("message", (result: { bytes?: Uint8Array; error?: string }) => {
      received = true
      clearTimeout(timer)
      if (result.bytes) resolveBytes(new Uint8Array(result.bytes))
      else
        reject(
          new FileError(
            result.error === "active"
              ? "Active, encrypted, embedded-file or form PDFs are not supported. Export a plain PDF and retry."
              : result.error === "pages"
                ? "PDFs may contain up to 100 pages."
                : result.error === "large"
                  ? "The processed image is too large. Choose a smaller image."
                  : "Cannot validate this file. Use a plain PDF or a single JPEG/PNG image."
          )
        )
    })
    worker.once("error", () => {
      clearTimeout(timer)
      reject(new FileError("File validation failed."))
    })
    worker.once("exit", (code) => {
      clearTimeout(timer)
      if (!received || code !== 0)
        reject(new FileError("File validation failed."))
    })
  })
}
