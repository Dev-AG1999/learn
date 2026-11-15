import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, test } from "vitest"
import { openPayrollDatabase, type SaveMonthInput } from "../src/db/sqlite-payroll.ts"
import { readSalaryEditor, saveSalaryEditor } from "../src/salary-editor.ts"
import { validateSalary } from "../src/salary-validation.ts"

const input: SaveMonthInput = { employeeId: "emp-a", year: 2026, month: 3, annualCtcMinor: 1440000, currency: "INR", calendarDays: 31, unpaidLeaveDays: 0, otherDeductionsMinor: 0, confirmed: true, claims: [{ id: "claim-a", amountMinor: 500, status: "approved", receipt: "receipt-a" }] }
const cleanup: (() => void)[] = []
afterEach(() => { cleanup.splice(0).forEach(fn => fn()) })
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "salary-editor-"))
  const path = join(dir, "payroll.sqlite")
  const db = openPayrollDatabase(path)
  cleanup.push(() => { db.close(); rmSync(dir, { recursive: true, force: true }) })
  return { db, path }
}
async function formFor(db: ReturnType<typeof openPayrollDatabase>) {
  const data = await readSalaryEditor(db, "emp-a", 2026, 3)
  const form = new FormData()
  for (const [key, value] of Object.entries({ employeeId: "emp-a", year: 2026, month: 3, annualCtcMinor: 2880000, currency: "INR", unpaidLeaveDays: 2, otherDeductionsMinor: 100, confirmed: "yes", version: data!.version })) form.set(key, String(value))
  return form
}

test("salary editing persists, preserves claims and leaves other months and employees unchanged", async () => {
  const { db, path } = setup()
  await db.saveMonth(input)
  await db.saveMonth({ ...input, month: 4, claims: [] })
  await db.saveMonth({ ...input, employeeId: "emp-b", claims: [] })
  const claims = await db.getClaims("emp-a", 2026, 3)
  const result = await saveSalaryEditor(db, await formFor(db))
  assert.equal(result.ok, true)
  assert.deepEqual(await db.getClaims("emp-a", 2026, 3), claims)
  assert.equal((await db.getLeave("emp-a", 2026, 3))?.unpaidLeaveDays, 2)
  const reopened = openPayrollDatabase(path)
  try {
    assert.equal((await reopened.get("emp-a", 2026, 3))?.netMinor, 224916)
    assert.equal((await reopened.getSalaryInputs("emp-a", 2026, 3))?.annualCtcMinor, 2880000)
    assert.equal((await reopened.get("emp-a", 2026, 4))?.monthlyGrossMinor, 120000)
    assert.equal((await reopened.get("emp-b", 2026, 3))?.monthlyGrossMinor, 120000)
  } finally { reopened.close() }
})

test.each(["", "-1", "1.5", "NaN", "Infinity", "9007199254740992", "1e5"])("invalid CTC %s fails without writing", async value => {
  const { db } = setup(); await db.saveMonth(input)
  const form = await formFor(db); form.set("annualCtcMinor", value)
  const before = await readSalaryEditor(db, "emp-a", 2026, 3)
  assert.equal((await saveSalaryEditor(db, form)).ok, false)
  assert.deepEqual(await readSalaryEditor(db, "emp-a", 2026, 3), before)
})

test("missing confirmation, invalid leave and currency fail without writes", async () => {
  const { db } = setup(); await db.saveMonth(input)
  for (const [key, value] of [["confirmed", "no"], ["unpaidLeaveDays", "32"], ["currency", "ZZZ"], ["currency", "USD"], ["month", "13"]]) {
    const form = await formFor(db); form.set(key, value)
    assert.equal((await saveSalaryEditor(db, form)).ok, false)
  }
  assert.equal((await db.get("emp-a", 2026, 3))?.monthlyGrossMinor, 120000)
})

test("stale forms cannot overwrite a salary or newly submitted claim", async () => {
  const { db } = setup(); await db.saveMonth(input)
  const form = await formFor(db)
  await db.submitPendingClaim({ employeeId: "emp-a", year: 2026, month: 3, claimId: "new", amountMinor: 100, receipt: "receipt", confirmed: true })
  assert.equal((await saveSalaryEditor(db, form)).ok, false)
  const fresh = await formFor(db)
  assert.equal((await saveSalaryEditor(db, fresh)).ok, true)
  assert.equal((await saveSalaryEditor(db, fresh)).ok, false)
})

test("claim approval uses original monthly CTC after a later salary change", async () => {
  const { db } = setup()
  await db.saveMonth({ ...input, claims: [{ ...input.claims[0], status: "pending" }] })
  await db.saveMonth({ ...input, month: 4, annualCtcMinor: 2880000, claims: [] })
  const result = await db.approveClaim({ claimId: "claim-a", confirmed: true })
  assert.equal(result.ok, true)
  assert.equal((await db.get("emp-a", 2026, 3))?.netMinor, 120500)
})

test("required fields, currency and claim validation run at repository boundary", async () => {
  const { db } = setup()
  for (const patch of [{ employeeId: "" }, { currency: "ZZZ" }, { annualCtcMinor: -1 }, { calendarDays: 0 }, { claims: [{ ...input.claims[0], receipt: "" }] }, { claims: [{ ...input.claims[0], amountMinor: -1 }] }]) {
    assert.ok(validateSalary({ ...input, ...patch }).length)
    assert.equal((await db.saveMonth({ ...input, ...patch })).ok, false)
  }
  assert.equal(await db.get("emp-a", 2026, 3), null)
})

test("simultaneous stale edits allow exactly one save", async () => {
  const { db } = setup(); await db.saveMonth(input)
  const first = await formFor(db), second = await formFor(db)
  second.set("annualCtcMinor", "3600000")
  const results = await Promise.all([saveSalaryEditor(db, first), saveSalaryEditor(db, second)])
  assert.equal(results.filter(result => result.ok).length, 1)
})

test("a missing month can be created for an existing employee", async () => {
  const { db } = setup(); await db.saveMonth(input)
  const data = await readSalaryEditor(db, "emp-a", 2026, 2)
  const form = await formFor(db)
  form.set("month", "2"); form.set("version", data!.version)
  assert.equal((await saveSalaryEditor(db, form)).ok, true)
  assert.equal((await db.getLeave("emp-a", 2026, 2))?.calendarDays, 28)
})
