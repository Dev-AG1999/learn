export type UploadKind = "claim" | "policy" | "chat" | "import" | "pdf"

export type UploadJobStatus =
  | { state: "queued" | "processing" }
  | { state: "finished"; status: number; result: unknown }
  | { state: "interrupted"; error: string }

export const UPLOAD_POLL_MS = 2000
