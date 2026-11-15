import { requirePage } from "../../../../../src/auth/next.ts"
import { withPayroll } from "../../../../../src/payroll-db.ts"
import {
  currentPeriod,
  formatMoney,
  periodLabel,
  periodQuery,
} from "../../../../../src/presentation.ts"
import {
  Workspace,
  PageHeading,
  EmptyState,
} from "../../../../components/workspace.tsx"
import { Icon } from "../../../../components/ui-icon.tsx"

export default async function PayrollReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ draftId: string }>
  searchParams: Promise<{ page?: string; failure?: string }>
}) {
  const principal = await requirePage("hr")
  const { draftId } = await params
  const query = await searchParams
  const draft = await withPayroll((db) =>
    db.getPayrollDraft(draftId, principal.userId, Number(query.page ?? 1))
  )
  const period = draft?.period ?? currentPeriod()
  return (
    <Workspace
      principal={principal}
      period={period}
      active={draft?.mode === "create" ? "create" : "import"}
    >
      <PageHeading
        eyebrow="REVIEW & CONFIRM"
        title={
          draft?.status === "committed"
            ? "Payroll saved"
            : "Review employee salaries"
        }
        description={
          draft?.status === "committed"
            ? "Your employee records and monthly payslips are saved in the database."
            : "Check the employee IDs, period and amounts before committing any changes."
        }
      />
      {!draft ? (
        <section className="panel">
          <EmptyState
            icon="clock"
            title="This review is unavailable"
            description="Reviews are private to the HR account that created them and expire after 15 minutes. Start again to prepare a fresh review."
          >
            <a className="button button-primary" href="/hr/import">
              Upload a salary sheet
            </a>
          </EmptyState>
        </section>
      ) : (
        <>
          {query.failure && draft.status === "pending" && (
            <div className="notice notice-error" role="alert">
              {query.failure}
            </div>
          )}
          {draft.status === "committed" && (
            <div className="notice notice-success" role="status">
              <Icon name="check" size={20} />
              <p>
                <strong>
                  {draft.total.toLocaleString("en-IN")} employee{" "}
                  {draft.total === 1 ? "salary" : "salaries"} saved
                </strong>
                <span>
                  The dashboard and employee payslips now use these saved
                  records. Login accounts are managed separately.
                </span>
              </p>
            </div>
          )}
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>
                  {periodLabel(period)} · {draft.total.toLocaleString("en-IN")}{" "}
                  employees
                </h2>
                <p>Source: {draft.source}</p>
              </div>
              <span
                className={`badge ${draft.status === "committed" ? "badge-green" : "badge-amber"}`}
              >
                {draft.status === "committed" ? "Saved" : "Not saved yet"}
              </span>
            </div>
            <div className="table-wrap">
              <table>
                <caption className="sr-only">
                  Salary review for {periodLabel(period)}, page {draft.page} of{" "}
                  {draft.pages}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Employee ID</th>
                    <th scope="col">Employee record</th>
                    <th scope="col">Annual CTC</th>
                    <th scope="col">Unpaid days</th>
                    <th scope="col">Other deductions</th>
                  </tr>
                </thead>
                <tbody>
                  {draft.rows.map((row) => (
                    <tr key={row.employeeId}>
                      <td>{row.employeeId}</td>
                      <td>
                        <span
                          className={`badge ${row.operation === "create" ? "badge-green" : "badge-blue"}`}
                        >
                          {row.operation === "create"
                            ? "New employee"
                            : "Existing employee"}
                        </span>
                      </td>
                      <td className="amount">
                        {row.currency}{" "}
                        {formatMoney(row.annualCtcMinor, row.currency)}
                      </td>
                      <td>{row.unpaidLeaveDays}</td>
                      <td className="amount">
                        {formatMoney(row.otherDeductionsMinor, row.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="review-pagination">
              <span>
                Page {draft.page} of {draft.pages} · up to 25 rows per page
              </span>
              <div>
                {draft.page > 1 && (
                  <a
                    className="button button-secondary button-small"
                    href={`?page=${draft.page - 1}`}
                  >
                    Previous
                  </a>
                )}
                {draft.page < draft.pages && (
                  <a
                    className="button button-secondary button-small"
                    href={`?page=${draft.page + 1}`}
                  >
                    Next rows →
                  </a>
                )}
              </div>
            </div>
          </section>
          {draft.status === "pending" ? (
            <section className="panel">
              <form
                action="/hr/import/commit"
                method="post"
                className="panel-body stack-form payroll-confirm-form"
              >
                <input type="hidden" name="draftId" value={draft.id} />
                <div className="notice notice-info">
                  <Icon name="lock" size={18} />
                  <p>
                    <strong>One confirmed save</strong>
                    <span>
                      All {draft.total.toLocaleString("en-IN")} rows will be
                      saved together. Only {periodLabel(period)} is
                      recalculated, and existing claims stay on file. This
                      review expires 15 minutes after it was prepared.
                    </span>
                  </p>
                </div>
                <label className="checkbox-label confirmation-box">
                  <input
                    type="checkbox"
                    name="confirmed"
                    value="yes"
                    required
                  />
                  <span>
                    <strong>I have reviewed the employee salaries</strong>
                    <small>
                      I authorize saving all{" "}
                      {draft.total.toLocaleString("en-IN")} rows, including
                      updates to existing employee payroll for this month.
                    </small>
                  </span>
                </label>
                <div className="form-actions">
                  <a
                    className="button button-secondary"
                    href={
                      draft.mode === "create"
                        ? "/hr/employees/new"
                        : "/hr/import"
                    }
                  >
                    Start again
                  </a>
                  <button className="button button-primary">
                    Confirm and save{" "}
                    {draft.total === 1
                      ? "employee"
                      : `${draft.total.toLocaleString("en-IN")} salaries`}
                    <Icon name="check" size={17} />
                  </button>
                </div>
              </form>
            </section>
          ) : (
            <div className="success-actions">
              <a
                className="button button-primary"
                href={`/hr?${periodQuery(period)}`}
              >
                View updated dashboard <Icon name="arrow" size={17} />
              </a>
              <a className="button button-secondary" href="/hr/employees/new">
                Add another employee
              </a>
              <a className="button button-secondary" href="/hr/import">
                Upload another sheet
              </a>
              {draft.total === 1 && (
                <a
                  className="text-link"
                  href={`/hr/salary?employeeId=${encodeURIComponent(draft.rows[0].employeeId)}&${periodQuery(period)}`}
                >
                  Open saved salary
                </a>
              )}
            </div>
          )}
        </>
      )}
    </Workspace>
  )
}
