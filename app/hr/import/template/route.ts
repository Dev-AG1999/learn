import { requireRequest, authFailure } from "../../../../src/auth/http.ts"
import { salaryCsv, salaryXlsx } from "../../../../src/import/template.ts"

export async function GET(request: Request) {
  try {
    await requireRequest(request, "hr")
  } catch (error) {
    return authFailure(error)
  }
  const query = new URL(request.url).searchParams
  const xlsx = query.get("format") === "xlsx"
  const sample = query.get("sample") === "yes"
  return new Response(
    xlsx ? Buffer.from(salaryXlsx(sample)) : salaryCsv(sample),
    {
      headers: {
        "Content-Type": xlsx
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="employee-salary-${sample ? "sample" : "template"}.${xlsx ? "xlsx" : "csv"}"`,
        "Cache-Control": "no-store",
      },
    }
  )
}
