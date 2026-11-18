import { createServer } from "node:net"
// Self-contained protocol fixture for browser tests, not an antivirus engine.
// The real-engine regression is scripts/check-upload-scanner.ts.
export function scannerFixture() {
  return createServer((socket) => {
    let bytes = Buffer.alloc(0),
      streaming = false
    const chunks: Buffer[] = []
    socket.on("data", (chunk) => {
      bytes = Buffer.concat([bytes, chunk])
      if (!streaming) {
        const end = bytes.indexOf(0)
        if (end < 0) return
        const command = bytes.subarray(0, end).toString()
        bytes = bytes.subarray(end + 1)
        if (command === "zVERSION") {
          socket.end(`ClamAV browser-fixture/1/${new Date().toUTCString()}\0`)
          return
        }
        if (command !== "zINSTREAM") {
          socket.destroy()
          return
        }
        streaming = true
      }
      while (bytes.length >= 4) {
        const length = bytes.readUInt32BE(0)
        if (length > 9 * 1024 * 1024) {
          socket.destroy()
          return
        }
        if (bytes.length < 4 + length) return
        if (length === 0) {
          socket.end(
            Buffer.concat(chunks).includes(Buffer.from("EICAR-STANDARD"))
              ? "stream: Eicar-Test-Signature FOUND\0"
              : "stream: OK\0"
          )
          return
        }
        chunks.push(bytes.subarray(4, 4 + length))
        bytes = bytes.subarray(4 + length)
      }
    })
  })
}
