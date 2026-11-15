import { requireRequest, authFailure } from "../../../../src/auth/http.ts"
import { withPayroll } from "../../../../src/payroll-db.ts"
import { boundedForm, BodyLimitError } from "../../../../src/import/request.ts"

export async function POST(request: Request) {
  let principal
  try {
    principal = await requireRequest(request, "hr")
  } catch (error) {
    return authFailure(error)
  }
  const headers = { "Cache-Control": "no-store" }
  let draftId = ""
  try {
    const form = await boundedForm(request, 4096)
    draftId = String(form.get("draftId") ?? "")
    if (!/^[a-f0-9-]{36}$/.test(draftId))
      return new Response("Invalid review reference.", { status: 400, headers })
    const result = await withPayroll((db) =>
      db.commitPayrollDraft(
        draftId,
        principal.userId,
        form.get("confirmed") === "yes"
      )
    )
    const params = new URLSearchParams()
    if (!result.ok) params.set("failure", result.message)
    return new Response(null, {
      status: 303,
      headers: {
        ...headers,
        Location: `/hr/import/review/${draftId}${params.size ? `?${params}` : ""}`,
      },
    })
  } catch (error) {
    if (error instanceof BodyLimitError)
      return new Response(error.message, { status: error.status, headers })
    return new Response(
      "Payroll could not be saved. No partial import was committed. Return to the review and try again.",
      { status: 500, headers }
    )
  }
}
