import assert from "node:assert/strict"
import { gzipSync } from "node:zlib"
import { clamAvScanner } from "../src/files/scanner.ts"
import { FileError } from "../src/files/types.ts"
import { payslipPdf } from "../src/payslip-document.ts"
const scanner = clamAvScanner()
const pdf = payslipPdf({
  employeeId: "SCANNER-TEST",
  year: 2026,
  month: 1,
  currency: "INR",
  monthlyGrossMinor: 10000,
  unpaidDeductionMinor: 0,
  otherDeductionsMinor: 0,
  approvedReimbursementsMinor: 0,
  netMinor: 10000,
})
await scanner.scan(pdf)
await scanner.scan(gzipSync(pdf))
// EICAR is a harmless industry test string, not executable malware.
const eicar = Buffer.from(
  [
    "X5O!P%@AP[4",
    String.fromCharCode(92),
    "PZX54(P^)7CC)7}$",
    "EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
  ].join("")
)
for (const bytes of [eicar, gzipSync(eicar)]) {
  await assert.rejects(
    () => scanner.scan(bytes),
    (error) => error instanceof FileError && error.status === 422
  )
}
console.log(
  "Real ClamAV checks passed: current signatures, plain/gzip PDF accepted, plain/gzip harmless EICAR rejected."
)
