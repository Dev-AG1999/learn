import { afterEach, expect, test, vi } from "vitest"
const model = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock("../src/ai/local.ts", () => ({ invokeLocal: model.invoke }))
import { reviewUpload } from "../src/ai/review.ts"
afterEach(() => {
  vi.unstubAllEnvs()
  model.invoke.mockReset()
})
function enable() {
  for (const [key, value] of Object.entries({
    AI_DOCUMENTS_ENABLED: "true",
    AI_PROVIDER: "ollama",
    DATABASE_ENCRYPTION_KEY: "ab".repeat(32),
    LANGSMITH_TRACING: "false",
    LANGCHAIN_TRACING: "false",
    LANGCHAIN_TRACING_V2: "false",
  }))
    vi.stubEnv(key, value)
}
test("salary review explicitly describes its sample and never substitutes for all-row validation", async () => {
  enable()
  model.invoke.mockResolvedValue({
    needsReview: true,
    summary: "Check unusually high deductions.",
    checks: [
      { field: "otherDeductionsMinor", detail: "Review the supplied sample." },
    ],
  })
  const result = await reviewUpload(new Uint8Array([1]), "csv", {
    purpose: "salary-sheet",
    structuredText: () =>
      "10000 rows passed code checks; five sample rows follow.",
  })
  expect(result.status).toBe("needs-review")
  expect(result.summary).toContain("sample only")
  expect(result.summary).toContain("code checked")
})
test("model outage is visible and does not masquerade as a successful review", async () => {
  enable()
  model.invoke.mockRejectedValue(Error("offline"))
  const result = await reviewUpload(new Uint8Array([1]), "csv", {
    purpose: "salary-sheet",
    structuredText: () => "Valid sample",
  })
  expect(result.status).toBe("unavailable")
  expect(result.checks).toEqual([])
})
test("disabled AI performs no model calls", async () => {
  vi.stubEnv("AI_DOCUMENTS_ENABLED", "false")
  expect(
    (await reviewUpload(new Uint8Array([1]), "png", { purpose: "receipt" }))
      .status
  ).toBe("disabled")
  expect(model.invoke).not.toHaveBeenCalled()
})
