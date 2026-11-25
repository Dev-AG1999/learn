import { localModelFetch, ollamaStructuredModel } from "../ai/structured-provider.ts"
import { OllamaEmbeddings } from "@langchain/ollama"
import { ollamaBaseUrl } from "./config.ts"
import { DOCUMENT_SYSTEM_PROMPT, documentAnswerSchema } from "./prompt.ts"
import { DocumentError, type LanguageProvider } from "./types.ts"

export const LOCAL_EMBEDDING_MODEL = "nomic-embed-text:v1.5"
export const LOCAL_VECTOR_SIZE = 768
export function ollamaProvider(configuration?: {
  fetch: typeof fetch
}): LanguageProvider {
  const baseUrl = ollamaBaseUrl()
  const timeout = 120_000
  const structured = ollamaStructuredModel(documentAnswerSchema, {
    timeout, maxTokens: 1800, name: "document_answer", fetch: configuration?.fetch,
  })
  const embeddings = new OllamaEmbeddings({
    model: LOCAL_EMBEDDING_MODEL,
    baseUrl,
    truncate: false,
    maxRetries: 0,
    fetch: localModelFetch(timeout, configuration?.fetch),
  })
  async function embed(texts: string[]): Promise<number[][]> {
    const vectors: number[][] = []
    // Bound local inference batches and add Nomic's retrieval task prefixes.
    for (let start = 0; start < texts.length; start += 8) {
      const batch = await embeddings.embedDocuments(
        texts.slice(start, start + 8)
      )
      if (
        batch.length !== Math.min(8, texts.length - start) ||
        batch.some(
          (vector) =>
            vector.length !== LOCAL_VECTOR_SIZE ||
            vector.some((value) => !Number.isFinite(value))
        )
      )
        throw new DocumentError(
          "The local embedding model returned invalid vectors.",
          502
        )
      vectors.push(...batch)
    }
    return vectors
  }
  return {
    embeddingProfile: "ollama-nomic-v1",
    embedDocuments: (texts) =>
      embed(texts.map((text) => `search_document: ${text}`)),
    async embedQuery(text) {
      return (await embed([`search_query: ${text}`]))[0]
    },
    async answer(question, passages) {
      return structured(DOCUMENT_SYSTEM_PROMPT, { question, sourcePassages: passages })
    },
  }
}
