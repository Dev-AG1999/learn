import type { Principal } from "../../auth/repository.ts"
import { formatMoney } from "../../presentation.ts"
import { employeeAccess } from "../../access/roles.ts"
import { withPayroll } from "../../payroll-db.ts"
import { readPeriod } from "../../period.ts"
import {
  attachmentForm,
  hasAttachment,
  storeFormFile,
  discardFile,
  attachmentResult,
} from "../../files/attachments.ts"
import { withFiles } from "../../files/repository.ts"
import { FileError, type StoredFile } from "../../files/types.ts"
export async function saveClaim(request: Request, principal: Principal, employeeId: string) {
  const back = new URL(
    `/employee/${encodeURIComponent(employeeId)}`,
    request.url
  )
  back.hash = "claims"
  let stored: StoredFile | undefined
  try {
    const form = await attachmentForm(request),
      period = readPeriod(
        String(form.get("year") ?? ""),
        String(form.get("month") ?? "")
      )
    if (!period) throw new FileError("Year and month are required.")
    back.searchParams.set("year", String(period.year))
    back.searchParams.set("month", String(period.month))
    const amountMinor = Number(form.get("amountMinor")),
      receipt = String(form.get("receipt") ?? "").trim(),
      confirmed = form.get("confirmed") === "yes"
    if (
      !confirmed ||
      !Number.isSafeInteger(amountMinor) ||
      !receipt ||
      receipt.length > 1000
    )
      throw new FileError(
        "Confirm the claim and provide a valid amount and receipt reference."
      )
    const savedPayslip = await withPayroll((db) =>
      employeeAccess(db, employeeId).get(period.year, period.month)
    )
    if (!savedPayslip) throw new FileError("No payslip for this period.")
    if (hasAttachment(form))
      stored = await storeFormFile(principal, form, "attachment", undefined, {
        purpose: "receipt",
        expected: {
          employeeId,
          year: period.year,
          month: period.month,
          claimedAmountMinor: amountMinor,
          formattedClaimAmount: formatMoney(amountMinor, savedPayslip.currency),
          currency: savedPayslip.currency,
        },
      })
    const claimId = crypto.randomUUID()
    if (stored) await withFiles((db) => db.link("claim", claimId, stored!.id))
    const result = await withPayroll((db) =>
      employeeAccess(db, employeeId).submitPendingClaim({
        ...period,
        claimId,
        amountMinor,
        receipt,
        confirmed,
      })
    )
    if (!result.ok)
      throw new FileError(result.failures[0] ?? "Claim could not be saved.")
    back.searchParams.set("notice", "claim-submitted")
    return attachmentResult(
      request,
      `${back.pathname}${back.search}${back.hash}`,
      stored
    )
  } catch (error) {
    if (stored) await discardFile(stored)
    const message =
      error instanceof FileError
        ? error.message
        : "Claim could not be submitted. Please retry."
    back.searchParams.set("failure", message)
    return attachmentResult(
      request,
      `${back.pathname}${back.search}${back.hash}`,
      undefined,
      message,
      error instanceof FileError ? error.status : 503
    )
  }
}
