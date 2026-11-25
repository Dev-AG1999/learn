import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, expect, test, vi } from "vitest"
import { EmployeeDirectory } from "../app/hr/employees/directory.tsx"
import { directoryColumns, EmployeeDirectoryTable } from "../app/hr/employees/directory-table.tsx"

afterEach(() => vi.restoreAllMocks())

test("directory options use the server snapshot when browser currency metadata differs", () => {
  const currencies = ["INR", "SLE", "USD"]
  const render = () => renderToStaticMarkup(createElement(EmployeeDirectory, {
    initialPage: { employees: [], nextCursor: null },
    initialQuery: {},
    initialPeriod: { year: 2026, month: 1 },
    valid: true,
    userId: "hr-test",
    currencies,
  }))
  const server = render()
  const browserMetadata = vi.spyOn(Intl, "supportedValuesOf").mockReturnValue(["INR", "SLL", "USD"])
  const browser = render()
  expect(browser).toBe(server)
  expect(browser).toContain(">SLE</option>")
  expect(browser).not.toContain(">SLL</option>")
  expect(browserMetadata).not.toHaveBeenCalled()
})

test("adding a column definition renders the same column for every employee", () => {
  const employees = [
    {
      employeeId: "EMP-001",
      currency: "INR",
      annualCtcMinor: 120000000,
      monthlyNetMinor: 10000000,
      monthlyCurrency: "INR",
      team: "Platform",
    },
    {
      employeeId: "EMP-002",
      currency: "INR",
      annualCtcMinor: 120000000,
      monthlyNetMinor: null,
      monthlyCurrency: null,
      team: null,
    },
  ]
  const html = renderToStaticMarkup(createElement(EmployeeDirectoryTable<(typeof employees)[number]>, {
    employees,
    period: { year: 2026, month: 1 },
    columns: [
      ...directoryColumns,
      { id: "team", label: "Team", render: (employee) => employee.team ?? "—" },
    ],
  }))
  expect(html).toContain('<th scope="col">Team</th>')
  expect(html).toContain("<td>Platform</td></tr>")
  expect(html).toContain("<td>—</td></tr>")
  expect(html).toContain("Not saved this month")
})
