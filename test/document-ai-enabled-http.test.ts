import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
const model = vi.hoisted(() => ({ index: vi.fn(), answer: vi.fn() }))
vi.mock("../src/document-ai/runtime.ts", () => ({ indexSecurePdf: model.index, answerSecurePdf: model.answer }))
import { uploadResponse, askResponse } from "../src/document-ai/http.ts"
import { withAuth } from "../src/auth/repository.ts"
import { hashPassword } from "../src/auth/password.ts"
import { loginResponse } from "../src/auth/endpoints.ts"
let directory: string, cookie: string
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "ai-enabled-http-"))
  for (const [key, value] of Object.entries({ PAYROLL_DB: join(directory, "db.sqlite"), DATABASE_ENCRYPTION_KEY: "ac".repeat(32), AUTH_JWT_SECRET: "ba".repeat(32), APP_ORIGIN: "http://localhost:3000", AI_DOCUMENTS_ENABLED: "true", AI_PROVIDER: "ollama", LANGSMITH_TRACING: "false", LANGCHAIN_TRACING_V2: "false", LANGCHAIN_TRACING: "false" })) vi.stubEnv(key, value)
  model.index.mockReset(); model.answer.mockReset()
  model.index.mockResolvedValue({ id: "doc-a", name: "receipt.pdf", status: "ready", pages: 1, objectKey: "private-key" })
  model.answer.mockResolvedValue({ answer: "Tax is 100.", citations: [{ page: 1, text: "Tax is 100." }] })
  await withAuth(async (db) => db.provision("hr-test", await hashPassword("Private document HTTP password!"), "hr", null))
  const login = await loginResponse(new Request("http://localhost:3000/auth/login", { method: "POST", headers: { Origin: "http://localhost:3000" }, body: new URLSearchParams({ username: "hr-test", password: "Private document HTTP password!" }) }), false)
  cookie = login.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ")
})
afterEach(() => { vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true }) })
function request(body: string, origin = "http://localhost:3000", authenticated = true) {
  return new Request("http://localhost:3000/api/documents", { method: "POST", headers: { Origin: origin, Cookie: authenticated ? cookie : "", "Content-Type": "application/json" }, body })
}
test("authenticated indexing and questions return private responses without internal storage keys", async () => {
  const response = await uploadResponse(request(JSON.stringify({ fileId: "file-a" })))
  expect(response.status).toBe(200)
  expect(response.headers.get("cache-control")).toBe("no-store")
  expect(JSON.stringify(await response.json())).not.toContain("private-key")
  expect((await askResponse(request(JSON.stringify({ question: "Explain tax" })), "doc-a")).status).toBe(200)
  expect(model.answer).toHaveBeenCalledTimes(1)
})
test("authentication, CSRF, request limits and configuration are checked before model work", async () => {
  expect((await uploadResponse(request('{"fileId":"file-a"}', "http://localhost:3000", false))).status).toBe(401)
  expect((await uploadResponse(request('{"fileId":"file-a"}', "https://evil.test"))).status).toBe(403)
  expect((await uploadResponse(request("x".repeat(10001)))).status).toBe(400)
  vi.stubEnv("LANGSMITH_TRACING", "true")
  expect((await uploadResponse(request('{"fileId":"file-a"}'))).status).toBe(503)
  expect(model.index).not.toHaveBeenCalled()
})
