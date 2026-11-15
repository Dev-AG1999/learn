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
    const parsed = await parseSalaryFile(
      file.name,
      new Uint8Array(await file.arrayBuffer())
    )
    if (!parsed.ok)
      return Response.json(
        {
          failures: parsed.failures.slice(0, 100),
          totalErrors: parsed.failures.length,
        },
        { status: 422, headers }
      )
    const staged = await withPayroll((db) =>
      db.stagePayroll({
        ownerId: principal.userId,
        mode: "upsert",
        source: file.name,
        rows: parsed.rows,
      })
    )
    if (!staged.ok)
      return Response.json(
        {
          failures: staged.failures.slice(0, 100),
          totalErrors: staged.failures.length,
        },
        { status: 422, headers }
      )
    return Response.json(
      { reviewUrl: `/hr/import/review/${staged.draftId}` },
      { headers }
    )
  } catch (error) {
    return Response.json(
      {
        failures: [
          {
            row: 0,
            message:
              error instanceof BodyLimitError
                ? error.message
                : "The sheet could not be prepared. Please try again.",
          },
        ],
      },
      { status: error instanceof BodyLimitError ? error.status : 500, headers }
    )
  }
}
