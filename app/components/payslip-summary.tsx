import type { StoredPayslip } from "../../src/db/sqlite-payroll.ts"
import { formatMoney } from "../../src/presentation.ts"

export function PayslipSummary({ slip }: { slip: StoredPayslip }) {
  const rows = [
    ["Monthly gross", slip.monthlyGrossMinor],
    ["Unpaid leave deduction", slip.unpaidDeductionMinor],
    ["Other deductions", slip.otherDeductionsMinor],
    ["Approved reimbursements", slip.approvedReimbursementsMinor],
  ] as const
  return (
    <dl className="payslip-breakdown">
      {rows.map(([label, amount]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{formatMoney(amount, slip.currency)}</dd>
        </div>
      ))}
      <div className="net-row">
        <dt>
          Net pay<span>Stored monthly amount</span>
        </dt>
        <dd>{formatMoney(slip.netMinor, slip.currency)}</dd>
      </div>
    </dl>
  )
}
