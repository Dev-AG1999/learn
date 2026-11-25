import { requireReadPrincipal } from "../../../../src/auth/request.ts"
import { fileFailure } from "../../../../src/files/http.ts"
import { uploadStatus } from "../../../../src/files/jobs/http.ts"

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = await requireReadPrincipal(request)
    const { id } = await context.params
    return uploadStatus(principal, id)
  } catch (error) {
    return fileFailure(error)
  }
}
