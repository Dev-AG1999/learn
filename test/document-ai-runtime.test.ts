import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { gzipSync } from "node:zlib"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import type { Principal } from "../src/auth/repository.ts"
const mocks = vi.hoisted(() => ({ get: vi.fn(), answer: vi.fn(), embed: vi.fn(), remove: vi.fn() }))
vi.mock("../src/files/drive.ts", () => ({ googleDriveStore: () => ({ get: mocks.get, remove: mocks.remove }) }))
vi.mock("../src/document-ai/extract.ts", () => ({ extractPdf: async () => ({ pages: 1, passages: [{ index: 0, page: 1, text: "Gross 1000. Tax deducted 100. Net pay 900." }] }) }))
vi.mock("../src/document-ai/ollama.ts", () => ({ ollamaProvider: () => ({ embeddingProfile: "ollama-nomic-v1", embedDocuments: mocks.embed, embedQuery: mocks.embed, answer: mocks.answer }) }))
import { indexSecurePdf, answerSecurePdf } from "../src/document-ai/runtime.ts"
import { withFiles } from "../src/files/repository.ts"
import { withDocuments } from "../src/document-ai/repository.ts"
import { fingerprint } from "../src/files/crypto.ts"
const employee: Principal = { userId: "emp-a", username: "employee-a", employeeId: "EMP-A", role: "employee" }
const other: Principal = { userId: "emp-b", username: "employee-b", employeeId: "EMP-B", role: "employee" }
const hr: Principal = { userId: "hr", username: "hr", employeeId: null, role: "hr" }
let directory: string
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "ai-runtime-"))
  vi.stubEnv("PAYROLL_DB", join(directory, "db.sqlite"))
  vi.stubEnv("DATABASE_ENCRYPTION_KEY", "ac".repeat(32))
  vi.stubEnv("AI_DOCUMENTS_ENABLED", "true")
  vi.stubEnv("AI_PROVIDER", "ollama")
  vi.stubEnv("LANGSMITH_TRACING", "false")
  mocks.get.mockReset(); mocks.answer.mockReset(); mocks.embed.mockReset(); mocks.remove.mockReset()
  mocks.embed.mockResolvedValue([Array.from({ length: 768 }, (_, index) => index === 0 ? 1 : 0)])
  mocks.answer.mockResolvedValue({ answer: "Tax deducted is 100. The PDF does not state why.", sourceIndexes: [0] })
  const bytes = Buffer.from("%PDF- synthetic scan-passed fixture"), stored = gzipSync(bytes)
  mocks.get.mockResolvedValue(stored)
  await withFiles((db) => {
    db.reserve({ id: "file-a", ownerId: employee.userId, ownerName: employee.username, name: "payslip.pdf", createdAt: Date.now() })
    db.setDriveId("file-a", "drive-a")
    db.ready({ id: "file-a", ownerId: employee.userId, ownerName: employee.username, name: "payslip.pdf", createdAt: Date.now(), status: "ready", driveId: "drive-a", kind: "pdf", originalBytes: bytes.length, storedBytes: stored.length, sha256: fingerprint(stored), scannedAt: Date.now(), scannerVersion: "test" })
  })
})
afterEach(() => { vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true }) })
test("authorized secure PDF is indexed once, persists vectors, and returns cited answers", async () => {
  const document = await indexSecurePdf(employee, "file-a")
  expect(document.status).toBe("ready")
  expect(await withDocuments((db) => db.vectors(document))).toHaveLength(1)
  expect((await answerSecurePdf(employee, document.id, "What was deducted?")).citations[0].page).toBe(1)
  expect((await indexSecurePdf(employee, "file-a")).id).toBe(document.id)
  expect(mocks.get).toHaveBeenCalledTimes(1)
  expect(mocks.embed).toHaveBeenCalledTimes(1)
})
test("other employees cannot index or ask about another employee's PDF", async () => {
  await expect(indexSecurePdf(other, "file-a")).rejects.toMatchObject({ status: 404 })
  expect(mocks.embed).not.toHaveBeenCalled()
  const document = await indexSecurePdf(hr, "file-a")
  expect(document.ownerId).toBe(employee.userId)
  await expect(answerSecurePdf(other, document.id, "Show salary")).rejects.toMatchObject({ status: 404 })
  expect(mocks.answer).not.toHaveBeenCalled()
  expect((await answerSecurePdf(employee, document.id, "Explain tax")).citations).toHaveLength(1)
})
test("AI failure retains the source attachment and permits an explicit retry", async () => {
  mocks.embed.mockRejectedValueOnce(Error("Ollama unavailable"))
  await expect(indexSecurePdf(employee, "file-a")).rejects.toMatchObject({ status: 503 })
  expect((await withFiles((db) => db.access(employee, "file-a"))).status).toBe("ready")
  expect(mocks.remove).not.toHaveBeenCalled()
  expect((await indexSecurePdf(employee, "file-a")).status).toBe("ready")
})
test("tampered or rejected source files never reach the model", async () => {
  mocks.get.mockResolvedValueOnce(gzipSync("changed content"))
  await expect(indexSecurePdf(employee, "file-a")).rejects.toMatchObject({ status: 409 })
  expect(mocks.embed).not.toHaveBeenCalled()
  await withFiles((db) => db.fail("file-a", "rejected"))
  await expect(indexSecurePdf(employee, "file-a")).rejects.toMatchObject({ status: 409 })
})
