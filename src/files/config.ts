import { storageKey } from "./crypto.ts"
import { FileError } from "./types.ts"
export function driveConfigured(): boolean {
  try {
    storageKey()
    return (
      !!process.env.GOOGLE_DRIVE_CLIENT_ID?.trim() &&
      !!process.env.GOOGLE_DRIVE_CLIENT_SECRET?.trim()
    )
  } catch {
    return false
  }
}
export function requireDriveConfig() {
  if (!driveConfigured())
    throw new FileError(
      "HR must configure Google Drive before files can be uploaded.",
      503
    )
}
export function requireUploadsEnabled() {
  requireDriveConfig()
  if (process.env.FILE_UPLOADS_ENABLED !== "true")
    throw new FileError(
      "File uploads are disabled until Drive and antivirus setup is complete.",
      503
    )
}
