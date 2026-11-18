import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AuthError } from "../src/auth/http.ts"
const state = vi.hoisted(() => ({ role: "hr" as "hr" | "employee" | "anonymous" }))
vi.mock("../src/auth/request.ts", () => ({ requireReadPrincipal: async () => {
  if (state.role === "anonymous") throw new AuthError(401)
  return { userId: "test", username: "test", role: state.role, employeeId: state.role === "employee" ? "EMP-1" : null }
} }))
import { GET } from "../app/api/employees/route.ts"
import { withPayroll } from "../src/payroll-db.ts"
let directory: string
beforeEach(() => {
  state.role = "hr"
  directory = mkdtempSync(join(tmpdir(), "paydesk-search-"))
  vi.stubEnv("PAYROLL_DB", join(directory, "payroll.sqlite"))
})
afterEach(() => { vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true }) })
const request = (query = "year=2026&month=1") => GET(new Request(`http://localhost:3000/api/employees?${query}`))
test("directory endpoint requires HR authorization", async () => {
  state.role = "anonymous"
  expect((await request()).status).toBe(401)
  state.role = "employee"
  expect((await request()).status).toBe(403)
})
test("HR search validates inputs and reads actual SQLite data without HTTP caching", async () => {
  await withPayroll((db) => db.saveMonth({ employeeId: "EMP-1", year: 2026, month: 1, annualCtcMinor: 1200000, currency: "INR", calendarDays: 31, unpaidLeaveDays: 0, otherDeductionsMinor: 0, claims: [], confirmed: true }))
  const response = await request("year=2026&month=1&q=EMP")
  expect(response.status).toBe(200)
  expect(response.headers.get("cache-control")).toBe("no-store")
  expect((await response.json()).employees[0].employeeId).toBe("EMP-1")
  for (const query of ["year=2026&month=13", "year=2026&month=1&q=%25", "year=2026&month=1&currency=BAD"])
    expect((await request(query)).status).toBe(400)
  expect((await (await request("year=2026&month=1&q=OTHER")).json()).employees).toEqual([])
})
