import { runUploadWorker } from "../src/files/jobs/worker.ts"

if (process.env.UPLOAD_QUEUE_ENABLED !== "true")
  throw new Error("Set UPLOAD_QUEUE_ENABLED=true before starting the upload worker.")

const shutdown = new AbortController()
process.once("SIGINT", () => shutdown.abort())
process.once("SIGTERM", () => shutdown.abort())
await runUploadWorker(shutdown.signal)
