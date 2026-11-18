import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { qdrantIndex, documentFilter } from "../src/document-ai/vectors.ts"
import { VECTOR_SIZE, type DocumentRecord } from "../src/document-ai/types.ts"
const document: DocumentRecord = {
  id: "doc-a",
  ownerId: "user-a",
  ownerName: "A",
  name: "file.pdf",
  objectKey: "private",
  pages: 1,
  status: "ready",
  createdAt: 0,
}
const vector = Array.from({ length: VECTOR_SIZE }, () => 0.1)
beforeEach(() => {
  vi.stubEnv("QDRANT_URL", "http://127.0.0.1:6333")
  vi.stubEnv("QDRANT_API_KEY", "test-only-key")
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
test("vector query enforces both owner and selected document, excluding foreign payloads", async () => {
  const fetchMock = vi.fn(async () =>
    Response.json({
      result: {
        points: [
          {
            payload: {
              documentId: document.id,
              ownerId: document.ownerId,
              chunkIndex: 2,
            },
          },
          {
            payload: {
              documentId: "other",
              ownerId: document.ownerId,
              chunkIndex: 4,
            },
          },
          {
            payload: {
              documentId: document.id,
              ownerId: "other",
              chunkIndex: 6,
            },
          },
        ],
      },
    })
  )
  vi.stubGlobal("fetch", fetchMock)
  expect(await qdrantIndex().search(document, vector, 8)).toEqual([2])
  const options = (fetchMock.mock.calls[0] as unknown as [URL, RequestInit])[1]
  expect(JSON.parse(options.body as string).filter).toEqual(
    documentFilter(document)
  )
  expect(options.redirect).toBe("error")
  expect(options.headers).toHaveProperty("api-key", "test-only-key")
})
test("does not accept remote plaintext vector servers", () => {
  vi.stubEnv("QDRANT_URL", "http://example.com:6333")
  expect(() => qdrantIndex()).toThrow("HTTPS")
})
test("validates vector dimensions before network access", async () => {
  const network = vi.fn()
  vi.stubGlobal("fetch", network)
  await expect(qdrantIndex().search(document, [1], 8)).rejects.toThrow(
    "invalid data"
  )
  expect(network).not.toHaveBeenCalled()
})
test("indexes only identifiers in payloads, never document text or filenames", async () => {
  const requests: { path: string; body?: unknown }[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL, options: RequestInit) => {
      requests.push({
        path: url.pathname,
        body: options.body ? JSON.parse(options.body as string) : undefined,
      })
      return Response.json({
        result: {
          config: {
            params: { vectors: { size: VECTOR_SIZE, distance: "Cosine" } },
          },
        },
      })
    })
  )
  await qdrantIndex().put(
    document,
    [{ index: 0, page: 1, text: "private salary" }],
    [vector]
  )
  const write = requests.find((request) => request.path.endsWith("/points"))!
  expect(JSON.stringify(write)).not.toContain("private salary")
  expect(JSON.stringify(write)).not.toContain("file.pdf")
  expect(
    (write.body as { points: { payload: object }[] }).points[0].payload
  ).toEqual({ ownerId: "user-a", documentId: "doc-a", chunkIndex: 0 })
})
test("search outage returns a safe error", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("private backend detail", { status: 500 }))
  )
  await expect(qdrantIndex().search(document, vector, 8)).rejects.toThrow(
    "temporarily unavailable"
  )
})

test("local embedding vectors use a different collection with 768 dimensions", async () => {
  const requests: { path: string; body?: Record<string, unknown> }[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL, options: RequestInit) => {
      requests.push({
        path: url.pathname,
        body: options.body ? JSON.parse(String(options.body)) : undefined,
      })
      return Response.json({
        result: {
          config: { params: { vectors: { size: 768, distance: "Cosine" } } },
        },
      })
    })
  )
  const local = { ...document, embeddingProfile: "ollama-nomic-v1" as const }
  await qdrantIndex().put(
    local,
    [{ index: 0, page: 1, text: "private" }],
    [Array(768).fill(0.1)]
  )
  expect(
    requests.every((request) =>
      request.path.startsWith("/collections/paydesk_documents_ollama_nomic_v1")
    )
  ).toBe(true)
  await expect(
    qdrantIndex().put(local, [{ index: 0, page: 1, text: "private" }], [vector])
  ).rejects.toThrow("invalid data")
})
