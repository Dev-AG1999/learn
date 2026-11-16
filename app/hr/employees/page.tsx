import { requirePage } from "../../../src/auth/next.ts"
import { hrAccess } from "../../../src/access/roles.ts"
import { withPayroll } from "../../../src/payroll-db.ts"
import { readPeriod } from "../../../src/period.ts"
import {
  currentPeriod,
  formatMoney,
  monthNames,
  periodLabel,
  periodQuery,
} from "../../../src/presentation.ts"
import {
  Workspace,
  PageHeading,
  EmptyState,
} from "../../components/workspace.tsx"
import { Icon } from "../../components/ui-icon.tsx"

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<{
    year?: string
    month?: string
    q?: string
    currency?: string
    cursor?: string
  }>
}) {
  const principal = await requirePage("hr")
  const query = await searchParams
  const requested =
    query.year === undefined && query.month === undefined
      ? currentPeriod()
      : readPeriod(query.year, query.month)
  const period = requested ?? currentPeriod()
  const prefix = (query.q ?? "").trim()
  const currency = query.currency ?? ""
  const currencies = Intl.supportedValuesOf("currency")
  const valid =
    !!requested &&
    /^[A-Za-z0-9_-]{0,64}$/.test(prefix) &&
    (!currency || (currencies as string[]).includes(currency)) &&
    (query.cursor?.length ?? 0) <= 256
  const page = valid
    ? await withPayroll((db) =>
        hrAccess(db).listEmployees({
          ...period,
          prefix,
          currency,
          cursor: query.cursor ?? null,
          limit: 25,
        })
      )
    : { employees: [], nextCursor: null }
  const filters = new URLSearchParams({
    year: String(period.year),
    month: String(period.month),
    q: prefix,
    currency,
  })
  const first = `/hr/employees?${filters}`
  const next = new URLSearchParams(filters)
  if (page.nextCursor) next.set("cursor", page.nextCursor)
  return (
    <Workspace principal={principal} period={period} active="employees">
      <PageHeading
        eyebrow="PEOPLE OPERATIONS"
        title="Employees"
        description="Find employees added manually or imported from a salary sheet."
      >
        <div className="dashboard-entry-actions">
          <a className="button button-secondary" href="/hr/import">
            <Icon name="file" size={17} />
            Upload salary sheet
          </a>
          <a
            className="button button-primary"
            href={`/hr/employees/new?${periodQuery(period)}`}
          >
            <Icon name="plus" size={17} />
            Add employee
          </a>
        </div>
      </PageHeading>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Find an employee</h2>
            <p>
              Search by the start of an employee ID. IDs are case-sensitive.
            </p>
          </div>
          <Icon name="search" />
        </div>
        <form
          method="get"
          action="/hr/employees"
          className="panel-body employee-directory-filters"
        >
          <label>
            Employee ID starts with
            <input
              name="q"
              defaultValue={prefix}
              maxLength={64}
              pattern="[A-Za-z0-9_-]*"
              placeholder="e.g. EMP- or HR-DEMO-"
            />
          </label>
          <label>
            CTC currency
            <select name="currency" defaultValue={currency}>
              <option value="">All currencies</option>
              {currencies.map((code) => (
                <option key={code}>{code}</option>
              ))}
            </select>
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
          <button className="button button-primary">Apply filters</button>
        </form>
      </section>
      {!valid && (
        <div role="alert" className="notice notice-error">
          Choose a valid period and currency. Search IDs using letters, numbers,
          hyphens or underscores.
        </div>
      )}
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Employee salary records</h2>
            <p>
              {periodLabel(period)} monthly pay · Annual CTC is the employee's
              current saved input.
            </p>
          </div>
          <span className="badge badge-neutral">
            {page.employees.length} shown
          </span>
        </div>
        {page.employees.length ? (
          <div className="table-wrap">
            <table>
              <caption className="sr-only">
                Employee directory and saved pay for {periodLabel(period)}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Employee ID</th>
                  <th scope="col">Current annual CTC</th>
                  <th scope="col">Monthly net pay</th>
                  <th scope="col">Payslip</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {page.employees.map((employee) => (
                  <tr key={employee.employeeId}>
                    <td>
                      <strong>{employee.employeeId}</strong>
                    </td>
                    <td className="amount">
                      {employee.currency}{" "}
                      {formatMoney(employee.annualCtcMinor, employee.currency)}
                    </td>
                    <td className="amount">
                      {employee.monthlyNetMinor !== null &&
                      employee.monthlyCurrency
                        ? `${employee.monthlyCurrency} ${formatMoney(employee.monthlyNetMinor, employee.monthlyCurrency)}`
                        : "—"}
                    </td>
                    <td>
                      <span
                        className={`badge ${employee.monthlyNetMinor !== null ? "badge-green" : "badge-neutral"}`}
                      >
                        {employee.monthlyNetMinor !== null
                          ? "Available"
                          : "Not saved this month"}
                      </span>
                    </td>
                    <td>
                      <a
                        className="text-link"
                        href={`/hr/salary?employeeId=${encodeURIComponent(employee.employeeId)}&${periodQuery(period)}`}
                        aria-label={`Edit salary for ${employee.employeeId}`}
                      >
                        Edit salary <Icon name="arrow" size={15} />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon="users"
            title={
              prefix || currency || query.cursor
                ? "No matching employees"
                : "No employees yet"
            }
            description={
              prefix || currency || query.cursor
                ? "Try a different ID prefix, currency, or return to the first page."
                : "Add an employee manually or upload a salary sheet. Saved employee records will appear here."
            }
          >
            <a
              className="text-link"
              href={
                prefix || currency || query.cursor
                  ? `/hr/employees?${periodQuery(period)}`
                  : "/hr/import"
              }
            >
              {prefix || currency || query.cursor
                ? "Clear filters"
                : "Upload salary sheet"}{" "}
              <Icon name="arrow" size={16} />
            </a>
          </EmptyState>
        )}
        <div className="review-pagination">
          <span>
            Up to 25 employees per page. Employees stay listed even when this
            month has no payslip.
          </span>
          <div>
            {query.cursor && (
              <a className="button button-secondary button-small" href={first}>
                First page
              </a>
            )}
            {page.nextCursor && (
              <a
                className="button button-secondary button-small"
                href={`/hr/employees?${next}`}
              >
                Next employees →
              </a>
            )}
          </div>
        </div>
      </section>
      <p className="field-help">
        This is the payroll employee directory. Names and other profile fields
        are not stored in the current employee schema. Employee sign-in accounts
        are managed separately.
      </p>
    </Workspace>
  )
}
