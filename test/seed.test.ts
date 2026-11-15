import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "vitest"
import { computePayslip } from "../src/domain/payslip.ts"
import { openPayrollDatabase } from "../src/db/sqlite-payroll.ts"
import { seedSyntheticEmployees, syntheticMonth } from "../src/db/seed.ts"

test("the synthetic seed is 10,000 employees and matches the payslip function", async () => {
  const dir = mkdtempSync(join(tmpdir(), "payroll-seed-"))
  const db = openPayrollDatabase(join(dir, "payroll.sqlite"))
  assert.equal(await seedSyntheticEmployees(db), 10_000)

  const sample = syntheticMonth(1)
  const stored = await db.get(sample.employeeId, sample.year, sample.month)
  const expected = computePayslip({
    annualCtcMinor: sample.annualCtcMinor,
    currency: sample.currency,
    calendarDays: sample.calendarDays,
    unpaidLeaveDays: sample.unpaidLeaveDays,
    otherDeductionsMinor: sample.otherDeductionsMinor,
    approvedReimbursementsMinor: 0,
  })
  assert.equal(stored?.netMinor, expected.netMinor)
  assert.equal(stored?.currency, sample.currency)

  let count = 0
  let cursor: string | null = null
  do {
    const page = await db.listEmployeeIds(1_000, cursor)
    count += page.employeeIds.length
    cursor = page.nextCursor
  } while (cursor !== null)
  assert.equal(count, 10_000)

  const totals = await db.orgTotals(2026, 1)
  assert.deepEqual(
    totals.map((total) => total.currency),
    ["EUR", "INR", "USD"],
  )
  assert.equal(
    totals.reduce((sum, total) => sum + total.employeeCount, 0),
    10_000,
  )
  db.close()
})
