"use client"
import { apiFetch } from "../../src/client/api.ts"
import { useRef, useState, type MouseEvent } from "react"
import { ensureSession } from "../../src/auth/browser.ts"
export function AttachmentDownload({
  id,
  url,
  name,
  userId,
}: {
  id: string
  url: string
  name: string
  userId: string
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false)
  const pending = useRef(false)
  async function download(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault()
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError("")
    try {
      const session = await ensureSession()
      if (session.timing.userId !== userId)
        throw new Error("Your account changed. Reload before downloading.")
      const refreshed = await apiFetch(
        `/api/files/${encodeURIComponent(id)}/link`,
        { credentials: "same-origin", cache: "no-store" }
      )
      if (refreshed.status === 401 || refreshed.status === 403)
        throw new Error("Sign in again, then retry the download.")
      const data = await refreshed.json()
      if (
        !refreshed.ok ||
        typeof data.signedUrl !== "string" ||
        !data.signedUrl.startsWith(
          `/api/files/${encodeURIComponent(id)}/download?`
        )
      )
        throw new Error(data.error ?? "Download is unavailable.")
      const response = await apiFetch(data.signedUrl, {
        credentials: "same-origin",
        cache: "no-store",
      })
      if (!response.ok) {
        const result = await response.json().catch(() => null)
        throw new Error(
          result?.error ??
            "Download unavailable. Reload for a fresh signed link."
        )
      }
      const objectUrl = URL.createObjectURL(await response.blob())
      const anchor = document.createElement("a")
      anchor.href = objectUrl
      anchor.download = `${name}.gz`
      anchor.click()
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Download failed. Please retry."
      )
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return (
    <>
      <a
        className="text-link"
        href={url}
        onClick={download}
        aria-disabled={busy}
      >
        {name}.gz
      </a>
      {error && (
        <span className="field-help" role="alert">
          {error}
        </span>
      )}
    </>
  )
}
