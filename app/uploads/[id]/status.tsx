"use client"
import { useEffect, useState } from "react"
import { readUploadJob } from "../../../src/files/jobs/browser.ts"
import { UPLOAD_POLL_MS, type UploadJobStatus } from "../../../src/files/jobs/types.ts"

type Result = {
  error?: string
  redirectUrl?: string
  reviewUrl?: string
  failures?: { row: number; message: string }[]
}

export function UploadStatus({ id }: { id: string }) {
  const [job, setJob] = useState<UploadJobStatus>()
  const [error, setError] = useState("")
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      try {
        const result = await readUploadJob(id, controller.signal)
        if (controller.signal.aborted) return
        setJob(result)
        if (result.state === "queued" || result.state === "processing")
          timer = setTimeout(poll, UPLOAD_POLL_MS)
      } catch (error) {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : "Upload status is unavailable.")
      }
    }
    void poll()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [id])

  if (error) return <p role="alert">{error} <a href="/login">Sign in</a></p>
  if (!job) return <p role="status">Loading upload status…</p>
  if (job.state === "queued") return <p role="status">Queued for processing.</p>
  if (job.state === "processing") return <p role="status">Processing upload…</p>
  if (job.state === "interrupted") return <p role="alert">{job.error}</p>
  if (job.state !== "finished") return null

  const result = job.result as Result
  if (job.status >= 400) return <>
    <p role="alert">{result.error ?? "The upload could not be completed."}</p>
    {result.failures?.length ? <ul>{result.failures.map(({ row, message }, index) =>
      <li key={index}>{row > 0 ? `Row ${row}: ` : ""}{message}</li>
    )}</ul> : null}
  </>
  const next = result.reviewUrl ?? result.redirectUrl
  return <p role="status">Upload processed.{" "}
    {next?.startsWith("/") && !next.startsWith("//") && <a href={next}>Continue</a>}
    {!next && "You can find the attachment in your workspace."}
  </p>
}
