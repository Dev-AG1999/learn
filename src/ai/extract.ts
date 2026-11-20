import sharp from "sharp"
import { execFile } from "node:child_process"
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters"
import type { FileKind } from "../files/types.ts"
import { extractPdf } from "../document-ai/extract.ts"
import {
  DocumentError,
  MAX_TEXT,
  MAX_CHUNKS,
  type Passage,
} from "../document-ai/types.ts"
const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1600,
  chunkOverlap: 200,
})
/** Native OCR uses memory pipes, not plaintext document files in temporary storage. */
function run(
  command: string,
  args: string[],
  input: Uint8Array,
  timeout: number,
  maxBuffer: number
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      command,
      args,
      { timeout, maxBuffer, encoding: "buffer" },
      (error, stdout) => (error ? reject(error) : resolve(stdout))
    )
    child.stdin?.on("error", () => {}) // Process errors are reported by the callback.
    child.stdin?.end(input)
  })
}
async function chunk(
  pages: string[]
): Promise<{ pages: number; passages: Passage[] }> {
  const passages: Passage[] = []
  if (pages.join("").length > MAX_TEXT)
    throw new DocumentError("Document text exceeds the processing limit.")
  for (const [index, page] of pages.entries()) {
    for (const text of await splitter.splitText(page))
      passages.push({ index: passages.length, page: index + 1, text })
    if (passages.length > MAX_CHUNKS)
      throw new DocumentError("Split this document into smaller files.")
  }
  if (!passages.length || pages.join("").trim().length < 20)
    throw new DocumentError(
      "No readable text was found. Use a clearer scan or image."
    )
  return { pages: pages.length, passages }
}
/** Called only after malware scanning and deterministic format normalization. */
export async function extractAttachment(bytes: Uint8Array, kind: FileKind) {
  if (kind === "pdf") {
    try {
      return await extractPdf(bytes)
    } catch (error) {
      if (
        !(error instanceof DocumentError) ||
        !/No readable text/.test(error.message)
      )
        throw error
    }
  }
  if (!["pdf", "png", "jpeg"].includes(kind))
    throw new DocumentError("Choose a PDF, PNG or JPEG attachment for chat.")
  const deadline = Date.now() + 60_000
  const remaining = (limit: number) => {
    const time = Math.min(limit, deadline - Date.now())
    if (time <= 0)
      throw new DocumentError(
        "OCR timed out. Split this document into smaller files.",
        503
      )
    return time
  }
  try {
    let count = 1
    if (kind === "pdf") {
      const info = await run(
        process.env.PDFINFO_PATH ?? "pdfinfo",
        ["-"],
        bytes,
        remaining(5000),
        65536
      )
      count = Number(/Pages:\s+(\d+)/.exec(info.toString())?.[1])
      if (!Number.isInteger(count) || count < 1 || count > 10)
        throw new DocumentError(
          "Scanned PDFs support up to 10 pages per upload."
        )
    }
    const pages: string[] = []
    for (let page = 1; page <= count; page++) {
      const image =
        kind === "pdf"
          ? await run(
              process.env.PDFTOPPM_PATH ?? "pdftoppm",
              [
                "-f",
                String(page),
                "-l",
                String(page),
                "-singlefile",
                "-scale-to",
                "1600",
                "-png",
                "-",
              ],
              bytes,
              remaining(20000),
              8 * 1024 * 1024
            )
          : await sharp(bytes, { limitInputPixels: 20_000_000 })
              .resize({
                width: 1600,
                height: 1600,
                fit: "inside",
                withoutEnlargement: true,
              })
              .png()
              .toBuffer()
      const text = await run(
        process.env.TESSERACT_PATH ?? "tesseract",
        ["stdin", "stdout", "-l", "eng", "--psm", "6"],
        image,
        remaining(15000),
        MAX_TEXT
      )
      pages.push(text.toString("utf8").trim())
    }
    return await chunk(pages)
  } catch (error) {
    if (error instanceof DocumentError) throw error
    throw new DocumentError(
      "OCR is unavailable or the image could not be read. Use a clear image or text-based PDF, or ask HR to check OCR setup.",
      503
    )
  }
}
