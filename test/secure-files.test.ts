import { beforeEach, afterEach, expect, test, vi } from "vitest"
import { gzipSync, gunzipSync } from "node:zlib"
import sharp from "sharp"
import {
  openFileRepository,
  type FileRepository,
} from "../src/files/repository.ts"
import {
  secureUpload,
  type UploadDependencies,
  validateFilename,
} from "../src/files/service.ts"
import { normalizeUpload } from "../src/files/normalize.ts"
import { FileError, MAX_ORIGINAL_BYTES } from "../src/files/types.ts"
import { payslipPdf } from "../src/payslip-document.ts"
const principal = {
  userId: "user-a",
  username: "a@example.test",
  role: "employee" as const,
  employeeId: "emp-a",
}
const pdf = payslipPdf({
  employeeId: "emp-a",
  year: 2026,
  month: 11,
  currency: "INR",
  monthlyGrossMinor: 100000,
  unpaidDeductionMinor: 0,
  otherDeductionsMinor: 5000,
  approvedReimbursementsMinor: 0,
  netMinor: 95000,
})
let repository: FileRepository, deps: UploadDependencies
beforeEach(() => {
  repository = openFileRepository(":memory:")
  deps = {
    repository,
    scanner: {
      scan: vi.fn(async () => ({
        version: "ClamAV test",
        scannedAt: Date.now(),
      })),
    },
    store: {
      allocate: vi.fn(async () => "drive-random"),
      put: vi.fn(async () => {}),
      get: vi.fn(async () => new Uint8Array()),
      remove: vi.fn(async () => {}),
    },
  }
})
afterEach(() => repository.close())
test("real plain PDF validation, two scans, recompression and metadata finalize in order", async () => {
  const events: string[] = []
  deps.scanner.scan = vi.fn(async () => {
    events.push("scan")
    return { version: "ClamAV test", scannedAt: Date.now() }
  })
  deps.store.put = vi.fn(async () => {
    events.push("store")
  })
  const result = await secureUpload(
    principal,
    "payslip.pdf",
    gzipSync(pdf),
    deps
  )
  expect(events).toEqual(["scan", "scan", "store"])
  const calls = vi.mocked(deps.scanner.scan).mock.calls
  expect(calls[0][0]).toEqual(Buffer.from(pdf))
  expect(gunzipSync(calls[1][0])).toEqual(Buffer.from(pdf))
  expect(result.status).toBe("ready")
  expect(result.driveId).toBe("drive-random")
  expect(result.scannerVersion).toBe("ClamAV test")
  expect(result.sha256).toHaveLength(64)
})
test("real JPEG and PNG re-encoding strips metadata and produces valid output", async () => {
  for (const format of ["jpeg", "png"] as const) {
    const original = await sharp({
      create: { width: 40, height: 30, channels: 3, background: "#ff0000" },
    })
      .withMetadata({ density: 144 })
      .toFormat(format)
      .toBuffer()
    const output = await normalizeUpload(original, format)
    const metadata = await sharp(output).metadata()
    expect(metadata.format).toBe(format)
    expect(metadata.width).toBe(40)
    expect(metadata.exif).toBeUndefined()
    expect(metadata.icc).toBeUndefined()
  }
})
test("rejects malformed PDF and images even when an antivirus stub reports clean", async () => {
  for (const [name, bytes] of [
    ["bad.pdf", Buffer.from("%PDF-invalid")],
    ["bad.png", Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2])],
  ] as const)
    await expect(
      secureUpload(principal, name, gzipSync(bytes), deps)
    ).rejects.toBeInstanceOf(FileError)
  expect(deps.store.put).not.toHaveBeenCalled()
})
test("rejects active PDF before storage", async () => {
  const active = Buffer.concat([
    Buffer.from(pdf),
    Buffer.from("\n/Java#53cript (payload)"),
  ])
  await expect(
    secureUpload(principal, "active.pdf", gzipSync(active), deps)
  ).rejects.toThrow("Active")
  expect(deps.store.allocate).not.toHaveBeenCalled()
})
test("antivirus detection rejects before PDF/image parser or Drive is called", async () => {
  deps.normalize = vi.fn()
  deps.scanner.scan = vi.fn(async () => {
    throw new FileError("File rejected by antivirus.", 422)
  })
  await expect(
    secureUpload(principal, "test.pdf", gzipSync(pdf), deps)
  ).rejects.toMatchObject({ status: 422 })
  expect(deps.normalize).not.toHaveBeenCalled()
  expect(deps.store.allocate).not.toHaveBeenCalled()
  expect(repository.list(principal).files[0].status).toBe("rejected")
})
test("scanner outage fails closed and cannot be bypassed by a client scan claim", async () => {
  deps.scanner.scan = async () => {
    throw new FileError("Antivirus unavailable", 503)
  }
  await expect(
    secureUpload(principal, "test.pdf", gzipSync(pdf), deps)
  ).rejects.toMatchObject({ status: 503 })
  expect(deps.store.put).not.toHaveBeenCalled()
  expect(repository.list(principal).files[0].status).toBe("failed")
})
test("final compressed output must also pass a scan", async () => {
  vi.mocked(deps.scanner.scan)
    .mockResolvedValueOnce({ version: "test", scannedAt: 1 })
    .mockRejectedValueOnce(new FileError("Final scan rejected", 422))
  await expect(
    secureUpload(principal, "test.pdf", gzipSync(pdf), deps)
  ).rejects.toThrow("Final scan")
  expect(deps.store.allocate).not.toHaveBeenCalled()
})
test("bounded decompression rejects a gzip bomb before scanning", async () => {
  await expect(
    secureUpload(
      principal,
      "bomb.pdf",
      gzipSync(Buffer.alloc(MAX_ORIGINAL_BYTES + 1)),
      deps
    )
  ).rejects.toMatchObject({ status: 413 })
  expect(deps.scanner.scan).not.toHaveBeenCalled()
})
test("rejects uncompressed payloads and spoofed extensions", async () => {
  await expect(secureUpload(principal, "test.pdf", pdf, deps)).rejects.toThrow(
    "decompress"
  )
  await expect(
    secureUpload(principal, "test.png", gzipSync(pdf), deps)
  ).rejects.toThrow("does not match")
})
test("blocks risky extensions, path names and control characters", () => {
  for (const name of [
    "file.svg",
    "file.html",
    "file.zip",
    "../file.pdf",
    "bad\n.pdf",
    "bad\u202e.pdf",
  ])
    expect(() => validateFilename(name)).toThrow()
})
test("ambiguous Drive failure cleans up the preallocated ID and withholds download readiness", async () => {
  deps.store.put = async () => {
    throw new Error("private Google credential details")
  }
  await expect(
    secureUpload(principal, "test.pdf", gzipSync(pdf), deps)
  ).rejects.toThrow("could not be stored")
  expect(deps.store.remove).toHaveBeenCalledWith("drive-random")
  expect(repository.list(principal).files[0].status).toBe("failed")
})
test("keyset pages are scoped by account and do not load the entire table", () => {
  for (let i = 0; i < 30; i++)
    repository.reserve({
      id: `file-${String(i).padStart(2, "0")}`,
      ownerId: principal.userId,
      ownerName: "A",
      name: "file.pdf",
      createdAt: i,
    })
  repository.reserve({
    id: "other",
    ownerId: "user-b",
    ownerName: "B",
    name: "other.pdf",
    createdAt: 40,
  })
  const page = repository.list(principal)
  expect(page.files).toHaveLength(25)
  expect(page.next).toBeTruthy()
  const next = repository.list(principal, page.next!)
  expect(next.files).toHaveLength(5)
  expect(next.next).toBeNull()
  expect(repository.list({ userId: "hr", role: "hr" }).files[0].id).toBe(
    "other"
  )
  expect(() =>
    repository.access({ userId: "user-b", role: "employee" }, "file-00")
  ).toThrow("not found")
})
test("durable upload limits are account-bound", () => {
  for (let i = 0; i < 10; i++) repository.consume(principal, 0)
  expect(() => repository.consume(principal, 0)).toThrow("limit")
  expect(() =>
    repository.consume({ ...principal, userId: "other" }, 0)
  ).not.toThrow()
  expect(() => repository.consume(principal, 3600000)).not.toThrow()
})

test("AI review runs only after both scans and code validation; unavailable review remains visible", async () => {
  const events: string[] = []
  deps.scanner.scan = vi.fn(async () => { events.push("scan"); return { version: "test", scannedAt: Date.now() } })
  deps.normalize = async (bytes) => { events.push("normalize"); return bytes }
  deps.validate = async () => { events.push("validate") }
  deps.review = vi.fn(async () => { events.push("review"); return { status: "unavailable" as const, summary: "Local AI is unavailable; review manually.", checks: [] } })
  deps.store.put = vi.fn(async () => { events.push("store") })
  const file = await secureUpload(principal, "sample.pdf", gzipSync(pdf), deps)
  expect(events).toEqual(["scan", "normalize", "validate", "scan", "review", "store"])
  expect(file.status).toBe("ready")
  expect(repository.review(principal, file.id)?.status).toBe("unavailable")
  expect(() => repository.review({ role: "employee", userId: "other" }, file.id)).toThrow("not found")
})
test("malware in either scan never reaches AI review or Drive", async () => {
  for (const rejectedScan of [1, 2]) {
    let call = 0
    deps.scanner.scan = vi.fn(async () => {
      if (++call === rejectedScan) throw new FileError("Malware detected.", 422)
      return { version: "test", scannedAt: Date.now() }
    })
    deps.review = vi.fn(async () => ({ status: "reviewed" as const, summary: "unused", checks: [] }))
    await expect(secureUpload(principal, "sample.pdf", gzipSync(pdf), deps)).rejects.toMatchObject({ status: 422 })
    expect(deps.review).not.toHaveBeenCalled()
    expect(deps.store.put).not.toHaveBeenCalled()
  }
})
