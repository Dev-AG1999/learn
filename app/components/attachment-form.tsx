"use client"
import { useState, useRef, type ReactNode, type FormEvent } from "react"
import { compressFormFiles } from "../../src/files/browser.ts"
import { ensureSession } from "../../src/auth/browser.ts"
export function AttachmentForm({
  action,
  className,
  children,
  userId,
}: {
  action: string
  className?: string
  children: ReactNode
  userId: string
}) {
  const [phase, setPhase] = useState(""),
    [error, setError] = useState("")
  const busy = useRef(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    const form = new FormData(event.currentTarget),
      file = form.get("attachment")
    if (!(file instanceof File) || !file.size) return
    event.preventDefault()
    if (busy.current) return
    busy.current = true
    setError("")
    setPhase("Compressing attachment…")
    try {
      await compressFormFiles(form, ["attachment"])
      const session = await ensureSession()
      if (session.timing.userId !== userId)
        throw new Error("Your account changed. Reload before submitting.")
      setPhase("Scanning and storing attachment…")
      const response = await fetch(action, {
        method: "POST",
        body: form,
        headers: { Accept: "application/json" },
        credentials: "same-origin",
      })
      if (response.status === 401 || response.status === 403)
        throw new Error("Your session is unavailable. Sign in again and retry.")
      const result = await response.json()
      if (!response.ok)
        throw new Error(
          result.error ?? "The attachment could not be submitted."
        )
      if (
        typeof result.redirectUrl !== "string" ||
        !result.redirectUrl.startsWith("/") ||
        result.redirectUrl.startsWith("//")
      )
        throw new Error("The saved result could not be opened.")
      window.location.assign(result.redirectUrl)
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Upload failed. Please retry."
      )
    } finally {
      busy.current = false
      setPhase("")
    }
  }
  return (
    <form
      action={action}
      method="post"
      encType="multipart/form-data"
      className={className}
      onSubmit={submit}
    >
      <fieldset disabled={!!phase} className="attachment-fields">
        {children}
      </fieldset>
      {phase && (
        <p role="status" className="field-help">
          {phase}
        </p>
      )}
      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}
    </form>
  )
}
