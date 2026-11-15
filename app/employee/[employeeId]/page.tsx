import { employeeAccess } from "../../../src/access/roles.ts"
import { explainPayslip } from "../../../src/explain-payslip.ts"
import { payslipText } from "../../../src/payslip-document.ts"
import { withPayroll } from "../../../src/payroll-db.ts"
import { readPeriod } from "../../../src/period.ts"
import { flagUnreadableReceipt } from "../../../src/receipt-flag.ts"

export default async function EmployeePayslipPage({
  params,
  searchParams,
}: {
  params: Promise<{ employeeId: string }>
  searchParams: Promise<{ year?: string; month?: string; failure?: string }>
}) {
  const { employeeId } = await params
  const query = await searchParams
  const period = readPeriod(query.year, query.month)
  if (!period) {
    return (
      <main>
        <p>Year and month are required.</p>
      </main>
    )
  }
  const [slip, claims] = await withPayroll(async (db) => {
    const employee = employeeAccess(db, employeeId)
    return Promise.all([employee.get(period.year, period.month), employee.getClaims(period.year, period.month)])
  })
  return (
    <main>
      {query.failure ? <p>{query.failure}</p> : null}
      <p>{explainPayslip(slip)}</p>
      {payslipText(slip).map((line) => (
        <p key={line}>{line}</p>
      ))}
      {slip ? (
        <p>
          <a href={`/employee/${employeeId}/download?year=${period.year}&month=${period.month}`}>Download PDF</a>
        </p>
      ) : null}
      {claims.map((claim) => (
        <p key={claim.id}>
          {claim.id} {claim.status} {claim.amountMinor} {flagUnreadableReceipt(claim.receipt) ?? claim.receipt}
        </p>
      ))}
      {slip ? (
        <form action={`/employee/${employeeId}/claims`} method="post">
          <input type="hidden" name="year" value={period.year} />
          <input type="hidden" name="month" value={period.month} />
          <input name="amountMinor" aria-label="Claim amount" />
          <input name="receipt" aria-label="Receipt" />
          <label>
            <input type="checkbox" name="confirmed" value="yes" /> Confirm
          </label>
          <button type="submit">Upload pending claim</button>
        </form>
      ) : null}
    </main>
  )
}
