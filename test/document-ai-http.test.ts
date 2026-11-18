import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeEach, afterEach, expect, test, vi } from "vitest"
import { hashPassword } from "../src/auth/password.ts"
import { withAuth } from "../src/auth/repository.ts"
import { loginResponse } from "../src/auth/endpoints.ts"
import {
  uploadResponse,
  askResponse,
  downloadResponse,
} from "../src/document-ai/http.ts"
let dir: string
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "ai-deferred-"))
  vi.stubEnv("PAYROLL_DB", join(dir, "db.sqlite"))
  vi.stubEnv("AUTH_JWT_SECRET", "ab".repeat(32))
  vi.stubEnv("APP_ORIGIN", "http://localhost:3000")
  await withAuth(async (db) =>
    db.provision(
      "hr@example.test",
      await hashPassword("Testing password for deferred AI!"),
      "hr",
      null
    )
  )
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  vi.unstubAllEnvs()
})
test("every old document AI endpoint is blocked even when AI_DOCUMENTS_ENABLED is true", async () => {
  vi.stubEnv("AI_DOCUMENTS_ENABLED", "true")
  const login = await loginResponse(
    new Request("http://localhost:3000/auth/login", {
      method: "POST",
      headers: { Origin: "http://localhost:3000" },
      body: new URLSearchParams({
        username: "hr@example.test",
        password: "Testing password for deferred AI!",
      }),
    }),
    false
  )
  const cookie = login.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ")
  for (const endpoint of [
    (r: Request) => uploadResponse(r),
    (r: Request) => askResponse(r, "id"),
    (r: Request) => downloadResponse(r, "id"),
  ]) {
    const response = await endpoint(
      new Request("http://localhost:3000/api/documents", {
        method: "POST",
        headers: { Cookie: cookie, Origin: "http://localhost:3000" },
      })
    )
    expect(response.status).toBe(409)
    expect(await response.text()).toContain("deferred")
  }
})
test("deferred endpoints still enforce authentication", async () => {
  expect(
    (
      await downloadResponse(
        new Request("http://localhost:3000/api/documents/id/download"),
        "id"
      )
    ).status
  ).toBe(401)
})
