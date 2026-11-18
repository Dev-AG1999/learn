import { ConnectDrive } from "../components/connect-drive.tsx"
import { AttachmentForm } from "../components/attachment-form.tsx"
import {
  AttachmentLinks,
  loadAttachmentLinks,
} from "../components/attachment-links.tsx"
import { withFiles } from "../../src/files/repository.ts"
import { driveConfigured } from "../../src/files/config.ts"
import { requirePage, pageReturnTo } from "../../src/auth/next.ts"
import { hrAccess } from "../../src/access/roles.ts"
import { withPayroll } from "../../src/payroll-db.ts"
import { readPeriod } from "../../src/period.ts"
import {
  currentPeriod,
  formatMoney,
  periodLabel,
  periodQuery,
} from "../../src/presentation.ts"
import { flagUnreadableReceipt } from "../../src/receipt-flag.ts"
import { Workspace, PageHeading, EmptyState } from "../components/workspace.tsx"
import { PeriodPicker } from "../components/period-picker.tsx"
import { Icon } from "../components/ui-icon.tsx"

export default async function HrPage({
  searchParams,
}: {
  searchParams: Promise<{
    year?: string
    month?: string
    cursor?: string
    q?: string
    failure?: string
    notice?: string
    storage?: string
  }>
}) {
  const query = await searchParams
  const principal = await requirePage(
    "hr",
    undefined,
    pageReturnTo("/hr", query)
  )
  const driveConnected = await withFiles((db) => db.connected())
  const requested =
    query.year === undefined && query.month === undefined
      ? currentPeriod()
      : readPeriod(query.year, query.month)
  const period = requested ?? currentPeriod()
  const [totals, pending, answer] = await withPayroll(async (db) => {
    const hr = hrAccess(db)
    const [totals, page, answer] = await Promise.all([
      requested ? hr.orgTotals(period.year, period.month) : Promise.resolve([]),
      hr.listPendingClaims(20, query.cursor ?? null),
      query.q ? hr.answerFromDocuments(query.q) : Promise.resolve(null),
    ])
    const claims = await Promise.all(
      page.claims.map(async (claim) => ({
        ...claim,
        currency:
          (await db.get(claim.employeeId, claim.year, claim.month))?.currency ??
          null,
      }))
    )
    return [totals, { ...page, claims }, answer] as const
  })
  const documentAttachments = await loadAttachmentLinks(principal, "document")
  const claimAttachments = Object.fromEntries(
    await Promise.all(
      pending.claims.map(async (claim) => [
        claim.id,
        await loadAttachmentLinks(principal, "claim", claim.id),
      ])
    )
  )
  const count = totals.reduce((sum, total) => sum + total.employeeCount, 0)
  const nextQuery = new URLSearchParams({
    year: String(period.year),
    month: String(period.month),
    cursor: pending.nextCursor ?? "",
  })
  if (query.q) nextQuery.set("q", query.q)
  return (
    <Workspace principal={principal} period={period} active="overview">
      <PageHeading
        eyebrow="PEOPLE OPERATIONS"
        title="Payroll overview"
        description="A clear view of your people, payroll, and what needs attention."
      >
        <div className="dashboard-entry-actions">
          <a
            className="button button-secondary"
            href={`/hr/employees?${periodQuery(period)}`}
          >
            <Icon name="users" size={18} />
            View employees
          </a>
          <a className="button button-secondary" href="/hr/import">
            <Icon name="file" size={18} />
            Upload salary sheet
          </a>
          <a
            className="button button-primary"
            href={`/hr/employees/new?${periodQuery(period)}`}
          >
            <Icon name="plus" size={18} />
            Add employee
          </a>
        </div>
      </PageHeading>
      <div className="section-toolbar">
        <div>
          <h2>Your payroll at a glance</h2>
          <p className="muted">{periodLabel(period)} · Saved monthly records</p>
        </div>
        <PeriodPicker period={period} action="/hr" />
      </div>
      {!requested && (
        <div className="notice notice-error" role="alert">
          Choose a valid payroll month and a year between 1900 and 9999.
        </div>
      )}
      {query.notice === "document-saved" && (
        <div className="notice notice-success" role="status">
          Policy text saved. You can now find answers in this document.
        </div>
      )}
      {query.notice === "claim-approved" && (
        <div className="notice notice-success" role="status">
          Claim approved and the employee’s monthly payslip updated.
        </div>
      )}
      {query.failure && (
        <div className="notice notice-error" role="alert">
          {query.failure}
        </div>
      )}
      <section className="metric-grid" aria-label="Payroll summary">
        <article className="metric-card">
          <div className="metric-label">
            Employees in payroll
            <span className="metric-icon blue">
              <Icon name="users" />
            </span>
          </div>
          <strong className="metric-value">
            {count.toLocaleString("en-IN")}
          </strong>
          <p>With a saved payslip this month</p>
        </article>
        <article className="metric-card">
          <div className="metric-label">
            Payroll currencies
            <span className="metric-icon green">
              <Icon name="wallet" />
            </span>
          </div>
          <strong className="metric-value">{totals.length}</strong>
          <p>Totals kept separate by currency</p>
        </article>
        <article className="metric-card">
          <div className="metric-label">
            Claims awaiting review
            <span className="metric-icon amber">
              <Icon name="clock" />
            </span>
          </div>
          <strong className="metric-value">
            {pending.claims.length}
            {pending.nextCursor ? "+" : ""}
          </strong>
          <p>On this page · across all periods</p>
        </article>
      </section>
      <div className="dashboard-columns">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Monthly payroll</h2>
              <p>Net pay from saved payslips, grouped by currency.</p>
            </div>
            <span
              className={`badge ${totals.length ? "badge-green" : "badge-neutral"}`}
            >
              {totals.length ? "Saved records" : "No records"}
            </span>
          </div>
          {totals.length ? (
            <div className="table-wrap">
              <table>
                <caption className="sr-only">
                  Payroll totals for {periodLabel(period)}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Currency</th>
                    <th scope="col">Employees</th>
                    <th scope="col" className="text-right">
                      Total net pay
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {totals.map((total) => (
                    <tr key={total.currency}>
                      <td>
                        <span className="currency-code">{total.currency}</span>
                      </td>
                      <td>{total.employeeCount.toLocaleString("en-IN")}</td>
                      <td className="text-right amount">
                        {formatMoney(total.netMinor, total.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon="wallet"
              title="No payroll for this month"
              description="There are no saved payslips in this period. Choose another month, add an employee, or upload your salary sheet."
            >
              <a
                className="text-link"
                href={`/hr/salary?${periodQuery(period)}`}
              >
                Open salary editor <Icon name="arrow" size={16} />
              </a>
            </EmptyState>
          )}
          <div className="panel-footnote">
            <Icon name="lock" size={14} />
            Only saved payroll is shown. Different currencies are never added
            together.
          </div>
        </section>
        <aside className="panel next-steps">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">YOUR WORKSPACE</p>
              <h2>Keep payroll moving</h2>
            </div>
          </div>
          <a
            className="workflow-link"
            href={`/hr/salary?${periodQuery(period)}`}
          >
            <span className="workflow-icon">
              <Icon name="wallet" />
            </span>
            <span>
              <strong>Update a salary</strong>
              <small>Review inputs and confirm a monthly save.</small>
            </span>
            <Icon name="arrow" size={17} />
          </a>
          <a className="workflow-link" href="#claims">
            <span className="workflow-icon">
              <Icon name="check" />
            </span>
            <span>
              <strong>Review reimbursements</strong>
              <small>Approve pending employee claims.</small>
            </span>
            <Icon name="arrow" size={17} />
          </a>
          <a className="workflow-link" href="#documents">
            <span className="workflow-icon">
              <Icon name="file" />
            </span>
            <span>
              <strong>Add an HR policy</strong>
              <small>Keep policy answers grounded in your text.</small>
            </span>
            <Icon name="arrow" size={17} />
          </a>
          <div className="workspace-tip">
            <Icon name="calendar" size={18} />
            <p>
              <strong>One month at a time.</strong> Changing a salary
              recalculates only the period you save.
            </p>
          </div>
        </aside>
      </div>
      <section className="panel" id="claims">
        <div className="panel-heading">
          <div>
            <h2>Reimbursement inbox</h2>
            <p>Pending employee claims across all payroll periods.</p>
          </div>
          <span className="badge badge-amber">
            {pending.claims.length} on this page
          </span>
        </div>
        {pending.claims.length ? (
          <div className="claim-list">
            {pending.claims.map((claim) => (
              <form
                className="claim-row"
                key={claim.id}
                action="/hr/claims"
                method="post"
              >
                <input type="hidden" name="year" value={period.year} />
                <input type="hidden" name="month" value={period.month} />
                <input type="hidden" name="claimId" value={claim.id} />
                <span className="row-icon">
                  <Icon name="file" />
                </span>
                <div className="claim-info">
                  <strong>{claim.employeeId}</strong>
                  <span>
                    {periodLabel(claim)} · {claim.id}
                  </span>
                  <span className="receipt-text">
                    Receipt:{" "}
                    {flagUnreadableReceipt(claim.receipt) ?? claim.receipt}
                  </span>
                  <AttachmentLinks files={claimAttachments[claim.id] ?? []} />
                </div>
                <div className="claim-amount">
                  {claim.currency
                    ? formatMoney(claim.amountMinor, claim.currency)
                    : `${claim.amountMinor} minor units`}
                  <span className="badge badge-amber">Pending</span>
                </div>
                <div className="claim-approval">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      name="confirmed"
                      value="yes"
                      required
                    />
                    Confirm approval
                  </label>
                  <button className="button button-secondary button-small">
                    Approve claim
                  </button>
                </div>
              </form>
            ))}
          </div>
        ) : (
          <EmptyState
            icon="check"
            title="You're all caught up"
            description="No reimbursement claims are waiting for approval."
          />
        )}
        {pending.nextCursor && (
          <div className="panel-pagination">
            <a
              className="button button-secondary button-small"
              href={`/hr?${nextQuery}#claims`}
            >
              Next claims <Icon name="arrow" size={16} />
            </a>
          </div>
        )}
      </section>
      <div className="dashboard-columns equal-columns">
        <section className="panel" id="documents">
          <div className="panel-heading">
            <div>
              <h2>HR policy library</h2>
              <p>
                Add policy text or attach a document for your team's reference.
              </p>
            </div>
            <Icon name="file" />
          </div>
          <AttachmentForm
            userId={principal.userId}
            className="panel-body stack-form hr-document-form"
            action="/hr/documents"
          >
            <input type="hidden" name="year" value={period.year} />
            <input type="hidden" name="month" value={period.month} />
            <label>
              Document ID
              <input
                name="documentId"
                placeholder="e.g. reimbursement-policy"
                required
              />
            </label>
            <label>
              Policy text
              <textarea
                name="body"
                rows={5}
                placeholder="Paste the approved policy text here…"
              />
            </label>
            <label>
              Optional PDF or image
              <input
                name="attachment"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
              />
            </label>
            <p className="field-help">
              Attachments are compressed and scanned before private Google Drive
              storage. Up to 8 MB; plain PDF, JPEG or PNG.
            </p>
            <p className="field-help">
              Saving an existing document ID replaces its policy text.
            </p>
            <button className="button button-secondary">
              <Icon name="plus" size={16} />
              Save document
            </button>
          </AttachmentForm>

          <div className="panel-body">
            <p className="field-help">
              Google Drive: {driveConnected ? "connected" : "not connected"}.
              Antivirus must be running before file uploads.
            </p>
            <ConnectDrive
              configured={driveConfigured()}
              connected={driveConnected}
              userId={principal.userId}
            />

            {!driveConfigured() && (
              <p className="field-help">
                Configure Google OAuth and the Drive token encryption key in
                .env.local. See SECURE_UPLOADS.md.
              </p>
            )}
            {query.storage && (
              <p role="status">
                {query.storage === "connected"
                  ? "Google Drive connected."
                  : "Drive connection did not complete. Check setup and reconnect the original Google account."}
              </p>
            )}
            {query.notice === "attachment-saved" && (
              <p role="status">
                Attachment stored in Google Drive. Download it below.
              </p>
            )}
            <AttachmentLinks files={documentAttachments} />
          </div>
        </section>
        <section className="panel" id="knowledge">
          <div className="panel-heading">
            <div>
              <h2>Policy answers</h2>
              <p>Find answers in your saved HR documents.</p>
            </div>
            <Icon name="spark" />
          </div>
          <form className="panel-body stack-form" action="/hr" method="get">
            <input type="hidden" name="year" value={period.year} />
            <input type="hidden" name="month" value={period.month} />
            <label>
              What would you like to find?
              <input
                name="q"
                defaultValue={query.q}
                placeholder="Enter a word or phrase from a policy"
                required
              />
            </label>
            <p className="field-help">
              Matches exact text in saved documents. Answers always include a
              source.
            </p>
            <button className="button button-secondary">
              <Icon name="search" size={16} />
              Find an answer
            </button>
          </form>
          {query.q && (
            <div className="answer-box" role="status">
              {answer ? (
                <>
                  <span className="badge badge-green">
                    Source · {answer.citation}
                  </span>
                  <p>{answer.answer}</p>
                </>
              ) : (
                <>
                  <strong>No matching answer</strong>
                  <p>
                    Try another phrase or add the relevant policy text first.
                  </p>
                </>
              )}
            </div>
          )}
        </section>
      </div>
    </Workspace>
  )
}
