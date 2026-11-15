import { requirePage } from "../../../src/auth/next.ts"
import { employeeAccess } from "../../../src/access/roles.ts"
import { withPayroll } from "../../../src/payroll-db.ts"
import { readPeriod } from "../../../src/period.ts"
import {
  currentPeriod,
  formatMoney,
  minorUnitHelp,
  periodLabel,
} from "../../../src/presentation.ts"
import { flagUnreadableReceipt } from "../../../src/receipt-flag.ts"
import {
  Workspace,
  PageHeading,
  EmptyState,
} from "../../components/workspace.tsx"
import { PeriodPicker } from "../../components/period-picker.tsx"
import { PayslipSummary } from "../../components/payslip-summary.tsx"
import { Icon } from "../../components/ui-icon.tsx"

export default async function EmployeePayslipPage({
  params,
  searchParams,
}: {
  params: Promise<{ employeeId: string }>
  searchParams: Promise<{
    year?: string
    month?: string
    failure?: string
    notice?: string
  }>
}) {
  const { employeeId } = await params
  const principal = await requirePage("employee", employeeId)
  const query = await searchParams
  const requested =
    query.year === undefined && query.month === undefined
      ? currentPeriod()
      : readPeriod(query.year, query.month)
  const period = requested ?? currentPeriod()
  const [slip, claims] = await withPayroll(async (db) => {
    const employee = employeeAccess(db, employeeId)
    return requested
      ? Promise.all([
          employee.get(period.year, period.month),
          employee.getClaims(period.year, period.month),
        ])
      : ([null, []] as const)
  })
  const path = `/employee/${encodeURIComponent(employeeId)}`
  return (
    <Workspace principal={principal} period={period} active="payslip">
      <PageHeading
        eyebrow="YOUR PAYROLL"
        title="My payslip"
        description="Your monthly pay, clearly explained. All figures come from your saved payslip."
      >
        {slip && (
          <a
            className="button button-primary"
            href={`${path}/download?year=${period.year}&month=${period.month}`}
          >
            <Icon name="download" size={18} />
            Download PDF
          </a>
        )}
      </PageHeading>
      <div className="section-toolbar">
        <div>
          <h2>{periodLabel(period)}</h2>
          <p className="muted">Employee ID · {employeeId}</p>
        </div>
        <PeriodPicker period={period} action={path} />
      </div>
      {!requested && (
        <div className="notice notice-error" role="alert">
          Choose a valid payroll month and a year between 1900 and 9999.
        </div>
      )}
      {query.failure && (
        <div className="notice notice-error" role="alert">
          {query.failure}
        </div>
      )}
      {query.notice === "claim-submitted" && (
        <div className="notice notice-success" role="status">
          Your claim has been submitted to HR for review.
        </div>
      )}
      {slip ? (
        <>
          <section className="employee-pay-grid" aria-label="My monthly pay">
            <article className="net-pay-card">
              <div>
                <span>NET PAY · {slip.currency}</span>
                <Icon name="wallet" size={24} />
              </div>
              <strong>{formatMoney(slip.netMinor, slip.currency)}</strong>
              <p>Your saved take-home amount for {periodLabel(period)}.</p>
              <span className="badge badge-on-dark">
                <Icon name="check" size={14} />
                Payslip available
              </span>
            </article>
            <article className="metric-card">
              <div className="metric-label">
                Monthly gross
                <span className="metric-icon blue">
                  <Icon name="wallet" />
                </span>
              </div>
              <strong className="metric-value money-metric">
                {formatMoney(slip.monthlyGrossMinor, slip.currency)}
              </strong>
              <p>Before deductions and reimbursements</p>
            </article>
            <article className="metric-card">
              <div className="metric-label">
                Reimbursements
                <span className="metric-icon green">
                  <Icon name="check" />
                </span>
              </div>
              <strong className="metric-value money-metric">
                {formatMoney(slip.approvedReimbursementsMinor, slip.currency)}
              </strong>
              <p>Approved and included in this payslip</p>
            </article>
          </section>
          <div className="dashboard-columns">
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>Pay breakdown</h2>
                  <p>
                    {periodLabel(period)} · {slip.currency}
                  </p>
                </div>
                <Icon name="file" />
              </div>
              <div className="panel-body">
                <PayslipSummary slip={slip} />
              </div>
              <div className="panel-footnote">
                <Icon name="lock" size={14} />
                This is your saved monthly payslip. Only HR can change payroll
                inputs.
              </div>
            </section>
            <aside className="panel">
              <div className="panel-heading">
                <div>
                  <h2>Understanding your pay</h2>
                  <p>A little clarity on each part of your payslip.</p>
                </div>
              </div>
              <div className="panel-body explanation-list">
                <div>
                  <span className="explanation-number">01</span>
                  <p>
                    <strong>Monthly gross</strong>Your annual CTC divided into
                    monthly pay, using the payroll rounding rules.
                  </p>
                </div>
                <div>
                  <span className="explanation-number">02</span>
                  <p>
                    <strong>Deductions</strong>Unpaid leave and other deductions
                    entered by HR reduce your pay. Paid leave does not reduce
                    it.
                  </p>
                </div>
                <div>
                  <span className="explanation-number">03</span>
                  <p>
                    <strong>Reimbursements</strong>Claims are included in pay
                    only after HR approval.
                  </p>
                </div>
              </div>
            </aside>
          </div>
        </>
      ) : (
        <section className="panel">
          <EmptyState
            icon="wallet"
            title="No payslip for this month"
            description={`HR hasn't saved a payslip for ${periodLabel(period)}. Choose another month or contact your HR team.`}
          />
        </section>
      )}
      <section className="panel" id="claims">
        <div className="panel-heading">
          <div>
            <h2>My reimbursement claims</h2>
            <p>Track the claims you've submitted for {periodLabel(period)}.</p>
          </div>
          <span className="badge badge-neutral">{claims.length} claims</span>
        </div>
        {claims.length ? (
          <div className="table-wrap">
            <table>
              <caption className="sr-only">
                My claims for {periodLabel(period)}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Claim</th>
                  <th scope="col">Receipt reference</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="text-right">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {claims.map((claim) => (
                  <tr key={claim.id}>
                    <td className="claim-id">{claim.id}</td>
                    <td className="receipt-cell">
                      {flagUnreadableReceipt(claim.receipt) ?? claim.receipt}
                    </td>
                    <td>
                      <span
                        className={`badge ${claim.status === "approved" ? "badge-green" : "badge-amber"}`}
                      >
                        {claim.status === "approved"
                          ? "Approved"
                          : "Pending review"}
                      </span>
                    </td>
                    <td className="text-right amount">
                      {slip
                        ? formatMoney(claim.amountMinor, slip.currency)
                        : `${claim.amountMinor} minor units`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon="file"
            title="No claims this month"
            description="Your reimbursement claims will appear here once submitted."
          />
        )}
      </section>
      {slip && (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Submit a reimbursement</h2>
              <p>
                Send your claim to HR for review. Submitting it does not change
                your pay.
              </p>
            </div>
            <Icon name="plus" />
          </div>
          <form
            action={`${path}/claims`}
            method="post"
            className="panel-body stack-form"
          >
            <input type="hidden" name="year" value={period.year} />
            <input type="hidden" name="month" value={period.month} />
            <div className="form-grid">
              <label>
                Claim amount (minor units)
                <input
                  name="amountMinor"
                  type="number"
                  min="0"
                  step="1"
                  required
                  placeholder="Enter amount"
                />
                <span className="field-help">
                  {minorUnitHelp(slip.currency)}
                </span>
              </label>
              <label>
                Receipt reference
                <input
                  name="receipt"
                  required
                  placeholder="Enter your receipt reference"
                />
                <span className="field-help">
                  Provide the reference HR should review for this claim.
                </span>
              </label>
            </div>
            <label className="checkbox-label">
              <input type="checkbox" name="confirmed" value="yes" required />I
              confirm that the amount and receipt reference are correct.
            </label>
            <div>
              <button className="button button-primary">
                Submit for review <Icon name="arrow" size={17} />
              </button>
            </div>
          </form>
        </section>
      )}
    </Workspace>
  )
}
