import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { openPayrollDatabase, type PayrollRepository } from "./db/sqlite-payroll.ts"

export function payrollDbPath(): string {
  return process.env.PAYROLL_DB ?? "data/payroll.sqlite"
}

export async function withPayroll<T>(run: (db: PayrollRepository) => Promise<T>): Promise<T> {
  const path = payrollDbPath()
  mkdirSync(dirname(path), { recursive: true })
  const db = openPayrollDatabase(path)
  try {
    return await run(db)
  } finally {
    db.close()
  }
}
