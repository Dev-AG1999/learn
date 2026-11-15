"use server"

import { revalidatePath } from "next/cache.js"
import { withPayroll } from "../../../src/payroll-db.ts"
import { saveSalaryEditor } from "../../../src/salary-editor.ts"

export type SalaryState = { ok: boolean; messages: string[]; values?: Record<string, string> }

export async function saveSalary(_previous: SalaryState, form: FormData): Promise<SalaryState> {
  const values = Object.fromEntries(["annualCtcMinor", "currency", "unpaidLeaveDays", "otherDeductionsMinor"].map(key => [key, String(form.get(key) ?? "")]))
  try {
    const result = await withPayroll(db => saveSalaryEditor(db, form))
    if (!result.ok) return { ok: false, messages: result.failures, values }
    revalidatePath("/hr")
    revalidatePath("/hr/salary")
    revalidatePath(`/employee/${encodeURIComponent(result.payslip.employeeId)}`)
    return { ok: true, messages: ["Salary saved. Reload the editor before making another change."] }
  } catch {
    return { ok: false, messages: ["Salary could not be saved. Please retry."], values }
  }
}
