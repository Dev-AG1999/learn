import type { StoredPayslip } from "./db/sqlite-payroll.ts"

export function payslipText(slip: StoredPayslip | null): string[] {
  if (!slip) return ["No payslip"]
  // Keep PDF text ASCII for the built-in Helvetica font and format exactly from
  // integer minor units. Raw minor-unit values must never look like currency pay.
  const digits =
    new Intl.NumberFormat("en", {
      style: "currency",
      currency: slip.currency,
    }).resolvedOptions().maximumFractionDigits ?? 2
  const scale = 10n ** BigInt(digits)
  const amount = (minor: number) => {
    if (!Number.isSafeInteger(minor)) throw new Error("Invalid payslip amount.")
    const signed = BigInt(minor)
    const value = signed < 0n ? -signed : signed
    const fraction = digits
      ? `.${String(value % scale).padStart(digits, "0")}`
      : ""
    return `${slip.currency} ${signed < 0n ? "-" : ""}${value / scale}${fraction}`
  }
  return [
    `Employee ${slip.employeeId}`,
    `Period ${slip.year}-${String(slip.month).padStart(2, "0")}`,
    `Currency ${slip.currency}`,
    `Monthly gross ${amount(slip.monthlyGrossMinor)}`,
    `Unpaid deduction ${amount(slip.unpaidDeductionMinor)}`,
    `Other deductions ${amount(slip.otherDeductionsMinor)}`,
    `Approved reimbursements ${amount(slip.approvedReimbursementsMinor)}`,
    `Net ${amount(slip.netMinor)}`,
  ]
}

function escapePdfText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)")
}

export function payslipPdf(slip: StoredPayslip): Uint8Array {
  const stream = payslipText(slip)
    .map(
      (line, index) =>
        `BT /F1 12 Tf 50 ${760 - index * 18} Td (${escapePdfText(line)}) Tj ET`
    )
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
