import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeEach, afterEach, expect, test, vi } from "vitest"
const mocks = vi.hoisted(() => ({ auth: vi.fn() }))
vi.mock("../src/auth/next.ts", () => ({ requireHrAction: mocks.auth }))
vi.mock("next/navigation.js", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`)
  },
}))
import { previewEmployee } from "../app/hr/employees/new/actions.ts"
import { withPayroll } from "../src/payroll-db.ts"
import { AuthError } from "../src/auth/http.ts"
let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "employee-create-"))
  vi.stubEnv("PAYROLL_DB", join(dir, "db.sqlite"))
  mocks.auth.mockResolvedValue({ userId: "hr-a", role: "hr" })
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  vi.unstubAllEnvs()
})
function form() {
  const result = new FormData()
  for (const [key, value] of Object.entries({
    employeeId: "MANUAL-1",
    year: "2026",
    month: "11",
    annualCtc: "1200000.29",
    currency: "INR",
    unpaidLeaveDays: "0",
    otherDeductions: "1500.50",
  }))
    result.set(key, value)
  return result
}

test("manual entry stages exact rupee amounts and redirects to a private review without writing payroll", async () => {
  let location = ""
  try {
    await previewEmployee({ failures: [] }, form())
  } catch (error) {
    location = (error as Error).message
  }
  expect(location).toContain("redirect:/hr/import/review/")
  const id = location.split("/").pop()!
  const draft = await withPayroll((db) => db.getPayrollDraft(id, "hr-a", 1))
  expect(draft?.rows[0].annualCtcMinor).toBe(120000029)
  expect(draft?.rows[0].otherDeductionsMinor).toBe(150050)
  expect(await withPayroll((db) => db.get("MANUAL-1", 2026, 11))).toBeNull()
})

test("invalid fields keep entered values and do not create a review", async () => {
  const data = form()
  data.set("annualCtc", "-5")
  const result = await previewEmployee({ failures: [] }, data)
  expect(result.failures.join()).toContain("valid annual CTC")
  expect(result.values?.annualCtc).toBe("-5")
})

test.each([401, 403] as const)(
  "unauthorized manual entry is blocked with %s",
  async (status) => {
    mocks.auth.mockRejectedValueOnce(new AuthError(status))
    const result = await previewEmployee({ failures: [] }, form())
    expect(result.failures[0]).toBe(
      status === 401 ? "Authentication required." : "Access denied."
    )
  }
)
