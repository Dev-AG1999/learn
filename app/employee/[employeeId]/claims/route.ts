import { requireRequest, authFailure } from "../../../../src/auth/http.ts"
import { employeeAccess } from "../../../../src/access/roles.ts"
import { withPayroll } from "../../../../src/payroll-db.ts"
import { readPeriod } from "../../../../src/period.ts"
import {
  attachmentForm,
  hasAttachment,
  storeFormFile,
  discardFile,
  attachmentResult,
} from "../../../../src/files/attachments.ts"
import { withFiles } from "../../../../src/files/repository.ts"
import { FileError, type StoredFile } from "../../../../src/files/types.ts"
export async function POST(
  request: Request,
  context: { params: Promise<{ employeeId: string }> }
) {
  const { employeeId } = await context.params
  let principal
  try {
    principal = await requireRequest(request, "employee", employeeId)
  } catch (error) {
    return authFailure(error)
  }
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
    if (
      !(await withPayroll((db) =>
        employeeAccess(db, employeeId).get(period.year, period.month)
      ))
    )
      throw new FileError("No payslip for this period.")
    if (hasAttachment(form))
      stored = await storeFormFile(principal, form, "attachment")
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
