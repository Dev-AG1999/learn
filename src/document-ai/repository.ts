import { openStorageDatabase } from "../db/connection.ts"
import { preparePayrollPath } from "../payroll-db.ts"
import {
  DocumentError,
  type DocumentRecord,
  type Passage,
  type Scope,
} from "./types.ts"

export function openDocumentRepository(path: string) {
  const db = openStorageDatabase(path)
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS ai_documents (
      id TEXT PRIMARY KEY, ownerId TEXT NOT NULL, ownerName TEXT NOT NULL,
      name TEXT NOT NULL, objectKey TEXT NOT NULL UNIQUE, pages INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('processing','ready','failed')), createdAt INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ai_documents_owner ON ai_documents(ownerId, createdAt DESC);
    CREATE INDEX IF NOT EXISTS ai_documents_created ON ai_documents(createdAt DESC);
    CREATE TABLE IF NOT EXISTS ai_passages (
      documentId TEXT NOT NULL REFERENCES ai_documents(id) ON DELETE CASCADE,
      chunkIndex INTEGER NOT NULL, page INTEGER NOT NULL, text TEXT NOT NULL,
      PRIMARY KEY(documentId, chunkIndex)
    );
    CREATE TABLE IF NOT EXISTS ai_usage (
      userId TEXT NOT NULL, action TEXT NOT NULL, hour INTEGER NOT NULL, count INTEGER NOT NULL,
      PRIMARY KEY(userId, action, hour)
    );
  `)
  // Existing document records were embedded with OpenAI before local support.
  const columns = db.prepare("PRAGMA table_info(ai_documents)").all() as {
    name: string
  }[]
  if (!columns.some((column) => column.name === "embeddingProfile")) {
    try {
      db.exec(
        "ALTER TABLE ai_documents ADD COLUMN embeddingProfile TEXT NOT NULL DEFAULT 'openai-v1'"
      )
    } catch (error) {
      const migrated = db.prepare("PRAGMA table_info(ai_documents)").all() as {
        name: string
      }[]
      if (!migrated.some((column) => column.name === "embeddingProfile"))
        throw error
    }
  }
  const access = (scope: Scope, id: string): DocumentRecord => {
    const row = db
      .prepare(
        "SELECT * FROM ai_documents WHERE id = ? AND (? = 'hr' OR ownerId = ?)"
      )
      .get(id, scope.role, scope.userId) as DocumentRecord | undefined
    if (!row) throw new DocumentError("Document not found.", 404)
    return row
  }
  return {
    access,
    list(scope: Scope): DocumentRecord[] {
      return db
        .prepare(
          "SELECT * FROM ai_documents WHERE (? = 'hr' OR ownerId = ?) ORDER BY createdAt DESC, id DESC LIMIT 50"
        )
        .all(scope.role, scope.userId) as DocumentRecord[]
    },
    reserve(document: DocumentRecord) {
      db.exec("BEGIN IMMEDIATE")
      try {
        const { count } = db
          .prepare(
            "SELECT COUNT(*) AS count FROM ai_documents WHERE ownerId = ?"
          )
          .get(document.ownerId) as { count: number }
        if (count >= 100)
          throw new DocumentError(
            "Your 100-document limit has been reached. Contact HR.",
            429
          )
        db.prepare(
          "INSERT INTO ai_documents (id, ownerId, ownerName, name, objectKey, pages, status, createdAt, embeddingProfile) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).run(
          document.id,
          document.ownerId,
          document.ownerName,
          document.name,
          document.objectKey,
          document.pages,
          document.status,
          document.createdAt,
          document.embeddingProfile ?? "openai-v1"
        )
        db.exec("COMMIT")
      } catch (error) {
        db.exec("ROLLBACK")
        throw error
      }
    },
    complete(id: string, passages: Passage[]) {
      db.exec("BEGIN IMMEDIATE")
      try {
        const insert = db.prepare("INSERT INTO ai_passages VALUES (?, ?, ?, ?)")
        for (const passage of passages)
          insert.run(id, passage.index, passage.page, passage.text)
        db.prepare("UPDATE ai_documents SET status = 'ready' WHERE id = ?").run(
          id
        )
        db.exec("COMMIT")
      } catch (error) {
        db.exec("ROLLBACK")
        throw error
      }
    },
    fail(id: string) {
      db.prepare("UPDATE ai_documents SET status = 'failed' WHERE id = ?").run(
        id
      )
    },
    passages(scope: Scope, id: string): Passage[] {
      access(scope, id)
      return db
        .prepare(
          "SELECT chunkIndex AS 'index', page, text FROM ai_passages WHERE documentId = ? ORDER BY chunkIndex"
        )
        .all(id) as Passage[]
    },
    consume(scope: Scope, action: "upload" | "ask", now = Date.now()) {
      const hour = Math.floor(now / 3_600_000)
      db.prepare("DELETE FROM ai_usage WHERE hour < ?").run(hour - 24)
      const row = db
        .prepare(
          `INSERT INTO ai_usage VALUES (?, ?, ?, 1)
        ON CONFLICT(userId, action, hour) DO UPDATE SET count = count + 1
        WHERE count < ? RETURNING count`
        )
        .get(scope.userId, action, hour, action === "upload" ? 10 : 60)
      if (!row)
        throw new DocumentError(
          "AI request limit reached. Try again next hour.",
          429
        )
    },
    close() {
      db.close()
    },
  }
}
export type DocumentRepository = ReturnType<typeof openDocumentRepository>
export async function withDocuments<T>(
  run: (db: DocumentRepository) => T | Promise<T>
): Promise<T> {
  const db = openDocumentRepository(preparePayrollPath())
  try {
    return await run(db)
  } finally {
    db.close()
  }
}
