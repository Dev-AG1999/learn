import { AttachmentDownload } from "./attachment-download.tsx"
import type { Principal } from "../../src/auth/repository.ts"
import { withFiles } from "../../src/files/repository.ts"
import { signedFileUrl } from "../../src/files/signing.ts"
export async function loadAttachmentLinks(
  principal: Principal,
  context: "claim" | "document" | "import",
  contextId?: string
) {
  return withFiles((db) =>
    db.linked(principal, context, contextId).map((file) => ({
      review: db.review(principal, file.id),
      id: file.id,
      name: file.name,
      url: signedFileUrl(file.id, principal.userId),
      userId: principal.userId,
    }))
  )
}
export function AttachmentLinks({
  files,
}: {
  files: readonly {
    id: string
    name: string
    url: string
    userId: string
    review?: import("../../src/ai/review.ts").UploadReview | null
  }[]
}) {
  if (!files.length) return null
  return (
    <ul className="attachment-links">
      {files.map((file) => (
        <li key={file.url}>
          <AttachmentDownload
            id={file.id}
            url={file.url}
            name={file.name}
            userId={file.userId}
          />
          <span className="field-help">
            {" "}
            · scans passed · link expires in 5 minutes
          </span>
          {file.review && (
            <details className="field-help">
              <summary>
                AI review · {file.review.status.replaceAll("-", " ")}
              </summary>
              <p>{file.review.summary}</p>
              {file.review.checks.map((check, index) => (
                <p key={index}>
                  <strong>{check.field}:</strong> {check.detail}
                </p>
              ))}
            </details>
          )}
        </li>
      ))}
    </ul>
  )
}
