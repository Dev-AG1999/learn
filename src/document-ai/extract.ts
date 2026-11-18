import { Worker } from "node:worker_threads"
import { resolve } from "node:path"
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters"
import {
  DocumentError,
  MAX_PDF_BYTES,
  MAX_CHUNKS,
  type Passage,
} from "./types.ts"

const extractionErrors: Record<string, string> = {
  pages: "PDFs may contain up to 100 pages.",
  text: "PDF text is too large. Split it into smaller files.",
  empty:
    "No readable text found. Scanned PDFs need OCR; upload a text-based PDF.",
  unreadable: "Cannot read this PDF. Use an unencrypted, text-based PDF.",
}
function extractPages(bytes: Uint8Array): Promise<string[]> {
  return new Promise((resolvePages, reject) => {
    const worker = new Worker(
      resolve(process.cwd(), "scripts/pdf-extract-worker.mjs"),
      {
        workerData: bytes,
        resourceLimits: {
          maxOldGenerationSizeMb: 128,
          maxYoungGenerationSizeMb: 32,
        },
      }
    )
    let received = false
    const timer = setTimeout(() => {
      void worker.terminate()
      reject(
        new DocumentError(
          "PDF processing timed out. Try a smaller or simpler PDF."
        )
      )
    }, 15_000)
    worker.once("message", (result: { pages?: string[]; error?: string }) => {
      received = true
      clearTimeout(timer)
      if (result.pages) resolvePages(result.pages)
      else
        reject(
          new DocumentError(
            extractionErrors[result.error ?? "unreadable"] ??
              extractionErrors.unreadable
          )
        )
    })
    worker.once("error", () => {
      clearTimeout(timer)
      reject(new DocumentError(extractionErrors.unreadable))
    })
    worker.once("exit", (code) => {
      clearTimeout(timer)
      if (!received || code !== 0)
        reject(new DocumentError(extractionErrors.unreadable))
    })
  })
}
export async function extractPdf(
  bytes: Uint8Array
): Promise<{ pages: number; passages: Passage[] }> {
  if (!bytes.length || bytes.length > MAX_PDF_BYTES)
    throw new DocumentError("Choose a PDF up to 5 MB.")
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-")
    throw new DocumentError("The file is not a PDF.")
  const pages = await extractPages(bytes)
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1600,
    chunkOverlap: 200,
  })
  const passages: Passage[] = []
  for (const [index, text] of pages.entries()) {
    for (const chunk of await splitter.splitText(text))
      passages.push({ index: passages.length, page: index + 1, text: chunk })
    if (passages.length > MAX_CHUNKS)
      throw new DocumentError(extractionErrors.text)
  }
  return { pages: pages.length, passages }
}
