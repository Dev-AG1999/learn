import { hashPassword } from "../src/auth/password.ts"
import { withAuth } from "../src/auth/repository.ts"

const [command, username, role, employeeId] = process.argv.slice(2)

try {
  if (!username || !["create", "reset-password", "disable"].includes(command)) {
    throw new Error("Usage: npm run auth:user -- create <username> <hr|employee> [employee-id] | reset-password <username> | disable <username>")
  }
  if (command === "disable") {
    await withAuth(db => {
      if (!db.findUser(username)) throw new Error("Account not found.")
      db.disable(username)
    })
  } else {
    if (command === "create" && (role !== "hr" && role !== "employee" || role === "employee" && !employeeId || role === "hr" && employeeId)) {
      throw new Error("Choose hr without an employee ID, or employee with an existing employee ID.")
    }
    const password = process.env.AUTH_USER_PASSWORD ?? ""
    delete process.env.AUTH_USER_PASSWORD
    const passwordHash = await hashPassword(password)
    await withAuth(db => {
      if (command === "reset-password") db.resetPassword(username, passwordHash)
      else db.provision(username, passwordHash, role as "hr" | "employee", role === "employee" ? employeeId : null)
    })
  }
  console.log("Account updated. Existing sessions are revoked on password reset or disable.")
} catch (error) {
  // Do not print raw SQLite errors or credential-bearing request data.
  console.error(error instanceof Error && !error.message.includes("constraint") ? error.message : "Account update failed. Verify the username and employee ID.")
  process.exitCode = 1
}
