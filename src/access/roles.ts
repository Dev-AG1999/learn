import type { PayrollRepository, SaveMonthInput, SaveMonthResult } from "../db/sqlite-payroll.ts"

export type HrAccess = {
  saveMonth(input: SaveMonthInput): Promise<SaveMonthResult>
  orgTotals: PayrollRepository["orgTotals"]
  listEmployeeIds: PayrollRepository["listEmployeeIds"]
}

export type EmployeeAccess = {
  get(year: number, month: number): ReturnType<PayrollRepository["get"]>
}

export function hrAccess(db: PayrollRepository): HrAccess {
  return {
    saveMonth: (input) => db.saveMonth(input),
    orgTotals: (year, month) => db.orgTotals(year, month),
    listEmployeeIds: (limit, cursor) => db.listEmployeeIds(limit, cursor),
  }
}

export function employeeAccess(db: PayrollRepository, employeeId: string): EmployeeAccess {
  return {
    get(year, month) {
      return db.get(employeeId, year, month)
    },
  }
}
