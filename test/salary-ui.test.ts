import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, test, vi } from "vitest"
vi.mock("../app/hr/salary/actions.ts", () => ({ saveSalary: vi.fn() }))
import { SalaryEditor } from "../app/hr/salary/editor.tsx"

test("salary form shows labelled saved values, confirmation and server action controls", () => {
  const html = renderToStaticMarkup(
    createElement(SalaryEditor, {
      employeeId: "emp-a",
      year: 2026,
      month: 2,
      version: "version-a",
      annualCtcMinor: 1440000,
      currency: "INR",
      unpaidLeaveDays: 2,
      otherDeductionsMinor: 500,
      currencies: [
        {
          code: "INR",
          help: "100 minor units = ₹1.00. Enter whole minor units below.",
        },
      ],
    })
  )
  expect(html).toContain('name="annualCtcMinor"')
  expect(html).toContain('value="1440000"')
  expect(html).toContain('max="28"')
  expect(html).toContain('name="confirmed"')
  expect(html).toContain('required=""')
  expect(html).toContain('name="version"')
  expect(html).toContain("Confirm and save salary")
  expect(html).toContain(
    "Existing claims and their approval statuses are preserved"
  )
  expect(html).toContain('aria-live="polite"')
})
