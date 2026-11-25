import { randomUUID } from "node:crypto"
import type { Principal } from "../../auth/repository.ts"
import { databaseKey, openStorageDatabase } from "../../db/connection.ts"
import { preparePayrollPath } from "../../payroll-db.ts"
import { FileError } from "../types.ts"
import type { UploadJobStatus, UploadKind } from "./types.ts"

const LEASE_MS = 60_000
const QUEUE_LIFETIME_MS = 60 * 60_000
const RESULT_LIFETIME_MS = 24 * 60 * 60_000
const MAX_PENDING = 20
const MAX_PENDING_PER_OWNER = 3

type Job = {
  id: string
  ownerId: string
  username: string
  employeeId: string | null
  role: Principal["role"]
  kind: UploadKind
  contentType: string
  payload: Uint8Array
}

type StoredResult = {
  state: string
  status: number | null
  result: string | null
  createdAt: number
  updatedAt: number
  leaseUntil: number | null
}

const EXPIRED = { error: "The upload expired before processing started. Submit it again." }
const INTERRUPTED = "Processing was interrupted. Check whether the file or related record was saved before submitting again."

export function withUploadJobs<T>(run: (repository: ReturnType<typeof uploadJobs>) => T): T {
  const key = databaseKey()
  if (!key) throw new FileError("Queued uploads require an encrypted database.", 503)
  key.fill(0)
  const db = openStorageDatabase(preparePayrollPath())
  try {
    db.exec(`PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS upload_jobs (
        id TEXT PRIMARY KEY, ownerId TEXT NOT NULL, username TEXT NOT NULL,
        employeeId TEXT, role TEXT NOT NULL, kind TEXT NOT NULL,
        contentType TEXT NOT NULL, payload BLOB,
        state TEXT NOT NULL, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL,
        leaseUntil INTEGER, status INTEGER, result TEXT
      );
      CREATE INDEX IF NOT EXISTS upload_jobs_state_age ON upload_jobs(state, createdAt);
      CREATE INDEX IF NOT EXISTS upload_jobs_owner_state ON upload_jobs(ownerId, state);
    `)
    return run(uploadJobs(db))
  } finally {
    db.close()
  }
}

function uploadJobs(db: ReturnType<typeof openStorageDatabase>) {
  function maintain(now: number) {
    db.prepare(`UPDATE upload_jobs
      SET state='interrupted', payload=NULL, updatedAt=?
      WHERE state='processing' AND leaseUntil <= ?`).run(now, now)
    db.prepare(`UPDATE upload_jobs
      SET state='finished', payload=NULL, updatedAt=?, status=503, result=?
      WHERE state='queued' AND createdAt <= ?`).run(now,
        JSON.stringify(EXPIRED),
        now - QUEUE_LIFETIME_MS)
    db.prepare(`DELETE FROM upload_jobs
      WHERE state IN ('finished','interrupted') AND updatedAt <= ?`).run(now - RESULT_LIFETIME_MS)
  }

  return {
    enqueue(principal: Principal, kind: UploadKind, contentType: string, payload: Uint8Array, now = Date.now()) {
      maintain(now)
      const id = randomUUID()
      const result = db.prepare(`INSERT INTO upload_jobs
        (id, ownerId, username, employeeId, role, kind, contentType, payload, state, createdAt, updatedAt)
        SELECT ?,?,?,?,?,?,?,?,'queued',?,?
        WHERE (SELECT COUNT(*) FROM upload_jobs WHERE state IN ('queued','processing')) < ?
          AND (SELECT COUNT(*) FROM upload_jobs WHERE ownerId=? AND state IN ('queued','processing')) < ?
      `).run(id, principal.userId, principal.username, principal.employeeId, principal.role,
        kind, contentType, payload, now, now, MAX_PENDING, principal.userId, MAX_PENDING_PER_OWNER)
      if (!result.changes)
        throw new FileError("The upload queue is full. Check your queued uploads or try again shortly.", 429)
      return id
    },
    status(ownerId: string, id: string, now = Date.now()): UploadJobStatus | null {
      const row = db.prepare(`SELECT state,status,result,createdAt,updatedAt,leaseUntil
        FROM upload_jobs WHERE id=? AND ownerId=?`).get(id, ownerId) as StoredResult | undefined
      if (!row) return null
      if (row.state === "queued")
        return row.createdAt <= now - QUEUE_LIFETIME_MS
          ? { state: "finished", status: 503, result: EXPIRED }
          : { state: "queued" }
      if (row.state === "processing")
        return row.leaseUntil! <= now
          ? { state: "interrupted", error: INTERRUPTED }
          : { state: "processing" }
      if (row.updatedAt <= now - RESULT_LIFETIME_MS) return null
      if (row.state === "interrupted")
        return { state: "interrupted", error: INTERRUPTED }
      return { state: "finished", status: row.status!, result: JSON.parse(row.result!) }
    },
    claim(now = Date.now()): Job | undefined {
      maintain(now)
      return db.prepare(`UPDATE upload_jobs SET state='processing', leaseUntil=?, updatedAt=?
        WHERE id = (SELECT id FROM upload_jobs WHERE state='queued' ORDER BY createdAt, id LIMIT 1)
          AND NOT EXISTS (SELECT 1 FROM upload_jobs WHERE state='processing')
        RETURNING id,ownerId,username,employeeId,role,kind,contentType,payload
      `).get(now + LEASE_MS, now) as Job | undefined
    },
    renew(id: string, now = Date.now()) {
      return !!db.prepare(`UPDATE upload_jobs SET leaseUntil=?
        WHERE id=? AND state='processing' AND leaseUntil>?`).run(now + LEASE_MS, id, now).changes
    },
    finish(id: string, status: number, result: unknown, now = Date.now()) {
      return !!db.prepare(`UPDATE upload_jobs SET state='finished', payload=NULL,
        updatedAt=?, leaseUntil=NULL, status=?, result=?
        WHERE id=? AND state='processing'`).run(now, status, JSON.stringify(result), id).changes
    },
  }
}
