import { requirePage } from "../../../src/auth/next.ts"
import { currentPeriod } from "../../../src/presentation.ts"
import { Workspace, PageHeading } from "../../components/workspace.tsx"
import { Icon } from "../../components/ui-icon.tsx"
import { UploadForm } from "./upload-form.tsx"

export default async function ImportPage() {
  const principal = await requirePage("hr")
  return (
    <Workspace principal={principal} period={currentPeriod()} active="import">
      <PageHeading
        eyebrow="EMPLOYEE PAYROLL"
        title="Upload salary sheet"
        description="Add employees or update a month's payroll from a validated spreadsheet."
      >
        <a className="button button-secondary" href="/hr/employees/new">
          <Icon name="plus" size={17} />
          Add one employee manually
        </a>
      </PageHeading>
      <div className="entry-layout">
        <UploadForm />
        <aside className="panel">
          <div className="panel-heading">
            <div>
              <h2>Start with the right template</h2>
              <p>This uploads employee salaries, not HR policy text.</p>
            </div>
          </div>
          <div className="panel-body stack-form">
            <div className="template-links">
              <a
                className="button button-secondary"
                href="/hr/import/template?format=xlsx"
              >
                Blank Excel template <Icon name="download" size={16} />
              </a>
              <a
                className="button button-secondary"
                href="/hr/import/template?format=csv"
              >
                Blank CSV template <Icon name="download" size={16} />
              </a>
              <a
                className="text-link"
                href="/hr/import/template?format=xlsx&sample=yes"
              >
                Download sample Excel sheet
              </a>
              <a
                className="text-link"
                href="/hr/import/template?format=csv&sample=yes"
              >
                Download sample CSV sheet
              </a>
            </div>
            <p className="field-help">
              Samples contain three synthetic employees in the current payroll
              month.
            </p>
            <div className="workspace-tip">
              <Icon name="wallet" size={18} />
              <p>
                <strong>Sheet amounts use minor units.</strong> For INR, annual
                CTC ₹12,00,000 is 120000000 paise in annualCtcMinor. Monthly pay
                is calculated by the application.
              </p>
            </div>
            <p className="field-help">
              Keep the seven column headings. Use month numbers 1 (January)
              through 12 (December), plain numeric values, and a single
              worksheet. Save formulas as values first.
            </p>
            <p className="field-help">
              Existing employee IDs update only the month in the sheet. Claims
              are preserved. A changed record will require a fresh review before
              saving.
            </p>
          </div>
        </aside>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <h2>Sheet columns</h2>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Column</th>
                <th scope="col">What to enter</th>
                <th scope="col">Example</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["employeeId", "A unique employee identifier", "EMP-001"],
                ["year", "Payroll year", "2026"],
                [
                  "month",
                  "Payroll month, January = 1 through December = 12",
                  "11 (November)",
                ],
                [
                  "annualCtcMinor",
                  "Annual CTC in integer currency minor units",
                  "120000000 = ₹12,00,000",
                ],
                ["currency", "Supported ISO currency code", "INR"],
                ["unpaidLeaveDays", "Whole unpaid days within the month", "0"],
                [
                  "otherDeductionsMinor",
                  "Monthly deductions in integer minor units",
                  "150000 = ₹1,500",
                ],
              ].map(([column, description, example]) => (
                <tr key={column}>
                  <td>
                    <code>{column}</code>
                  </td>
                  <td>{description}</td>
                  <td>{example}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </Workspace>
  )
}
