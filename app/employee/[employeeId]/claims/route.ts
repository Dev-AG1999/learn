import { requireRequest, authFailure } from "../../../../src/auth/http.ts"
import { employeeAccess } from "../../../../src/access/roles.ts"
import { withPayroll } from "../../../../src/payroll-db.ts"
import { readPeriod } from "../../../../src/period.ts"

export async function POST(
  request: Request,
  context: { params: Promise<{ employeeId: string }> },
) {
  const { employeeId } = await context.params
  try { await requireRequest(request, "employee", employeeId) } catch (error) { return authFailure(error) }
  const form = await request.formData()
  const period = readPeriod(String(form.get("year") ?? ""), String(form.get("month") ?? ""))
  const back = new URL(`/employee/${employeeId}`, request.url)
  if (!period) {
    back.searchParams.set("failure", "Year and month are required.")
    return new Response(null, { status: 303, headers: { Location: back.toString() } })
  }
  back.searchParams.set("year", String(period.year))
  back.searchParams.set("month", String(period.month))
  const result = await withPayroll((db) =>
    employeeAccess(db, employeeId).submitPendingClaim({
      year: period.year,
      month: period.month,
      claimId: crypto.randomUUID(),
      amountMinor: Number(form.get("amountMinor")),
      receipt: String(form.get("receipt") ?? ""),
      confirmed: form.get("confirmed") === "yes",
    }),
  )
  if (!result.ok) back.searchParams.set("failure", result.failures[0] ?? "receipt")
  return new Response(null, { status: 303, headers: { Location: back.toString() } })
}
