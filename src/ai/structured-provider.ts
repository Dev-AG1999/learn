import { ChatOllama } from "@langchain/ollama"
import { ChatOpenAI } from "@langchain/openai"
import type { z } from "zod"
import { ollamaBaseUrl } from "../document-ai/config.ts"
import { DocumentError } from "../document-ai/types.ts"

export type StructuredModelAdapter = (
  messages: [["system", string], ["human", string]],
  options: { signal: AbortSignal; callbacks: [] },
) => Promise<unknown>

export function structuredModel<T>(schema: z.ZodType<T>, adapter: StructuredModelAdapter, timeout: number) {
  return async (system: string, input: unknown): Promise<T> => {
    const response = await adapter(
      [["system", system], ["human", JSON.stringify(input)]],
      { signal: AbortSignal.timeout(timeout), callbacks: [] },
    )
    let payload = response
    if (typeof response === "string") {
      try {
        payload = JSON.parse(response)
      } catch {
        throw new DocumentError("The AI provider returned an invalid structured response.", 502)
      }
    }
    const result = schema.safeParse(payload)
    if (!result.success)
      throw new DocumentError("The AI provider returned an invalid structured response.", 502)
    return result.data
  }
}

export function ollamaModelName() {
  const model = process.env.OLLAMA_CHAT_MODEL ?? "qwen3:4b"
  if (!/^qwen3:(?:0\.6b|1\.7b|4b|8b)$/.test(model))
    throw new DocumentError("Choose a supported local Qwen3 model: 0.6b, 1.7b, 4b or 8b.", 503)
  return model
}

export function localModelFetch(timeout: number, transport: typeof fetch = fetch): typeof fetch {
  return (url, init) => transport(url, {
    ...init,
    redirect: "error",
    signal: init?.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(timeout)])
      : AbortSignal.timeout(timeout),
  })
}

export function ollamaStructuredModel<T>(
  schema: z.ZodType<T>,
  options: { timeout: number; maxTokens: number; name?: string; fetch?: typeof fetch },
) {
  const chat = new ChatOllama({
    baseUrl: ollamaBaseUrl(),
    model: ollamaModelName(),
    temperature: 0,
    think: false,
    numCtx: 16_384,
    numPredict: options.maxTokens,
    maxRetries: 0,
    fetch: localModelFetch(options.timeout, options.fetch),
  }).withStructuredOutput(schema, { method: "jsonSchema", name: options.name })
  return structuredModel(schema, (messages, settings) => chat.invoke(messages, settings), options.timeout)
}

export function openAiStructuredModel<T>(
  schema: z.ZodType<T>,
  options: { timeout: number; name: string; configuration?: { fetch: typeof fetch } },
) {
  const chat = new ChatOpenAI({
    model: process.env.AI_MODEL ?? "gpt-5.4-mini",
    useResponsesApi: true,
    zdrEnabled: true,
    maxRetries: 1,
    timeout: 45_000,
    maxTokens: 1800,
    configuration: options.configuration,
  }).withStructuredOutput(schema, { name: options.name, strict: true })
  return structuredModel(schema, (messages, settings) => chat.invoke(messages, settings), options.timeout)
}
