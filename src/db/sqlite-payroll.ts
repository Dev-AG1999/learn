import { randomUUID } from "node:crypto"
import { validateEntries } from "../import/validation.ts"
import {
  DRAFT_SECONDS,
  REVIEW_PAGE_SIZE,
  type PayrollEntry,
  type StagedEntry,
  type EntryMode,
  type StageResult,
  type DraftPage,
  type CommitResult,
} from "../import/types.ts"
import { createHash } from "node:crypto"
import { validateSalary } from "../salary-validation.ts"
import { DatabaseSync } from "node:sqlite"
import {
  computePayslip,
  validatePayrollInput,
  type Payslip,
} from "../domain/payslip.ts"

export type ClaimStatus = "pending" | "approved"

export type ClaimInput = {
  id: string
  amountMinor: number
  status: ClaimStatus
  receipt: string
}

export type SaveMonthInput = {
  employeeId: string
  year: number
  month: number
  annualCtcMinor: number
  currency: string
  calendarDays: number
  unpaidLeaveDays: number
  otherDeductionsMinor: number
  claims: readonly ClaimInput[]
  confirmed: boolean
  expectedVersion?: string
}

export type StoredPayslip = Payslip & {
  employeeId: string
  year: number
  month: number
}

export type LeaveDays = {
  employeeId: string
  year: number
  month: number
  unpaidLeaveDays: number
  calendarDays: number
}

export type StoredClaim = ClaimInput & {
  employeeId: string
  year: number
  month: number
}

export type OrgTotal = {
  currency: string
  employeeCount: number
  netMinor: number
}

export type EmployeePage = {
  employeeIds: string[]
  nextCursor: string | null
}

export type EmployeeDirectoryRow = {
  employeeId: string
  annualCtcMinor: number
  currency: string
  monthlyNetMinor: number | null
  monthlyCurrency: string | null
}

export type EmployeeDirectoryQuery = {
  year: number
  month: number
  prefix: string
  currency: string
  cursor: string | null
  limit: number
}

export type EmployeeDirectoryPage = {
  employees: EmployeeDirectoryRow[]
  nextCursor: string | null
}

export type SaveMonthResult =
  { ok: true; payslip: StoredPayslip } | { ok: false; failures: string[] }

export type PendingClaimInput = {
  employeeId: string
  year: number
  month: number
  claimId: string
  amountMinor: number
  receipt: string
  confirmed: boolean
}

export type ApproveClaimInput = {
  claimId: string
  confirmed: boolean
}

export type PendingClaim = {
  id: string
  employeeId: string
  year: number
  month: number
  amountMinor: number
  receipt: string
}

export type PendingClaimPage = {
  claims: PendingClaim[]
  nextCursor: string | null
}

export type CitedAnswer = {
  citation: string
  answer: string
}

export type SalaryInputs = { annualCtcMinor: number; currency: string }

export type PayrollRepository = {
  listEmployees(query: EmployeeDirectoryQuery): Promise<EmployeeDirectoryPage>
  stagePayroll(input: {
    ownerId: string
    source: string
    mode: EntryMode
    rows: readonly PayrollEntry[]
  }): Promise<StageResult>
  getPayrollDraft(
    id: string,
    ownerId: string,
    page: number
  ): Promise<DraftPage | null>
  commitPayrollDraft(
    id: string,
    ownerId: string,
    confirmed: boolean
  ): Promise<CommitResult>
  getSalaryVersion(
    employeeId: string,
    year: number,
    month: number
  ): Promise<string>
  getSalaryInputs(
    employeeId: string,
    year: number,
    month: number
  ): Promise<SalaryInputs | null>
  get(
    employeeId: string,
    year: number,
    month: number
  ): Promise<StoredPayslip | null>
  getLeave(
    employeeId: string,
    year: number,
    month: number
  ): Promise<LeaveDays | null>
  getClaims(
    employeeId: string,
    year: number,
    month: number
  ): Promise<StoredClaim[]>
  saveMonth(input: SaveMonthInput): Promise<SaveMonthResult>
  submitPendingClaim(input: PendingClaimInput): Promise<SaveMonthResult>
  approveClaim(input: ApproveClaimInput): Promise<SaveMonthResult>
  listPendingClaims(
    limit: number,
    cursor: string | null
  ): Promise<PendingClaimPage>
  uploadDocument(input: { documentId: string; body: string }): Promise<void>
  answerFromDocuments(question: string): Promise<CitedAnswer | null>
  orgTotals(year: number, month: number): Promise<OrgTotal[]>
  listEmployeeIds(limit: number, cursor: string | null): Promise<EmployeePage>
  close(): void
}

type PayslipRow = {
  employee_id: string
  year: number
  month: number
  currency: string
  monthly_gross_minor: number
  unpaid_deduction_minor: number
  other_deductions_minor: number
  approved_reimbursements_minor: number
  net_minor: number
}

export function openPayrollDatabase(path: string): PayrollRepository {
  const db = new DatabaseSync(path)
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS employees (
      employee_id TEXT PRIMARY KEY,
      annual_ctc_minor INTEGER NOT NULL,
      currency TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_employees_currency_id ON employees(currency, employee_id);
    CREATE TABLE IF NOT EXISTS payslips (
      employee_id TEXT NOT NULL,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      currency TEXT NOT NULL,
      monthly_gross_minor INTEGER NOT NULL,
      unpaid_deduction_minor INTEGER NOT NULL,
      other_deductions_minor INTEGER NOT NULL,
      approved_reimbursements_minor INTEGER NOT NULL,
      net_minor INTEGER NOT NULL,
      PRIMARY KEY (employee_id, year, month),
      FOREIGN KEY (employee_id) REFERENCES employees (employee_id)
    );
    CREATE TABLE IF NOT EXISTS leave_days (
      employee_id TEXT NOT NULL,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      unpaid_leave_days INTEGER NOT NULL,
      calendar_days INTEGER NOT NULL,
      PRIMARY KEY (employee_id, year, month),
      FOREIGN KEY (employee_id) REFERENCES employees (employee_id)
    );
    CREATE TABLE IF NOT EXISTS claims (
      claim_id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      amount_minor INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'approved')),
      receipt TEXT NOT NULL,
      FOREIGN KEY (employee_id) REFERENCES employees (employee_id)
    );
    CREATE INDEX IF NOT EXISTS idx_payslips_month_currency
      ON payslips (year, month, currency, employee_id);
    CREATE INDEX IF NOT EXISTS idx_claims_employee_month
      ON claims (employee_id, year, month);
    CREATE INDEX IF NOT EXISTS idx_claims_pending
      ON claims (status, claim_id);
    CREATE TABLE IF NOT EXISTS salary_inputs (
      employee_id TEXT NOT NULL REFERENCES employees(employee_id),
      year INTEGER NOT NULL, month INTEGER NOT NULL, annual_ctc_minor INTEGER NOT NULL, currency TEXT NOT NULL,
      PRIMARY KEY (employee_id, year, month)
    );
    CREATE TABLE IF NOT EXISTS payroll_drafts (
      draft_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, source TEXT NOT NULL,
      mode TEXT NOT NULL CHECK(mode IN ('create', 'upsert')), rows_json TEXT NOT NULL,
      expires_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','committed'))
    );
    CREATE INDEX IF NOT EXISTS idx_payroll_draft_expiry ON payroll_drafts(expires_at);
    CREATE INDEX IF NOT EXISTS idx_payroll_draft_owner ON payroll_drafts(owner_id, expires_at);
    CREATE TABLE IF NOT EXISTS documents (
      document_id TEXT PRIMARY KEY,
      body TEXT NOT NULL
    );
  `)

  const getPayslip = db.prepare(`
    SELECT employee_id, year, month, currency, monthly_gross_minor, unpaid_deduction_minor,
           other_deductions_minor, approved_reimbursements_minor, net_minor
    FROM payslips
    WHERE employee_id = ? AND year = ? AND month = ?
  `)
  const getLeaveRow = db.prepare(`
    SELECT employee_id, year, month, unpaid_leave_days, calendar_days
    FROM leave_days
    WHERE employee_id = ? AND year = ? AND month = ?
  `)
  const getClaimRows = db.prepare(`
    SELECT claim_id, employee_id, year, month, amount_minor, status, receipt
    FROM claims
    WHERE employee_id = ? AND year = ? AND month = ?
    ORDER BY claim_id
  `)
  const upsertEmployee = db.prepare(`
    INSERT INTO employees (employee_id, annual_ctc_minor, currency)
    VALUES (?, ?, ?)
    ON CONFLICT (employee_id) DO UPDATE SET
      annual_ctc_minor = excluded.annual_ctc_minor,
      currency = excluded.currency
  `)
  const upsertPayslip = db.prepare(`
    INSERT INTO payslips (
      employee_id, year, month, currency, monthly_gross_minor, unpaid_deduction_minor,
      other_deductions_minor, approved_reimbursements_minor, net_minor
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (employee_id, year, month) DO UPDATE SET
      currency = excluded.currency,
      monthly_gross_minor = excluded.monthly_gross_minor,
      unpaid_deduction_minor = excluded.unpaid_deduction_minor,
      other_deductions_minor = excluded.other_deductions_minor,
      approved_reimbursements_minor = excluded.approved_reimbursements_minor,
      net_minor = excluded.net_minor
  `)
  const upsertLeave = db.prepare(`
    INSERT INTO leave_days (employee_id, year, month, unpaid_leave_days, calendar_days)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (employee_id, year, month) DO UPDATE SET
      unpaid_leave_days = excluded.unpaid_leave_days,
      calendar_days = excluded.calendar_days
  `)
  const deleteClaims = db.prepare(`
    DELETE FROM claims WHERE employee_id = ? AND year = ? AND month = ?
  `)
  const insertClaim = db.prepare(`
    INSERT INTO claims (claim_id, employee_id, year, month, amount_minor, status, receipt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  const orgTotalRows = db.prepare(`
    SELECT currency, COUNT(*) AS employee_count, SUM(net_minor) AS net_minor
    FROM payslips
    WHERE year = ? AND month = ?
    GROUP BY currency
    ORDER BY currency
  `)
  const employeePage = db.prepare(`
    SELECT employee_id FROM employees
    WHERE employee_id > ?
    ORDER BY employee_id
    LIMIT ?
  `)
  const getEmployee = db.prepare(`
    SELECT annual_ctc_minor, currency FROM employees WHERE employee_id = ?
  `)
  const getClaimById = db.prepare(`
    SELECT claim_id, employee_id, year, month, amount_minor, status, receipt
    FROM claims WHERE claim_id = ?
  `)
  const approvedTotal = db.prepare(`
    SELECT COALESCE(SUM(amount_minor), 0) AS total
    FROM claims
    WHERE employee_id = ? AND year = ? AND month = ? AND status = 'approved'
  `)
  const pendingPage = db.prepare(`
    SELECT claim_id, employee_id, year, month, amount_minor, receipt
    FROM claims
    WHERE status = 'pending' AND claim_id > ?
    ORDER BY claim_id
    LIMIT ?
  `)
  const citedDocument = db.prepare(`
    SELECT document_id, body FROM documents
    WHERE instr(body, ?) > 0
    ORDER BY document_id
    LIMIT 1
  `)
  const insertDocument = db.prepare(`
    INSERT INTO documents (document_id, body) VALUES (?, ?)
    ON CONFLICT (document_id) DO UPDATE SET body = excluded.body
  `)

  const monthlyInputs = db.prepare(
    "SELECT annual_ctc_minor, currency FROM salary_inputs WHERE employee_id = ? AND year = ? AND month = ?"
  )
  const saveInputs = db.prepare(
    "INSERT INTO salary_inputs VALUES (?, ?, ?, ?, ?) ON CONFLICT(employee_id, year, month) DO UPDATE SET annual_ctc_minor = excluded.annual_ctc_minor, currency = excluded.currency"
  )
  function salaryVersion(
    employeeId: string,
    year: number,
    month: number
  ): string {
    const state = [
      monthlyInputs.get(employeeId, year, month) ?? getEmployee.get(employeeId),
      getPayslip.get(employeeId, year, month),
      getLeaveRow.get(employeeId, year, month),
      getClaimRows.all(employeeId, year, month),
    ]
    return createHash("sha256").update(JSON.stringify(state)).digest("hex")
  }
  function saveMonth(input: SaveMonthInput): SaveMonthResult {
    if (!input.confirmed) {
      return { ok: false, failures: ["commit only after confirmation"] }
    }
    if (
      input.expectedVersion !== undefined &&
      input.expectedVersion !==
        salaryVersion(input.employeeId, input.year, input.month)
    ) {
      return {
        ok: false,
        failures: [
          "Payroll changed since this form was opened. Reload before editing.",
        ],
      }
    }
    const failures = [...validatePayrollInput(input), ...validateSalary(input)]
    if (failures.length > 0) return { ok: false, failures }

    const approvedReimbursementsMinor = input.claims
      .filter((claim) => claim.status === "approved")
      .reduce((sum, claim) => sum + claim.amountMinor, 0)
    const payslip = computePayslip({
      annualCtcMinor: input.annualCtcMinor,
      currency: input.currency,
      calendarDays: input.calendarDays,
      unpaidLeaveDays: input.unpaidLeaveDays,
      otherDeductionsMinor: input.otherDeductionsMinor,
      approvedReimbursementsMinor,
    })
    if (
      !Object.values(payslip).every(
        (value) => typeof value === "string" || Number.isSafeInteger(value)
      )
    )
      return {
        ok: false,
        failures: ["Computed pay exceeds the safe integer range."],
      }
    const stored: StoredPayslip = {
      employeeId: input.employeeId,
      year: input.year,
      month: input.month,
      ...payslip,
    }

    db.exec("SAVEPOINT save_month")
    try {
      upsertEmployee.run(input.employeeId, input.annualCtcMinor, input.currency)
      saveInputs.run(
        input.employeeId,
        input.year,
        input.month,
        input.annualCtcMinor,
        input.currency
      )
      upsertPayslip.run(
        input.employeeId,
        input.year,
        input.month,
        payslip.currency,
        payslip.monthlyGrossMinor,
        payslip.unpaidDeductionMinor,
        payslip.otherDeductionsMinor,
        payslip.approvedReimbursementsMinor,
        payslip.netMinor
      )
      upsertLeave.run(
        input.employeeId,
        input.year,
        input.month,
        input.unpaidLeaveDays,
        input.calendarDays
      )
      deleteClaims.run(input.employeeId, input.year, input.month)
      for (const claim of input.claims) {
        insertClaim.run(
          claim.id,
          input.employeeId,
          input.year,
          input.month,
          claim.amountMinor,
          claim.status,
          claim.receipt
        )
      }
      db.exec("RELEASE save_month")
    } catch (error) {
      db.exec("ROLLBACK TO save_month")
      db.exec("RELEASE save_month")
      throw error
    }

    return { ok: true, payslip: stored }
  }

  type DraftRow = {
    draft_id: string
    owner_id: string
    source: string
    mode: EntryMode
    rows_json: string
    expires_at: number
    status: "pending" | "committed"
  }
  const draftRow = db.prepare(
    "SELECT * FROM payroll_drafts WHERE draft_id = ? AND owner_id = ? AND expires_at > unixepoch()"
  )
  function existingClaims(row: PayrollEntry): ClaimInput[] {
    return (
      getClaimRows.all(row.employeeId, row.year, row.month) as Array<{
        claim_id: string
        amount_minor: number
        status: ClaimStatus
        receipt: string
      }>
    ).map((claim) => ({
      id: claim.claim_id,
      amountMinor: claim.amount_minor,
      status: claim.status,
      receipt: claim.receipt,
    }))
  }
  return {
    async stagePayroll(input) {
      const failures = validateEntries(input.rows)
      if (failures.length) return { ok: false, failures }
      const staged: StagedEntry[] = []
      input.rows.forEach((row, index) => {
        const employee = getEmployee.get(row.employeeId)
        if (input.mode === "create" && employee)
          failures.push({
            row: index + 2,
            message:
              "Employee ID already exists. Use the salary editor to update it.",
          })
        const claims = existingClaims(row)
        const current = getPayslip.get(row.employeeId, row.year, row.month) as
          PayslipRow | undefined
        if (claims.length && current?.currency !== row.currency)
          failures.push({
            row: index + 2,
            message: "Currency cannot change while this month has claims.",
          })
        const claimFailures = validateSalary({
          ...row,
          claims,
          confirmed: true,
        })
        if (claimFailures.length) {
          for (const message of claimFailures)
            failures.push({ row: index + 2, message })
          return
        }
        const approvedReimbursementsMinor = claims
          .filter((claim) => claim.status === "approved")
          .reduce((sum, claim) => sum + claim.amountMinor, 0)
        if (!Number.isSafeInteger(approvedReimbursementsMinor)) {
          failures.push({
            row: index + 2,
            message: "Approved claims exceed the safe integer range.",
          })
          return
        }
        const slip = computePayslip({ ...row, approvedReimbursementsMinor })
        if (
          !Object.values(slip).every(
            (value) => typeof value === "string" || Number.isSafeInteger(value)
          )
        )
          failures.push({
            row: index + 2,
            message: "Computed pay exceeds the safe integer range.",
          })
        staged.push({
          ...row,
          expectedVersion: salaryVersion(row.employeeId, row.year, row.month),
          operation: employee ? "update" : "create",
        })
      })
      if (failures.length) return { ok: false, failures }
      db.exec("BEGIN IMMEDIATE")
      try {
        db.prepare(
          "DELETE FROM payroll_drafts WHERE expires_at <= unixepoch()"
        ).run()
        db.prepare(
          "DELETE FROM payroll_drafts WHERE owner_id = ? AND draft_id NOT IN (SELECT draft_id FROM payroll_drafts WHERE owner_id = ? ORDER BY expires_at DESC, rowid DESC LIMIT 2)"
        ).run(input.ownerId, input.ownerId)
        const count = db
          .prepare("SELECT COUNT(*) AS total FROM payroll_drafts")
          .get() as { total: number }
        if (count.total >= 50) {
          db.exec("ROLLBACK")
          return {
            ok: false,
            failures: [
              {
                row: 0,
                message: "Too many pending reviews. Try again in 15 minutes.",
              },
            ],
          }
        }
        const id = randomUUID()
        db.prepare(
          "INSERT INTO payroll_drafts(draft_id, owner_id, source, mode, rows_json, expires_at) VALUES (?, ?, ?, ?, ?, unixepoch() + ?)"
        ).run(
          id,
          input.ownerId,
          input.source.slice(0, 120),
          input.mode,
          JSON.stringify(staged),
          DRAFT_SECONDS
        )
        db.exec("COMMIT")
        return { ok: true, draftId: id }
      } catch (error) {
        db.exec("ROLLBACK")
        throw error
      }
    },
    async getPayrollDraft(id, ownerId, page) {
      const draft = draftRow.get(id, ownerId) as DraftRow | undefined
      if (!draft) return null
      const rows = JSON.parse(draft.rows_json) as StagedEntry[]
      const pages = Math.ceil(rows.length / REVIEW_PAGE_SIZE)
      const selected = Number.isSafeInteger(page)
        ? Math.min(pages, Math.max(1, page))
        : 1
      return {
        id,
        source: draft.source,
        mode: draft.mode,
        expiresAt: draft.expires_at,
        status: draft.status,
        total: rows.length,
        period: { year: rows[0].year, month: rows[0].month },
        page: selected,
        pages,
        rows: rows
          .slice((selected - 1) * REVIEW_PAGE_SIZE, selected * REVIEW_PAGE_SIZE)
          .map(({ expectedVersion: _version, ...row }) => row),
      }
    },
    async commitPayrollDraft(id, ownerId, confirmed) {
      if (!confirmed)
        return {
          ok: false,
          message: "Confirm the reviewed payroll before saving.",
        }
      db.exec("BEGIN IMMEDIATE")
      try {
        const draft = draftRow.get(id, ownerId) as DraftRow | undefined
        if (!draft) {
          db.exec("ROLLBACK")
          return {
            ok: false,
            message:
              "This review is unavailable or expired. Please start again.",
          }
        }
        const rows = JSON.parse(draft.rows_json) as StagedEntry[]
        if (draft.status === "committed") {
          db.exec("COMMIT")
          return { ok: true, count: rows.length }
        }
        for (let index = 0; index < rows.length; index++) {
          const row = rows[index]
          if (
            row.expectedVersion !==
            salaryVersion(row.employeeId, row.year, row.month)
          ) {
            db.exec("ROLLBACK")
            return {
              ok: false,
              message: `Row ${index + 2}: payroll changed since review. Start again to review the latest data. Nothing was saved.`,
            }
          }
          const result = saveMonth({
            ...row,
            claims: existingClaims(row),
            confirmed: true,
          })
          if (!result.ok) {
            db.exec("ROLLBACK")
            return {
              ok: false,
              message: `Row ${index + 2}: ${result.failures.join(" ")} Nothing was saved.`,
            }
          }
        }
        db.prepare(
          "UPDATE payroll_drafts SET status = 'committed' WHERE draft_id = ?"
        ).run(id)
        db.exec("COMMIT")
        return { ok: true, count: rows.length }
      } catch (error) {
        db.exec("ROLLBACK")
        throw error
      }
    },
    async getSalaryVersion(employeeId, year, month) {
      return salaryVersion(employeeId, year, month)
    },
    async getSalaryInputs(employeeId, year, month) {
      const row = (monthlyInputs.get(employeeId, year, month) ??
        getEmployee.get(employeeId)) as
        { annual_ctc_minor: number; currency: string } | undefined
      return row
        ? { annualCtcMinor: row.annual_ctc_minor, currency: row.currency }
        : null
    },
    async get(employeeId, year, month) {
      const row = getPayslip.get(employeeId, year, month) as
        PayslipRow | undefined
      if (!row) return null
      return {
        employeeId: row.employee_id,
        year: row.year,
        month: row.month,
        currency: row.currency,
        monthlyGrossMinor: row.monthly_gross_minor,
        unpaidDeductionMinor: row.unpaid_deduction_minor,
        otherDeductionsMinor: row.other_deductions_minor,
        approvedReimbursementsMinor: row.approved_reimbursements_minor,
        netMinor: row.net_minor,
      }
    },

    async getLeave(employeeId, year, month) {
      const row = getLeaveRow.get(employeeId, year, month) as
        | {
            employee_id: string
            year: number
            month: number
            unpaid_leave_days: number
            calendar_days: number
          }
        | undefined
      if (!row) return null
      return {
        employeeId: row.employee_id,
        year: row.year,
        month: row.month,
        unpaidLeaveDays: row.unpaid_leave_days,
        calendarDays: row.calendar_days,
      }
    },

    async getClaims(employeeId, year, month) {
      const rows = getClaimRows.all(employeeId, year, month) as Array<{
        claim_id: string
        employee_id: string
        year: number
        month: number
        amount_minor: number
        status: ClaimStatus
        receipt: string
      }>
      return rows.map((row) => ({
        id: row.claim_id,
        employeeId: row.employee_id,
        year: row.year,
        month: row.month,
        amountMinor: row.amount_minor,
        status: row.status,
        receipt: row.receipt,
      }))
    },

    async saveMonth(input) {
      return saveMonth(input)
    },

    async submitPendingClaim(input) {
      if (!input.confirmed) {
        return { ok: false, failures: ["commit only after confirmation"] }
      }
      if (input.receipt.trim() === "")
        return { ok: false, failures: ["receipt"] }
      if (!Number.isSafeInteger(input.amountMinor))
        return { ok: false, failures: ["claim amount"] }
      const payslip = await this.get(input.employeeId, input.year, input.month)
      if (!payslip) return { ok: false, failures: ["No payslip"] }
      insertClaim.run(
        input.claimId,
        input.employeeId,
        input.year,
        input.month,
        input.amountMinor,
        "pending",
        input.receipt
      )
      return { ok: true, payslip }
    },

    async approveClaim(input) {
      if (!input.confirmed) {
        return { ok: false, failures: ["commit only after confirmation"] }
      }
      const claim = getClaimById.get(input.claimId) as
        | {
            claim_id: string
            employee_id: string
            year: number
            month: number
            amount_minor: number
            status: ClaimStatus
            receipt: string
          }
        | undefined
      if (!claim) return { ok: false, failures: ["No payslip"] }
      const employee = (monthlyInputs.get(
        claim.employee_id,
        claim.year,
        claim.month
      ) ?? getEmployee.get(claim.employee_id)) as
        { annual_ctc_minor: number; currency: string } | undefined
      const leave = await this.getLeave(
        claim.employee_id,
        claim.year,
        claim.month
      )
      const current = await this.get(claim.employee_id, claim.year, claim.month)
      if (!employee || !leave || !current)
        return { ok: false, failures: ["No payslip"] }

      db.exec("BEGIN")
      try {
        if (claim.status === "pending") {
          db.prepare(
            `UPDATE claims SET status = 'approved' WHERE claim_id = ?`
          ).run(input.claimId)
        }
        const total = approvedTotal.get(
          claim.employee_id,
          claim.year,
          claim.month
        ) as { total: number }
        const payslip = computePayslip({
          annualCtcMinor: employee.annual_ctc_minor,
          currency: employee.currency,
          calendarDays: leave.calendarDays,
          unpaidLeaveDays: leave.unpaidLeaveDays,
          otherDeductionsMinor: current.otherDeductionsMinor,
          approvedReimbursementsMinor: total.total,
        })
        upsertPayslip.run(
          claim.employee_id,
          claim.year,
          claim.month,
          payslip.currency,
          payslip.monthlyGrossMinor,
          payslip.unpaidDeductionMinor,
          payslip.otherDeductionsMinor,
          payslip.approvedReimbursementsMinor,
          payslip.netMinor
        )
        db.exec("COMMIT")
        return {
          ok: true as const,
          payslip: {
            employeeId: claim.employee_id,
            year: claim.year,
            month: claim.month,
            ...payslip,
          },
        }
      } catch (error) {
        db.exec("ROLLBACK")
        throw error
      }
    },

    async listPendingClaims(limit, cursor) {
      const rows = pendingPage.all(cursor ?? "", limit + 1) as Array<{
        claim_id: string
        employee_id: string
        year: number
        month: number
        amount_minor: number
        receipt: string
      }>
      const page = rows.slice(0, limit)
      return {
        claims: page.map((row) => ({
          id: row.claim_id,
          employeeId: row.employee_id,
          year: row.year,
          month: row.month,
          amountMinor: row.amount_minor,
          receipt: row.receipt,
        })),
        nextCursor: rows.length > limit ? page[page.length - 1].claim_id : null,
      }
    },

    async uploadDocument(input) {
      insertDocument.run(input.documentId, input.body)
    },

    async answerFromDocuments(question) {
      const trimmed = question.trim()
      if (trimmed === "") return null
      const row = citedDocument.get(trimmed) as
        { document_id: string; body: string } | undefined
      if (!row) return null
      return { citation: row.document_id, answer: row.body }
    },

    async orgTotals(year, month) {
      const rows = orgTotalRows.all(year, month) as Array<{
        currency: string
        employee_count: number
        net_minor: number
      }>
      return rows.map((row) => ({
        currency: row.currency,
        employeeCount: row.employee_count,
        netMinor: row.net_minor,
      }))
    },

    async listEmployees(query) {
      if (
        !Number.isInteger(query.limit) ||
        query.limit < 1 ||
        query.limit > 100 ||
        !Number.isInteger(query.year) ||
        query.year < 1900 ||
        query.year > 9999 ||
        !Number.isInteger(query.month) ||
        query.month < 1 ||
        query.month > 12 ||
        !/^[A-Za-z0-9_-]{0,64}$/.test(query.prefix) ||
        (query.currency &&
          !(Intl.supportedValuesOf("currency") as string[]).includes(
            query.currency
          ))
      ) {
        throw new Error("Invalid employee directory filters.")
      }
      const conditions = ["e.employee_id > ?"]
      const parameters: (string | number)[] = [
        query.year,
        query.month,
        query.cursor ?? "",
      ]
      if (query.prefix) {
        conditions.push("e.employee_id GLOB ?")
        parameters.push(`${query.prefix}*`)
      }
      if (query.currency) {
        conditions.push("e.currency = ?")
        parameters.push(query.currency)
      }
      parameters.push(query.limit + 1)
      const rows = db
        .prepare(
          `
        SELECT e.employee_id, e.annual_ctc_minor, e.currency,
               p.net_minor AS monthly_net_minor, p.currency AS monthly_currency
        FROM employees e LEFT JOIN payslips p
          ON p.employee_id = e.employee_id AND p.year = ? AND p.month = ?
        WHERE ${conditions.join(" AND ")}
        ORDER BY e.employee_id LIMIT ?
      `
        )
        .all(...parameters) as Array<{
        employee_id: string
        annual_ctc_minor: number
        currency: string
        monthly_net_minor: number | null
        monthly_currency: string | null
      }>
      const page = rows.slice(0, query.limit)
      return {
        employees: page.map((row) => ({
          employeeId: row.employee_id,
          annualCtcMinor: row.annual_ctc_minor,
          currency: row.currency,
          monthlyNetMinor: row.monthly_net_minor,
          monthlyCurrency: row.monthly_currency,
        })),
        nextCursor:
          rows.length > query.limit ? page[page.length - 1].employee_id : null,
      }
    },

    async listEmployeeIds(limit, cursor) {
      const rows = employeePage.all(cursor ?? "", limit + 1) as Array<{
        employee_id: string
      }>
      const page = rows.slice(0, limit)
      return {
        employeeIds: page.map((row) => row.employee_id),
        nextCursor:
          rows.length > limit ? page[page.length - 1].employee_id : null,
      }
    },

    close() {
      db.close()
    },
  }
}
