import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test, vi } from "vitest"
import { withUploadJobs } from "../src/files/jobs/repository.ts"

test("the queue serializes processing and does not replay an expired lease", () => {
  const dir = mkdtempSync(join(tmpdir(), "queued-uploads-"))
  vi.stubEnv("PAYROLL_DB", join(dir, "queue.sqlite"))
  vi.stubEnv("DATABASE_ENCRYPTION_KEY", "79".repeat(32))
  const owner = { userId: "hr-id", username: "hr", role: "hr" as const, employeeId: null }
  const now = 100_000
  try {
    const [first, second] = withUploadJobs((jobs) => [
      jobs.enqueue(owner, "policy", "multipart/form-data", Buffer.from("first"), now),
      jobs.enqueue(owner, "policy", "multipart/form-data", Buffer.from("second"), now + 1),
    ])
    expect(withUploadJobs((jobs) => jobs.claim(now + 2))?.id).toBe(first)
    expect(withUploadJobs((jobs) => jobs.claim(now + 3))).toBeUndefined()
    const later = now + 65_000
    expect(withUploadJobs((jobs) => jobs.claim(later))?.id).toBe(second)
    expect(withUploadJobs((jobs) => jobs.finish(first, 200, {}, later))).toBe(false)
    expect(withUploadJobs((jobs) => jobs.status(owner.userId, first, later))?.state).toBe("interrupted")
    expect(withUploadJobs((jobs) => jobs.finish(second, 200, { saved: true }, later))).toBe(true)
    expect(withUploadJobs((jobs) => jobs.status(owner.userId, second, later))).toEqual({
      state: "finished", status: 200, result: { saved: true },
    })
  } finally {
    vi.unstubAllEnvs()
    rmSync(dir, { recursive: true, force: true })
  }
})
