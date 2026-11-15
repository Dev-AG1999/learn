import assert from "node:assert/strict"
import { test } from "vitest"
import {
  computePayslip,
  roundHalfAwayFromZero,
  validatePayrollInput,
} from "../src/domain/payslip.ts"

const exactMonth = {
  annualCtcMinor: 1_440_000,
  currency: "INR",
  calendarDays: 30,
  unpaidLeaveDays: 0,
  otherDeductionsMinor: 0,
  approvedReimbursementsMinor: 0,
}

test("monthly gross is annual CTC divided by 12", () => {
  const slip = computePayslip(exactMonth)
  assert.equal(slip.monthlyGrossMinor, 120_000)
  assert.equal(slip.currency, "INR")
})

test("currency is stored and does not change the amounts", () => {
  const slip = computePayslip({ ...exactMonth, currency: "USD" })
  assert.equal(slip.currency, "USD")
  assert.equal(slip.monthlyGrossMinor, 120_000)
  assert.equal(slip.netMinor, 120_000)
})

test("paid leave does not reduce pay", () => {
  const slip = computePayslip(exactMonth)
  assert.equal(slip.unpaidDeductionMinor, 0)
  assert.equal(slip.netMinor, 120_000)
})

test("unpaid deduction is unpaid days times monthly gross over calendar days", () => {
  const slip = computePayslip({ ...exactMonth, unpaidLeaveDays: 2 })
  assert.equal(slip.unpaidDeductionMinor, 8_000)
  assert.equal(slip.netMinor, 112_000)
})

test("other deductions reduce net and approved reimbursements increase it", () => {
  const slip = computePayslip({
    ...exactMonth,
    unpaidLeaveDays: 2,
    otherDeductionsMinor: 500,
    approvedReimbursementsMinor: 200,
  })
  assert.deepEqual(slip, {
    currency: "INR",
    monthlyGrossMinor: 120_000,
    unpaidDeductionMinor: 8_000,
    otherDeductionsMinor: 500,
    approvedReimbursementsMinor: 200,
    netMinor: 111_700,
  })
})

test("the payslip has no tax, PF, or ESI amount", () => {
  const slip = computePayslip(exactMonth)
  assert.deepEqual(Object.keys(slip).sort(), [
    "approvedReimbursementsMinor",
    "currency",
    "monthlyGrossMinor",
    "netMinor",
    "otherDeductionsMinor",
    "unpaidDeductionMinor",
  ])
})

test("a non-integer minor unit is not a payslip result", () => {
  assert.throws(
    () => computePayslip({ ...exactMonth, annualCtcMinor: 1_440_000.5 }),
    /insufficient context/,
  )
})

test("PAY-12 monthly gross rounds 0.5 away from zero", () => {
  const slip = computePayslip({ ...exactMonth, annualCtcMinor: 6 })
  assert.equal(slip.monthlyGrossMinor, 1)
})

test("PAY-13 monthly gross rounds 1.5 away from zero", () => {
  const slip = computePayslip({ ...exactMonth, annualCtcMinor: 18 })
  assert.equal(slip.monthlyGrossMinor, 2)
})

test("PAY-14 monthly gross below half rounds toward zero", () => {
  const slip = computePayslip({ ...exactMonth, annualCtcMinor: 100 })
  assert.equal(slip.monthlyGrossMinor, 8)
})

test("PAY-15 daily rate rounds half away from zero", () => {
  const slip = computePayslip({
    ...exactMonth,
    annualCtcMinor: 120,
    calendarDays: 4,
    unpaidLeaveDays: 1,
  })
  assert.equal(slip.monthlyGrossMinor, 10)
  assert.equal(slip.unpaidDeductionMinor, 3)
})

test("PAY-16 unpaid deduction uses the rounded daily rate", () => {
  const slip = computePayslip({
    ...exactMonth,
    annualCtcMinor: 120,
    calendarDays: 4,
    unpaidLeaveDays: 2,
    otherDeductionsMinor: 0,
    approvedReimbursementsMinor: 0,
  })
  assert.equal(slip.unpaidDeductionMinor, 6)
  assert.equal(slip.netMinor, slip.monthlyGrossMinor - 6)
})

test("PAY-17 half rounds away from zero for a negative value", () => {
  assert.equal(roundHalfAwayFromZero(-1.5), -2)
})

test("one unpaid day in a 31-day month uses the rounded daily rate", () => {
  const slip = computePayslip({
    ...exactMonth,
    calendarDays: 31,
    unpaidLeaveDays: 1,
  })
  assert.equal(slip.monthlyGrossMinor, 120_000)
  assert.equal(slip.unpaidDeductionMinor, 3_871)
  assert.equal(slip.netMinor, 116_129)
})

test("unpaid days above the calendar days fail validation", () => {
  assert.deepEqual(
    validatePayrollInput({ unpaidLeaveDays: 31, calendarDays: 30 }),
    ["unpaid days ≤ calendar days"],
  )
})

test("unpaid days within the calendar days pass validation", () => {
  assert.deepEqual(
    validatePayrollInput({ unpaidLeaveDays: 30, calendarDays: 30 }),
    [],
  )
  assert.deepEqual(
    validatePayrollInput({ unpaidLeaveDays: 0, calendarDays: 30 }),
    [],
  )
})
