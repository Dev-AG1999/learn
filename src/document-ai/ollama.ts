import { ChatOllama, OllamaEmbeddings } from "@langchain/ollama"
import { ollamaBaseUrl } from "./config.ts"
import { DOCUMENT_SYSTEM_PROMPT, documentAnswerSchema } from "./prompt.ts"
import { DocumentError, type LanguageProvider } from "./types.ts"

export const LOCAL_EMBEDDING_MODEL = "nomic-embed-text:v1.5"
export const LOCAL_VECTOR_SIZE = 768
export function ollamaProvider(configuration?: {
  fetch: typeof fetch
}): LanguageProvider {
  const baseUrl = ollamaBaseUrl()
  // Disable redirects: a local request must never forward PDF text elsewhere.
  const localFetch: typeof fetch = async (input, init) => {
    const signal = init?.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(120_000)])
      : AbortSignal.timeout(120_000)
    return (configuration?.fetch ?? fetch)(input, {
      ...init,
      signal,
      redirect: "error",
    })
  }
  const embeddings = new OllamaEmbeddings({
    model: LOCAL_EMBEDDING_MODEL,
    baseUrl,
    truncate: false,
    maxRetries: 0,
    fetch: localFetch,
  })
  const model = process.env.OLLAMA_CHAT_MODEL ?? "qwen3:4b"
  if (!/^qwen3:(?:0\.6b|1\.7b|4b|8b)$/.test(model))
    throw new DocumentError(
      "Choose a supported local Qwen3 model: 0.6b, 1.7b, 4b or 8b.",
      503
    )
  const structured = new ChatOllama({
    model,
    baseUrl,
    temperature: 0,
    think: false,
    numCtx: 16_384,
    numPredict: 1800,
    maxRetries: 0,
    fetch: localFetch,
  }).withStructuredOutput(documentAnswerSchema, {
    name: "document_answer",
    method: "jsonSchema",
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
      return structured.invoke(
        [
          ["system", DOCUMENT_SYSTEM_PROMPT],
          ["human", JSON.stringify({ question, sourcePassages: passages })],
        ],
        { signal: AbortSignal.timeout(120_000), callbacks: [] }
      )
    },
  }
}
