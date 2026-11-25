import { expect, test, vi } from "vitest"
import { z } from "zod"
import { structuredModel } from "../src/ai/structured-provider.ts"

test("a new adapter can return parsed data or JSON without changing the feature schema", async () => {
  const adapter = vi.fn()
    .mockResolvedValueOnce({ score: 2 })
    .mockResolvedValueOnce('{"score":3}')
    .mockResolvedValueOnce({ score: "invalid" })
  const invoke = structuredModel(z.object({ score: z.number() }), adapter, 5000)
  await expect(invoke("Review", { name: "sample" })).resolves.toEqual({ score: 2 })
  expect(adapter).toHaveBeenCalledWith(
    [["system", "Review"], ["human", '{"name":"sample"}']],
    { signal: expect.any(AbortSignal), callbacks: [] },
  )
  await expect(invoke("Review", {})).resolves.toEqual({ score: 3 })
  await expect(invoke("Review", {})).rejects.toMatchObject({ status: 502 })
})
