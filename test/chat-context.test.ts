import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { withPayroll } from "../src/payroll-db.ts"
import {
  loadChatContext,
  scopedEmployee,
  policyVisibility,
} from "../src/ai/context.ts"
import type { Principal } from "../src/auth/repository.ts"
const employee: Principal = {
  userId: "a",
  username: "employee-a",
  role: "employee",
  employeeId: "EMP-A",
}
const hr: Principal = {
  userId: "hr",
  username: "hr",
  role: "hr",
  employeeId: null,
}
let directory: string
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "chat-context-"))
  vi.stubEnv("PAYROLL_DB", join(directory, "db.sqlite"))
  await withPayroll(async (db) => {
    for (const employeeId of ["EMP-A", "EMP-B"])
      await db.saveMonth({
        employeeId,
        year: 2026,
        month: 1,
        annualCtcMinor: employeeId === "EMP-A" ? 1200000 : 2400000,
        currency: "INR",
        calendarDays: 31,
        unpaidLeaveDays: 0,
        otherDeductionsMinor: 5000,
        claims: [],
        confirmed: true,
      })
    await db.uploadDocument({
      documentId: "published",
      body: "Travel reimbursement receipts must include merchant and date.",
    })
    await db.uploadDocument({
      documentId: "private",
      body: "Travel reimbursement confidential HR review record.",
    })
  })
  policyVisibility("published", true)
})
afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(directory, { recursive: true, force: true })
})
test("employee payroll context is forced to the authenticated employee", async () => {
  expect(() => scopedEmployee(employee, "EMP-B")).toThrow("Access denied")
  const sources = await loadChatContext(
    employee,
    { year: 2026, month: 1 },
    "Why was salary deducted?"
  )
  const text = JSON.stringify(sources)
  expect(text).toContain("EMP-A")
  expect(text).not.toContain("EMP-B")
  expect(text).toContain("5000 minor units")
  expect(text).toContain("Other deduction reasons are not stored")
  expect(text).toContain("Payroll equation")
})
test("HR chooses the employee explicitly and employees only receive published policy text", async () => {
  const hrContext = await loadChatContext(
    hr,
    { employeeId: "EMP-B", year: 2026, month: 1 },
    "Explain salary"
  )
  expect(JSON.stringify(hrContext)).toContain("EMP-B")
  const policies = await loadChatContext(
    employee,
    { year: 2026, month: 1 },
    "Travel reimbursement"
  )
  expect(JSON.stringify(policies)).toContain("published")
  expect(JSON.stringify(policies)).not.toContain("confidential HR")
  const privateHr = await loadChatContext(
    hr,
    { year: 2026, month: 1 },
    "Travel reimbursement"
  )
  expect(JSON.stringify(privateHr)).toContain("confidential HR")
  policyVisibility("published", false)
  expect(
    JSON.stringify(
      await loadChatContext(
        employee,
        { year: 2026, month: 1 },
        "Travel reimbursement"
      )
    )
  ).not.toContain("merchant and date")
})

test("policy updates change searchable text and publication together, defaulting back to private", async () => {
  await withPayroll((db) =>
    db.uploadDocument({
      documentId: "published",
      body: "Travel reimbursement replacement rule requires itemized invoices.",
      shareWithEmployees: true,
    })
  )
  const shared = await loadChatContext(
    employee,
    { year: 2026, month: 1 },
    "Travel reimbursement"
  )
  expect(JSON.stringify(shared)).toContain("itemized invoices")
  expect(JSON.stringify(shared)).not.toContain("merchant and date")
  await withPayroll((db) =>
    db.uploadDocument({
      documentId: "published",
      body: "Travel reimbursement confidential replacement rule.",
    })
  )
  expect(
    JSON.stringify(
      await loadChatContext(
        employee,
        { year: 2026, month: 1 },
        "Travel reimbursement"
      )
    )
  ).not.toContain("confidential replacement")
  expect(
    JSON.stringify(
      await loadChatContext(
        hr,
        { year: 2026, month: 1 },
        "Travel reimbursement"
      )
    )
  ).toContain("confidential replacement")
})
