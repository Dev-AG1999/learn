import { expect, test, vi, beforeEach, afterEach } from "vitest"
const mocks = vi.hoisted(() => ({ headers: vi.fn(), authenticate: vi.fn() }))
vi.mock("next/headers.js", () => ({ headers: mocks.headers }))
vi.mock("next/navigation.js", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`) } }))
vi.mock("../src/auth/repository.ts", () => ({ withAuth: (run: (db: unknown) => unknown) => run({}) }))
vi.mock("../src/auth/service.ts", () => ({ authenticate: mocks.authenticate }))
import { requireHrAction, requirePage } from "../src/auth/next.ts"

beforeEach(() => {
  vi.stubEnv("APP_ORIGIN", "http://localhost:3000")
  mocks.headers.mockResolvedValue(new Headers({ authorization: "Bearer a.b.c", origin: "http://localhost:3000" }))
  mocks.authenticate.mockReset()
})

afterEach(() => vi.unstubAllEnvs())

test("anonymous page visits redirect to login", async () => {
  mocks.authenticate.mockResolvedValue(null)
  await expect(requirePage("hr")).rejects.toThrow("redirect:/login")
})

test("employee page guards reject another employee and HR areas", async () => {
  const employee = { userId: "a", username: "employee", role: "employee", employeeId: "emp-a" }
  mocks.authenticate.mockResolvedValue(employee)
  await expect(requirePage("hr")).rejects.toThrow("redirect:/forbidden")
  await expect(requirePage("employee", "emp-b")).rejects.toThrow("redirect:/forbidden")
  await expect(requirePage("employee", "emp-a")).resolves.toEqual(employee)
})

test("HR action independently checks role and Origin", async () => {
  mocks.authenticate.mockResolvedValue({ userId: "a", username: "employee", role: "employee", employeeId: "emp-a" })
  await expect(requireHrAction()).rejects.toMatchObject({ status: 403 })
  mocks.authenticate.mockResolvedValue({ userId: "hr", username: "hr", role: "hr", employeeId: null })
  await expect(requireHrAction()).resolves.toMatchObject({ role: "hr" })
  mocks.headers.mockResolvedValue(new Headers({ authorization: "Bearer a.b.c", origin: "http://evil.example" }))
  await expect(requireHrAction()).rejects.toMatchObject({ status: 403 })
})
