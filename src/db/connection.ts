import { DatabaseSync } from "node:sqlite"
import EncryptedDatabase from "better-sqlite3-multiple-ciphers"

export type StorageDatabase = Pick<DatabaseSync, "prepare" | "exec" | "close">

export function databaseKey(): Buffer | null {
  const value = process.env.DATABASE_ENCRYPTION_KEY
  if (!value) {
    if (process.env.NODE_ENV === "production")
      throw new Error("DATABASE_ENCRYPTION_KEY is required in production.")
    return null
  }
  if (!/^[a-f0-9]{64}$/i.test(value))
    throw new Error("DATABASE_ENCRYPTION_KEY must be a random 32-byte hex key.")
  if ([process.env.AUTH_JWT_SECRET, process.env.DRIVE_TOKEN_SECRET].includes(value))
    throw new Error("Use a separate key for database encryption.")
  return Buffer.from(value, "hex")
}

/** Keep repository SQL and indexes intact; encryption happens at the SQLite page layer. */
export function openStorageDatabase(path: string): StorageDatabase {
  const key = databaseKey()
  if (!key) return new DatabaseSync(path)
  const db = new EncryptedDatabase(path)
  try {
    db.pragma("cipher='sqlcipher'")
    db.key(key)
    db.pragma("temp_store=MEMORY")
    db.prepare("SELECT count(*) FROM sqlite_master").get()
    // These repositories use only the common synchronous exec/prepare/close API.
    return db as unknown as StorageDatabase
  } catch {
    db.close()
    throw new Error("Cannot open encrypted database. Check the database key and migrate existing plaintext databases before enabling encryption.")
  } finally {
    key.fill(0)
  }
}
