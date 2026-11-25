import type { ReactNode } from "react"
import type { EmployeeDirectoryRow } from "../../../src/db/sqlite-payroll.ts"
import { formatMoney, periodLabel, periodQuery } from "../../../src/presentation.ts"
import { Icon } from "../../components/ui-icon.tsx"

type Period = { year: number; month: number }

export type EmployeeDirectoryColumn<Row = EmployeeDirectoryRow> = {
  id: string
  label: string
  className?: string
  render: (employee: Row, period: Period) => ReactNode
}

export const directoryColumns: readonly EmployeeDirectoryColumn[] = [
  {
    id: "employeeId",
    label: "Employee ID",
    render: (employee) => <strong>{employee.employeeId}</strong>,
  },
  {
    id: "annualCtc",
    label: "Current annual CTC",
    className: "amount",
    render: (employee) =>
      `${employee.currency} ${formatMoney(employee.annualCtcMinor, employee.currency)}`,
  },
  {
    id: "monthlyNet",
    label: "Monthly net pay",
    className: "amount",
    render: (employee) =>
      employee.monthlyNetMinor !== null && employee.monthlyCurrency
        ? `${employee.monthlyCurrency} ${formatMoney(employee.monthlyNetMinor, employee.monthlyCurrency)}`
        : "—",
  },
  {
    id: "payslip",
    label: "Payslip",
    render: (employee) => {
      const available = employee.monthlyNetMinor !== null
      return (
        <span className={`badge ${available ? "badge-green" : "badge-neutral"}`}>
          {available ? "Available" : "Not saved this month"}
        </span>
      )
    },
  },
  {
    id: "action",
    label: "Action",
    render: (employee, period) => (
      <a
        className="text-link"
        href={`/hr/salary?employeeId=${encodeURIComponent(employee.employeeId)}&${periodQuery(period)}`}
        aria-label={`Edit salary for ${employee.employeeId}`}
      >
        Edit salary <Icon name="arrow" size={15} />
      </a>
    ),
  },
]

export function EmployeeDirectoryTable<Row extends { employeeId: string }>({
  employees,
  period,
  columns,
}: {
  employees: readonly Row[]
  period: Period
  columns: readonly EmployeeDirectoryColumn<Row>[]
}) {
  return (
    <div className="table-wrap">
      <table>
        <caption className="sr-only">
          Employee directory and saved pay for {periodLabel(period)}
        </caption>
        <thead>
          <tr>
            {columns.map(({ id, label }) => <th scope="col" key={id}>{label}</th>)}
          </tr>
        </thead>
        <tbody>
          {employees.map((employee) => (
            <tr key={employee.employeeId}>
              {columns.map(({ id, className, render }) => (
                <td key={id} className={className}>{render(employee, period)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
