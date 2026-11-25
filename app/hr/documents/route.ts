import { savePolicy } from "../../../src/files/jobs/policy.ts"
import { maybeQueueUpload } from "../../../src/files/jobs/http.ts"
import { requireRequest, authFailure } from "../../../src/auth/http.ts"
export async function POST(request: Request) {
  try {
    const principal = await requireRequest(request, "hr")
    const queued = await maybeQueueUpload(request, principal, "policy")
    return queued ?? savePolicy(request, principal)
  } catch (error) {
    return authFailure(error)
  }
}
