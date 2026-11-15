import type { SaveMonthInput } from "./db/sqlite-payroll.ts"

export function validateSalary(input: SaveMonthInput): string[] {
  const failures: string[] = []
  if (!input.employeeId.trim()) failures.push("Employee ID is required.")
  if (!Number.isInteger(input.year) || input.year < 1900 || input.year > 9999 || !Number.isInteger(input.month) || input.month < 1 || input.month > 12) failures.push("Select a valid payroll period.")
  for (const [label, value] of [["Annual CTC", input.annualCtcMinor], ["Other deductions", input.otherDeductionsMinor], ["Unpaid leave days", input.unpaidLeaveDays]] as const) {
    if (!Number.isSafeInteger(value) || value < 0) failures.push(`${label} must be a non-negative safe integer.`)
  }
  if (!Number.isInteger(input.calendarDays) || input.calendarDays < 1 || input.calendarDays > 31) failures.push("Calendar days must be between 1 and 31.")
  if (!(Intl.supportedValuesOf("currency") as string[]).includes(input.currency)) failures.push("Select a supported ISO currency.")
  for (const claim of input.claims) {
    if (!claim.id.trim() || !claim.receipt.trim() || !Number.isSafeInteger(claim.amountMinor) || claim.amountMinor < 0 || !["pending", "approved"].includes(claim.status)) failures.push("Claims require an ID, receipt, valid status and non-negative integer amount.")
  }
  return failures
}
