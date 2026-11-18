import { afterEach, expect, test, vi } from "vitest"
import { sessionStatus } from "../src/auth/browser.ts"
afterEach(() => vi.unstubAllGlobals())
test("session checks share in-flight work but never cache completed authentication", async () => {
  const request = vi.fn(async () => Response.json({ session: {
    userId: "hr-1", accessExpiresAt: 100, idleExpiresAt: 200,
    absoluteExpiresAt: 300, serverNow: 0, renewable: true,
  } }))
  vi.stubGlobal("fetch", request)
  const [a, b] = await Promise.all([sessionStatus(), sessionStatus()])
  expect(a?.timing.userId).toBe("hr-1")
  expect(b?.timing.userId).toBe("hr-1")
  expect(request).toHaveBeenCalledTimes(1)
  await sessionStatus()
  expect(request).toHaveBeenCalledTimes(2)
})
test("session failures can retry", async () => {
  const request = vi.fn().mockRejectedValueOnce(Error("offline")).mockResolvedValueOnce(new Response(null, { status: 401 }))
  vi.stubGlobal("fetch", request)
  await expect(sessionStatus()).rejects.toThrow("offline")
  expect(await sessionStatus()).toBeNull()
})
