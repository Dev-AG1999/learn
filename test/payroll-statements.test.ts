import { DatabaseSync } from "node:sqlite"
import { expect, test } from "vitest"
import { payrollStatements, PayrollDatabaseError } from "../src/db/payroll-statements.ts"

test("SQLite failures surface as payroll errors and keep their original cause", () => {
  const db = payrollStatements(new DatabaseSync(":memory:"))
  try {
    expect(() => db.exec("invalid SQL")).toThrow(PayrollDatabaseError)
    expect(() => db.prepare("SELECT * FROM missing")).toThrow(PayrollDatabaseError)
    db.exec("CREATE TABLE sample (id TEXT UNIQUE)")
    const insert = db.prepare("INSERT INTO sample VALUES (?)")
    insert.run("key")
    try {
      insert.run("key")
      throw new Error("Expected a constraint failure")
    } catch (error) {
      expect(error).toBeInstanceOf(PayrollDatabaseError)
      expect((error as Error).cause).toBeInstanceOf(Error)
    }
    expect(db.prepare("SELECT id FROM sample").all()).toEqual([{ id: "key" }])
  } finally {
    db.close()
  }
})
