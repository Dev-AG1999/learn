import { expect, test, vi } from "vitest"
const mocks = vi.hoisted(() => ({ save: vi.fn(), revalidate: vi.fn(), auth: vi.fn() }))
vi.mock("../src/auth/next.ts", () => ({ requireHrAction: mocks.auth }))
vi.mock("next/cache.js", () => ({ revalidatePath: mocks.revalidate }))
vi.mock("../src/payroll-db.ts", () => ({ withPayroll: (run: (db: unknown) => unknown) => run({}) }))
vi.mock("../src/salary-editor.ts", () => ({ saveSalaryEditor: mocks.save }))
import { saveSalary } from "../app/hr/salary/actions.ts"

test("validation failure retains entered values and returns actionable feedback", async () => {
  mocks.save.mockResolvedValue({ ok: false, failures: ["Invalid amount"] })
  const form = new FormData(); form.set("annualCtcMinor", "-5")
  const state = await saveSalary({ ok: false, messages: [] }, form)
  expect(state.ok).toBe(false)
  expect(state.messages).toEqual(["Invalid amount"])
  expect(state.values?.annualCtcMinor).toBe("-5")
})

test("successful save refreshes the dashboard and employee view", async () => {
  mocks.save.mockResolvedValue({ ok: true, payslip: { employeeId: "emp-a" } })
  expect((await saveSalary({ ok: false, messages: [] }, new FormData())).ok).toBe(true)
  expect(mocks.revalidate).toHaveBeenCalledWith("/hr")
  expect(mocks.revalidate).toHaveBeenCalledWith("/employee/emp-a")
})

test("unexpected storage errors return safe feedback", async () => {
  mocks.save.mockRejectedValue(new Error("internal database detail"))
  const state = await saveSalary({ ok: false, messages: [] }, new FormData())
  expect(state.ok).toBe(false)
  expect(state.messages.join()).not.toContain("internal database detail")
})

test("unauthenticated salary actions never reach payroll persistence", async () => {
  const { AuthError } = await import("../src/auth/http.ts")
  mocks.save.mockClear()
  mocks.auth.mockRejectedValueOnce(new AuthError(401))
  const state = await saveSalary({ ok: false, messages: [] }, new FormData())
  expect(state.ok).toBe(false)
  expect(state.messages).toEqual(["Authentication required."])
  expect(mocks.save).not.toHaveBeenCalled()
})

test("non-HR salary actions never reach payroll persistence", async () => {
  const { AuthError } = await import("../src/auth/http.ts")
  mocks.save.mockClear()
  mocks.auth.mockRejectedValueOnce(new AuthError(403))
  const state = await saveSalary({ ok: false, messages: [] }, new FormData())
  expect(state.messages).toEqual(["Access denied."])
  expect(mocks.save).not.toHaveBeenCalled()
})
