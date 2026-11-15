import type { StoredPayslip } from "./db/sqlite-payroll.ts"

export function payslipText(slip: StoredPayslip | null): string[] {
  if (!slip) return ["No payslip"]
  return [
    `Employee ${slip.employeeId}`,
    `Period ${slip.year}-${String(slip.month).padStart(2, "0")}`,
    `Currency ${slip.currency}`,
    `Monthly gross ${slip.monthlyGrossMinor}`,
    `Unpaid deduction ${slip.unpaidDeductionMinor}`,
    `Other deductions ${slip.otherDeductionsMinor}`,
    `Approved reimbursements ${slip.approvedReimbursementsMinor}`,
    `Net ${slip.netMinor}`,
  ]
}

function escapePdfText(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)")
}

export function payslipPdf(slip: StoredPayslip): Uint8Array {
  const stream = payslipText(slip)
    .map((line, index) => `BT /F1 12 Tf 50 ${760 - index * 18} Td (${escapePdfText(line)}) Tj ET`)
    .join("\n")
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
    "2 0 obj << /Type /Pages /Count 1 /Kids [3 0 R] >> endobj\n",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n",
    `4 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj\n`,
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n",
  ]
  let body = "%PDF-1.4\n"
  const offsets: number[] = []
  for (const object of objects) {
    offsets.push(body.length)
    body += object
  }
  const xrefOffset = body.length
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, "0")} 00000 n \n`
  }
  xref += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  return new TextEncoder().encode(body + xref)
}
