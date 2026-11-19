import EncryptedDatabase from "better-sqlite3-multiple-ciphers"
import { randomUUID } from "node:crypto"
import { chmodSync, closeSync, linkSync, lstatSync, openSync, unlinkSync } from "node:fs"
import { resolve } from "node:path"

/** Run offline. Preserve the source and publish the destination only after verification. */
export async function encryptDatabase(source: string, destination: string, key: Buffer): Promise<void> {
  if (key.length !== 32) throw new Error("A 32-byte database key is required.")
  if (resolve(source) === resolve(destination)) throw new Error("Choose a separate destination database.")
  if (!lstatSync(source).isFile()) throw new Error("Source must be a regular database file.")
  const temporary = `${destination}.${randomUUID()}.migration`
  const fd = openSync(temporary, "wx", 0o600)
  closeSync(fd)
  let input: EncryptedDatabase.Database | undefined
  let output: EncryptedDatabase.Database | undefined
  try {
    input = new EncryptedDatabase(source, { readonly: true, fileMustExist: true })
    input.prepare("SELECT count(*) FROM sqlite_master").get()
    await input.backup(temporary)
    input.close()
    input = undefined
    chmodSync(temporary, 0o600)
    output = new EncryptedDatabase(temporary)
    output.pragma("cipher='sqlcipher'")
    output.rekey(key)
    const checked = output.pragma("integrity_check", { simple: true })
    if (checked !== "ok") throw new Error("Encrypted database verification failed.")
    output.close()
    output = undefined
    // A hard link publishes atomically and refuses to overwrite an existing destination.
    linkSync(temporary, destination)
  } finally {
    input?.close()
    output?.close()
    unlinkSync(temporary)
  }
}
