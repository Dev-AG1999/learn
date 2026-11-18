import { AttachmentDownload } from "./attachment-download.tsx"
import type { Principal } from "../../src/auth/repository.ts"
import { withFiles } from "../../src/files/repository.ts"
import { signedFileUrl } from "../../src/files/signing.ts"
export async function loadAttachmentLinks(
  principal: Principal,
  context: "claim" | "document" | "import",
  contextId?: string
) {
  const files = await withFiles((db) =>
    db.linked(principal, context, contextId)
  )
  return files.map((file) => ({
    id: file.id,
    name: file.name,
    url: signedFileUrl(file.id, principal.userId),
    userId: principal.userId,
  }))
}
export function AttachmentLinks({
  files,
}: {
  files: readonly { id: string; name: string; url: string; userId: string }[]
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
        </li>
      ))}
    </ul>
  )
}
