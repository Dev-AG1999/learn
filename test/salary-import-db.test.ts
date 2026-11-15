import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { beforeEach, afterEach, expect, test } from "vitest"
import {
  openPayrollDatabase,
  type PayrollRepository,
} from "../src/db/sqlite-payroll.ts"
import type { PayrollEntry } from "../src/import/types.ts"

const row: PayrollEntry = {
  employeeId: "new-a",
  year: 2026,
  month: 11,
  annualCtcMinor: 120000000,
  currency: "INR",
  calendarDays: 30,
  unpaidLeaveDays: 0,
  otherDeductionsMinor: 0,
}
let dir: string, path: string, db: PayrollRepository
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "payroll-import-"))
  path = join(dir, "db.sqlite")
  db = openPayrollDatabase(path)
})
afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})
async function stage(rows = [row], mode: "create" | "upsert" = "upsert") {
  const result = await db.stagePayroll({
    ownerId: "hr-a",
    source: "salary.csv",
    mode,
    rows,
  })
  if (!result.ok) throw new Error(JSON.stringify(result.failures))
  return result.draftId
}

test("review is private and does not write employees, leave or payslips before confirmation", async () => {
  const id = await stage()
  expect(await db.getPayrollDraft(id, "other-hr", 1)).toBeNull()
  expect(await db.get("new-a", 2026, 11)).toBeNull()
  expect((await db.listEmployeeIds(10, null)).employeeIds).toEqual([])
  expect((await db.commitPayrollDraft(id, "hr-a", false)).ok).toBe(false)
  expect((await db.commitPayrollDraft(id, "other-hr", true)).ok).toBe(false)
  expect(await db.getLeave("new-a", 2026, 11)).toBeNull()
})

test("confirmed manual create persists across reopen and replay does not write again", async () => {
  const id = await stage([row], "create")
  expect(await db.commitPayrollDraft(id, "hr-a", true)).toEqual({
    ok: true,
    count: 1,
  })
  expect((await db.get("new-a", 2026, 11))?.netMinor).toBe(10000000)
  expect((await db.getPayrollDraft(id, "hr-a", 1))?.status).toBe("committed")
  await db.saveMonth({
    ...row,
    annualCtcMinor: 240000000,
    claims: [],
    confirmed: true,
  })
  expect((await db.commitPayrollDraft(id, "hr-a", true)).ok).toBe(true)
  expect((await db.get("new-a", 2026, 11))?.monthlyGrossMinor).toBe(20000000)
  db.close()
  db = openPayrollDatabase(path)
  expect((await db.listEmployeeIds(10, null)).employeeIds).toEqual(["new-a"])
})

test("manual creation rejects an existing employee ID", async () => {
  await db.saveMonth({ ...row, claims: [], confirmed: true })
  const result = await db.stagePayroll({
    ownerId: "hr-a",
    source: "Manual",
    mode: "create",
    rows: [row],
  })
  expect(result.ok).toBe(false)
})

test("imports preserve claims, earlier months and other employees", async () => {
  const claims = [
    {
      id: "claim",
      amountMinor: 10000,
      status: "approved" as const,
      receipt: "receipt",
    },
  ]
  await db.saveMonth({
    ...row,
    month: 10,
    calendarDays: 31,
    claims: [],
    confirmed: true,
  })
  await db.saveMonth({ ...row, claims, confirmed: true })
  const id = await stage([
    { ...row, annualCtcMinor: 240000000 },
    { ...row, employeeId: "new-b" },
  ])
  expect((await db.commitPayrollDraft(id, "hr-a", true)).ok).toBe(true)
  expect((await db.getClaims("new-a", 2026, 11))[0]).toMatchObject(claims[0])
  expect((await db.get("new-a", 2026, 11))?.approvedReimbursementsMinor).toBe(
    10000
  )
  expect((await db.get("new-a", 2026, 10))?.monthlyGrossMinor).toBe(10000000)
  expect((await db.orgTotals(2026, 11))[0].employeeCount).toBe(2)
})

test("changed payroll or claims make the whole review stale and roll back earlier rows", async () => {
  await db.saveMonth({
    ...row,
    employeeId: "new-b",
    claims: [],
    confirmed: true,
  })
  const id = await stage([
    row,
    { ...row, employeeId: "new-b", annualCtcMinor: 240000000 },
  ])
  await db.submitPendingClaim({
    employeeId: "new-b",
    year: 2026,
    month: 11,
    claimId: "later",
    amountMinor: 100,
    receipt: "receipt",
    confirmed: true,
  })
  const result = await db.commitPayrollDraft(id, "hr-a", true)
  expect(result.ok).toBe(false)
  expect(await db.get("new-a", 2026, 11)).toBeNull()
  expect((await db.listEmployeeIds(10, null)).employeeIds).toEqual(["new-b"])
  expect((await db.get("new-b", 2026, 11))?.monthlyGrossMinor).toBe(10000000)
})

test("a SQLite failure on a later row rolls back employees, slips, leave and draft status", async () => {
  const id = await stage([row, { ...row, employeeId: "fail" }])
  const raw = new DatabaseSync(path)
  raw.exec(
    "CREATE TRIGGER reject_test_row BEFORE INSERT ON payslips WHEN NEW.employee_id = 'fail' BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;"
  )
  raw.close()
  await expect(db.commitPayrollDraft(id, "hr-a", true)).rejects.toThrow()
  expect((await db.listEmployeeIds(10, null)).employeeIds).toEqual([])
  expect(await db.getLeave("new-a", 2026, 11)).toBeNull()
  expect((await db.getPayrollDraft(id, "hr-a", 1))?.status).toBe("pending")
})

test("currency changes with claims and duplicate IDs are rejected during preview", async () => {
  await db.saveMonth({
    ...row,
    claims: [{ id: "c", amountMinor: 100, status: "pending", receipt: "r" }],
    confirmed: true,
  })
  expect(
    (
      await db.stagePayroll({
        ownerId: "hr-a",
        source: "file",
        mode: "upsert",
        rows: [{ ...row, currency: "USD" }],
      })
    ).ok
  ).toBe(false)
  expect(
    (
      await db.stagePayroll({
        ownerId: "hr-a",
        source: "file",
        mode: "upsert",
        rows: [row, row],
      })
    ).ok
  ).toBe(false)
})

test("expired reviews cannot be viewed or committed", async () => {
  const id = await stage()
  const raw = new DatabaseSync(path)
  raw
    .prepare("UPDATE payroll_drafts SET expires_at = 0 WHERE draft_id = ?")
    .run(id)
  raw.close()
  expect(await db.getPayrollDraft(id, "hr-a", 1)).toBeNull()
  expect((await db.commitPayrollDraft(id, "hr-a", true)).ok).toBe(false)
})

test("10,000-row review is paginated and imports completely", async () => {
  const rows = Array.from({ length: 10000 }, (_, i) => ({
    ...row,
    employeeId: `bulk-${String(i).padStart(5, "0")}`,
  }))
  const id = await stage(rows)
  const first = await db.getPayrollDraft(id, "hr-a", 1)
  expect(first?.rows).toHaveLength(25)
  expect(first?.pages).toBe(400)
  expect((await db.getPayrollDraft(id, "hr-a", 400))?.rows[24].employeeId).toBe(
    "bulk-09999"
  )
  expect(await db.commitPayrollDraft(id, "hr-a", true)).toEqual({
    ok: true,
    count: 10000,
  })
  expect((await db.orgTotals(2026, 11))[0].employeeCount).toBe(10000)
}, 15000)
