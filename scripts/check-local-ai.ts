import { ollamaBaseUrl } from "../src/document-ai/config.ts"
import { LOCAL_EMBEDDING_MODEL } from "../src/document-ai/ollama.ts"
const model = process.env.OLLAMA_CHAT_MODEL ?? "qwen3:4b"
try {
  const response = await fetch(`${ollamaBaseUrl()}/api/tags`, { redirect: "error", signal: AbortSignal.timeout(5000) })
  if (!response.ok) throw new Error("Ollama did not return its installed models.")
  const data = await response.json() as { models?: { name?: string }[] }
  const installed = new Set(data.models?.map((entry) => entry.name))
  const missing = [model, LOCAL_EMBEDDING_MODEL].filter((name) => !installed.has(name))
  if (missing.length) throw new Error(`Install missing local models: ${missing.map((name) => `ollama pull ${name}`).join('; ')}`)
  console.log("Local Ollama is reachable and both required models are installed. No employee data was sent.")
} catch (error) {
  console.error(error instanceof Error && !/fetch failed/.test(error.message) ? error.message : "Start Ollama locally, then run npm run ai:check again.")
  process.exitCode = 1
}
