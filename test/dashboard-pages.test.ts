import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
const mocks = vi.hoisted(() => ({
  principal: {
    userId: "hr-a",
    username: "hr@example.com",
    role: "hr",
    employeeId: null as string | null,
  },
}))
vi.mock("../src/auth/next.ts", () => ({
  requirePage: vi.fn(async () => mocks.principal),
  currentPrincipal: vi.fn(async () => mocks.principal),
  pagePrincipal: vi.fn(async () => mocks.principal),
  pageReturnTo: (path: string) => path,
}))
vi.mock("next/navigation.js", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`)
  },
}))
vi.mock("../app/hr/salary/actions.ts", () => ({ saveSalary: vi.fn() }))
vi.mock("../app/hr/employees/new/actions.ts", () => ({
  previewEmployee: vi.fn(),
}))
import EmployeesPage from "../app/hr/employees/page.tsx"
import NewEmployeePage from "../app/hr/employees/new/page.tsx"
import ImportPage from "../app/hr/import/page.tsx"
import ReviewPage from "../app/hr/import/review/[draftId]/page.tsx"
import HrPage from "../app/hr/page.tsx"
import SalaryPage from "../app/hr/salary/page.tsx"
import EmployeePage from "../app/employee/[employeeId]/page.tsx"
import HomePage from "../app/page.tsx"
import { withPayroll } from "../src/payroll-db.ts"

let dir: string
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "paydesk-ui-"))
  vi.stubEnv("PAYROLL_DB", join(dir, "payroll.sqlite"))
  mocks.principal = {
    userId: "hr-a",
    username: "hr@example.com",
    role: "hr",
    employeeId: null,
  }
  await withPayroll(async (db) => {
    await db.saveMonth({
      employeeId: "emp-a",
      year: 2026,
      month: 1,
      annualCtcMinor: 1200000,
      currency: "INR",
      calendarDays: 31,
      unpaidLeaveDays: 0,
      otherDeductionsMinor: 0,
      confirmed: true,
      claims: [],
    })
  })
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

test("HR dashboard loads the requested saved payroll with named periods and formatted totals", async () => {
  const html = renderToStaticMarkup(
    await HrPage({
      searchParams: Promise.resolve({ year: "2026", month: "1" }),
    })
  )
  expect(html).toContain("January 2026")
  expect(html).toContain("₹1,000.00")
  expect(html).toContain("Monthly payroll")
  expect(html).toContain("Reimbursement inbox")
  expect(html).toContain('name="body"')
})

test("a month with no rows has an honest empty state and cannot display another month's totals", async () => {
  const html = renderToStaticMarkup(
    await HrPage({
      searchParams: Promise.resolve({ year: "2026", month: "2" }),
    })
  )
  expect(html).toContain("No payroll for this month")
  expect(html).not.toContain("₹1,000.00")
  expect(html).toContain("February 2026")
})

test("invalid month does not render payroll for a different period", async () => {
  const html = renderToStaticMarkup(
    await HrPage({
      searchParams: Promise.resolve({ year: "2026", month: "13" }),
    })
  )
  expect(html).toContain("Choose a valid payroll month")
  expect(html).not.toContain("₹1,000.00")
})

test("salary lookup uses named months and keeps saved monetary inputs", async () => {
  const html = renderToStaticMarkup(
    await SalaryPage({
      searchParams: Promise.resolve({
        year: "2026",
        month: "1",
        employeeId: "emp-a",
      }),
    })
  )
  expect(html).toContain("January 2026")
  expect(html).toContain('value="1200000"')
  expect(html).toContain("₹1,000.00")
  expect(html).toContain("I've reviewed".replace("'", "&#x27;"))
})

test("employee dashboard renders only the requested saved snapshot and a real download link", async () => {
  mocks.principal = {
    userId: "employee-a",
    username: "employee@example.com",
    role: "employee",
    employeeId: "emp-a",
  }
  const html = renderToStaticMarkup(
    await EmployeePage({
      params: Promise.resolve({ employeeId: "emp-a" }),
      searchParams: Promise.resolve({ year: "2026", month: "1" }),
    })
  )
  expect(html).toContain("₹1,000.00")
  expect(html).toContain("/employee/emp-a/download?year=2026&amp;month=1")
  expect(html).toContain("Submit a reimbursement")
  expect(html).not.toContain('href="/hr')
})

test("employee empty state does not offer an unavailable PDF or claim form", async () => {
  mocks.principal = {
    userId: "employee-a",
    username: "employee@example.com",
    role: "employee",
    employeeId: "emp-a",
  }
  const html = renderToStaticMarkup(
    await EmployeePage({
      params: Promise.resolve({ employeeId: "emp-a" }),
      searchParams: Promise.resolve({ year: "2026", month: "2" }),
    })
  )
  expect(html).toContain("No payslip for this month")
  expect(html).not.toContain("Download PDF")
  expect(html).not.toContain("Submit a reimbursement")
})

test("login landing routes users to their own role workspace without a hardcoded month", async () => {
  await expect(HomePage()).rejects.toThrow("redirect:/hr")
  mocks.principal = {
    userId: "employee-a",
    username: "employee@example.com",
    role: "employee",
    employeeId: "emp-a",
  }
  await expect(HomePage()).rejects.toThrow("redirect:/employee/emp-a")
})

test("manual employee entry accepts major currency amounts and offers review before saving", async () => {
  const html = renderToStaticMarkup(
    await NewEmployeePage({
      searchParams: Promise.resolve({ year: "2026", month: "11" }),
    })
  )
  expect(html).toContain('name="annualCtc"')
  expect(html).toContain("Review employee salary")
  expect(html).toContain("November")
  expect(html).toContain("Add an employee")
})

test("salary upload page provides real CSV and Excel templates", async () => {
  const html = renderToStaticMarkup(await ImportPage())
  expect(html).toContain('accept=".csv,.xlsx"')
  expect(html).toContain("/hr/import/template?format=xlsx")
  expect(html).toContain("Validate and review sheet")
  expect(html).toContain("annualCtcMinor")
})

test("review page shows pending records without writing and displays a saved receipt only after commit", async () => {
  const result = await withPayroll((db) =>
    db.stagePayroll({
      ownerId: "hr-a",
      mode: "create",
      source: "Manual",
      rows: [
        {
          employeeId: "REVIEW-1",
          year: 2026,
          month: 11,
          annualCtcMinor: 120000000,
          currency: "INR",
          calendarDays: 30,
          unpaidLeaveDays: 0,
          otherDeductionsMinor: 0,
        },
      ],
    })
  )
  if (!result.ok) throw new Error("Fixture failed")
  const props = {
    params: Promise.resolve({ draftId: result.draftId }),
    searchParams: Promise.resolve({}),
  }
  let html = renderToStaticMarkup(await ReviewPage(props))
  expect(html).toContain("Not saved yet")
  expect(html).toContain("₹12,00,000.00")
  expect(html).toContain('action="/hr/import/commit"')
  expect(await withPayroll((db) => db.get("REVIEW-1", 2026, 11))).toBeNull()
  await withPayroll((db) => db.commitPayrollDraft(result.draftId, "hr-a", true))
  html = renderToStaticMarkup(await ReviewPage(props))
  expect(html).toContain("1 employee salary saved")
  expect(html).not.toContain('action="/hr/import/commit"')
  mocks.principal.userId = "another-hr"
  html = renderToStaticMarkup(await ReviewPage(props))
  expect(html).toContain("This review is unavailable")
  expect(html).not.toContain("₹12,00,000.00")
})

test("employee directory lists saved employees with a link to edit salary", async () => {
  const html = renderToStaticMarkup(
    await EmployeesPage({
      searchParams: Promise.resolve({ year: "2026", month: "1" }),
    })
  )
  expect(html).toContain("emp-a")
  expect(html).toContain("INR ₹1,000.00")
  expect(html).toContain(
    "/hr/salary?employeeId=emp-a&amp;year=2026&amp;month=1"
  )
  expect(html).toContain("1 shown")
})

test("directory search has an honest empty state and invalid filters do not show records", async () => {
  let html = renderToStaticMarkup(
    await EmployeesPage({
      searchParams: Promise.resolve({ q: "MISSING", year: "2026", month: "1" }),
    })
  )
  expect(html).toContain("No matching employees")
  html = renderToStaticMarkup(
    await EmployeesPage({
      searchParams: Promise.resolve({ q: "*", year: "2026", month: "1" }),
    })
  )
  expect(html).toContain("Choose a valid period")
  expect(html).not.toContain("INR ₹1,000.00")
})
