import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { DatabaseSync } from "node:sqlite"
import {
  openFileRepository,
  type FileRepository,
} from "../src/files/repository.ts"
import {
  googleDriveStore,
  finishDriveAuthorization,
  DRIVE_SCOPE,
  driveApi,
} from "../src/files/drive.ts"
import { seal, unseal } from "../src/files/crypto.ts"
let dir: string, repository: FileRepository, path: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "drive-storage-"))
  path = join(dir, "db.sqlite")
  repository = openFileRepository(path)
  vi.stubEnv("DRIVE_TOKEN_SECRET", "ab".repeat(32))
  vi.stubEnv("GOOGLE_DRIVE_CLIENT_ID", "client-id")
  vi.stubEnv("GOOGLE_DRIVE_CLIENT_SECRET", "client-secret")
  vi.stubEnv("APP_ORIGIN", "http://localhost:3000")
})
afterEach(() => {
  repository.close()
  rmSync(dir, { recursive: true, force: true })
  vi.unstubAllEnvs()
})
const connection = () => ({
  userId: "hr-user",
  driveUserId: "google-user",
  folderId: "private-folder",
  accessToken: "private-access-token",
  refreshToken: "private-refresh-token",
  expiresAt: Date.now() + 3600000,
})
function googleMock(
  options: { shared?: boolean; account?: string; failUpload?: boolean } = {}
) {
  const requests: { url: string; init: RequestInit }[] = [],
    data = new Map<string, Uint8Array>()
  const network: typeof fetch = async (input, init = {}) => {
    const url = String(input)
    requests.push({ url, init })
    if (url === "https://oauth2.googleapis.com/token")
      return Response.json({
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_in: 3600,
        scope: DRIVE_SCOPE,
      })
    if (url.includes("/about?"))
      return Response.json({
        user: { permissionId: options.account ?? "google-user" },
      })
    if (url.includes("/generateIds?"))
      return Response.json({ ids: ["allocated-file"] })
    if (url.includes("/permissions?"))
      return Response.json({
        permissions: options.shared
          ? [{ type: "anyone", role: "reader" }]
          : [{ type: "user", role: "owner" }],
      })
    if (url.includes("/upload/"))
      return options.failUpload
        ? new Response("private provider error", { status: 500 })
        : Response.json({ id: "allocated-file" })
    if (init.method === "DELETE") return new Response(null, { status: 204 })
    if (url.includes("alt=media"))
      return new Response(new Uint8Array([1, 2, 3]))
    if (url.includes("fields=id,mimeType"))
      return Response.json({
        ownedByMe: true,
        trashed: false,
        mimeType: url.includes("private-folder")
          ? "application/vnd.google-apps.folder"
          : "application/gzip",
        parents: ["private-folder"],
        size: "3",
      })
    if (init.method === "POST") return Response.json({ id: "allocated-file" })
    throw new Error(`Unexpected synthetic endpoint ${url}`)
  }
  return { network, requests, data }
}
test("connection and PKCE credentials are encrypted at rest and bound to their purpose", () => {
  repository.saveConnection(connection())
  repository.saveState("hash", "hr-user", "private-verifier")
  const raw = new DatabaseSync(path)
  const secret = (
    raw.prepare("SELECT secret FROM drive_connection").get() as {
      secret: string
    }
  ).secret
  const verifier = (
    raw.prepare("SELECT verifier FROM drive_oauth_states").get() as {
      verifier: string
    }
  ).verifier
  raw.close()
  expect(secret).not.toContain("private-access")
  expect(secret).not.toContain("private-refresh")
  expect(verifier).not.toContain("private-verifier")
  expect(repository.connection()!.refreshToken).toBe("private-refresh-token")
  expect(() => unseal(seal("token", "one"), "another")).toThrow(
    "could not be opened"
  )
})
test("OAuth state is user-bound, expires and can be used only once", () => {
  repository.saveState("hash", "hr-user", "verifier", 1000)
  expect(repository.consumeState("hash", "other-user", 1001)).toBeNull()
  expect(repository.consumeState("hash", "hr-user", 1001)).toBe("verifier")
  expect(repository.consumeState("hash", "hr-user", 1002)).toBeNull()
  repository.saveState("expired", "hr-user", "verifier", 0)
  expect(repository.consumeState("expired", "hr-user", 700000)).toBeNull()
})
test("refreshes expired access without exposing refresh credentials to Drive file requests", async () => {
  repository.saveConnection({ ...connection(), expiresAt: 0 })
  const mock = googleMock()
  expect(await googleDriveStore(repository, mock.network).allocate()).toBe(
    "allocated-file"
  )
  const refresh = mock.requests.find((item) => item.url.includes("oauth2"))!
  expect(String(refresh.init.body)).toContain(
    "refresh_token=private-refresh-token"
  )
  expect(repository.connection()!.accessToken).toBe("new-access")
  expect(
    mock.requests
      .filter((item) => item.url.includes("www.googleapis.com"))
      .every(
        (item) =>
          JSON.stringify(item.init).includes("private-refresh-token") === false
      )
  ).toBe(true)
})
test("private folder checks reject shared folders before uploading", async () => {
  repository.saveConnection(connection())
  const mock = googleMock({ shared: true })
  await expect(
    googleDriveStore(repository, mock.network).put(
      "allocated-file",
      new Uint8Array([1])
    )
  ).rejects.toThrow("remain private")
  expect(mock.requests.some((item) => item.url.includes("/upload/"))).toBe(
    false
  )
})
test("multipart upload uses random storage names, no public permission calls and no redirects", async () => {
  repository.saveConnection(connection())
  const mock = googleMock()
  await googleDriveStore(repository, mock.network).put(
    "allocated-file",
    new Uint8Array([1, 2, 3])
  )
  const upload = mock.requests.find((item) => item.url.includes("/upload/"))!
  expect(
    (upload.init.headers as Record<string, string>)["Content-Type"]
  ).toContain("multipart/related")
  expect(Buffer.from(upload.init.body as Uint8Array).toString()).toContain(
    '"name":"allocated-file.gz"'
  )
  expect(mock.requests.every((item) => item.init.redirect === "error")).toBe(
    true
  )
  expect(
    mock.requests.some(
      (item) => item.init.method === "POST" && item.url.includes("permissions")
    )
  ).toBe(false)
})
test("download rechecks folder and file privacy before reading content", async () => {
  repository.saveConnection(connection())
  const mock = googleMock()
  expect(
    await googleDriveStore(repository, mock.network).get("allocated-file")
  ).toEqual(new Uint8Array([1, 2, 3]))
  const media = mock.requests.findIndex((item) =>
    item.url.includes("alt=media")
  )
  expect(
    mock.requests
      .slice(0, media)
      .filter((item) => item.url.includes("/permissions?"))
  ).toHaveLength(2)
})
test("reconnection cannot silently switch the Google account", async () => {
  repository.saveConnection(connection())
  const mock = googleMock({ account: "different-user" })
  await expect(
    finishDriveAuthorization(
      repository,
      "hr-user",
      "code",
      "verifier",
      mock.network
    )
  ).rejects.toMatchObject({ status: 409 })
  expect(repository.connection()!.driveUserId).toBe("google-user")
})
test("same-account reconnection retains folder and can recover after token-key rotation", async () => {
  repository.saveConnection(connection())
  vi.stubEnv("DRIVE_TOKEN_SECRET", "cd".repeat(32))
  const mock = googleMock()
  await finishDriveAuthorization(
    repository,
    "hr-user",
    "code",
    "verifier",
    mock.network
  )
  expect(repository.connection()!.folderId).toBe("private-folder")
  expect(repository.connection()!.refreshToken).toBe("new-refresh")
  const token = mock.requests[0]
  expect(String(token.init.body)).toContain("code_verifier=verifier")
})


test("Drive storage quota failures explain the required action without exposing provider details", async () => {
  const network: typeof fetch = async () => Response.json({ error: {
    message: "private Google account and file information",
    errors: [{ reason: "storageQuotaExceeded" }],
  } }, { status: 403 })
  await expect(driveApi("secret-token", network).request("/upload/drive/v3/files"))
    .rejects.toMatchObject({ status: 507, message: expect.stringContaining("storage limit") })
  try { await driveApi("secret-token", network).request("/upload/drive/v3/files") }
  catch (error) {
    expect(String(error)).not.toContain("private Google")
    expect(String(error)).not.toContain("secret-token")
  }
})

test("Drive errors distinguish reconnect and retry cases, with bounded safe fallbacks", async () => {
  for (const [status, reason, expectedStatus, text] of [
    [401, "authError", 503, "reconnect the same"],
    [403, "userRateLimitExceeded", 429, "Wait a moment"],
    [429, "rateLimitExceeded", 429, "Wait a moment"],
    [500, "backendError", 503, "request failed"],
  ] as const) {
    const network: typeof fetch = async () => Response.json({ error: { errors: [{ reason }] } }, { status })
    await expect(driveApi("token", network).request("/drive/v3/files"))
      .rejects.toMatchObject({ status: expectedStatus, message: expect.stringContaining(text) })
  }
  for (const body of ["not JSON", "x".repeat(9000), JSON.stringify({ error: { errors: [null, 1, {}] } })]) {
    const network: typeof fetch = async () => new Response(body, { status: 403 })
    await expect(driveApi("token", network).request("/drive/v3/files"))
      .rejects.toMatchObject({ status: 503, message: expect.stringContaining("request failed") })
  }
})
