import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai"
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
  const structured = new ChatOpenAI({
    model: process.env.AI_MODEL ?? "gpt-5.4-mini",
    useResponsesApi: true,
    zdrEnabled: true,
    maxRetries: 1,
    timeout: 45_000,
    maxTokens: 1800,
    configuration,
  }).withStructuredOutput(documentAnswerSchema, {
    name: "document_answer",
    strict: true,
  })
  return {
    embeddingProfile: "openai-v1",
    embedDocuments: (texts) => embeddings.embedDocuments(texts),
    embedQuery: (text) => embeddings.embedQuery(text),
    async answer(question, passages) {
      return structured.invoke(
        [
          ["system", DOCUMENT_SYSTEM_PROMPT],
          ["human", JSON.stringify({ question, sourcePassages: passages })],
        ],
        { signal: AbortSignal.timeout(50_000), callbacks: [] }
      )
    },
  }
}

export function languageProvider(): LanguageProvider {
  return selectedAiProvider() === "ollama" ? ollamaProvider() : openAiProvider()
}
