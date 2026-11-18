import { expect, test, afterEach, vi } from "vitest"
import { signedFileUrl, verifyFileUrl } from "../src/files/signing.ts"
afterEach(() => vi.unstubAllEnvs())
test("download signatures are user/file/expiry bound and reject edits and excessive lifetimes", () => {
  vi.stubEnv("DRIVE_TOKEN_SECRET", "ab".repeat(32))
  const now = Date.now(),
    url = new URL(signedFileUrl("file-a", "user-a", now), "http://localhost")
  expect(() => verifyFileUrl(url, "file-a", "user-a", now)).not.toThrow()
  expect(() => verifyFileUrl(url, "file-b", "user-a", now)).toThrow()
  expect(() => verifyFileUrl(url, "file-a", "user-b", now)).toThrow()
  expect(() => verifyFileUrl(url, "file-a", "user-a", now + 301000)).toThrow(
    "expired"
  )
  url.searchParams.set("expires", String(Math.floor(now / 1000) + 3600))
  expect(() => verifyFileUrl(url, "file-a", "user-a", now)).toThrow()
})
