import { hrAccess } from "../../src/access/roles.ts"
import { withPayroll } from "../../src/payroll-db.ts"
import { readPeriod } from "../../src/period.ts"
import { flagUnreadableReceipt } from "../../src/receipt-flag.ts"

export default async function HrPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string; cursor?: string; q?: string; failure?: string }>
}) {
  const query = await searchParams
  const period = readPeriod(query.year, query.month)
  if (!period) {
    return (
      <main>
        <p>Year and month are required.</p>
      </main>
    )
  }
  const [totals, pending, answer] = await withPayroll(async (db) => {
    const hr = hrAccess(db)
    return Promise.all([
      hr.orgTotals(period.year, period.month),
      hr.listPendingClaims(20, query.cursor ?? null),
      query.q ? hr.answerFromDocuments(query.q) : Promise.resolve(null),
    ])
  })
  return (
    <main>
      {query.failure ? <p>{query.failure}</p> : null}
      <p>
        Org totals {period.year}-{String(period.month).padStart(2, "0")}
      </p>
      {totals.length === 0 ? <p>No payslips</p> : null}
      {totals.map((total) => (
        <p key={total.currency}>
          {total.currency} employees {total.employeeCount} net {total.netMinor}
        </p>
      ))}
      {pending.claims.map((claim) => (
        <form key={claim.id} action="/hr/claims" method="post">
          <input type="hidden" name="year" value={period.year} />
          <input type="hidden" name="month" value={period.month} />
          <input type="hidden" name="claimId" value={claim.id} />
          <p>
            {claim.id} {claim.employeeId} {claim.amountMinor}{" "}
            {flagUnreadableReceipt(claim.receipt) ?? claim.receipt}
          </p>
          <label>
            <input type="checkbox" name="confirmed" value="yes" /> Confirm
          </label>
          <button type="submit">Approve claim</button>
        </form>
      ))}
      {pending.nextCursor ? (
        <p>
          <a href={`/hr?year=${period.year}&month=${period.month}&cursor=${pending.nextCursor}`}>Next claims</a>
        </p>
      ) : null}
      <form action="/hr/documents" method="post">
        <input type="hidden" name="year" value={period.year} />
        <input type="hidden" name="month" value={period.month} />
        <input name="documentId" aria-label="Document id" />
        <input name="body" aria-label="Document text" />
        <button type="submit">Upload document</button>
      </form>
      <form action="/hr" method="get">
        <input type="hidden" name="year" value={period.year} />
        <input type="hidden" name="month" value={period.month} />
        <input name="q" aria-label="Question" />
        <button type="submit">Ask</button>
      </form>
      {query.q ? (
        answer ? (
          <p>
            Citation {answer.citation}. {answer.answer}
          </p>
        ) : (
          <p>No answer</p>
        )
      ) : null}
    </main>
  )
}
