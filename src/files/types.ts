import type { Principal } from "../auth/repository.ts"
export const MAX_ORIGINAL_BYTES = 8 * 1024 * 1024
export const MAX_COMPRESSED_BYTES = 9 * 1024 * 1024
export type FileScope = Pick<Principal, "userId" | "role">
export type FileKind = "pdf" | "jpeg" | "png" | "csv" | "xlsx"
export class FileError extends Error {
  readonly status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}
export type StoredFile = {
  id: string
  ownerId: string
  ownerName: string
  name: string
  createdAt: number
  status: "processing" | "ready" | "rejected" | "failed"
  driveId: string | null
  kind: FileKind | null
  originalBytes: number | null
  storedBytes: number | null
  sha256: string | null
  scannedAt: number | null
  scannerVersion: string | null
}
export interface FileScanner {
  scan(bytes: Uint8Array): Promise<{ version: string; scannedAt: number }>
}
export interface FileStore {
  allocate(): Promise<string>
  put(id: string, bytes: Uint8Array): Promise<void>
  get(id: string): Promise<Uint8Array>
  remove(id: string): Promise<void>
}
export type DriveConnection = {
  userId: string
  driveUserId: string
  folderId: string
  refreshToken: string
  accessToken: string
  expiresAt: number
}
