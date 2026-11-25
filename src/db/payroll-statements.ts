import type { SQLInputValue } from "node:sqlite"
import type { StorageDatabase } from "./connection.ts"

export class PayrollDatabaseError extends Error {
  constructor(operation: string, cause: unknown) {
    super(`Payroll database could not ${operation}.`, { cause })
    this.name = "PayrollDatabaseError"
  }
}

function checked<T>(operation: string, run: () => T): T {
  try {
    return run()
  } catch (cause) {
    throw new PayrollDatabaseError(operation, cause)
  }
}

export function payrollStatements(connection: StorageDatabase) {
  return {
    exec(sql: string) {
      checked("execute a statement", () => connection.exec(sql))
    },
    prepare(sql: string) {
      const statement = checked("prepare a statement", () => connection.prepare(sql))
      return {
        get: (...args: SQLInputValue[]) =>
          checked("read a row", () => statement.get(...args)),
        all: (...args: SQLInputValue[]) =>
          checked("read rows", () => statement.all(...args)),
        run: (...args: SQLInputValue[]) =>
          checked("write rows", () => statement.run(...args)),
      }
    },
    close() {
      checked("close the connection", () => connection.close())
    },
  }
}
