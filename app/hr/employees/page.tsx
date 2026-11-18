import { EmployeeDirectory } from "./directory.tsx"
import { requirePage, pageReturnTo } from "../../../src/auth/next.ts"
import { hrAccess } from "../../../src/access/roles.ts"
import { withPayroll } from "../../../src/payroll-db.ts"
import { readPeriod } from "../../../src/period.ts"
import {
  currentPeriod,
  periodQuery,
} from "../../../src/presentation.ts"
import {
  Workspace,
  PageHeading,
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
  const query = await searchParams
  const principal = await requirePage(
    "hr",
    undefined,
    pageReturnTo("/hr/employees", query)
  )
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
      <EmployeeDirectory key={principal.userId + JSON.stringify(query)} initialPage={page} initialQuery={query} initialPeriod={period} valid={valid} currencies={currencies} userId={principal.userId} />
      <p className="field-help">
        This is the payroll employee directory. Names and other profile fields
        are not stored in the current employee schema. Employee sign-in accounts
        are managed separately.
      </p>
    </Workspace>
  )
}
