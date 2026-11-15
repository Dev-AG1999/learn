import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "vitest"
import { employeeAccess, hrAccess } from "../src/access/roles.ts"
import { openPayrollDatabase } from "../src/db/sqlite-payroll.ts"

const march = {
  year: 2026,
  month: 3,
  annualCtcMinor: 1_440_000,
  calendarDays: 31,
  unpaidLeaveDays: 0,
  otherDeductionsMinor: 0,
  claims: [] as const,
  confirmed: true,
}

test("HR access stores a month and reads totals without an employee payslip", async () => {
  const dir = mkdtempSync(join(tmpdir(), "payroll-hr-"))
  const db = openPayrollDatabase(join(dir, "payroll.sqlite"))
  const hr = hrAccess(db)
  const saved = await hr.saveMonth({ ...march, employeeId: "emp-a", currency: "USD" })
  assert.equal(saved.ok, true)
  assert.deepEqual(await hr.orgTotals(2026, 3), [
    { currency: "USD", employeeCount: 1, netMinor: 120_000 },
  ])
  assert.equal("get" in hr, false)
  db.close()
})

test("employee access reads only the bound employee", async () => {
  const dir = mkdtempSync(join(tmpdir(), "payroll-employee-"))
  const db = openPayrollDatabase(join(dir, "payroll.sqlite"))
  const hr = hrAccess(db)
  await hr.saveMonth({ ...march, employeeId: "emp-a", currency: "USD" })
  await hr.saveMonth({
    ...march,
    employeeId: "emp-b",
    currency: "INR",
    annualCtcMinor: 2_880_000,
  })
  const employee = employeeAccess(db, "emp-a")
  assert.equal((await employee.get(2026, 3))?.currency, "USD")
  assert.equal((await employee.get(2026, 3))?.netMinor, 120_000)
  assert.equal("orgTotals" in employee, false)
  assert.equal("saveMonth" in employee, false)
  db.close()
})
