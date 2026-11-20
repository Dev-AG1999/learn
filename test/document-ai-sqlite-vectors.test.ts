import { expect, test, vi } from "vitest"
import { sqliteVectorIndex } from "../src/document-ai/sqlite-vectors.ts"
import type { DocumentRepository } from "../src/document-ai/repository.ts"
import type { DocumentRecord } from "../src/document-ai/types.ts"
const document: DocumentRecord = { id: "a", ownerId: "owner-a", ownerName: "a", name: "a.pdf", objectKey: "secure-files/a", pages: 1, status: "ready", createdAt: 0, embeddingProfile: "ollama-nomic-v1" }
const vector = (a: number, b: number) => [a, b, ...Array(766).fill(0)]
test("per-document exact cosine retrieval ranks relevant chunks and validates embeddings", async () => {
  const rows = [{ index: 0, vector: vector(0, 1) }, { index: 1, vector: vector(1, 0) }]
  const repository = { vectors: vi.fn(() => rows), saveVectors: vi.fn(), removeVectors: vi.fn() } as unknown as DocumentRepository
  const index = sqliteVectorIndex(repository)
  expect(await index.search(document, vector(1, 0), 1)).toEqual([1])
  expect(repository.vectors).toHaveBeenCalledWith(document)
  await expect(index.put(document, [{ index: 0, page: 1, text: "a" }], [[1]])).rejects.toMatchObject({ status: 502 })
  await expect(index.search(document, Array(768).fill(0), 8)).rejects.toMatchObject({ status: 502 })
})
