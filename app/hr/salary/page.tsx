import { requirePage } from "../../../src/auth/next.ts"
import { withPayroll } from "../../../src/payroll-db.ts"
import { readSalaryEditor } from "../../../src/salary-editor.ts"
import { readPeriod } from "../../../src/period.ts"
import {
  currencyChoices,
  currentPeriod,
  monthNames,
  periodLabel,
  periodQuery,
} from "../../../src/presentation.ts"
import {
  Workspace,
  PageHeading,
  EmptyState,
} from "../../components/workspace.tsx"
import { PayslipSummary } from "../../components/payslip-summary.tsx"
import { Icon } from "../../components/ui-icon.tsx"
import { SalaryEditor } from "./editor.tsx"

export const dynamic = "force-dynamic"

export default async function SalaryPage({
  searchParams,
}: {
  searchParams: Promise<{ employeeId?: string; year?: string; month?: string }>
}) {
  const principal = await requirePage("hr")
  const query = await searchParams
  const requested =
    query.year === undefined && query.month === undefined
      ? currentPeriod()
      : readPeriod(query.year, query.month)
  const period = requested ?? currentPeriod()
  const employeeId = query.employeeId?.trim() ?? ""
  const data =
    requested && employeeId
      ? await withPayroll((db) =>
          readSalaryEditor(db, employeeId, period.year, period.month)
        )
      : null
  return (
    <Workspace principal={principal} period={period} active="salary">
      <PageHeading
        eyebrow="PAYROLL MANAGEMENT"
        title="Employee salary"
        description="Review payroll inputs, make an update, and save with confidence."
      >
        <a
          className="button button-secondary"
          href={`/hr?${periodQuery(period)}`}
        >
          Back to overview
        </a>
      </PageHeading>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Find employee payroll</h2>
            <p>Choose an employee and the month you want to work on.</p>
          </div>
          <Icon name="search" />
        </div>
        <form method="get" className="panel-body salary-lookup">
          <label>
            Employee ID
            <input
              name="employeeId"
              defaultValue={employeeId}
              required
              placeholder="Enter employee ID"
            />
          </label>
          <label>
            Payroll month
            <select name="month" defaultValue={period.month}>
              {monthNames.map((name, index) => (
                <option key={name} value={index + 1}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Year
            <input
              name="year"
              type="number"
              min="1900"
              max="9999"
              defaultValue={period.year}
              required
            />
          </label>
          <button className="button button-primary">
            <Icon name="search" size={17} />
            Load payroll
          </button>
        </form>
      </section>
      {!requested && (
        <div className="notice notice-error" role="alert">
          Choose a valid month and a year between 1900 and 9999.
        </div>
      )}
      {employeeId && requested && !data && (
        <div className="notice notice-error" role="alert">
          Employee not found. Check the employee ID and try again.
        </div>
      )}
      {data && requested ? (
        <>
          <div className="employee-context">
            <span className="employee-avatar">
              {employeeId.slice(0, 2).toUpperCase()}
            </span>
            <div>
              <h2>{employeeId}</h2>
              <p>
                {periodLabel(period)} <span>·</span> {data.inputs.currency}{" "}
                payroll
              </p>
            </div>
            <span
              className={`badge ${data.payslip ? "badge-green" : "badge-neutral"}`}
            >
              {data.payslip ? "Payslip on file" : "New monthly payslip"}
            </span>
          </div>
          <div className="editor-columns">
            <SalaryEditor
              key={`${employeeId}-${period.year}-${period.month}`}
              currencies={currencyChoices()}
              employeeId={employeeId}
              year={period.year}
              month={period.month}
              version={data.version}
              annualCtcMinor={data.inputs.annualCtcMinor}
              currency={data.payslip?.currency ?? data.inputs.currency}
              unpaidLeaveDays={data.leave?.unpaidLeaveDays ?? 0}
              otherDeductionsMinor={data.payslip?.otherDeductionsMinor ?? 0}
            />
            <aside className="editor-summary">
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Saved payslip</h2>
                    <p>
                      {periodLabel(period)} ·{" "}
                      {data.payslip?.currency ?? data.inputs.currency}
                    </p>
                  </div>
                  <Icon name="file" />
                </div>
                {data.payslip ? (
                  <div className="panel-body">
                    <PayslipSummary slip={data.payslip} />
                  </div>
                ) : (
                  <EmptyState
                    title="No saved payslip yet"
                    description="Confirm the payroll inputs to create this month's payslip."
                  />
                )}
              </section>
              <div className="info-note">
                <Icon name="lock" size={19} />
                <p>
                  <strong>A deliberate save.</strong> Your changes affect this
                  month only. Existing claims stay on file, and other months
                  keep their saved payslips.
                </p>
              </div>
            </aside>
          </div>
        </>
      ) : (
        !employeeId && (
          <section className="panel">
            <EmptyState
              icon="users"
              title="Start with an employee"
              description="Enter an existing employee ID above to review their monthly pay. Nothing changes until you confirm and save. To create a new employee, use Add employee."
            />
          </section>
        )
      )}
    </Workspace>
  )
}
