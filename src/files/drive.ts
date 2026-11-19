import { randomUUID } from "node:crypto"
import { appOrigin } from "../auth/config.ts"
import type { FileRepository } from "./repository.ts"
import {
  FileError,
  MAX_COMPRESSED_BYTES,
  type DriveConnection,
  type FileStore,
} from "./types.ts"
import { boundedBytes } from "./bytes.ts"

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file"
const validId = (value: unknown): value is string =>
  typeof value === "string" && /^[\w-]{1,200}$/.test(value)
export const driveCallbackUrl = () =>
  `${appOrigin()}/api/storage/drive/callback`
export async function googleToken(
  form: URLSearchParams,
  network: typeof fetch = fetch
) {
  form.set("client_id", process.env.GOOGLE_DRIVE_CLIENT_ID!)
  form.set("client_secret", process.env.GOOGLE_DRIVE_CLIENT_SECRET!)
  const response = await network("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: form,
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok)
    throw new FileError(
      "Google authorization expired or failed. Ask HR to reconnect Drive.",
      503
    )
  const data = (await response.json()) as {
    access_token?: unknown
    refresh_token?: unknown
    expires_in?: unknown
    scope?: unknown
  }
  if (
    typeof data.access_token !== "string" ||
    data.access_token.length > 8192 ||
    typeof data.expires_in !== "number" ||
    data.expires_in <= 0 ||
    data.expires_in > 86400
  )
    throw new FileError("Google returned invalid credentials.", 503)
  return {
    accessToken: data.access_token,
    refreshToken:
      typeof data.refresh_token === "string" ? data.refresh_token : undefined,
    expiresAt: Date.now() + data.expires_in * 1000,
    scope: data.scope,
  }
}
export function driveApi(accessToken: string, network: typeof fetch = fetch) {
  async function request(path: string, init: RequestInit = {}) {
    const response = await network(`https://www.googleapis.com${path}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${accessToken}` },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) {
      // Classify only known provider codes; never expose Google's raw message,
      // which may include file IDs, account details or request information.
      let reasons: string[] = []
      try {
        const bytes = await boundedBytes(response.body, 8192)
        const body: unknown = JSON.parse(new TextDecoder().decode(bytes))
        const errors = (body as { error?: { errors?: unknown } } | null)?.error?.errors
        if (Array.isArray(errors))
          reasons = errors.flatMap((entry: unknown) => {
            const reason = (entry as { reason?: unknown } | null)?.reason
            return typeof reason === "string" ? [reason] : []
          })
      } catch {
        // Non-JSON and oversized provider errors retain the safe fallback.
      }
      if (response.status === 403 && reasons.includes("storageQuotaExceeded"))
        throw new FileError(
          "The connected Google account has reached its storage limit. HR must free Google storage, including trash, then retry this upload. Reconnecting Drive will not free storage.",
          507
        )
      if (response.status === 401)
        throw new FileError(
          "Google Drive authorization is no longer valid. Ask HR to reconnect the same Google account, then retry.",
          503
        )
      if (response.status === 429 || reasons.some((reason) =>
        reason === "rateLimitExceeded" || reason === "userRateLimitExceeded"
      ))
        throw new FileError("Google Drive is receiving too many requests. Wait a moment, then retry.", 429)
      throw new FileError(
        "Google Drive request failed. Check the connection and available storage.",
        503
      )
    }
    return response
  }
  async function privateFile(id: string, folderId?: string) {
    if (!validId(id))
      throw new FileError("Invalid private file reference.", 503)
    const metadata = (await (
      await request(
        `/drive/v3/files/${id}?fields=id,mimeType,trashed,ownedByMe,parents,size`
      )
    ).json()) as {
      mimeType?: string
      trashed?: boolean
      ownedByMe?: boolean
      parents?: string[]
      size?: string
    }
    if (
      metadata.trashed ||
      !metadata.ownedByMe ||
      metadata.mimeType !==
        (folderId
          ? "application/gzip"
          : "application/vnd.google-apps.folder") ||
      (folderId &&
        (!metadata.parents?.includes(folderId) ||
          Number(metadata.size) > MAX_COMPRESSED_BYTES))
    )
      throw new FileError(
        "Private Drive file is missing, moved or invalid.",
        503
      )
    const access = (await (
      await request(
        `/drive/v3/files/${id}/permissions?fields=nextPageToken,permissions(type,role)&pageSize=100`
      )
    ).json()) as {
      permissions?: { type: string; role: string }[]
      nextPageToken?: string
    }
    if (
      access.nextPageToken ||
      !access.permissions?.length ||
      access.permissions.some(
        (permission) =>
          permission.type !== "user" || permission.role !== "owner"
      )
    )
      throw new FileError(
        "Drive folder and files must remain private to their owner. Remove sharing before retrying.",
        503
      )
  }
  async function allocate() {
    const data = (await (
      await request(
        "/drive/v3/files/generateIds?count=1&space=drive&type=files"
      )
    ).json()) as { ids?: unknown[] }
    if (!validId(data.ids?.[0]))
      throw new FileError(
        "Google Drive returned an invalid file reference.",
        503
      )
    return data.ids[0]
  }
  return { request, privateFile, allocate }
}
export async function finishDriveAuthorization(
  repository: FileRepository,
  userId: string,
  code: string,
  verifier: string,
  network: typeof fetch = fetch
) {
  const credentials = await googleToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: driveCallbackUrl(),
    }),
    network
  )
  if (
    !credentials.refreshToken ||
    typeof credentials.scope !== "string" ||
    !credentials.scope.split(" ").includes(DRIVE_SCOPE)
  )
    throw new FileError(
      "Google did not grant offline file access. Retry the Drive connection.",
      503
    )
  const api = driveApi(credentials.accessToken, network)
  const about = (await (
    await api.request("/drive/v3/about?fields=user(permissionId)")
  ).json()) as { user?: { permissionId?: unknown } }
  if (!validId(about.user?.permissionId))
    throw new FileError("Google account could not be verified.", 503)
  const existing = repository.connectionIdentity()
  if (existing && existing.driveUserId !== about.user.permissionId)
    throw new FileError(
      "Reconnect the original Google account to preserve access to stored files.",
      409
    )
  let folderId = existing?.folderId
  let created = false
  try {
    if (!folderId) {
      folderId = await api.allocate()
      await api.request("/drive/v3/files?fields=id", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: folderId,
          name: "Paydesk private uploads",
          mimeType: "application/vnd.google-apps.folder",
        }),
      })
      created = true
    }
    await api.privateFile(folderId)
    repository.saveConnection({
      userId,
      driveUserId: about.user.permissionId,
      folderId,
      refreshToken: credentials.refreshToken,
      accessToken: credentials.accessToken,
      expiresAt: credentials.expiresAt,
    })
  } catch (error) {
    if (created && folderId)
      await api
        .request(`/drive/v3/files/${folderId}`, { method: "DELETE" })
        .catch(() => {})
    throw error
  }
}
export function googleDriveStore(
  repository: FileRepository,
  network: typeof fetch = fetch
): FileStore {
  async function connection(): Promise<{
    details: DriveConnection
    api: ReturnType<typeof driveApi>
  }> {
    let details = repository.connection()
    if (!details)
      throw new FileError("HR must connect Google Drive before uploading.", 503)
    if (details.expiresAt < Date.now() + 60_000) {
      const renewed = await googleToken(
        new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: details.refreshToken,
        }),
        network
      )
      details = {
        ...details,
        accessToken: renewed.accessToken,
        expiresAt: renewed.expiresAt,
        refreshToken: renewed.refreshToken ?? details.refreshToken,
      }
      repository.saveConnection(details)
    }
    const api = driveApi(details.accessToken, network)
    await api.privateFile(details.folderId)
    return { details, api }
  }
  return {
    async allocate() {
      return (await connection()).api.allocate()
    },
    async put(id, bytes) {
      if (!validId(id) || bytes.length > MAX_COMPRESSED_BYTES)
        throw new FileError("Invalid storage upload.")
      const { details, api } = await connection()
      const boundary = `paydesk_${randomUUID()}`
      const metadata = {
        id,
        name: `${id}.gz`,
        mimeType: "application/gzip",
        parents: [details.folderId],
      }
      const body = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/gzip\r\n\r\n`
        ),
        Buffer.from(bytes),
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ])
      const result = (await (
        await api.request(
          "/upload/drive/v3/files?uploadType=multipart&fields=id",
          {
            method: "POST",
            headers: {
              "Content-Type": `multipart/related; boundary=${boundary}`,
            },
            body,
          }
        )
      ).json()) as { id?: string }
      if (result.id !== id)
        throw new FileError(
          "Drive upload reference could not be verified.",
          503
        )
      await api.privateFile(id, details.folderId)
    },
    async get(id) {
      const { details, api } = await connection()
      await api.privateFile(id, details.folderId)
      const response = await api.request(`/drive/v3/files/${id}?alt=media`)
      return boundedBytes(response.body, MAX_COMPRESSED_BYTES)
    },
    async remove(id) {
      if (!validId(id)) throw new FileError("Invalid file reference.", 503)
      const { api } = await connection()
      await api.request(`/drive/v3/files/${id}`, { method: "DELETE" })
    },
  }
}
