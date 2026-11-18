import { requireReadPrincipal } from "../../../src/auth/request.ts"
import { authorize, AuthError, authFailure } from "../../../src/auth/http.ts"
import { withPayroll } from "../../../src/payroll-db.ts"
import { hrAccess } from "../../../src/access/roles.ts"
import { readPeriod } from "../../../src/period.ts"
export const runtime = "nodejs"
export async function GET(request: Request) {
  try {
    const principal = await requireReadPrincipal(request)
    if (!principal) throw new AuthError(401)
    authorize(principal, "hr")
    const query = new URL(request.url).searchParams
    const period = readPeriod(query.get("year") ?? undefined, query.get("month") ?? undefined)
    const prefix = (query.get("q") ?? "").trim()
    const currency = query.get("currency") ?? ""
    const cursor = query.get("cursor")
    if (!period || !/^[A-Za-z0-9_-]{0,64}$/.test(prefix) ||
      (currency && !Intl.supportedValuesOf("currency").includes(currency)) || (cursor?.length ?? 0) > 256)
      return Response.json({ error: "Choose valid search filters." }, { status: 400, headers: { "Cache-Control": "no-store" } })
    const page = await withPayroll((db) => hrAccess(db).listEmployees({ ...period, prefix, currency, cursor, limit: 25 }))
    return Response.json(page, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    if (error instanceof AuthError) return authFailure(error)
    return Response.json({ error: "Search is temporarily unavailable. Please retry." }, { status: 503, headers: { "Cache-Control": "no-store" } })
  }
}
