import { HEX_32_BYTE_KEY } from "../crypto-patterns.ts"
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto"
import { FileError } from "./types.ts"
export const fingerprint = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex")
export function storageKey(): Buffer {
  if (!HEX_32_BYTE_KEY.test(process.env.DRIVE_TOKEN_SECRET ?? ""))
    throw new FileError(
      "Configure DRIVE_TOKEN_SECRET with a separate random 32-byte hex key.",
      503
    )
  return Buffer.from(process.env.DRIVE_TOKEN_SECRET!, "hex")
}
export function seal(value: string, purpose: string): string {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", storageKey(), iv)
  cipher.setAAD(Buffer.from(`paydesk:${purpose}`))
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ])
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
    "base64url"
  )
}
export function unseal(value: string, purpose: string): string {
  try {
    const data = Buffer.from(value, "base64url")
    const decipher = createDecipheriv(
      "aes-256-gcm",
      storageKey(),
      data.subarray(0, 12)
    )
    decipher.setAAD(Buffer.from(`paydesk:${purpose}`))
    decipher.setAuthTag(data.subarray(12, 28))
    return Buffer.concat([
      decipher.update(data.subarray(28)),
      decipher.final(),
    ]).toString("utf8")
  } catch {
    throw new FileError(
      "Drive credentials could not be opened. Ask HR to reconnect the same Drive account.",
      503
    )
  }
}
