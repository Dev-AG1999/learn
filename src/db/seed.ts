import type { PayrollRepository, SaveMonthInput } from "./sqlite-payroll.ts"

const currencies = ["EUR", "INR", "USD"] as const

export function syntheticMonth(index: number): SaveMonthInput {
  return {
    employeeId: `syn-${String(index).padStart(5, "0")}`,
    year: 2026,
    month: 1,
    annualCtcMinor: 1_200_000 + index * 12,
    currency: currencies[index % currencies.length],
    calendarDays: 31,
    unpaidLeaveDays: 0,
    otherDeductionsMinor: 0,
    claims: [],
    confirmed: true,
  }
}

export async function seedSyntheticEmployees(
  db: PayrollRepository,
  count = 10_000,
): Promise<number> {
  for (let index = 1; index <= count; index += 1) {
    const saved = await db.saveMonth(syntheticMonth(index))
    if (!saved.ok) {
      throw new Error("insufficient context")
    }
  }
  return count
}
