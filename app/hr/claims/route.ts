import { requireRequest, authFailure } from "../../../src/auth/http.ts"
import { hrAccess } from "../../../src/access/roles.ts"
import { withPayroll } from "../../../src/payroll-db.ts"
import { readPeriod } from "../../../src/period.ts"

export async function POST(request: Request) {
  try { await requireRequest(request, "hr") } catch (error) { return authFailure(error) }
  const form = await request.formData()
  const period = readPeriod(String(form.get("year") ?? ""), String(form.get("month") ?? ""))
  const back = new URL("/hr", request.url)
  if (period) {
    back.searchParams.set("year", String(period.year))
    back.searchParams.set("month", String(period.month))
  }
  const result = await withPayroll((db) =>
    hrAccess(db).approveClaim({
      claimId: String(form.get("claimId") ?? ""),
      confirmed: form.get("confirmed") === "yes",
    }),
  )
  if (!result.ok) back.searchParams.set("failure", result.failures[0] ?? "commit only after confirmation")
  return new Response(null, { status: 303, headers: { Location: back.toString() } })
}
