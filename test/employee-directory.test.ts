import { DatabaseSync } from "node:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { beforeEach, afterEach, expect, test } from "vitest"
import {
  openPayrollDatabase,
  type PayrollRepository,
} from "../src/db/sqlite-payroll.ts"
import { employeeAccess, hrAccess } from "../src/access/roles.ts"

let dir: string, db: PayrollRepository
const base = {
  year: 2026,
  month: 1,
  calendarDays: 31,
  annualCtcMinor: 120000000,
  currency: "INR",
  unpaidLeaveDays: 0,
  otherDeductionsMinor: 0,
  claims: [],
  confirmed: true,
}
const filters = {
  year: 2026,
  month: 1,
  prefix: "",
  currency: "",
  cursor: null,
  limit: 2,
}
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "employee-directory-"))
  db = openPayrollDatabase(join(dir, "db.sqlite"))
  for (const employeeId of ["EMP-001", "EMP-002", "EMP-003", "OTHER-001"])
    await db.saveMonth({
      ...base,
      employeeId,
      currency: employeeId === "EMP-003" ? "USD" : "INR",
    })
})
afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

test("directory paginates by employee ID without duplicates or loading all rows", async () => {
  const first = await hrAccess(db).listEmployees(filters)
  expect(first.employees.map((e) => e.employeeId)).toEqual([
    "EMP-001",
    "EMP-002",
  ])
  expect(first.nextCursor).toBe("EMP-002")
  const second = await hrAccess(db).listEmployees({
    ...filters,
    cursor: first.nextCursor,
  })
  expect(second.employees.map((e) => e.employeeId)).toEqual([
    "EMP-003",
    "OTHER-001",
  ])
  expect(second.nextCursor).toBeNull()
  expect("listEmployees" in employeeAccess(db, "EMP-001")).toBe(false)
})

test("ID prefix and currency filters combine and remain case-sensitive", async () => {
  const result = await db.listEmployees({
    ...filters,
    prefix: "EMP-",
    currency: "INR",
    limit: 25,
  })
  expect(result.employees.map((e) => e.employeeId)).toEqual([
    "EMP-001",
    "EMP-002",
  ])
  expect(
    (await db.listEmployees({ ...filters, prefix: "emp-" })).employees
  ).toEqual([])
})

test("employees remain visible without a payslip in the selected month", async () => {
  const result = await db.listEmployees({ ...filters, month: 2 })
  expect(result.employees).toHaveLength(2)
  expect(result.employees[0].monthlyNetMinor).toBeNull()
  expect(result.employees[0].annualCtcMinor).toBe(120000000)
})

test("current CTC and historical payslip amounts/currencies stay distinct", async () => {
  await db.saveMonth({
    ...base,
    employeeId: "EMP-001",
    month: 2,
    calendarDays: 28,
    annualCtcMinor: 240000000,
    currency: "USD",
  })
  const result = await db.listEmployees({ ...filters, prefix: "EMP-001" })
  expect(result.employees[0]).toMatchObject({
    currency: "USD",
    annualCtcMinor: 240000000,
    monthlyCurrency: "INR",
    monthlyNetMinor: 10000000,
  })
})

test("invalid limits, periods and search wildcards cannot produce an unbounded query", async () => {
  for (const patch of [
    { limit: 0 },
    { limit: 1000 },
    { month: 13 },
    { prefix: "*" },
    { prefix: "EMP?" },
    { currency: "ZZZ" },
  ])
    await expect(db.listEmployees({ ...filters, ...patch })).rejects.toThrow(
      "Invalid"
    )
})

test("currency and prefix lookup uses the employee index and monthly primary key", () => {
  const raw = new DatabaseSync(join(dir, "db.sqlite"), { readOnly: true })
  try {
    const plan = raw
      .prepare(
        "EXPLAIN QUERY PLAN SELECT e.employee_id, p.net_minor FROM employees e LEFT JOIN payslips p ON p.employee_id=e.employee_id AND p.year=? AND p.month=? WHERE e.employee_id > ? AND e.employee_id GLOB ? AND e.currency=? ORDER BY e.employee_id LIMIT ?"
      )
      .all(2026, 1, "", "EMP-*", "INR", 26)
    const detail = plan.map((row) => String(row.detail)).join(" ")
    expect(detail).toContain("idx_employees_currency_id")
    expect(detail).not.toContain("SCAN e")
  } finally {
    raw.close()
  }
})
