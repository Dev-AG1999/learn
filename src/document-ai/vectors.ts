import { randomUUID } from "node:crypto"
import {
  DocumentError,
  VECTOR_SIZE,
  type DocumentRecord,
  type VectorIndex,
} from "./types.ts"

export function documentFilter(document: DocumentRecord) {
  return {
    must: [
      { key: "documentId", match: { value: document.id } },
      { key: "ownerId", match: { value: document.ownerId } },
    ],
  }
}
export function qdrantIndex(): VectorIndex {
  const base = new URL(process.env.QDRANT_URL!)
  if (
    base.protocol !== "https:" &&
    !(
      base.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(base.hostname)
    )
  )
    throw new DocumentError("Qdrant requires HTTPS or a loopback address.", 503)
  const profileFor = (document: DocumentRecord) => {
    if (!document.embeddingProfile || document.embeddingProfile === "openai-v1")
      return { collection: "paydesk_documents_v1", size: VECTOR_SIZE }
    if (document.embeddingProfile === "ollama-nomic-v1")
      return { collection: "paydesk_documents_ollama_nomic_v1", size: 768 }
    throw new DocumentError("Unsupported document embedding profile.", 409)
  }
  async function call(
    path: string,
    method: string,
    body?: unknown,
    allow404 = false
  ) {
    const response = await fetch(new URL(path, base), {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: {
        "Content-Type": "application/json",
        "api-key": process.env.QDRANT_API_KEY!,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (response.status === 404 && allow404) return null
    if (!response.ok)
      throw new DocumentError(
        "Document search is temporarily unavailable.",
        503
      )
    return response.json() as Promise<{ result: unknown }>
  }
  async function ensureCollection({
    collection,
    size,
  }: {
    collection: string
    size: number
  }) {
    let existing = await call(
      `/collections/${collection}`,
      "GET",
      undefined,
      true
    )
    if (!existing) {
      // A concurrent first upload may create the same collection. Re-read it on conflict.
      try {
        await call(`/collections/${collection}`, "PUT", {
          vectors: { size, distance: "Cosine" },
        })
      } catch {
        existing = await call(`/collections/${collection}`, "GET")
        if (!existing)
          throw new DocumentError("Document search is unavailable.", 503)
      }
      existing = await call(`/collections/${collection}`, "GET")
    }
    const config = existing?.result as {
      config?: { params?: { vectors?: { size?: number; distance?: string } } }
    }
    if (
      config?.config?.params?.vectors?.size !== size ||
      config.config.params.vectors.distance !== "Cosine"
    )
      throw new DocumentError(
        "Document vector collection has an incompatible configuration.",
        503
      )
    for (const field_name of ["documentId", "ownerId"]) {
      await call(`/collections/${collection}/index?wait=true`, "PUT", {
        field_name,
        field_schema: "keyword",
      })
    }
  }
  return {
    async put(document, passages, vectors) {
      const profile = profileFor(document)
      const { collection, size } = profile
      if (
        vectors.length !== passages.length ||
        vectors.some(
          (vector) =>
            vector.length !== size ||
            vector.some((value) => !Number.isFinite(value))
        )
      )
        throw new DocumentError(
          "The embedding provider returned invalid data.",
          502
        )
      await ensureCollection(profile)
      await call(`/collections/${collection}/points?wait=true`, "PUT", {
        points: passages.map((passage, index) => ({
          id: randomUUID(),
          vector: vectors[index],
          payload: {
            documentId: document.id,
            ownerId: document.ownerId,
            chunkIndex: passage.index,
          },
        })),
      })
    },
    async search(document, vector, limit) {
      const { collection, size } = profileFor(document)
      if (
        vector.length !== size ||
        vector.some((value) => !Number.isFinite(value))
      )
        throw new DocumentError(
          "The embedding provider returned invalid data.",
          502
        )
      const data = await call(
        `/collections/${collection}/points/query`,
        "POST",
        {
          query: vector,
          filter: documentFilter(document),
          limit,
          with_payload: true,
          with_vector: false,
        }
      )
      const result = data?.result as {
        points?: { payload?: Record<string, unknown> }[]
      }
      if (!Array.isArray(result?.points))
        throw new DocumentError("Document search returned invalid data.", 502)
      return result.points.flatMap(({ payload }) =>
        payload?.documentId === document.id &&
        payload.ownerId === document.ownerId &&
        Number.isInteger(payload.chunkIndex)
          ? [payload.chunkIndex as number]
          : []
      )
    },
    async remove(document) {
      const { collection } = profileFor(document)
      await call(
        `/collections/${collection}/points/delete?wait=true`,
        "POST",
        { filter: documentFilter(document) },
        true
      )
    },
  }
}
