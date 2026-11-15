import { AccountNav } from "../../components/account-nav.tsx"
import { requirePage } from "../../../src/auth/next.ts"
import { withPayroll } from "../../../src/payroll-db.ts"
import { readSalaryEditor } from "../../../src/salary-editor.ts"
import { readPeriod } from "../../../src/period.ts"
import { SalaryEditor } from "./editor.tsx"
import "./salary.css"

export const dynamic = "force-dynamic"

export default async function SalaryPage({ searchParams }: { searchParams: Promise<{ employeeId?: string; year?: string; month?: string }> }) {
  await requirePage("hr")
  const query = await searchParams
  const period = readPeriod(query.year, query.month)
  const valid = period && period.year >= 1900 && period.year <= 9999 && period.month >= 1 && period.month <= 12
  const data = valid && query.employeeId ? await withPayroll(db => readSalaryEditor(db, query.employeeId!, period.year, period.month)) : null
  return <main className="salary-shell">
    <AccountNav />
    <a href={valid ? `/hr?year=${period.year}&month=${period.month}` : "/"}>← HR dashboard</a>
    <header><p>HR · PAYROLL MANAGEMENT</p><h1>Edit employee salary</h1><p>Review payroll inputs and save a monthly payslip.</p></header>
    <form method="get" className="salary-card salary-lookup">
      <label>Employee ID<input name="employeeId" defaultValue={query.employeeId} required placeholder="syn-00001" /></label>
      <label>Year<input name="year" type="number" min="1900" max="9999" defaultValue={query.year} required /></label>
      <label>Month<input name="month" type="number" min="1" max="12" defaultValue={query.month} required /></label>
      <button>Load payroll</button>
    </form>
    {query.employeeId && !data && <p role="alert">Employee not found or payroll period is invalid.</p>}
    {data && valid && <>
      <h2>{query.employeeId} · {period.year}-{String(period.month).padStart(2, "0")}</h2>
      <section className="salary-card" aria-label="Stored payslip"><h2>Saved monthly snapshot</h2>
        {data.payslip ? <dl className="salary-grid">{Object.entries({ "Monthly gross": data.payslip.monthlyGrossMinor, "Unpaid deduction": data.payslip.unpaidDeductionMinor, "Other deductions": data.payslip.otherDeductionsMinor, "Approved reimbursements": data.payslip.approvedReimbursementsMinor, "Net pay": data.payslip.netMinor }).map(([label, amount]) => <div key={label}><dt>{label}</dt><dd>{data.payslip!.currency} {amount.toLocaleString("en-IN")} minor units</dd></div>)}</dl> : <p>No payslip exists for this month. Saving will create one.</p>}
      </section>
      <SalaryEditor key={`${query.employeeId}-${period.year}-${period.month}`} employeeId={query.employeeId!} year={period.year} month={period.month} version={data.version} annualCtcMinor={data.inputs.annualCtcMinor} currency={data.payslip?.currency ?? data.inputs.currency} unpaidLeaveDays={data.leave?.unpaidLeaveDays ?? 0} otherDeductionsMinor={data.payslip?.otherDeductionsMinor ?? 0} />
    </>}
  </main>
}
