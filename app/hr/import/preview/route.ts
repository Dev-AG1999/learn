import {
  storeFormFile,
  discardFile,
} from "../../../../src/files/attachments.ts"
import { withFiles } from "../../../../src/files/repository.ts"
import { signedFileUrl } from "../../../../src/files/signing.ts"
import { FileError, type StoredFile } from "../../../../src/files/types.ts"
import type { RowFailure } from "../../../../src/import/types.ts"
class SheetValidationError extends FileError {
  constructor(readonly failures: RowFailure[]) {
    super("Salary sheet validation failed.", 422)
  }
}
import { requireRequest, authFailure } from "../../../../src/auth/http.ts"
import { withPayroll } from "../../../../src/payroll-db.ts"
import { parseSalaryFile } from "../../../../src/import/parse.ts"
import { boundedForm, BodyLimitError } from "../../../../src/import/request.ts"

export async function POST(request: Request) {
  let principal
  try {
    principal = await requireRequest(request, "hr")
  } catch (error) {
    return authFailure(error)
  }
  const headers = { "Cache-Control": "no-store" }
  let stored: StoredFile | undefined
  try {
    const form = await boundedForm(request)
    const files = form.getAll("sheet")
    const file = files[0]
    if (files.length !== 1 || !(file instanceof File))
      return Response.json(
        {
          failures: [
            {
              row: 0,
              message: "Choose exactly one CSV or Excel salary sheet.",
            },
          ],
        },
        { status: 422, headers }
      )
    if (!/\.(csv|xlsx)$/i.test(file.name))
      throw new FileError(
        "Upload a .csv or .xlsx salary sheet. PDF and .xls files cannot be imported.",
        422
      )
    let parsed: Awaited<ReturnType<typeof parseSalaryFile>> | undefined
    stored = await storeFormFile(principal, form, "sheet", async (bytes) => {
      parsed = await parseSalaryFile(file.name, bytes)
      if (!parsed.ok) throw new SheetValidationError(parsed.failures)
    })
    if (!parsed || !parsed.ok)
      throw new FileError("Sheet validation did not complete.", 422)
    const rows = parsed.rows
    const staged = await withPayroll((db) =>
      db.stagePayroll({
        ownerId: principal.userId,
        mode: "upsert",
        source: file.name,
        rows,
      })
    )
    if (!staged.ok) {
      await discardFile(stored)
      return Response.json(
        {
          failures: staged.failures.slice(0, 100),
          totalErrors: staged.failures.length,
        },
        { status: 422, headers }
      )
    }
    await withFiles((db) => db.link("import", staged.draftId, stored!.id))
    return Response.json(
      {
        reviewUrl: `/hr/import/review/${staged.draftId}`,
        signedUrl: signedFileUrl(stored.id, principal.userId),
      },
      { headers }
    )
  } catch (error) {
    if (stored) await discardFile(stored)
    if (error instanceof SheetValidationError)
      return Response.json(
        {
          failures: error.failures.slice(0, 100),
          totalErrors: error.failures.length,
        },
        { status: 422, headers }
      )
    return Response.json(
      {
        failures: [
          {
            row: 0,
            message:
              error instanceof BodyLimitError || error instanceof FileError
                ? error.message
                : "The sheet could not be prepared. Please try again.",
          },
        ],
      },
      {
        status:
          error instanceof BodyLimitError || error instanceof FileError
            ? error.status
            : 503,
        headers,
      }
    )
  }
}
