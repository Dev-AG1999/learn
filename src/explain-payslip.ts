import type { StoredPayslip } from "./db/sqlite-payroll.ts"
import { payslipText } from "./payslip-document.ts"

export function explainPayslip(slip: StoredPayslip | null): string {
  if (!slip) return "It does not know."
  return ["The stored payslip shows these figures.", ...payslipText(slip)].join(" ")
}
