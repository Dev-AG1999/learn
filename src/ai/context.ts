import { EMPLOYEE_ID } from "../employee-id.ts"
import type { Principal } from "../auth/repository.ts"
import { AuthError } from "../auth/http.ts"
import { withPayroll, preparePayrollPath } from "../payroll-db.ts"
import { openStorageDatabase } from "../db/connection.ts"
import { formatMoney, periodLabel } from "../presentation.ts"
import { DocumentError } from "../document-ai/types.ts"
export type ChatSource = { label: string; text: string; summary?: string }
export type ChatContext = { employeeId?: string; year: number; month: number }
export function scopedEmployee(
  principal: Principal,
  requested?: string
): string | undefined {
  if (principal.role === "employee") {
    if (
      !principal.employeeId ||
      (requested && requested !== principal.employeeId)
    )
      throw new AuthError(403)
    return principal.employeeId
  }
  if (requested && !EMPLOYEE_ID.test(requested))
    throw new DocumentError("Choose a valid employee ID.")
  return requested
}
export function policyVisibility(documentId?: string, shared?: boolean) {
  const db = openStorageDatabase(preparePayrollPath())
  try {
    db.exec(
      "CREATE TABLE IF NOT EXISTS chat_policy_access(documentId TEXT PRIMARY KEY, shared INTEGER NOT NULL CHECK(shared IN (0,1)))"
    )
    db.exec("PRAGMA busy_timeout=5000; BEGIN IMMEDIATE")
    const indexed = db
      .prepare(
        "SELECT 1 AS present FROM sqlite_master WHERE name='chat_policy_search'"
      )
      .get()
    if (!indexed) {
      db.exec(`CREATE VIRTUAL TABLE chat_policy_search USING fts5(document_id UNINDEXED, body, content='documents', content_rowid='rowid');
        CREATE TRIGGER IF NOT EXISTS chat_policy_insert AFTER INSERT ON documents BEGIN INSERT INTO chat_policy_search(rowid,document_id,body) VALUES(new.rowid,new.document_id,new.body); END;
        CREATE TRIGGER IF NOT EXISTS chat_policy_delete AFTER DELETE ON documents BEGIN INSERT INTO chat_policy_search(chat_policy_search,rowid,document_id,body) VALUES('delete',old.rowid,old.document_id,old.body); END;
        CREATE TRIGGER IF NOT EXISTS chat_policy_update AFTER UPDATE ON documents BEGIN INSERT INTO chat_policy_search(chat_policy_search,rowid,document_id,body) VALUES('delete',old.rowid,old.document_id,old.body); INSERT INTO chat_policy_search(rowid,document_id,body) VALUES(new.rowid,new.document_id,new.body); END;
        INSERT INTO chat_policy_search(chat_policy_search) VALUES('rebuild');`)
    }
    if (shared !== undefined && documentId)
      db.prepare(
        "INSERT INTO chat_policy_access VALUES (?,?) ON CONFLICT(documentId) DO UPDATE SET shared=excluded.shared"
      ).run(documentId, shared ? 1 : 0)
    db.exec("COMMIT")
  } catch (error) {
    try {
      db.exec("ROLLBACK")
    } catch {}
    throw error
  } finally {
    db.close()
  }
}
export async function loadChatContext(
  principal: Principal,
  input: ChatContext,
  question: string
): Promise<ChatSource[]> {
  const employeeId = scopedEmployee(principal, input.employeeId),
    sources: ChatSource[] = []
  if (employeeId)
    await withPayroll(async (db) => {
      const current = await db.get(employeeId, input.year, input.month)
      if (!current) {
        sources.push({
          label: "Payroll lookup",
          text: `No saved payslip for employee ${employeeId}, ${periodLabel(input)}. Do not infer a salary or deduction.`,
        })
        return
      }
      const leave = await db.getLeave(employeeId, input.year, input.month)
      const claims = await db.getClaims(employeeId, input.year, input.month)
      const amount = (value: number) =>
        `${formatMoney(value, current.currency)} ${current.currency} (${value} minor units)`
      sources.push({
        label: `Saved payslip · ${employeeId} · ${periodLabel(input)}`,
        summary: `For ${periodLabel(input)}, saved gross pay is ${formatMoney(current.monthlyGrossMinor, current.currency)}, unpaid-leave deduction is ${formatMoney(current.unpaidDeductionMinor, current.currency)}, other deductions are ${formatMoney(current.otherDeductionsMinor, current.currency)}, approved reimbursements are ${formatMoney(current.approvedReimbursementsMinor, current.currency)}, and net pay is ${formatMoney(current.netMinor, current.currency)}. Unpaid leave days: ${leave?.unpaidLeaveDays ?? "not recorded"}. Other deduction reasons are not stored; ask HR for the reason.`,
        text: [
          `Employee ${employeeId}; period ${periodLabel(input)}. These are saved payroll records, not estimates.`,
          `Gross ${amount(current.monthlyGrossMinor)}. Unpaid-leave deduction ${amount(current.unpaidDeductionMinor)}. Other deductions ${amount(current.otherDeductionsMinor)}. Approved reimbursements ${amount(current.approvedReimbursementsMinor)}. Net ${amount(current.netMinor)}.`,
          `Payroll equation: ${amount(current.monthlyGrossMinor)} - ${amount(current.unpaidDeductionMinor)} - ${amount(current.otherDeductionsMinor)} + ${amount(current.approvedReimbursementsMinor)} = ${amount(current.netMinor)}.`,
          `Unpaid leave days ${leave?.unpaidLeaveDays ?? "not recorded"}; calendar days ${leave?.calendarDays ?? "not recorded"}. Unpaid leave explains the unpaid-leave deduction when present. Other deduction reasons are not stored in this database; do not guess tax, penalties or policy reasons.`,
          ...claims
            .slice(0, 20)
            .map(
              (claim) =>
                `Claim ${claim.id}: ${amount(claim.amountMinor)}, status ${claim.status}; receipt reference ${claim.receipt.slice(0, 160)}. Pending claims are not approved reimbursements.`
            ),
        ].join("\n"),
      })
      const previous =
        input.month === 1
          ? { year: input.year - 1, month: 12 }
          : { year: input.year, month: input.month - 1 }
      const old = await db.get(employeeId, previous.year, previous.month)
      if (
        old &&
        old.currency === current.currency &&
        Number.isSafeInteger(current.netMinor - old.netMinor)
      )
        sources.push({
          label: "Previous-month comparison",
          text: `${periodLabel(previous)} net ${amount(old.netMinor)}. Selected-month net ${amount(current.netMinor)}. Net difference ${amount(current.netMinor - old.netMinor)}. A difference alone does not establish its reason.`,
        })
    })
  policyVisibility()
  const connection = openStorageDatabase(preparePayrollPath())
  try {
    const words =
      question
        .toLowerCase()
        .match(/[a-z]{4,}/g)
        ?.filter(
          (word) =>
            ![
              "what",
              "this",
              "that",
              "with",
              "have",
              "does",
              "from",
              "about",
              "please",
            ].includes(word)
        )
        .slice(0, 6) ?? []
    if (words.length) {
      const rows = connection
        .prepare(
          `SELECT d.document_id,snippet(chat_policy_search,1,'','','…',128) AS body FROM chat_policy_search JOIN documents d ON d.rowid=chat_policy_search.rowid LEFT JOIN chat_policy_access p ON p.documentId=d.document_id WHERE chat_policy_search MATCH ? AND (?='hr' OR p.shared=1) ORDER BY bm25(chat_policy_search) LIMIT 3`
        )
        .all(words.map((word) => `"${word}"`).join(" OR "), principal.role) as {
        document_id: string
        body: string
      }[]
      sources.push(
        ...rows.map((row) => ({
          label: `Policy text · ${row.document_id}`,
          text: row.body.slice(0, 4000),
        }))
      )
    }
  } finally {
    connection.close()
  }
  return sources
}
