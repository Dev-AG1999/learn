import { randomUUID } from "node:crypto"
import { gzip, gunzip } from "node:zlib"
import { promisify } from "node:util"
import type { Principal } from "../auth/repository.ts"
import type { FileRepository } from "./repository.ts"
import {
  FileError,
  MAX_COMPRESSED_BYTES,
  MAX_ORIGINAL_BYTES,
  type FileScanner,
  type FileStore,
  type FileKind,
  type StoredFile,
} from "./types.ts"
import { fingerprint } from "./crypto.ts"
import { normalizeUpload } from "./normalize.ts"
const compress = promisify(gzip),
  decompress = promisify(gunzip)
export function validateFilename(input: string): {
  name: string
  kind: FileKind
} {
  const name = input.normalize("NFC")
  if (
    name.length > 140 ||
    !/^[\p{L}\p{N}][\p{L}\p{N} ._()-]*\.(pdf|png|jpe?g|csv|xlsx)$/iu.test(name)
  )
    throw new FileError(
      "Choose a supported file with a simple filename up to 140 characters."
    )
  return {
    name,
    kind: /\.pdf$/i.test(name)
      ? "pdf"
      : /\.png$/i.test(name)
        ? "png"
        : /\.csv$/i.test(name)
          ? "csv"
          : /\.xlsx$/i.test(name)
            ? "xlsx"
            : "jpeg",
  }
}
export function matchesSignature(bytes: Uint8Array, kind: FileKind): boolean {
  if (kind === "csv") {
    try {
      return !new TextDecoder("utf-8", { fatal: true })
        .decode(bytes)
        .includes("\0")
    } catch {
      return false
    }
  }
  if (kind === "xlsx")
    return (
      bytes[0] === 80 && bytes[1] === 75 && bytes[2] === 3 && bytes[3] === 4
    )
  if (kind === "pdf")
    return Buffer.from(bytes.subarray(0, 5)).toString() === "%PDF-"
  if (kind === "png")
    return Buffer.from(bytes.subarray(0, 8)).equals(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    )
  return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
}
export type UploadDependencies = {
  repository: FileRepository
  scanner: FileScanner
  store: FileStore
  normalize?: typeof normalizeUpload
  review?: (
    bytes: Uint8Array,
    kind: FileKind
  ) => Promise<import("../ai/review.ts").UploadReview>
  validate?: (bytes: Uint8Array, kind: FileKind) => Promise<void>
}
export async function secureUpload(
  principal: Principal,
  inputName: string,
  compressed: Uint8Array,
  deps: UploadDependencies
): Promise<StoredFile> {
  const { name, kind } = validateFilename(inputName)
  if (!compressed.length || compressed.length > MAX_COMPRESSED_BYTES)
    throw new FileError("Compressed uploads must be under 9 MB.", 413)
  if (
    (kind === "csv" || kind === "xlsx") &&
    (principal.role !== "hr" || !deps.validate)
  )
    throw new FileError(
      "Salary sheets require the HR import validation workflow.",
      403
    )
  const id = randomUUID()
  deps.repository.reserve({
    id,
    ownerId: principal.userId,
    ownerName: principal.username,
    name,
    createdAt: Date.now(),
  })
  let driveId: string | undefined
  try {
    let raw: Buffer
    try {
      raw = await decompress(compressed, {
        maxOutputLength:
          kind === "csv" || kind === "xlsx"
            ? 2 * 1024 * 1024
            : MAX_ORIGINAL_BYTES,
      })
    } catch {
      throw new FileError(
        "Cannot decompress the file within the 8 MB limit.",
        413
      )
    }
    if (!raw.length || !matchesSignature(raw, kind))
      throw new FileError(
        "File content does not match its PDF/JPEG/PNG extension."
      )
    await deps.scanner.scan(raw)
    const normalized =
      kind === "csv" || kind === "xlsx"
        ? raw
        : await (deps.normalize ?? normalizeUpload)(raw, kind)
    if (
      !normalized.length ||
      normalized.length > MAX_ORIGINAL_BYTES ||
      !matchesSignature(normalized, kind)
    )
      throw new FileError("Processed file is invalid.")
    await deps.validate?.(normalized, kind)
    const stored = await compress(normalized, { level: 9 })
    if (stored.length > MAX_COMPRESSED_BYTES)
      throw new FileError("Processed file exceeds the storage limit.", 413)
    const report = await deps.scanner.scan(stored)
    if (deps.review)
      deps.repository.saveReview(id, await deps.review(normalized, kind))
    // No Drive API file write happens until both scans and validation succeed.
    driveId = await deps.store.allocate()
    deps.repository.setDriveId(id, driveId)
    await deps.store.put(driveId, stored)
    const file: StoredFile = {
      id,
      ownerId: principal.userId,
      ownerName: principal.username,
      name,
      createdAt: Date.now(),
      status: "ready",
      driveId,
      kind,
      originalBytes: raw.length,
      storedBytes: stored.length,
      sha256: fingerprint(stored),
      scannedAt: report.scannedAt,
      scannerVersion: report.version,
    }
    deps.repository.ready(file)
    return deps.repository.access(principal, id)
  } catch (error) {
    deps.repository.fail(
      id,
      error instanceof FileError && error.status < 500 ? "rejected" : "failed"
    )
    if (driveId) await deps.store.remove(driveId).catch(() => {})
    if (error instanceof FileError) throw error
    throw new FileError(
      "File could not be stored. Please retry. No payroll was changed.",
      503
    )
  }
}
