import { NEW_EMPLOYEE_ID } from "../employee-id.ts"
import { validatePayrollInput } from "../domain/payslip.ts"
import { validateSalary } from "../salary-validation.ts"
import { MAX_IMPORT_ROWS, type PayrollEntry, type RowFailure } from "./types.ts"

export const columns = [
  "employeeId",
  "year",
  "month",
  "annualCtcMinor",
  "currency",
  "unpaidLeaveDays",
  "otherDeductionsMinor",
] as const

export function validateEntries(rows: readonly PayrollEntry[]): RowFailure[] {
  if (!rows.length || rows.length > MAX_IMPORT_ROWS)
    return [
      {
        row: 0,
        message: `Provide between 1 and ${MAX_IMPORT_ROWS.toLocaleString("en")} employee rows.`,
      },
    ]
  const failures: RowFailure[] = []
  const seen = new Set<string>()
  const period = rows[0]
  rows.forEach((row, index) => {
    const errors = [
      ...validateSalary({ ...row, claims: [], confirmed: true }),
      ...validatePayrollInput(row),
    ]
    if (!NEW_EMPLOYEE_ID.test(row.employeeId))
      errors.push(
        "Employee ID must be 1–64 letters, digits, hyphens or underscores and start with a letter or digit."
      )
    if (
      Number.isInteger(row.year) &&
      row.year >= 1900 &&
      row.year <= 9999 &&
      row.month >= 1 &&
      row.month <= 12 &&
      row.calendarDays !==
        new Date(Date.UTC(row.year, row.month, 0)).getUTCDate()
    )
      errors.push("Calendar days must match the selected payroll month.")
    if (seen.has(row.employeeId))
      errors.push("Duplicate employee ID in this sheet.")
    seen.add(row.employeeId)
    if (row.year !== period.year || row.month !== period.month)
      errors.push("Use one payroll month per sheet.")
    for (const message of errors) failures.push({ row: index + 2, message })
  })
  return failures
}

export function integer(value: string): number {
  return /^\d+$/.test(value) ? Number(value) : NaN
}

export function rowToEntry(values: Record<string, string>): PayrollEntry {
  const year = integer(values.year ?? ""),
    month = integer(values.month ?? "")
  return {
    employeeId: (values.employeeId ?? "").trim(),
    year,
    month,
    annualCtcMinor: integer(values.annualCtcMinor ?? ""),
    currency: (values.currency ?? "").trim().toUpperCase(),
    unpaidLeaveDays: integer(values.unpaidLeaveDays ?? ""),
    otherDeductionsMinor: integer(values.otherDeductionsMinor ?? ""),
    calendarDays:
      Number.isInteger(year) &&
      Number.isInteger(month) &&
      month >= 1 &&
      month <= 12
        ? new Date(Date.UTC(year, month, 0)).getUTCDate()
        : NaN,
  }
}

// Decimal string conversion avoids floating-point rounding of HR-entered money.
export function moneyToMinor(value: string, currency: string): number {
  if (!(Intl.supportedValuesOf("currency") as string[]).includes(currency))
    return NaN
  const digits =
    new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2
  if (!/^\d+(?:\.\d+)?$/.test(value) || value.length > 24) return NaN
  const [whole, fraction = ""] = value.split(".")
  if (fraction.length > digits) return NaN
  const result =
    BigInt(whole) * 10n ** BigInt(digits) +
    BigInt(fraction.padEnd(digits, "0") || "0")
  return result <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result) : NaN
}

export function manualEntry(form: FormData): PayrollEntry {
  const text = (key: string) =>
    typeof form.get(key) === "string" ? String(form.get(key)).trim() : ""
  const currency = text("currency").toUpperCase()
  const row = rowToEntry(
    Object.fromEntries(columns.map((key) => [key, text(key)]))
  )
  return {
    ...row,
    annualCtcMinor: moneyToMinor(text("annualCtc"), currency),
    otherDeductionsMinor: moneyToMinor(text("otherDeductions"), currency),
  }
}
