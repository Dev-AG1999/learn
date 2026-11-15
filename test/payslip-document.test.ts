import assert from "node:assert/strict"
import { test } from "vitest"
import { payslipPdf, payslipText } from "../src/payslip-document.ts"
import type { StoredPayslip } from "../src/db/sqlite-payroll.ts"

const slip: StoredPayslip = {
  employeeId: "syn-00001",
  year: 2026,
  month: 1,
  currency: "INR",
  monthlyGrossMinor: 100_001,
  unpaidDeductionMinor: 0,
  otherDeductionsMinor: 0,
  approvedReimbursementsMinor: 0,
  netMinor: 100_001,
}

test("the employee view shows the stored payslip and nothing else", () => {
  assert.deepEqual(payslipText(slip), [
    "Employee syn-00001",
    "Period 2026-01",
    "Currency INR",
    "Monthly gross 100001",
    "Unpaid deduction 0",
    "Other deductions 0",
    "Approved reimbursements 0",
    "Net 100001",
  ])
})

test("a missing payslip is stated as missing", () => {
  assert.deepEqual(payslipText(null), ["No payslip"])
})

test("the PDF download is the stored payslip", () => {
  const bytes = payslipPdf(slip)
  const text = new TextDecoder().decode(bytes)
  assert.equal(text.startsWith("%PDF-1.4"), true)
  assert.equal(text.includes("Net 100001"), true)
  assert.equal(text.includes("Monthly gross 100001"), true)
  assert.equal(text.includes("PF"), false)
  assert.equal(text.includes("ESI"), false)
})
