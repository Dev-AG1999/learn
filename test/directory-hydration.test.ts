import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, expect, test, vi } from "vitest"
import { EmployeeDirectory } from "../app/hr/employees/directory.tsx"

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
