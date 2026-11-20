import { DocumentError } from "./types.ts"

export function selectedAiProvider(): "openai" | "ollama" {
  const provider = process.env.AI_PROVIDER ?? "ollama"
  if (provider !== "openai" && provider !== "ollama")
    throw new DocumentError("AI_PROVIDER must be openai or ollama.", 503)
  return provider
}
export function ollamaBaseUrl(): string {
  const url = new URL(process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434")
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new DocumentError(
      "Local AI must use an HTTP loopback Ollama address.",
      503
    )
  return url.origin
}
export function documentAiConfigured(): boolean {
  try { requireDocumentAi(); return true } catch { return false }
}
export function requireDocumentAi(): void {
  if (process.env.AI_DOCUMENTS_ENABLED !== "true")
    throw new DocumentError("Document AI is not enabled. Ask HR to configure the local Ollama models.", 503)
  if (selectedAiProvider() !== "ollama")
    throw new DocumentError("The document assistant requires the local Ollama provider.", 503)
  if ([process.env.LANGSMITH_TRACING, process.env.LANGCHAIN_TRACING_V2, process.env.LANGCHAIN_TRACING].some((value) => value === "true"))
    throw new DocumentError("Disable AI tracing before processing private documents.", 503)
  if (!/^[a-f0-9]{64}$/i.test(process.env.DATABASE_ENCRYPTION_KEY ?? ""))
    throw new DocumentError("Configure encrypted database storage before enabling document AI.", 503)
  ollamaBaseUrl()
}
