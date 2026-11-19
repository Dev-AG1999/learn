import { expect, test, vi } from "vitest"
const state = vi.hoisted(() => ({ timing: null as null | {
  userId: string; accessExpiresAt: number; idleExpiresAt: number;
  absoluteExpiresAt: number; serverNow: number; renewable: boolean
} }))
vi.mock("../src/auth/repository.ts", async (original) => ({
  ...await original<typeof import("../src/auth/repository.ts")>(),
  withAuth: async (run: (db: unknown) => unknown) => run({ sessionTiming: () => state.timing }),
}))
vi.mock("../src/auth/service.ts", async (original) => ({
  ...await original<typeof import("../src/auth/service.ts")>(),
  authenticate: async () => ({ userId: "hr-test", username: "hr", role: "hr", employeeId: null }),
}))
vi.mock("../src/auth/tokens.ts", async (original) => ({
  ...await original<typeof import("../src/auth/tokens.ts")>(),
  verifyToken: async () => ({ sessionId: "test-session" }),
}))
import { sessionResponse } from "../src/auth/endpoints.ts"
test("session expiry between authentication and timing returns 401 rather than malformed success", async () => {
  const response = await sessionResponse(new Request("http://localhost/api/auth/session", { headers: { authorization: "Bearer synthetic" } }))
  expect(response.status).toBe(401)
  expect(response.headers.get("cache-control")).toContain("no-store")
})
