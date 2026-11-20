import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import type { Principal } from "../src/auth/repository.ts"
const model = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock("../src/ai/local.ts", () => ({ invokeLocal: model.invoke }))
import { chat } from "../src/ai/chat.ts"
import { withPayroll } from "../src/payroll-db.ts"
const employee: Principal = {
  userId: "a",
  username: "employee-a",
  role: "employee",
  employeeId: "EMP-A",
}
let directory: string
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "chat-service-"))
  for (const [key, value] of Object.entries({
    PAYROLL_DB: join(directory, "db.sqlite"),
    DATABASE_ENCRYPTION_KEY: "ac".repeat(32),
    AI_DOCUMENTS_ENABLED: "true",
    AI_PROVIDER: "ollama",
    LANGSMITH_TRACING: "false",
    LANGCHAIN_TRACING: "false",
    LANGCHAIN_TRACING_V2: "false",
  }))
    vi.stubEnv(key, value)
  model.invoke.mockReset()
  await withPayroll((db) =>
    db.saveMonth({
      employeeId: "EMP-A",
      year: 2026,
      month: 1,
      annualCtcMinor: 1200000,
      currency: "INR",
      calendarDays: 31,
      unpaidLeaveDays: 0,
      otherDeductionsMinor: 5000,
      claims: [],
      confirmed: true,
    })
  )
})
afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(directory, { recursive: true, force: true })
})
const period = { year: 2026, month: 1 }
test("personal salary answers receive saved records and citations, with previous turns as untrusted context", async () => {
  model.invoke.mockResolvedValue({
    answer:
      "Your net pay is 950.00 INR. The reason for other deductions is not recorded.",
    sourceIndexes: [0],
  })
  const answer = await chat(
    employee,
    period,
    "Why was my salary deducted?",
    [{ role: "user", content: "Explain my payslip" }],
    []
  )
  expect(answer.sources[0].label).toContain("EMP-A")
  expect(answer.answer).toContain("950.00")
  const input = model.invoke.mock.calls[0][2]
  expect(JSON.stringify(input)).toContain("Payroll equation")
  expect(JSON.stringify(input)).not.toContain("EMP-B")
})
test("employee scope is enforced before model work and calculators never call the model", async () => {
  await expect(
    chat(employee, { ...period, employeeId: "EMP-B" }, "salary", [], [])
  ).rejects.toMatchObject({ status: 403 })
  expect(model.invoke).not.toHaveBeenCalled()
  const result = await chat(employee, period, "calculate 20% of 5000", [], [])
  expect(result.calculation).toBe(true)
  expect(result.answer).toContain("= 1000")
  expect(model.invoke).not.toHaveBeenCalled()
})
test("unsupported amounts and invented source references fail rather than reaching the user", async () => {
  model.invoke.mockResolvedValueOnce({
    answer: "Your net is 999999.",
    sourceIndexes: [0],
  })
  await expect(
    chat(employee, period, "My salary?", [], [])
  ).rejects.toMatchObject({ status: 502 })
  model.invoke.mockResolvedValueOnce({
    answer: "Your salary.",
    sourceIndexes: [99],
  })
  await expect(
    chat(employee, period, "My salary?", [], [])
  ).rejects.toMatchObject({ status: 502 })
})
test("general conversation is allowed but uncited personal-finance claims are not", async () => {
  model.invoke.mockResolvedValueOnce({
    answer: "Gross salary is pay before deductions; net pay is what remains.",
    sourceIndexes: [],
  })
  expect(
    (await chat(employee, period, "Explain gross versus net salary", [], []))
      .answer
  ).toContain("General explanation")
  model.invoke.mockResolvedValueOnce({
    answer: "Your employer deducted a tax penalty.",
    sourceIndexes: [],
  })
  const fallback = await chat(
    employee,
    period,
    "Why was my salary deducted?",
    [],
    []
  )
  expect(fallback.answer).toContain("saved payroll summary")
  expect(fallback.answer).toContain("Other deduction reasons are not stored")
  expect(fallback.answer).not.toContain("tax penalty")
  expect(fallback.sources[0].label).toContain("Saved payslip")
})
