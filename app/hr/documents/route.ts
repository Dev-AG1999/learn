import { requireRequest, authFailure } from "../../../src/auth/http.ts"
import { hrAccess } from "../../../src/access/roles.ts"
import { withPayroll } from "../../../src/payroll-db.ts"
import { readPeriod } from "../../../src/period.ts"

export async function POST(request: Request) {
  try {
    await requireRequest(request, "hr")
  } catch (error) {
    return authFailure(error)
  }
  const form = await request.formData()
  const period = readPeriod(
    String(form.get("year") ?? ""),
    String(form.get("month") ?? "")
  )
  const documentId = String(form.get("documentId") ?? "").trim()
  const body = String(form.get("body") ?? "").trim()
  if (documentId !== "" && body !== "") {
    await withPayroll((db) => hrAccess(db).uploadDocument({ documentId, body }))
  }
  const back = new URL("/hr", request.url)
  if (period) {
    back.searchParams.set("year", String(period.year))
    back.searchParams.set("month", String(period.month))
  }
  if (documentId && body) back.searchParams.set("notice", "document-saved")
  else
    back.searchParams.set(
      "failure",
      "Document ID and policy text are required."
    )
  return new Response(null, {
    status: 303,
    headers: { Location: `${back.pathname}${back.search}` },
  })
}
