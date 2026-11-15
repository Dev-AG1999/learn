import { randomBytes, scrypt, timingSafeEqual } from "node:crypto"

const options = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, options, (error, key) => error ? reject(error) : resolve(key))
  })
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12 || Buffer.byteLength(password) > 1024) {
    throw new Error("Password must contain at least 12 characters and at most 1024 bytes.")
  }
  const salt = randomBytes(16)
  const hash = await derive(password, salt)
  return `scrypt$131072$8$1$${salt.toString("hex")}$${hash.toString("hex")}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!password || Buffer.byteLength(password) > 1024) return false
  const parts = stored.split("$")
  if (parts.length !== 6 || parts.slice(0, 4).join("$") !== "scrypt$131072$8$1" ||
      !/^[a-f0-9]{32}$/.test(parts[4]) || !/^[a-f0-9]{128}$/.test(parts[5])) return false
  const actual = await derive(password, Buffer.from(parts[4], "hex"))
  return timingSafeEqual(actual, Buffer.from(parts[5], "hex"))
}

// Unknown users take the same expensive password verification path as known users.
export const dummyPasswordHash = `scrypt$131072$8$1$${"00".repeat(16)}$${"00".repeat(64)}`
