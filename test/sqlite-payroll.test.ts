import assert from "node:assert/strict"
import { existsSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "vitest"
import { openPayrollDatabase } from "../src/db/sqlite-payroll.ts"
import { computePayslip } from "../src/domain/payslip.ts"

function openTemp() {
  const dir = mkdtempSync(join(tmpdir(), "payroll-"))
  const path = join(dir, "payroll.sqlite")
  return { path, db: openPayrollDatabase(path) }
}

const march = {
  employeeId: "emp-a",
  year: 2026,
  month: 3,
  annualCtcMinor: 1_440_000,
  currency: "USD",
  calendarDays: 31,
  unpaidLeaveDays: 0,
  otherDeductionsMinor: 0,
  claims: [] as const,
  confirmed: true,
}

test("a missing month has no payslip", async () => {
  const { db } = openTemp()
  assert.equal(await db.get("emp-a", 2026, 3), null)
  db.close()
})

test("the stored payslip is the tested function output", async () => {
  const { path, db } = openTemp()
  const saved = await db.saveMonth(march)
  const expected = computePayslip({
    annualCtcMinor: march.annualCtcMinor,
    currency: march.currency,
    calendarDays: march.calendarDays,
    unpaidLeaveDays: march.unpaidLeaveDays,
    otherDeductionsMinor: march.otherDeductionsMinor,
    approvedReimbursementsMinor: 0,
  })
  assert.equal(saved.ok, true)
  assert.deepEqual(await db.get("emp-a", 2026, 3), {
    employeeId: "emp-a",
    year: 2026,
    month: 3,
    ...expected,
  })
  assert.equal(existsSync(path), true)
  db.close()
})

test("a later CTC change does not rewrite an earlier month", async () => {
  const { db } = openTemp()
  await db.saveMonth(march)
  await db.saveMonth({
    ...march,
    month: 4,
    calendarDays: 30,
    annualCtcMinor: 2_880_000,
  })
  assert.equal((await db.get("emp-a", 2026, 3))?.monthlyGrossMinor, 120_000)
  assert.equal((await db.get("emp-a", 2026, 4))?.monthlyGrossMinor, 240_000)
  db.close()
})

test("one employee cannot read another employee's month", async () => {
  const { db } = openTemp()
  await db.saveMonth(march)
  await db.saveMonth({
    ...march,
    employeeId: "emp-b",
    currency: "INR",
    annualCtcMinor: 2_880_000,
    claims: [{ id: "claim-b", amountMinor: 500, status: "approved", receipt: "receipt-b" }],
  })
  assert.equal((await db.get("emp-a", 2026, 3))?.currency, "USD")
  assert.equal((await db.get("emp-a", 2026, 3))?.netMinor, 120_000)
  assert.deepEqual(await db.getClaims("emp-a", 2026, 3), [])
  assert.equal((await db.getClaims("emp-b", 2026, 3))[0]?.id, "claim-b")
  db.close()
})

test("only an approved claim changes net, and the month commits together", async () => {
  const { db } = openTemp()
  const saved = await db.saveMonth({
    ...march,
    otherDeductionsMinor: 500,
    claims: [
      { id: "pending-1", amountMinor: 9_000, status: "pending", receipt: "receipt-pending" },
      { id: "approved-1", amountMinor: 200, status: "approved", receipt: "receipt-approved" },
    ],
  })
  assert.equal(saved.ok, true)
  if (!saved.ok) return
  assert.equal(saved.payslip.approvedReimbursementsMinor, 200)
  assert.equal(saved.payslip.netMinor, 119_700)
  assert.equal((await db.getLeave("emp-a", 2026, 3))?.unpaidLeaveDays, 0)
  assert.equal((await db.getClaims("emp-a", 2026, 3)).length, 2)
  db.close()
})

test("invalid leave does not leave a partial month", async () => {
  const { db } = openTemp()
  const saved = await db.saveMonth({ ...march, calendarDays: 30, unpaidLeaveDays: 31 })
  assert.deepEqual(saved, { ok: false, failures: ["unpaid days ≤ calendar days"] })
  assert.equal(await db.get("emp-a", 2026, 3), null)
  assert.equal(await db.getLeave("emp-a", 2026, 3), null)
  assert.deepEqual(await db.getClaims("emp-a", 2026, 3), [])
  db.close()
})

test("a month is stored only after confirmation", async () => {
  const { db } = openTemp()
  const saved = await db.saveMonth({ ...march, confirmed: false })
  assert.deepEqual(saved, { ok: false, failures: ["commit only after confirmation"] })
  assert.equal(await db.get("emp-a", 2026, 3), null)
  db.close()
})

test("a failed claim write rolls back the payslip and leave", async () => {
  const { db } = openTemp()
  await assert.rejects(() =>
    db.saveMonth({
      ...march,
      claims: [
        { id: "same", amountMinor: 100, status: "approved", receipt: "one" },
        { id: "same", amountMinor: 100, status: "pending", receipt: "two" },
      ],
    }),
  )
  assert.equal(await db.get("emp-a", 2026, 3), null)
  assert.equal(await db.getLeave("emp-a", 2026, 3), null)
  assert.deepEqual(await db.getClaims("emp-a", 2026, 3), [])
  db.close()
})

test("org totals group by currency", async () => {
  const { db } = openTemp()
  await db.saveMonth(march)
  await db.saveMonth({ ...march, employeeId: "emp-b" })
  await db.saveMonth({
    ...march,
    employeeId: "emp-c",
    currency: "INR",
    annualCtcMinor: 2_880_000,
  })
  assert.deepEqual(await db.orgTotals(2026, 3), [
    { currency: "INR", employeeCount: 1, netMinor: 240_000 },
    { currency: "USD", employeeCount: 2, netMinor: 240_000 },
  ])
  db.close()
})

test("a page of employees is not the full table", async () => {
  const { db } = openTemp()
  for (const employeeId of ["emp-a", "emp-b", "emp-c"]) {
    await db.saveMonth({ ...march, employeeId })
  }
  const first = await db.listEmployeeIds(2, null)
  assert.deepEqual(first.employeeIds, ["emp-a", "emp-b"])
  assert.equal(first.nextCursor, "emp-b")
  const second = await db.listEmployeeIds(2, first.nextCursor)
  assert.deepEqual(second.employeeIds, ["emp-c"])
  assert.equal(second.nextCursor, null)
  db.close()
})
