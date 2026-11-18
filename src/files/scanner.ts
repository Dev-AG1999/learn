import { createConnection } from "node:net"
import { FileError, type FileScanner } from "./types.ts"

export function clamAvScanner(options?: {
  port?: number
  now?: () => number
}): FileScanner {
  const host = process.env.CLAMAV_HOST ?? "127.0.0.1"
  const port = options?.port ?? Number(process.env.CLAMAV_PORT ?? "3310")
  if (
    !["127.0.0.1", "localhost", "::1"].includes(host) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    throw new FileError("Antivirus must use a local ClamAV service.", 503)
  function command(command: string, bytes?: Uint8Array): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = createConnection({ host, port })
      let response = "",
        settled = false
      const finish = (error?: FileError) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        socket.destroy()
        if (error) reject(error)
        else resolve(response.replace(/\0.*$/s, "").trim())
      }
      const timer = setTimeout(
        () =>
          finish(
            new FileError("Antivirus timed out. File was not uploaded.", 503)
          ),
        20_000
      )
      socket.on("error", () =>
        finish(
          new FileError("Antivirus is unavailable. File was not uploaded.", 503)
        )
      )
      socket.on("data", (chunk) => {
        response += chunk.toString("utf8")
        if (response.length > 4096)
          finish(new FileError("Antivirus returned an invalid response.", 503))
        else if (response.includes("\0")) finish()
      })
      socket.on("end", () =>
        response
          ? finish()
          : finish(new FileError("Antivirus returned no result.", 503))
      )
      socket.on("connect", () => {
        socket.write(`z${command}\0`)
        if (!bytes) return
        let offset = 0
        const write = () => {
          while (!settled && offset < bytes.length) {
            const chunk = bytes.subarray(offset, offset + 64 * 1024)
            const size = Buffer.alloc(4)
            size.writeUInt32BE(chunk.length)
            offset += chunk.length
            socket.write(size)
            if (!socket.write(chunk)) {
              socket.once("drain", write)
              return
            }
          }
          if (!settled) socket.write(Buffer.alloc(4))
        }
        write()
      })
    })
  }
  return {
    async scan(bytes) {
      const version = await command("VERSION")
      const parts = version.split("/")
      const stamp = parts.slice(2).join("/")
      const updatedAt = Date.parse(
        /\b(?:GMT|UTC)\b/.test(stamp) ? stamp : `${stamp} UTC`
      )
      const now = options?.now?.() ?? Date.now()
      if (
        !version.startsWith("ClamAV ") ||
        !Number.isFinite(updatedAt) ||
        now - updatedAt > 72 * 3_600_000 ||
        updatedAt - now > 3_600_000
      )
        throw new FileError(
          "Antivirus signatures are missing or older than 72 hours. File was not uploaded.",
          503
        )
      const result = await command("INSTREAM", bytes)
      if (result === "stream: OK")
        return { version: version.slice(0, 200), scannedAt: now }
      if (/ FOUND$/.test(result))
        throw new FileError(
          "File rejected by antivirus. It was not uploaded.",
          422
        )
      throw new FileError(
        "Antivirus could not complete the scan. File was not uploaded.",
        503
      )
    },
  }
}
