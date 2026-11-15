import { requireRequest, authFailure } from "../../../../src/auth/http.ts"
import { employeeAccess } from "../../../../src/access/roles.ts"
import { payslipPdf } from "../../../../src/payslip-document.ts"
import { withPayroll } from "../../../../src/payroll-db.ts"
import { readPeriod } from "../../../../src/period.ts"

export async function GET(
  request: Request,
  context: { params: Promise<{ employeeId: string }> },
) {
  const { employeeId } = await context.params
  try { await requireRequest(request, "employee", employeeId) } catch (error) { return authFailure(error) }
  const url = new URL(request.url)
  const period = readPeriod(url.searchParams.get("year") ?? undefined, url.searchParams.get("month") ?? undefined)
  if (!period) {
    return new Response("Year and month are required.", { status: 400 })
  }
  const pdf = await withPayroll(async (db) => {
    const slip = await employeeAccess(db, employeeId).get(period.year, period.month)
    return slip ? payslipPdf(slip) : null
  })
  if (!pdf) return new Response("No payslip", { status: 404 })
  return new Response(Buffer.from(pdf), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="payslip-${encodeURIComponent(employeeId)}-${period.year}-${period.month}.pdf"`,
    },
  })
}
