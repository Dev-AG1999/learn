import { ChatOllama } from "@langchain/ollama"
import type { z } from "zod"
import { requireDocumentAi, ollamaBaseUrl } from "../document-ai/config.ts"
import { DocumentError } from "../document-ai/types.ts"

export async function invokeLocal<T>(
  schema: z.ZodType<T>,
  system: string,
  input: unknown,
  timeout = 60_000
): Promise<T> {
  requireDocumentAi()
  const model = process.env.OLLAMA_CHAT_MODEL ?? "qwen3:4b"
  if (!/^qwen3:(?:0\.6b|1\.7b|4b|8b)$/.test(model))
    throw new DocumentError("Choose a supported local Qwen3 model.", 503)
  const chat = new ChatOllama({
    baseUrl: ollamaBaseUrl(),
    model,
    temperature: 0,
    think: false,
    numCtx: 16384,
    numPredict: 1600,
    maxRetries: 0,
    fetch: (url, init) =>
      fetch(url, {
        ...init,
        redirect: "error",
        signal: init?.signal
          ? AbortSignal.any([init.signal, AbortSignal.timeout(timeout)])
          : AbortSignal.timeout(timeout),
      }),
  }).withStructuredOutput(schema, { method: "jsonSchema" })
  return (await chat.invoke(
    [
      ["system", system],
      ["human", JSON.stringify(input)],
    ],
    { signal: AbortSignal.timeout(timeout), callbacks: [] }
  )) as T
}
