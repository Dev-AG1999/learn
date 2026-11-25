"use client"
import { ensureSession } from "../../auth/browser.ts"
import { apiFetch } from "../../client/api.ts"
import { UPLOAD_POLL_MS, type UploadJobStatus } from "./types.ts"

export async function readUploadJob(id: string, signal?: AbortSignal): Promise<UploadJobStatus> {
  const url = `/api/uploads/${id}`
  let response = await apiFetch(url, { signal })
  if (response.status === 401 && !signal?.aborted) {
    await ensureSession()
    response = await apiFetch(url, { signal })
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403)
      throw new Error("Sign in to check this upload.")
    if (response.status === 404)
      throw new Error("Upload job not found or its status has expired.")
    throw new Error("Upload status is temporarily unavailable. Check again shortly.")
  }
  return response.json()
}

export async function submitUpload(
  action: string,
  form: FormData,
  update: (message: string, statusUrl: string) => void,
): Promise<Response> {
  const response = await apiFetch(action, {
    method: "POST",
    headers: { Accept: "application/json", Prefer: "respond-async" },
    body: form,
  })
  if (response.status !== 202) return response
  const { jobId } = await response.json() as { jobId: string }
  if (!/^[a-f0-9-]{36}$/.test(jobId)) throw new Error("Upload status could not be opened.")
  const statusUrl = `/uploads/${jobId}`
  update("Upload queued…", statusUrl)
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, UPLOAD_POLL_MS))
    const job = await readUploadJob(jobId)
    if (job.state === "finished") return Response.json(job.result, { status: job.status })
    if (job.state === "interrupted") throw new Error(job.error)
    if (job.state === "processing") update("Processing upload…", statusUrl)
  }
}
