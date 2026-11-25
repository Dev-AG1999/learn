import { openAiStructuredModel } from "../ai/structured-provider.ts"
import { OpenAIEmbeddings } from "@langchain/openai"
import { DOCUMENT_SYSTEM_PROMPT, documentAnswerSchema } from "./prompt.ts"
import { selectedAiProvider } from "./config.ts"
import { ollamaProvider } from "./ollama.ts"
export { DOCUMENT_SYSTEM_PROMPT } from "./prompt.ts"
import { EMBEDDING_MODEL, type LanguageProvider } from "./types.ts"

export function openAiProvider(configuration?: {
  fetch: typeof fetch
}): LanguageProvider {
  const embeddings = new OpenAIEmbeddings({
    model: EMBEDDING_MODEL,
    dimensions: 1536,
    maxRetries: 1,
    timeout: 30_000,
    batchSize: 32,
    configuration,
  })
  const structured = openAiStructuredModel(documentAnswerSchema, {
    timeout: 50_000,
    name: "document_answer",
    configuration,
  })
  return {
    embeddingProfile: "openai-v1",
    embedDocuments: (texts) => embeddings.embedDocuments(texts),
    embedQuery: (text) => embeddings.embedQuery(text),
    async answer(question, passages) {
      return structured(DOCUMENT_SYSTEM_PROMPT, { question, sourcePassages: passages })
    },
  }
}

export function languageProvider(): LanguageProvider {
  return selectedAiProvider() === "ollama" ? ollamaProvider() : openAiProvider()
}
