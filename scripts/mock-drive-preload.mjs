// Explicitly loaded ONLY by the isolated browser-test child process via --import.
// It never runs in normal next dev/start and never reaches a real Drive account.
const originalFetch = globalThis.fetch
const files = new Map()
let counter = 0
globalThis.fetch = async (input, init = {}) => {
  const url = input instanceof Request ? input.url : String(input)
  if (!url.startsWith("https://www.googleapis.com/"))
    return originalFetch(input, init)
  if (url.includes("/generateIds?"))
    return Response.json({ ids: [`browser-drive-${++counter}`] })
  if (url.includes("/permissions?"))
    return Response.json({ permissions: [{ type: "user", role: "owner" }] })
  if (url.includes("/upload/")) {
    const contentType = new Headers(init.headers).get("content-type") ?? ""
    const boundary = contentType.split("boundary=")[1]
    const bytes = Buffer.from(init.body),
      text = bytes.toString("latin1")
    const metaStart = text.indexOf("\r\n\r\n") + 4,
      metaEnd = text.indexOf(`\r\n--${boundary}`, metaStart)
    const metadata = JSON.parse(text.slice(metaStart, metaEnd))
    const dataStart = text.indexOf("\r\n\r\n", metaEnd + 4) + 4,
      dataEnd = text.lastIndexOf(`\r\n--${boundary}--`)
    files.set(metadata.id, bytes.subarray(dataStart, dataEnd))
    return Response.json({ id: metadata.id })
  }
  const id = /\/files\/([^?]+)/.exec(url)?.[1]
  if (init.method === "DELETE") {
    files.delete(id)
    return new Response(null, { status: 204 })
  }
  if (url.includes("alt=media"))
    return files.has(id)
      ? new Response(files.get(id))
      : new Response(null, { status: 404 })
  if (url.includes("fields=id,mimeType"))
    return Response.json({
      ownedByMe: true,
      trashed: false,
      mimeType:
        id === "browser-folder"
          ? "application/vnd.google-apps.folder"
          : "application/gzip",
      parents: ["browser-folder"],
      size: String(files.get(id)?.length ?? 0),
    })
  throw new Error("Unexpected synthetic Drive request")
}
