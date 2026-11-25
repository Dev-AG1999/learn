import { saveClaim } from "../../../../src/files/jobs/claim.ts"
import { maybeQueueUpload } from "../../../../src/files/jobs/http.ts"
import { requireRequest, authFailure } from "../../../../src/auth/http.ts"
export async function POST(request: Request, context: { params: Promise<{ employeeId: string }> }) {
  const { employeeId } = await context.params
  try {
    const principal = await requireRequest(request, "employee", employeeId)
    const queued = await maybeQueueUpload(request, principal, "claim")
    return queued ?? saveClaim(request, principal, employeeId)
  } catch (error) {
    return authFailure(error)
  }
}
