import type { PayrollRepository, SaveMonthResult } from "./db/sqlite-payroll.ts"

export async function readSalaryEditor(db: PayrollRepository, employeeId: string, year: number, month: number) {
  const [inputs, payslip, leave, claims, version] = await Promise.all([
    db.getSalaryInputs(employeeId, year, month), db.get(employeeId, year, month),
    db.getLeave(employeeId, year, month), db.getClaims(employeeId, year, month), db.getSalaryVersion(employeeId, year, month),
  ])
  if (!inputs) return null
  const data = { inputs, payslip, leave, claims }
  return { ...data, version }
}

export async function saveSalaryEditor(db: PayrollRepository, form: FormData): Promise<SaveMonthResult> {
  const text = (key: string) => typeof form.get(key) === "string" ? String(form.get(key)) : ""
  const integer = (key: string) => /^\d+$/.test(text(key)) ? Number(text(key)) : NaN
  const employeeId = text("employeeId")
  const year = integer("year"), month = integer("month")
  if (!Number.isInteger(year) || year < 1900 || year > 9999 || month < 1 || month > 12 || !Number.isInteger(month)) return { ok: false, failures: ["Select a valid payroll period."] }
  const current = await readSalaryEditor(db, employeeId, year, month)
  if (!current) return { ok: false, failures: ["Employee not found."] }
  if (current.version !== text("version")) return { ok: false, failures: ["Payroll changed since this form was opened. Reload before editing."] }
  const currency = text("currency")
  if (current.claims.length && currency !== current.inputs.currency) return { ok: false, failures: ["Currency cannot change while this month has claims."] }
  return db.saveMonth({ expectedVersion: current.version, employeeId, year, month, annualCtcMinor: integer("annualCtcMinor"), currency,
    calendarDays: new Date(Date.UTC(year, month, 0)).getUTCDate(), unpaidLeaveDays: integer("unpaidLeaveDays"),
    otherDeductionsMinor: integer("otherDeductionsMinor"), claims: current.claims, confirmed: text("confirmed") === "yes" })
}
