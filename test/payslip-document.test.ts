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
    "Monthly gross INR 1000.01",
    "Unpaid deduction INR 0.00",
    "Other deductions INR 0.00",
    "Approved reimbursements INR 0.00",
    "Net INR 1000.01",
  ])
})

test("a missing payslip is stated as missing", () => {
  assert.deepEqual(payslipText(null), ["No payslip"])
})

test("the PDF download is the stored payslip", () => {
  const bytes = payslipPdf(slip)
  const text = new TextDecoder().decode(bytes)
  assert.equal(text.startsWith("%PDF-1.4"), true)
  assert.equal(text.includes("Net INR 1000.01"), true)
  assert.equal(text.includes("Monthly gross INR 1000.01"), true)
  assert.equal(text.includes("PF"), false)
  assert.equal(text.includes("ESI"), false)
})

test("PDF salary text uses exact currency precision, including negative net and largest safe minor units", () => {
  assert.ok(
    payslipText({ ...slip, otherDeductionsMinor: 5000 }).includes(
      "Other deductions INR 50.00"
    )
  )
  assert.ok(
    payslipText({ ...slip, currency: "JPY", netMinor: 123 }).includes(
      "Net JPY 123"
    )
  )
  assert.ok(
    payslipText({ ...slip, currency: "KWD", netMinor: 1234 }).includes(
      "Net KWD 1.234"
    )
  )
  assert.ok(payslipText({ ...slip, netMinor: -123 }).includes("Net INR -1.23"))
  assert.ok(
    payslipText({ ...slip, netMinor: Number.MAX_SAFE_INTEGER }).includes(
      "Net INR 90071992547409.91"
    )
  )
  assert.throws(
    () => payslipText({ ...slip, netMinor: Number.MAX_SAFE_INTEGER + 1 }),
    /Invalid payslip amount/
  )
})
