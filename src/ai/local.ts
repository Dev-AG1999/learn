import type { z } from "zod"
import { requireDocumentAi } from "../document-ai/config.ts"
import { ollamaStructuredModel } from "./structured-provider.ts"

export async function invokeLocal<T>(
  schema: z.ZodType<T>,
  system: string,
  input: unknown,
  timeout = 60_000
): Promise<T> {
  requireDocumentAi()
  return ollamaStructuredModel(schema, { timeout, maxTokens: 1600 })(system, input)
}
