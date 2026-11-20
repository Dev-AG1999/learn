import type { UploadReview } from "../ai/review.ts"
import { openStorageDatabase } from "../db/connection.ts"
import { preparePayrollPath } from "../payroll-db.ts"
import {
  FileError,
  type FileScope,
  type StoredFile,
  type DriveConnection,
} from "./types.ts"
import { seal, unseal } from "./crypto.ts"

export function openFileRepository(path: string) {
  const db = openStorageDatabase(path)
  db.exec(`PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS secure_files (
      id TEXT PRIMARY KEY, ownerId TEXT NOT NULL, ownerName TEXT NOT NULL, name TEXT NOT NULL,
      createdAt INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('processing','ready','rejected','failed')),
      driveId TEXT, kind TEXT, originalBytes INTEGER, storedBytes INTEGER, sha256 TEXT, scannedAt INTEGER, scannerVersion TEXT
    );
    CREATE INDEX IF NOT EXISTS secure_files_owner_page ON secure_files(ownerId, createdAt DESC, id DESC);
    CREATE INDEX IF NOT EXISTS secure_files_page ON secure_files(createdAt DESC, id DESC);
    CREATE TABLE IF NOT EXISTS secure_file_links (context TEXT NOT NULL, contextId TEXT NOT NULL, fileId TEXT NOT NULL, PRIMARY KEY(context,contextId,fileId));
    CREATE TABLE IF NOT EXISTS file_ai_reviews (
      fileId TEXT PRIMARY KEY REFERENCES secure_files(id), reviewJson TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS file_upload_limits (userId TEXT NOT NULL, hour INTEGER NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(userId,hour));
    CREATE TABLE IF NOT EXISTS drive_connection (id INTEGER PRIMARY KEY CHECK(id=1), userId TEXT NOT NULL, driveUserId TEXT NOT NULL, folderId TEXT NOT NULL, secret TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS drive_oauth_states (stateHash TEXT PRIMARY KEY, userId TEXT NOT NULL, verifier TEXT NOT NULL, expiresAt INTEGER NOT NULL);
  `)
  const access = (scope: FileScope, id: string): StoredFile => {
    const row = db
      .prepare(
        "SELECT * FROM secure_files WHERE id=? AND (?='hr' OR ownerId=?)"
      )
      .get(id, scope.role, scope.userId) as StoredFile | undefined
    if (!row) throw new FileError("File not found.", 404)
    return row
  }
  return {
    access,
    saveReview(fileId: string, review: UploadReview) {
      db.prepare(
        "INSERT INTO file_ai_reviews VALUES (?, ?) ON CONFLICT(fileId) DO UPDATE SET reviewJson=excluded.reviewJson"
      ).run(fileId, JSON.stringify(review))
    },
    review(scope: FileScope, fileId: string): UploadReview | null {
      access(scope, fileId)
      const row = db
        .prepare("SELECT reviewJson FROM file_ai_reviews WHERE fileId=?")
        .get(fileId) as { reviewJson: string } | undefined
      return row ? (JSON.parse(row.reviewJson) as UploadReview) : null
    },
    list(scope: FileScope, before?: string) {
      let cursor: { time: number; id: string } | null = null
      if (before) {
        try {
          const value = JSON.parse(
            Buffer.from(before, "base64url").toString("utf8")
          ) as unknown[]
          if (
            before.length > 200 ||
            !Array.isArray(value) ||
            value.length !== 2 ||
            !Number.isSafeInteger(value[0]) ||
            typeof value[1] !== "string" ||
            !/^[\w-]{1,64}$/.test(value[1])
          )
            throw new Error()
          cursor = { time: value[0] as number, id: value[1] }
        } catch {
          throw new FileError("Invalid file page.")
        }
      }
      const rows = db
        .prepare(
          `SELECT * FROM secure_files WHERE (?='hr' OR ownerId=?) AND (? IS NULL OR createdAt < ? OR (createdAt = ? AND id < ?)) ORDER BY createdAt DESC, id DESC LIMIT 26`
        )
        .all(
          scope.role,
          scope.userId,
          cursor?.time ?? null,
          cursor?.time ?? null,
          cursor?.time ?? null,
          cursor?.id ?? null
        ) as StoredFile[]
      const files = rows.slice(0, 25),
        last = files.at(-1)
      return {
        files,
        next:
          rows.length > 25 && last
            ? Buffer.from(JSON.stringify([last.createdAt, last.id])).toString(
                "base64url"
              )
            : null,
      }
    },
    consume(scope: FileScope, now = Date.now()) {
      const hour = Math.floor(now / 3_600_000)
      db.prepare("DELETE FROM file_upload_limits WHERE hour < ?").run(hour - 24)
      if (
        !db
          .prepare(
            `INSERT INTO file_upload_limits VALUES (?,?,1) ON CONFLICT(userId,hour) DO UPDATE SET count=count+1 WHERE count<10 RETURNING count`
          )
          .get(scope.userId, hour)
      )
        throw new FileError("Upload limit reached. Try again next hour.", 429)
    },
    reserve(
      file: Pick<
        StoredFile,
        "id" | "ownerId" | "ownerName" | "name" | "createdAt"
      >
    ) {
      db.exec("BEGIN IMMEDIATE")
      try {
        const { count } = db
          .prepare("SELECT COUNT(*) AS count FROM secure_files WHERE ownerId=?")
          .get(file.ownerId) as { count: number }
        if (count >= 100)
          throw new FileError(
            "Your file limit has been reached. Contact HR.",
            429
          )
        db.prepare(
          "INSERT INTO secure_files(id,ownerId,ownerName,name,createdAt,status) VALUES (?,?,?,?,?,'processing')"
        ).run(file.id, file.ownerId, file.ownerName, file.name, file.createdAt)
        db.exec("COMMIT")
      } catch (error) {
        db.exec("ROLLBACK")
        throw error
      }
    },
    link(
      context: "claim" | "document" | "import",
      contextId: string,
      fileId: string
    ) {
      db.prepare("INSERT OR IGNORE INTO secure_file_links VALUES (?,?,?)").run(
        context,
        contextId,
        fileId
      )
    },
    linked(
      scope: FileScope,
      context: "claim" | "document" | "import",
      contextId?: string
    ): StoredFile[] {
      return db
        .prepare(
          "SELECT f.* FROM secure_files f JOIN secure_file_links l ON l.fileId=f.id WHERE l.context=? AND (? IS NULL OR l.contextId=?) AND (?='hr' OR f.ownerId=?) AND f.status='ready' ORDER BY f.createdAt DESC LIMIT 25"
        )
        .all(
          context,
          contextId ?? null,
          contextId ?? null,
          scope.role,
          scope.userId
        ) as StoredFile[]
    },
    setDriveId(id: string, driveId: string) {
      db.prepare("UPDATE secure_files SET driveId=? WHERE id=?").run(
        driveId,
        id
      )
    },
    ready(file: StoredFile) {
      db.prepare(
        "UPDATE secure_files SET status='ready',kind=?,originalBytes=?,storedBytes=?,sha256=?,scannedAt=?,scannerVersion=? WHERE id=? AND status='processing'"
      ).run(
        file.kind,
        file.originalBytes,
        file.storedBytes,
        file.sha256,
        file.scannedAt,
        file.scannerVersion,
        file.id
      )
    },
    fail(id: string, status: "failed" | "rejected") {
      db.prepare("UPDATE secure_files SET status=? WHERE id=?").run(status, id)
    },
    connection(): DriveConnection | null {
      const row = db
        .prepare("SELECT * FROM drive_connection WHERE id=1")
        .get() as
        | {
            userId: string
            driveUserId: string
            folderId: string
            secret: string
          }
        | undefined
      return row
        ? ({
            userId: row.userId,
            driveUserId: row.driveUserId,
            folderId: row.folderId,
            ...JSON.parse(unseal(row.secret, "drive-connection")),
          } as DriveConnection)
        : null
    },
    connectionIdentity() {
      return db
        .prepare(
          "SELECT userId,driveUserId,folderId FROM drive_connection WHERE id=1"
        )
        .get() as
        Pick<DriveConnection, "userId" | "driveUserId" | "folderId"> | undefined
    },
    connected(): boolean {
      return !!db.prepare("SELECT id FROM drive_connection WHERE id=1").get()
    },
    saveConnection(connection: DriveConnection) {
      const secret = seal(
        JSON.stringify({
          accessToken: connection.accessToken,
          refreshToken: connection.refreshToken,
          expiresAt: connection.expiresAt,
        }),
        "drive-connection"
      )
      const existing = db
        .prepare("SELECT driveUserId FROM drive_connection WHERE id=1")
        .get() as { driveUserId: string } | undefined
      if (existing && existing.driveUserId !== connection.driveUserId)
        throw new FileError(
          "Reconnect the original Google account to preserve access to stored files.",
          409
        )
      const saved = db
        .prepare(
          `INSERT INTO drive_connection VALUES (1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET userId=excluded.userId, folderId=excluded.folderId, secret=excluded.secret WHERE driveUserId=excluded.driveUserId`
        )
        .run(
          connection.userId,
          connection.driveUserId,
          connection.folderId,
          secret
        )
      if (saved.changes !== 1)
        throw new FileError(
          "Drive account changed during connection. Retry with the original account.",
          409
        )
    },
    saveState(
      stateHash: string,
      userId: string,
      verifier: string,
      now = Date.now()
    ) {
      db.prepare(
        "DELETE FROM drive_oauth_states WHERE expiresAt < ? OR userId=?"
      ).run(now, userId)
      db.prepare("INSERT INTO drive_oauth_states VALUES (?,?,?,?)").run(
        stateHash,
        userId,
        seal(verifier, "drive-pkce"),
        now + 600_000
      )
    },
    consumeState(
      stateHash: string,
      userId: string,
      now = Date.now()
    ): string | null {
      const row = db
        .prepare(
          "DELETE FROM drive_oauth_states WHERE stateHash=? AND userId=? RETURNING verifier,expiresAt"
        )
        .get(stateHash, userId) as
        { verifier: string; expiresAt: number } | undefined
      return row && row.expiresAt > now
        ? unseal(row.verifier, "drive-pkce")
        : null
    },
    close() {
      db.close()
    },
  }
}
export type FileRepository = ReturnType<typeof openFileRepository>
export async function withFiles<T>(
  run: (db: FileRepository) => T | Promise<T>
): Promise<T> {
  const db = openFileRepository(preparePayrollPath())
  try {
    return await run(db)
  } finally {
    db.close()
  }
}
