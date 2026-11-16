import type {
  ApproveClaimInput,
  PayrollRepository,
  PendingClaimInput,
  SaveMonthInput,
  SaveMonthResult,
} from "../db/sqlite-payroll.ts"

export type HrAccess = {
  listEmployees: PayrollRepository["listEmployees"]
  saveMonth(input: SaveMonthInput): Promise<SaveMonthResult>
  approveClaim(input: ApproveClaimInput): Promise<SaveMonthResult>
  listPendingClaims: PayrollRepository["listPendingClaims"]
  uploadDocument: PayrollRepository["uploadDocument"]
  answerFromDocuments: PayrollRepository["answerFromDocuments"]
  orgTotals: PayrollRepository["orgTotals"]
  listEmployeeIds: PayrollRepository["listEmployeeIds"]
}

export type EmployeeAccess = {
  get(year: number, month: number): ReturnType<PayrollRepository["get"]>
  getClaims(
    year: number,
    month: number
  ): ReturnType<PayrollRepository["getClaims"]>
  submitPendingClaim(
    input: Omit<PendingClaimInput, "employeeId">
  ): Promise<SaveMonthResult>
}

export function hrAccess(db: PayrollRepository): HrAccess {
  return {
    listEmployees: (query) => db.listEmployees(query),
    saveMonth: (input) => db.saveMonth(input),
    approveClaim: (input) => db.approveClaim(input),
    listPendingClaims: (limit, cursor) => db.listPendingClaims(limit, cursor),
    uploadDocument: (input) => db.uploadDocument(input),
    answerFromDocuments: (question) => db.answerFromDocuments(question),
    orgTotals: (year, month) => db.orgTotals(year, month),
    listEmployeeIds: (limit, cursor) => db.listEmployeeIds(limit, cursor),
  }
}

export function employeeAccess(
  db: PayrollRepository,
  employeeId: string
): EmployeeAccess {
  return {
    get(year, month) {
      return db.get(employeeId, year, month)
    },
    getClaims(year, month) {
      return db.getClaims(employeeId, year, month)
    },
    submitPendingClaim(input) {
      return db.submitPendingClaim({ ...input, employeeId })
    },
  }
}
