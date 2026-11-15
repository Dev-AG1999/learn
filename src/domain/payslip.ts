export type PayslipInput = {
  annualCtcMinor: number
  currency: string
  calendarDays: number
  unpaidLeaveDays: number
  otherDeductionsMinor: number
  approvedReimbursementsMinor: number
}

export type Payslip = {
  currency: string
  monthlyGrossMinor: number
  unpaidDeductionMinor: number
  otherDeductionsMinor: number
  approvedReimbursementsMinor: number
  netMinor: number
}

export type PayrollValidationInput = {
  unpaidLeaveDays: number
  calendarDays: number
}

function assertMinorUnit(value: number): void {
  if (!Number.isSafeInteger(value)) {
    throw new Error("insufficient context")
  }
}

function exactQuotient(numerator: number, denominator: number): number {
  assertMinorUnit(numerator)
  assertMinorUnit(denominator)
  if (denominator === 0 || numerator % denominator !== 0) {
    throw new Error("insufficient context")
  }
  return numerator / denominator
}

export function computePayslip(input: PayslipInput): Payslip {
  assertMinorUnit(input.annualCtcMinor)
  assertMinorUnit(input.calendarDays)
  assertMinorUnit(input.unpaidLeaveDays)
  assertMinorUnit(input.otherDeductionsMinor)
  assertMinorUnit(input.approvedReimbursementsMinor)

  const monthlyGrossMinor = exactQuotient(input.annualCtcMinor, 12)
  const unpaidDeductionMinor =
    input.unpaidLeaveDays === 0
      ? 0
      : input.unpaidLeaveDays * exactQuotient(monthlyGrossMinor, input.calendarDays)
  const netMinor =
    monthlyGrossMinor -
    unpaidDeductionMinor -
    input.otherDeductionsMinor +
    input.approvedReimbursementsMinor

  return {
    currency: input.currency,
    monthlyGrossMinor,
    unpaidDeductionMinor,
    otherDeductionsMinor: input.otherDeductionsMinor,
    approvedReimbursementsMinor: input.approvedReimbursementsMinor,
    netMinor,
  }
}

export function validatePayrollInput(input: PayrollValidationInput): string[] {
  if (input.unpaidLeaveDays > input.calendarDays) {
    return ["unpaid days ≤ calendar days"]
  }
  return []
}
