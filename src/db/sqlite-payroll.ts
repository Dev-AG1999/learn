import { createHash } from "node:crypto"
import { validateSalary } from "../salary-validation.ts"
import { DatabaseSync } from "node:sqlite"
import { computePayslip, validatePayrollInput, type Payslip } from "../domain/payslip.ts"

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

export type SaveMonthResult =
  | { ok: true; payslip: StoredPayslip }
  | { ok: false; failures: string[] }

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
  getSalaryVersion(employeeId: string, year: number, month: number): Promise<string>
  getSalaryInputs(employeeId: string, year: number, month: number): Promise<SalaryInputs | null>
  get(employeeId: string, year: number, month: number): Promise<StoredPayslip | null>
  getLeave(employeeId: string, year: number, month: number): Promise<LeaveDays | null>
  getClaims(employeeId: string, year: number, month: number): Promise<StoredClaim[]>
  saveMonth(input: SaveMonthInput): Promise<SaveMonthResult>
  submitPendingClaim(input: PendingClaimInput): Promise<SaveMonthResult>
  approveClaim(input: ApproveClaimInput): Promise<SaveMonthResult>
  listPendingClaims(limit: number, cursor: string | null): Promise<PendingClaimPage>
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

  const monthlyInputs = db.prepare("SELECT annual_ctc_minor, currency FROM salary_inputs WHERE employee_id = ? AND year = ? AND month = ?")
  const saveInputs = db.prepare("INSERT INTO salary_inputs VALUES (?, ?, ?, ?, ?) ON CONFLICT(employee_id, year, month) DO UPDATE SET annual_ctc_minor = excluded.annual_ctc_minor, currency = excluded.currency")
  function salaryVersion(employeeId: string, year: number, month: number): string {
    const state = [monthlyInputs.get(employeeId, year, month) ?? getEmployee.get(employeeId),
      getPayslip.get(employeeId, year, month), getLeaveRow.get(employeeId, year, month),
      getClaimRows.all(employeeId, year, month)]
    return createHash("sha256").update(JSON.stringify(state)).digest("hex")
  }
  return {
    async getSalaryVersion(employeeId, year, month) { return salaryVersion(employeeId, year, month) },
    async getSalaryInputs(employeeId, year, month) {
      const row = (monthlyInputs.get(employeeId, year, month) ?? getEmployee.get(employeeId)) as { annual_ctc_minor: number; currency: string } | undefined
      return row ? { annualCtcMinor: row.annual_ctc_minor, currency: row.currency } : null
    },
    async get(employeeId, year, month) {
      const row = getPayslip.get(employeeId, year, month) as PayslipRow | undefined
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
      if (!input.confirmed) {
        return { ok: false, failures: ["commit only after confirmation"] }
      }
      if (input.expectedVersion !== undefined && input.expectedVersion !== salaryVersion(input.employeeId, input.year, input.month)) {
        return { ok: false, failures: ["Payroll changed since this form was opened. Reload before editing."] }
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
      if (!Object.values(payslip).every(value => typeof value === "string" || Number.isSafeInteger(value))) return { ok: false, failures: ["Computed pay exceeds the safe integer range."] }
      const stored: StoredPayslip = {
        employeeId: input.employeeId,
        year: input.year,
        month: input.month,
        ...payslip,
      }

      db.exec("BEGIN")
      try {
        upsertEmployee.run(input.employeeId, input.annualCtcMinor, input.currency)
        saveInputs.run(input.employeeId, input.year, input.month, input.annualCtcMinor, input.currency)
        upsertPayslip.run(
          input.employeeId,
          input.year,
          input.month,
          payslip.currency,
          payslip.monthlyGrossMinor,
          payslip.unpaidDeductionMinor,
          payslip.otherDeductionsMinor,
          payslip.approvedReimbursementsMinor,
          payslip.netMinor,
        )
        upsertLeave.run(
          input.employeeId,
          input.year,
          input.month,
          input.unpaidLeaveDays,
          input.calendarDays,
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
            claim.receipt,
          )
        }
        db.exec("COMMIT")
      } catch (error) {
        db.exec("ROLLBACK")
        throw error
      }

      return { ok: true, payslip: stored }
    },

    async submitPendingClaim(input) {
      if (!input.confirmed) {
        return { ok: false, failures: ["commit only after confirmation"] }
      }
      if (input.receipt.trim() === "") return { ok: false, failures: ["receipt"] }
      if (!Number.isSafeInteger(input.amountMinor)) return { ok: false, failures: ["claim amount"] }
      const payslip = await this.get(input.employeeId, input.year, input.month)
      if (!payslip) return { ok: false, failures: ["No payslip"] }
      insertClaim.run(
        input.claimId,
        input.employeeId,
        input.year,
        input.month,
        input.amountMinor,
        "pending",
        input.receipt,
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
      const employee = (monthlyInputs.get(claim.employee_id, claim.year, claim.month) ?? getEmployee.get(claim.employee_id)) as
        | { annual_ctc_minor: number; currency: string }
        | undefined
      const leave = await this.getLeave(claim.employee_id, claim.year, claim.month)
      const current = await this.get(claim.employee_id, claim.year, claim.month)
      if (!employee || !leave || !current) return { ok: false, failures: ["No payslip"] }

      db.exec("BEGIN")
      try {
        if (claim.status === "pending") {
          db.prepare(`UPDATE claims SET status = 'approved' WHERE claim_id = ?`).run(input.claimId)
        }
        const total = approvedTotal.get(claim.employee_id, claim.year, claim.month) as { total: number }
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
          payslip.netMinor,
        )
        db.exec("COMMIT")
        return {
          ok: true as const,
          payslip: { employeeId: claim.employee_id, year: claim.year, month: claim.month, ...payslip },
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
      const row = citedDocument.get(trimmed) as { document_id: string; body: string } | undefined
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

    async listEmployeeIds(limit, cursor) {
      const rows = employeePage.all(cursor ?? "", limit + 1) as Array<{ employee_id: string }>
      const page = rows.slice(0, limit)
      return {
        employeeIds: page.map((row) => row.employee_id),
        nextCursor: rows.length > limit ? page[page.length - 1].employee_id : null,
      }
    },

    close() {
      db.close()
    },
  }
}
