import { mkdirSync, openSync, closeSync, fchmodSync, constants } from "node:fs"
import { dirname } from "node:path"
import { openPayrollDatabase, type PayrollRepository } from "./db/sqlite-payroll.ts"

export function payrollDbPath(): string {
  return process.env.PAYROLL_DB ?? "data/payroll.sqlite"
}

export function preparePayrollPath(): string {
  const path = payrollDbPath()
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const descriptor = openSync(/*turbopackIgnore: true*/ path, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600)
  try { fchmodSync(descriptor, 0o600) } finally { closeSync(descriptor) }
  return path
}

export async function withPayroll<T>(run: (db: PayrollRepository) => Promise<T>): Promise<T> {
  const path = preparePayrollPath()
  const db = openPayrollDatabase(path)
  let operationFailed = false
  try {
    return await run(db)
  } catch (error) {
    operationFailed = true
    throw error
  } finally {
    try {
      db.close()
    } catch (error) {
      if (!operationFailed) throw error
    }
  }
}
