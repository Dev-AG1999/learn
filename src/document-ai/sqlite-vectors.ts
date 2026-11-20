import type { DocumentRepository } from "./repository.ts"
import { DocumentError, type VectorIndex } from "./types.ts"

function valid(vector: number[]): boolean {
  return vector.length === 768 && vector.every(Number.isFinite) && vector.some((value) => value !== 0)
}
/** Exact cosine search over at most 240 chunks of one already-authorized PDF. */
export function sqliteVectorIndex(repository: DocumentRepository): VectorIndex {
  return {
    async put(document, passages, vectors) {
      if (document.embeddingProfile !== "ollama-nomic-v1" || vectors.length !== passages.length || passages.some((passage, index) => passage.index !== index) || vectors.some((vector) => !valid(vector)))
        throw new DocumentError("Invalid local document embeddings.", 502)
      repository.saveVectors(document, vectors)
    },
    async search(document, vector, limit) {
      if (!valid(vector)) throw new DocumentError("Invalid query embedding.", 502)
      const magnitude = Math.hypot(...vector)
      return repository.vectors(document).map((row) => {
        if (!valid(row.vector)) throw new DocumentError("Stored document embeddings are invalid.", 503)
        const score = row.vector.reduce((sum, value, index) => sum + value * vector[index], 0) / (magnitude * Math.hypot(...row.vector))
        return { index: row.index, score }
      }).sort((a, b) => b.score - a.score).slice(0, Math.min(limit, 12)).map((row) => row.index)
    },
    async remove(document) { repository.removeVectors(document) },
  }
}
