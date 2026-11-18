import { randomUUID } from "node:crypto"
import { Annotation, StateGraph, START, END } from "@langchain/langgraph"
import type { Principal } from "../auth/repository.ts"
import type { DocumentRepository } from "./repository.ts"
import { extractPdf } from "./extract.ts"
import {
  DocumentError,
  type DocumentRecord,
  type ObjectStore,
  type LanguageProvider,
  type VectorIndex,
  type Passage,
  type Answer,
  type Scope,
} from "./types.ts"

export type DocumentDependencies = {
  repository: DocumentRepository
  objects: ObjectStore
  vectors: VectorIndex
  language: LanguageProvider
  extract?: typeof extractPdf
}
export async function uploadDocument(
  principal: Principal,
  name: string,
  bytes: Uint8Array,
  deps: DocumentDependencies
): Promise<DocumentRecord> {
  deps.repository.consume(principal, "upload")
  if (
    !/\.pdf$/i.test(name) ||
    name.length > 180 ||
    /[\u0000-\u001f/\\]/.test(name)
  )
    throw new DocumentError(
      "Use a PDF filename up to 180 characters, without directory paths."
    )
  const { pages, passages } = await (deps.extract ?? extractPdf)(bytes)
  const id = randomUUID()
  const document: DocumentRecord = {
    id,
    embeddingProfile: deps.language.embeddingProfile ?? "openai-v1",
    ownerId: principal.userId,
    ownerName: principal.username,
    name,
    objectKey: `documents/${id}.pdf`,
    pages,
    status: "processing",
    createdAt: Date.now(),
  }
  deps.repository.reserve(document)
  try {
    await deps.objects.put(document.objectKey, bytes)
    const embeddings = await deps.language.embedDocuments(
      passages.map((passage) => passage.text)
    )
    await deps.vectors.put(document, passages, embeddings)
    deps.repository.complete(id, passages)
    return { ...document, status: "ready" }
  } catch {
    deps.repository.fail(id)
    // Remove partial external writes. Failed records cannot be queried or downloaded.
    await Promise.allSettled([
      deps.objects.remove(document.objectKey),
      deps.vectors.remove(document),
    ])
    throw new DocumentError(
      "The PDF could not be processed. Please try uploading it again. No payroll was changed.",
      503
    )
  }
}

const AnswerState = Annotation.Root({
  question: Annotation<string>(),
  passages: Annotation<Passage[]>(),
  answer: Annotation<Answer>(),
})
export async function askDocument(
  scope: Scope,
  id: string,
  input: string,
  deps: DocumentDependencies
): Promise<Answer> {
  const question = input.trim()
  if (!question || question.length > 2000)
    throw new DocumentError("Enter a question up to 2,000 characters.")
  // Ownership is established before embeddings, vector lookup or any model request.
  const document = deps.repository.access(scope, id)
  if (document.status !== "ready")
    throw new DocumentError("This document is not ready for questions.", 409)
  if (
    (document.embeddingProfile ?? "openai-v1") !==
    (deps.language.embeddingProfile ?? "openai-v1")
  )
    throw new DocumentError(
      "This PDF was indexed with a different AI provider. Upload it again for the selected provider, or switch back to its original provider.",
      409
    )
  deps.repository.consume(scope, "ask")
  const all = deps.repository.passages(scope, id)
  const graph = new StateGraph(AnswerState)
    .addNode("retrieve", async () => {
      // Short PDFs use their complete text: a vector top-k must not omit a payslip total.
      if (
        all.reduce((size, passage) => size + passage.text.length, 0) <= 16_000
      )
        return { passages: all }
      const vector = await deps.language.embedQuery(question)
      const indexes = await deps.vectors.search(document, vector, 8)
      const chosen = new Set(indexes)
      return { passages: all.filter((passage) => chosen.has(passage.index)) }
    })
    .addNode("generate", async (state) => {
      if (!state.passages.length)
        return {
          answer: {
            answer:
              "I couldn't find relevant text in this PDF. Try a more specific question.",
            citations: [],
          },
        }
      const result = await deps.language.answer(question, state.passages)
      if (
        !result.answer ||
        result.answer.length > 6000 ||
        !Array.isArray(result.sourceIndexes)
      )
        throw new DocumentError(
          "The AI returned an invalid answer. Try rephrasing your question.",
          502
        )
      const sources = [...new Set(result.sourceIndexes)].map((index) =>
        state.passages.find((passage) => passage.index === index)
      )
      if (sources.some((source) => !source))
        throw new DocumentError(
          "The answer's sources could not be verified. Try rephrasing your question.",
          502
        )
      // Block invented amounts; arithmetic is never delegated to a language model.
      const amounts = (text: string) =>
        (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((value) =>
          value.replaceAll(",", "")
        )
      const sourceNumbers = new Set(
        amounts(sources.map((source) => source!.text).join(" "))
      )
      if (amounts(result.answer).some((amount) => !sourceNumbers.has(amount)))
        throw new DocumentError(
          "The answer included an unsupported number. Try asking about a specific line in the PDF.",
          502
        )
      if (!sources.length)
        return {
          answer: {
            answer:
              "The supplied PDF does not provide enough evidence to answer this question. Ask about a specific amount or section in the document.",
            citations: [],
          },
        }
      return {
        answer: {
          answer: result.answer,
          citations: sources.map((source) => ({
            page: source!.page,
            text: source!.text,
          })),
        },
      }
    })
    .addEdge(START, "retrieve")
    .addEdge("retrieve", "generate")
    .addEdge("generate", END)
    .compile()
  try {
    const result = await graph.invoke(
      { question },
      { recursionLimit: 4, callbacks: [] }
    )
    return result.answer
  } catch (error) {
    if (error instanceof DocumentError) throw error
    throw new DocumentError(
      "The AI service is temporarily unavailable. Your PDF is saved; try again shortly.",
      503
    )
  }
}
