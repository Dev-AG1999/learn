import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vitest"
import { Workspace, EmptyState } from "../app/components/workspace.tsx"
import { PeriodPicker } from "../app/components/period-picker.tsx"
import { PayslipSummary } from "../app/components/payslip-summary.tsx"

const period = { year: 2026, month: 2 }
const principal = {
  userId: "user-a",
  username: "employee@example.com",
  role: "employee" as const,
  employeeId: "emp-a",
}

test("employee navigation links only to the employee workspace and preserves the period", () => {
  const html = renderToStaticMarkup(
    createElement(Workspace, {
      principal,
      period,
      active: "payslip",
      children: "Content",
    })
  )
  expect(html).toContain("February 2026")
  expect(html).toContain("/employee/emp-a?year=2026&amp;month=2")
  expect(html).not.toContain('href="/hr')
  expect(html).toContain('action="/auth/logout"')
  expect(html).toContain('aria-current="page"')
  expect(html).toContain('href="#main-content"')
})

test("HR navigation uses existing guarded workflows", () => {
  const html = renderToStaticMarkup(
    createElement(Workspace, {
      principal: { ...principal, role: "hr", employeeId: null },
      period,
      active: "salary",
      children: "Content",
    })
  )
  expect(html).toContain("/hr/salary?year=2026&amp;month=2")
  expect(html).toContain("HR documents")
  expect(html).not.toContain("/employee/")
})

test("period controls label months by name while submitting numeric values", () => {
  const html = renderToStaticMarkup(
    createElement(PeriodPicker, { period, action: "/hr" })
  )
  expect(html).toContain('<option value="2" selected="">February</option>')
  expect(html).toContain("Payroll month")
  expect(html).toContain("December")
  expect(html).toContain('method="get"')
})

test("empty states describe missing data without showing fabricated pay", () => {
  const html = renderToStaticMarkup(
    createElement(EmptyState, {
      title: "No payroll for this month",
      description: "Choose another month.",
    })
  )
  expect(html).toContain("No payroll for this month")
  expect(html).not.toContain("₹")
})

test("payslip UI reads the saved snapshot instead of recomputing it", () => {
  const html = renderToStaticMarkup(
    createElement(PayslipSummary, {
      slip: {
        employeeId: "emp-a",
        year: 2026,
        month: 2,
        currency: "INR",
        monthlyGrossMinor: 120000,
        unpaidDeductionMinor: 0,
        otherDeductionsMinor: 0,
        approvedReimbursementsMinor: 0,
        netMinor: 98765,
      },
    })
  )
  expect(html).toContain("₹987.65")
  expect(html).toContain("Stored monthly amount")
})
