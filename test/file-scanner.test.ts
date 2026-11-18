import { beforeEach, afterEach, expect, test, vi } from "vitest"
const mock = vi.hoisted(() => ({
  version: "",
  result: "stream: OK",
  unavailable: false,
  silent: false,
  writes: [] as Uint8Array[],
}))
vi.mock("node:net", async () => {
  const { EventEmitter } = await import("node:events")
  return {
    createConnection: () => {
      class Socket extends EventEmitter {
        command = ""
        header = true
        destroyed = false
        write(input: string | Uint8Array) {
          if (typeof input === "string") {
            this.command = input
            if (input.startsWith("zVERSION") && !mock.silent)
              queueMicrotask(() =>
                this.emit("data", Buffer.from(mock.version + "\0"))
              )
          } else {
            mock.writes.push(new Uint8Array(input))
            if (this.command.startsWith("zINSTREAM")) {
              if (
                this.header &&
                input.length === 4 &&
                Buffer.from(input).readUInt32BE(0) === 0
              ) {
                if (!mock.silent)
                  queueMicrotask(() =>
                    this.emit("data", Buffer.from(mock.result + "\0"))
                  )
              } else this.header = !this.header
            }
          }
          return true
        }
        destroy() {
          this.destroyed = true
          return this
        }
      }
      const socket = new Socket()
      queueMicrotask(() =>
        mock.unavailable
          ? socket.emit("error", new Error("private socket detail"))
          : socket.emit("connect")
      )
      return socket
    },
  }
})
import { clamAvScanner } from "../src/files/scanner.ts"
beforeEach(() => {
  mock.version = `ClamAV 1.5.4/1/${new Date().toUTCString()}`
  mock.result = "stream: OK"
  mock.unavailable = false
  mock.silent = false
  mock.writes = []
  vi.stubEnv("CLAMAV_HOST", "127.0.0.1")
  vi.stubEnv("CLAMAV_PORT", "3310")
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})
test("speaks bounded INSTREAM framing and only accepts explicit OK", async () => {
  const bytes = Buffer.from("synthetic harmless bytes")
  expect((await clamAvScanner().scan(bytes)).version).toContain("ClamAV")
  expect(Buffer.from(mock.writes[0]).readUInt32BE(0)).toBe(bytes.length)
  expect(Buffer.from(mock.writes[1])).toEqual(bytes)
  expect(Buffer.from(mock.writes[2]).readUInt32BE(0)).toBe(0)
})
test("stale or malformed signature dates fail before file bytes are streamed", async () => {
  for (const version of [
    `ClamAV 1.5.4/1/${new Date(Date.now() - 73 * 3600000).toUTCString()}`,
    "ClamAV unknown",
    "untrusted OK",
  ]) {
    mock.version = version
    await expect(clamAvScanner().scan(Buffer.from("file"))).rejects.toThrow(
      "signatures"
    )
    expect(mock.writes).toHaveLength(0)
  }
})
test("scanner failure or limit errors are not treated as clean", async () => {
  mock.result = "stream: Heuristics.Limits.Exceeded FOUND"
  await expect(clamAvScanner().scan(Buffer.from("file"))).rejects.toMatchObject(
    { status: 422 }
  )
  mock.result = "stream: unexpected ERROR"
  await expect(clamAvScanner().scan(Buffer.from("file"))).rejects.toMatchObject(
    { status: 503 }
  )
  mock.unavailable = true
  await expect(clamAvScanner().scan(Buffer.from("file"))).rejects.toThrow(
    "unavailable"
  )
})
test("unresponsive scanner times out and remote hosts are refused", async () => {
  vi.useFakeTimers()
  mock.silent = true
  const promise = clamAvScanner().scan(Buffer.from("file"))
  const assertion = expect(promise).rejects.toThrow("timed out")
  await vi.advanceTimersByTimeAsync(20001)
  await assertion
  vi.stubEnv("CLAMAV_HOST", "external.example")
  expect(() => clamAvScanner()).toThrow("local ClamAV")
})
