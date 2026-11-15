import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "vitest"
import { hrAccess } from "../src/access/roles.ts"
import { openPayrollDatabase } from "../src/db/sqlite-payroll.ts"
import { explainPayslip } from "../src/explain-payslip.ts"
import { flagUnreadableReceipt } from "../src/receipt-flag.ts"
import type { StoredPayslip } from "../src/db/sqlite-payroll.ts"

const slip: StoredPayslip = {
  employeeId: "emp-a",
  year: 2026,
  month: 3,
  currency: "USD",
  monthlyGrossMinor: 120_000,
  unpaidDeductionMinor: 0,
  otherDeductionsMinor: 0,
  approvedReimbursementsMinor: 200,
  netMinor: 120_200,
}

test("the employee explanation shows the stored figures", () => {
  const text = explainPayslip(slip)
  assert.equal(text.includes("120200"), true)
  assert.equal(text.includes("120000"), true)
  assert.equal(text.includes("200"), true)
  assert.equal(text.includes("USD"), true)
})

test("no payslip means the assistant does not know", () => {
  assert.equal(explainPayslip(null), "It does not know.")
})

test("an HR answer requires a citation from an uploaded document", async () => {
  const dir = mkdtempSync(join(tmpdir(), "payroll-docs-"))
  const db = openPayrollDatabase(join(dir, "payroll.sqlite"))
  const hr = hrAccess(db)
  await hr.saveMonth({
    employeeId: "emp-a",
    year: 2026,
    month: 3,
    annualCtcMinor: 1_440_000,
    currency: "USD",
    calendarDays: 31,
    unpaidLeaveDays: 0,
    otherDeductionsMinor: 0,
    claims: [{ id: "claim-1", amountMinor: 200, status: "pending", receipt: "receipt-1" }],
    confirmed: true,
  })
  await hr.uploadDocument({
    documentId: "doc-1",
    body: "The handbook says approved receipts are reimbursed.",
  })
  assert.deepEqual(await hr.answerFromDocuments("approved receipts"), {
    citation: "doc-1",
    answer: "The handbook says approved receipts are reimbursed.",
  })
  assert.equal(await hr.answerFromDocuments("tax rules"), null)
  assert.equal((await db.getClaims("emp-a", 2026, 3))[0]?.status, "pending")
  assert.equal((await db.get("emp-a", 2026, 3))?.netMinor, 120_000)
  db.close()
})

test("an unreadable receipt is flagged and the stored amount stays", async () => {
  const dir = mkdtempSync(join(tmpdir(), "payroll-flag-"))
  const db = openPayrollDatabase(join(dir, "payroll.sqlite"))
  const hr = hrAccess(db)
  await hr.saveMonth({
    employeeId: "emp-a",
    year: 2026,
    month: 3,
    annualCtcMinor: 1_440_000,
    currency: "USD",
    calendarDays: 31,
    unpaidLeaveDays: 0,
    otherDeductionsMinor: 0,
    claims: [{ id: "claim-1", amountMinor: 200, status: "pending", receipt: "???" }],
    confirmed: true,
  })
  assert.equal(flagUnreadableReceipt("???"), "unreadable receipt")
  assert.equal(flagUnreadableReceipt("receipt-1"), null)
  assert.equal((await db.getClaims("emp-a", 2026, 3))[0]?.amountMinor, 200)
  assert.equal((await db.get("emp-a", 2026, 3))?.netMinor, 120_000)
  db.close()
})
