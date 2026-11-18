import { parentPort, workerData } from "node:worker_threads"
import sharp from "sharp"
import { getDocumentProxy } from "unpdf"

let pdf
try {
  const bytes = new Uint8Array(workerData.bytes)
  if (workerData.kind === "pdf") {
    // Supplement semantic inspection with detection of explicit active-content names.
    const source = Buffer.from(bytes)
      .toString("latin1")
      .replace(/#([0-9a-f]{2})/gi, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16))
      )
    if (
      /\/(?:JavaScript|JS|OpenAction|AA|Launch|EmbeddedFile|RichMedia|XFA|AcroForm|Encrypt)\b/.test(
        source
      )
    )
      throw new Error("active")
    pdf = await getDocumentProxy(bytes, {
      isEvalSupported: false,
      useSystemFonts: false,
      stopAtErrors: true,
      verbosity: 0,
    })
    if (pdf.numPages > 100) throw new Error("pages")
    if (
      pdf.isPureXfa ||
      (await pdf.hasJSActions()) ||
      (await pdf.getOpenAction()) ||
      (await pdf.getAttachments()) ||
      (await pdf.getFieldObjects())
    )
      throw new Error("active")
    for (let page = 1; page <= pdf.numPages; page++) {
      const current = await pdf.getPage(page)
      if (await current.getJSActions()) throw new Error("active")
      const annotations = await current.getAnnotations()
      if (
        annotations.some(
          (item) =>
            item.actions ||
            item.jsActions ||
            item.attachment ||
            item.subtype === "Widget" ||
            item.subtype === "FileAttachment" ||
            item.subtype === "RichMedia"
        )
      )
        throw new Error("active")
    }
    parentPort.postMessage({ bytes: workerData.bytes })
  } else {
    sharp.cache(false)
    sharp.concurrency(1)
    const image = sharp(Buffer.from(bytes), {
      limitInputPixels: 20_000_000,
      failOn: "warning",
      animated: false,
    })
    const meta = await image.metadata()
    if (
      !meta.width ||
      !meta.height ||
      (meta.pages ?? 1) > 1 ||
      !["png", "jpeg"].includes(meta.format) ||
      meta.format !== workerData.kind
    )
      throw new Error("image")
    // Decode/re-encode and omit metadata. Preserve dimensions and document legibility.
    const normalized = image.rotate()
    const output = await (
      workerData.kind === "jpeg"
        ? normalized.jpeg({ quality: 85, mozjpeg: true })
        : normalized.png({ compressionLevel: 9 })
    ).toBuffer()
    if (output.length > 8 * 1024 * 1024) throw new Error("large")
    parentPort.postMessage({ bytes: new Uint8Array(output) })
  }
} catch (error) {
  parentPort.postMessage({
    error:
      error instanceof Error &&
      ["active", "pages", "image", "large"].includes(error.message)
        ? error.message
        : "invalid",
  })
} finally {
  await pdf?.loadingTask.destroy()
}
