import { requirePage, pageReturnTo } from "../../../../src/auth/next.ts"
import { currentPeriod } from "../../../../src/presentation.ts"
import { readPeriod } from "../../../../src/period.ts"
import { Workspace, PageHeading } from "../../../components/workspace.tsx"
import { EmployeeForm } from "./employee-form.tsx"

export default async function NewEmployeePage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string }>
}) {
  const query = await searchParams
  const principal = await requirePage(
    "hr",
    undefined,
    pageReturnTo("/hr/employees/new", query)
  )
  const period = readPeriod(query.year, query.month) ?? currentPeriod()
  return (
    <Workspace principal={principal} period={period} active="create">
      <PageHeading
        eyebrow="EMPLOYEE PAYROLL"
        title="Add an employee"
        description="Enter a new employee's salary manually, then review it before saving."
      >
        <a className="button button-secondary" href="/hr/import">
          Upload a salary sheet instead
        </a>
      </PageHeading>
      <div className="entry-layout">
        <EmployeeForm
          period={period}
          currencies={Intl.supportedValuesOf("currency")}
        />
        <aside className="panel">
          <div className="panel-heading">
            <h2>What happens next?</h2>
          </div>
          <div className="panel-body stack-form">
            <p>1. Enter an unused employee ID and annual salary.</p>
            <p>2. Review the employee, payroll month and amounts.</p>
            <p>3. Confirm to save the employee and monthly payslip.</p>
            <p className="field-help">
              Already have this employee? Use Salary editor to update an
              existing record. Employee login accounts are provisioned
              separately by your system administrator.
            </p>
            <a className="text-link" href="/hr/salary">
              Open salary editor →
            </a>
          </div>
        </aside>
      </div>
    </Workspace>
  )
}
