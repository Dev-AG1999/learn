import { setTimeout as pause } from "node:timers/promises"
import { appOrigin } from "../../auth/config.ts"
import { withAuth } from "../../auth/repository.ts"
import { processPdfUpload } from "../../document-ai/http.ts"
import { saveChatAttachment } from "./chat.ts"
import { saveClaim } from "./claim.ts"
import { savePolicy } from "./policy.ts"
import { importPreview } from "./preview.ts"
import { withUploadJobs } from "./repository.ts"

export async function runUploadWorker(signal: AbortSignal) {
  const origin = appOrigin()
  while (!signal.aborted) {
    const job = withUploadJobs((jobs) => jobs.claim())
    if (!job) {
      await pause(1000, undefined, { signal }).catch((error) => {
        if (!signal.aborted) throw error
      })
      continue
    }

    const heartbeat = setInterval(() => {
      try {
        withUploadJobs((jobs) => jobs.renew(job.id))
      } catch {
        console.error("Could not renew upload worker lease.")
      }
    }, 10_000)
    try {
      const principal = await withAuth((auth) => auth.findUser(job.username))
      if (!principal || principal.disabled || principal.userId !== job.ownerId ||
          principal.role !== job.role || principal.employeeId !== job.employeeId ||
          ((job.kind === "policy" || job.kind === "import") && principal.role !== "hr") ||
          (job.kind === "claim" && (principal.role !== "employee" || !principal.employeeId))) {
        withUploadJobs((jobs) => jobs.finish(job.id, 403, { error: "Upload access is no longer available." }))
        continue
      }
      const request = new Request(origin, {
        method: "POST",
        headers: { "Content-Type": job.contentType, Accept: "application/json" },
        body: Buffer.from(job.payload),
      })
      const handlers = {
        claim: () => saveClaim(request, principal, principal.employeeId!),
        policy: () => savePolicy(request, principal),
        chat: () => saveChatAttachment(request, principal),
        import: () => importPreview(request, principal),
        pdf: () => processPdfUpload(request, principal),
      }
      const response = await handlers[job.kind]()
      const result: unknown = await response.json()
      // Download links expire independently of the job.
      if (result && typeof result === "object" && "signedUrl" in result)
        delete result.signedUrl
      withUploadJobs((jobs) => jobs.finish(job.id, response.status, result))

    } catch {
      // A failure here may follow a successful write. Leave the job leased so
      // status can report the interruption without replaying the operation.
      console.error("Upload worker could not record the job outcome.")
    } finally {
      clearInterval(heartbeat)
    }
  }
}
