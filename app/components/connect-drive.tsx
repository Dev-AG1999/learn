"use client"

import { useRef, useState } from "react"
import { ensureSession } from "../../src/auth/browser.ts"

export function googleAuthorizationUrl(value: unknown): string {
  if (typeof value !== "string")
    throw new Error("Google authorization could not be started. Please retry.")
  const url = new URL(value)
  if (
    url.origin !== "https://accounts.google.com" ||
    url.pathname !== "/o/oauth2/v2/auth" ||
    url.username ||
    url.password
  )
    throw new Error("Google authorization returned an unexpected destination.")
  return url.href
}

export function ConnectDrive({
  configured,
  connected,
  userId,
}: {
  configured: boolean
  connected: boolean
  userId: string
}) {
  const inFlight = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  async function connect() {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError("")
    let leaving = false
    try {
      const session = await ensureSession()
      if (session.timing.userId !== userId)
        throw new Error(
          "Your account changed. Reload before connecting Google Drive."
        )
      const response = await fetch("/api/storage/drive/connect", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        headers: { Accept: "application/json" },
      })
      if (response.status === 401 || response.status === 403)
        throw new Error(
          "Your HR session is unavailable. Sign in again and retry."
        )
      const result = await response.json()
      if (!response.ok)
        throw new Error(
          result.error ?? "Google Drive could not be connected. Please retry."
        )
      // Normal top-level navigation avoids CSP form-action's cross-origin redirect restriction.
      window.location.assign(googleAuthorizationUrl(result.authorizationUrl))
      leaving = true
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not start Google authorization. Check your connection and retry."
      )
    } finally {
      if (!leaving) {
        inFlight.current = false
        setBusy(false)
      }
    }
  }
  return (
    <>
      <button
        type="button"
        className="button button-secondary button-small"
        data-drive-connect
        onClick={connect}
        disabled={!configured || busy}
      >
        {busy
          ? "Opening Google…"
          : connected
            ? "Reconnect Google Drive"
            : "Connect Google Drive"}
      </button>
      <p className="field-help" aria-live="polite">
        {busy
          ? "Opening Google's permission screen in this tab…"
          : "Google authorization opens in this tab."}
      </p>
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
    </>
  )
}
