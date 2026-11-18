import { DocumentError } from "./types.ts"

export function selectedAiProvider(): "openai" | "ollama" {
  const provider = process.env.AI_PROVIDER ?? "openai"
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
// The upload-security milestone takes precedence over the earlier AI scaffold.
export function documentAiConfigured(): boolean {
  return false
}
export function requireDocumentAi(): never {
  throw new DocumentError(
    "Document AI is deferred until secure uploads are reviewed.",
    409
  )
}
