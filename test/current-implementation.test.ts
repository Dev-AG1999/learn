import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { withPayroll } from "../src/payroll-db.ts"
import { withAuth } from "../src/auth/repository.ts"
import { hashPassword } from "../src/auth/password.ts"
import { login, logout } from "../src/auth/service.ts"
import { requireRequest } from "../src/auth/http.ts"
import { parseSalaryFile } from "../src/import/parse.ts"
import { employeeAccess, hrAccess } from "../src/access/roles.ts"
import { loadChatContext } from "../src/ai/context.ts"
import { payslipPdf } from "../src/payslip-document.ts"

// Cross-feature acceptance coverage, separate from the original focused suites.
// Uses a real encrypted temporary database; no personal DB, Drive or model calls.
const password = "Synthetic acceptance password!"
const period = { year: 2026, month: 11 }
let directory: string, database: string
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "paydesk-current-"))
  database = join(directory, "payroll.sqlite")
  vi.stubEnv("PAYROLL_DB", database)
  vi.stubEnv("DATABASE_ENCRYPTION_KEY", "ab".repeat(32))
  vi.stubEnv("AUTH_JWT_SECRET", "cd".repeat(32))
  vi.stubEnv("APP_ORIGIN", "http://localhost:3000")
})
afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(directory, { recursive: true, force: true })
})
async function importEmployees() {
  const csv = [
    "employeeId,year,month,annualCtcMinor,currency,unpaidLeaveDays,otherDeductionsMinor",
    "CURRENT-A,2026,11,1200000,INR,0,5000",
    "CURRENT-B,2026,11,2400000,INR,0,0",
  ].join("\n")
  const parsed = await parseSalaryFile("current.csv", Buffer.from(csv))
  if (!parsed.ok) throw new Error("Synthetic salary sheet failed validation")
  await withPayroll(async (db) => {
    const draft = await db.stagePayroll({
      ownerId: "acceptance-hr",
      mode: "upsert",
      source: "current.csv",
      rows: parsed.rows,
    })
    if (!draft.ok) throw new Error("Synthetic draft failed")
    expect(await db.get("CURRENT-A", period.year, period.month)).toBeNull()
    expect(
      (await db.commitPayrollDraft(draft.draftId, "acceptance-hr", false)).ok
    ).toBe(false)
    expect(
      (await db.commitPayrollDraft(draft.draftId, "acceptance-hr", true)).ok
    ).toBe(true)
  })
}
async function employeeLogin() {
  await withAuth(async (db) =>
    db.provision(
      "current.employee",
      await hashPassword(password),
      "employee",
      "CURRENT-A"
    )
  )
  const result = await withAuth((db) => login(db, "current.employee", password))
  if (!result.ok) throw new Error("Synthetic employee login failed")
  const request = new Request("http://localhost:3000/employee/CURRENT-A", {
    headers: { Authorization: `Bearer ${result.token}` },
  })
  const principal = await requireRequest(request, "employee", "CURRENT-A")
  return { result, request, principal }
}

test("CURRENT-01 confirmed sheet to employee login, claim approval, encrypted persistence and grounded context", async () => {
  await importEmployees()
  const { principal } = await employeeLogin()
  await withPayroll(async (db) => {
    const employee = employeeAccess(db, principal.employeeId!)
    expect((await employee.get(period.year, period.month))?.netMinor).toBe(
      95000
    )
    const pending = await employee.submitPendingClaim({
      ...period,
      claimId: "current-receipt",
      amountMinor: 2500,
      receipt: "synthetic receipt reference",
      confirmed: true,
    })
    expect(pending.ok).toBe(true)
    expect((await employee.get(period.year, period.month))?.netMinor).toBe(
      95000
    )
    expect(
      (
        await hrAccess(db).approveClaim({
          claimId: "current-receipt",
          confirmed: true,
        })
      ).ok
    ).toBe(true)
    await db.uploadDocument({
      documentId: "shared-policy",
      body: "Reimbursement requests require an itemized receipt.",
      shareWithEmployees: true,
    })
    await db.uploadDocument({
      documentId: "hr-private",
      body: "Reimbursement confidential HR planning marker.",
    })
  })
  // Every withPayroll call reopens the real encrypted database.
  await withPayroll(async (db) => {
    const saved = await db.get("CURRENT-A", period.year, period.month)
    expect(saved?.netMinor).toBe(97500)
    expect(saved?.approvedReimbursementsMinor).toBe(2500)
    expect(
      (await db.get("CURRENT-B", period.year, period.month))?.netMinor
    ).toBe(200000)
    if (!saved) throw new Error("Missing confirmed snapshot")
    expect(Buffer.from(payslipPdf(saved)).subarray(0, 5).toString()).toBe(
      "%PDF-"
    )
  })
  const context = JSON.stringify(
    await loadChatContext(
      principal,
      period,
      "Explain salary deductions and reimbursement"
    )
  )
  expect(context).toContain("97500 minor units")
  expect(context).toContain("2500 minor units")
  expect(context).toContain("Other deduction reasons are not stored")
  expect(context).toContain("itemized receipt")
  expect(context).not.toContain("CURRENT-B")
  expect(context).not.toContain("confidential HR planning marker")
  const stored = readFileSync(database)
  expect(stored.subarray(0, 16).toString()).not.toBe("SQLite format 3\0")
  expect(stored.includes(Buffer.from("CURRENT-A"))).toBe(false)
})

test("CURRENT-02 an imported employee account cannot cross role/identity boundaries and logout revokes access", async () => {
  await importEmployees()
  const { result, request, principal } = await employeeLogin()
  await expect(
    requireRequest(request, "employee", "CURRENT-B")
  ).rejects.toMatchObject({ status: 403 })
  await expect(requireRequest(request, "hr")).rejects.toMatchObject({
    status: 403,
  })
  await expect(
    loadChatContext(
      principal,
      { ...period, employeeId: "CURRENT-B" },
      "Explain their salary"
    )
  ).rejects.toMatchObject({ status: 403 })
  await withAuth((db) => logout(db, result.token))
  await expect(
    requireRequest(request, "employee", "CURRENT-A")
  ).rejects.toMatchObject({ status: 401 })
  await withPayroll(async (db) => {
    expect(
      (await db.get("CURRENT-A", period.year, period.month))?.netMinor
    ).toBe(95000)
    expect(await db.getClaims("CURRENT-B", period.year, period.month)).toEqual(
      []
    )
  })
})
