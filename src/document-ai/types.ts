import type { Principal } from "../auth/repository.ts"

export const MAX_PDF_BYTES = 5 * 1024 * 1024
export const MAX_PAGES = 100
export const MAX_TEXT = 200_000
export const MAX_CHUNKS = 240
export const EMBEDDING_MODEL = "text-embedding-3-small"
export const VECTOR_SIZE = 1536
export type EmbeddingProfile = "openai-v1" | "ollama-nomic-v1"
export type DocumentRecord = {
  embeddingProfile?: EmbeddingProfile
  id: string
  ownerId: string
  ownerName: string
  name: string
  objectKey: string
  pages: number
  status: "processing" | "ready" | "failed"
  createdAt: number
}
export type Passage = { index: number; page: number; text: string }
export type Answer = {
  answer: string
  citations: { page: number; text: string }[]
}
export type Scope = Pick<Principal, "userId" | "role">
export class DocumentError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message)
  }
}
export interface ObjectStore {
  put(key: string, bytes: Uint8Array): Promise<void>
  get(key: string): Promise<Uint8Array>
  remove(key: string): Promise<void>
}
export interface VectorIndex {
  put(
    document: DocumentRecord,
    passages: Passage[],
    vectors: number[][]
  ): Promise<void>
  search(
    document: DocumentRecord,
    vector: number[],
    limit: number
  ): Promise<number[]>
  remove(document: DocumentRecord): Promise<void>
}
export interface LanguageProvider {
  embeddingProfile?: EmbeddingProfile
  embedDocuments(texts: string[]): Promise<number[][]>
  embedQuery(text: string): Promise<number[]>
  answer(
    question: string,
    passages: Passage[]
  ): Promise<{ answer: string; sourceIndexes: number[] }>
}
