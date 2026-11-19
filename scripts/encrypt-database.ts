import { databaseKey } from "../src/db/connection.ts"
import { encryptDatabase } from "../src/db/encrypt.ts"

const [source, destination, ...extra] = process.argv.slice(2)
if (!source || !destination || extra.length)
  throw new Error("Stop the app, then run npm run db:encrypt -- SOURCE DESTINATION")
const key = databaseKey()
if (!key) throw new Error("Set DATABASE_ENCRYPTION_KEY in .env.local first.")
try {
  await encryptDatabase(source, destination, key)
  console.log("Encrypted copy verified. Update PAYROLL_DB before restarting. The source is unchanged and remains plaintext; protect and remove it after verifying the migration.")
} finally {
  key.fill(0)
}
