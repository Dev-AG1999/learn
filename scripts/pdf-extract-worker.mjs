// Isolated PDF parsing: a malformed file must not block the Next.js request loop.
import { parentPort, workerData } from "node:worker_threads"
import { getDocumentProxy } from "unpdf"

let pdf
try {
  pdf = await getDocumentProxy(new Uint8Array(workerData.bytes), {
    isEvalSupported: false,
    useSystemFonts: false,
    stopAtErrors: true,
    verbosity: 0,
  })
  if (pdf.numPages > 100) throw new Error("pages")
  const pages = []
  let length = 0
  for (let page = 1; page <= pdf.numPages; page++) {
    const content = await (await pdf.getPage(page)).getTextContent()
    const text = content.items
      .map((item) =>
        "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : ""
      )
      .join("")
      .trim()
    length += text.length
    if (length > 200_000) throw new Error("text")
    pages.push(text)
  }
  if (length < 20) throw new Error("empty")
  parentPort.postMessage({ pages })
} catch (error) {
  const reason =
    error instanceof Error && ["pages", "text", "empty"].includes(error.message)
      ? error.message
      : "unreadable"
  parentPort.postMessage({ error: reason })
} finally {
  await pdf?.loadingTask.destroy()
}
