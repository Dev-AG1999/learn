import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "vitest"
import { employeeAccess, hrAccess } from "../src/access/roles.ts"
import { openPayrollDatabase } from "../src/db/sqlite-payroll.ts"

function openTemp() {
  const dir = mkdtempSync(join(tmpdir(), "payroll-claims-"))
  return openPayrollDatabase(join(dir, "payroll.sqlite"))
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

test("a pending receipt does not change net", async () => {
  const db = openTemp()
  const hr = hrAccess(db)
  const employee = employeeAccess(db, "emp-a")
  await hr.saveMonth(march)
  const submitted = await employee.submitPendingClaim({
    year: 2026,
    month: 3,
    claimId: "claim-1",
    amountMinor: 200,
    receipt: "receipt-1",
    confirmed: true,
  })
  assert.equal(submitted.ok, true)
  assert.equal((await employee.get(2026, 3))?.netMinor, 120_000)
  assert.equal((await employee.getClaims(2026, 3))[0]?.status, "pending")
  assert.equal("approveClaim" in employee, false)
  db.close()
})

test("HR approval changes net only through the stored month", async () => {
  const db = openTemp()
  const hr = hrAccess(db)
  const employee = employeeAccess(db, "emp-a")
  await hr.saveMonth(march)
  await hr.saveMonth({ ...march, month: 4, calendarDays: 30 })
  await employee.submitPendingClaim({
    year: 2026,
    month: 3,
    claimId: "claim-1",
    amountMinor: 200,
    receipt: "receipt-1",
    confirmed: true,
  })
  const unconfirmed = await hr.approveClaim({ claimId: "claim-1", confirmed: false })
  assert.deepEqual(unconfirmed, { ok: false, failures: ["commit only after confirmation"] })
  assert.equal((await employee.get(2026, 3))?.netMinor, 120_000)
  const approved = await hr.approveClaim({ claimId: "claim-1", confirmed: true })
  assert.equal(approved.ok, true)
  if (!approved.ok) return
  assert.equal(approved.payslip.approvedReimbursementsMinor, 200)
  assert.equal(approved.payslip.netMinor, 120_200)
  assert.equal((await employee.get(2026, 4))?.netMinor, 120_000)
  assert.equal((await employee.getClaims(2026, 3))[0]?.status, "approved")
  db.close()
})

test("an employee sees only that employee's claims", async () => {
  const db = openTemp()
  const hr = hrAccess(db)
  await hr.saveMonth(march)
  await hr.saveMonth({ ...march, employeeId: "emp-b", currency: "INR" })
  await employeeAccess(db, "emp-a").submitPendingClaim({
    year: 2026,
    month: 3,
    claimId: "claim-a",
    amountMinor: 200,
    receipt: "receipt-a",
    confirmed: true,
  })
  assert.deepEqual(await employeeAccess(db, "emp-b").getClaims(2026, 3), [])
  db.close()
})

test("a claim without a receipt or a whole minor-unit amount is not stored", async () => {
  const db = openTemp()
  const hr = hrAccess(db)
  const employee = employeeAccess(db, "emp-a")
  await hr.saveMonth(march)
  assert.deepEqual(
    await employee.submitPendingClaim({
      year: 2026,
      month: 3,
      claimId: "claim-1",
      amountMinor: 200,
      receipt: "",
      confirmed: true,
    }),
    { ok: false, failures: ["receipt"] },
  )
  assert.deepEqual(
    await employee.submitPendingClaim({
      year: 2026,
      month: 3,
      claimId: "claim-2",
      amountMinor: 10.5,
      receipt: "receipt-2",
      confirmed: true,
    }),
    { ok: false, failures: ["claim amount"] },
  )
  assert.deepEqual(await employee.getClaims(2026, 3), [])
  db.close()
})

test("pending claims are paged", async () => {
  const db = openTemp()
  const hr = hrAccess(db)
  const employee = employeeAccess(db, "emp-a")
  await hr.saveMonth(march)
  for (const claimId of ["c-1", "c-2", "c-3"]) {
    await employee.submitPendingClaim({
      year: 2026,
      month: 3,
      claimId,
      amountMinor: 100,
      receipt: `receipt-${claimId}`,
      confirmed: true,
    })
  }
  const first = await hr.listPendingClaims(2, null)
  assert.deepEqual(first.claims.map((claim) => claim.id), ["c-1", "c-2"])
  const second = await hr.listPendingClaims(2, first.nextCursor)
  assert.deepEqual(second.claims.map((claim) => claim.id), ["c-3"])
  assert.equal(second.nextCursor, null)
  db.close()
})
