import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, expect, test, vi } from "vitest"
vi.mock("../app/hr/salary/actions.ts", () => ({ saveSalary: vi.fn() }))
vi.mock("../app/hr/employees/new/actions.ts", () => ({
  previewEmployee: vi.fn(),
}))
import { SalaryEditor } from "../app/hr/salary/editor.tsx"
import { EmployeeForm } from "../app/hr/employees/new/employee-form.tsx"
import { currencyChoices } from "../src/presentation.ts"

afterEach(() => vi.restoreAllMocks())

test("manual employee form uses server-supplied currency order despite browser ICU differences", () => {
  const props = {
    period: { year: 2026, month: 11 },
    currencies: ["INR", "SLE", "XCG", "ZWG"],
  }
  const serverHtml = renderToStaticMarkup(createElement(EmployeeForm, props))
  const browserIntl = vi
    .spyOn(Intl, "supportedValuesOf")
    .mockReturnValue(["USD", "INR"])
  const clientHtml = renderToStaticMarkup(createElement(EmployeeForm, props))
  expect(clientHtml).toBe(serverHtml)
  expect(clientHtml).toContain("<option>XCG</option>")
  expect(browserIntl).not.toHaveBeenCalled()
})

test("salary editor renders the same options and money help when browser Intl differs", () => {
  const currencies = currencyChoices()
  const props = {
    employeeId: "emp-a",
    year: 2026,
    month: 11,
    version: "snapshot",
    annualCtcMinor: 120000000,
    currency: "INR",
    unpaidLeaveDays: 0,
    otherDeductionsMinor: 0,
    currencies,
  }
  const serverHtml = renderToStaticMarkup(createElement(SalaryEditor, props))
  const browserCurrencies = vi
    .spyOn(Intl, "supportedValuesOf")
    .mockReturnValue(["USD"])
  const browserMoney = vi.spyOn(Intl, "NumberFormat").mockImplementation(() => {
    throw new Error(
      "Client-side locale data must not be used for initial salary markup."
    )
  })
  const clientHtml = renderToStaticMarkup(createElement(SalaryEditor, props))
  expect(clientHtml).toBe(serverHtml)
  expect(clientHtml).toContain("100 minor units = ₹1.00")
  expect(browserCurrencies).not.toHaveBeenCalled()
  expect(browserMoney).not.toHaveBeenCalled()
})
