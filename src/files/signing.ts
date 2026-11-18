import { createHmac, timingSafeEqual } from "node:crypto"
import { storageKey } from "./crypto.ts"
import { FileError } from "./types.ts"
const signature = (id: string, userId: string, expires: number) =>
  createHmac("sha256", storageKey())
    .update(JSON.stringify(["paydesk:file-download:v1", id, userId, expires]))
    .digest("base64url")
export function signedFileUrl(
  id: string,
  userId: string,
  now = Date.now()
): string {
  const expires = Math.floor(now / 1000) + 300
  return `/api/files/${encodeURIComponent(id)}/download?expires=${expires}&signature=${signature(id, userId, expires)}`
}
export function verifyFileUrl(
  url: URL,
  id: string,
  userId: string,
  now = Date.now()
): void {
  const raw = url.searchParams.get("expires") ?? "",
    given = url.searchParams.get("signature") ?? ""
  const expires = Number(raw),
    seconds = Math.floor(now / 1000)
  if (
    !/^\d{10,12}$/.test(raw) ||
    !Number.isSafeInteger(expires) ||
    expires <= seconds ||
    expires > seconds + 300 ||
    !/^[\w-]{43}$/.test(given)
  )
    throw new FileError(
      "Download link expired or invalid. Reload the page to get a fresh link.",
      403
    )
  const expected = signature(id, userId, expires)
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(given)))
    throw new FileError("Download link expired or invalid.", 403)
}
