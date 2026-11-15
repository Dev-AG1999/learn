import { seedSyntheticEmployees } from "../src/db/seed.ts"
import { withPayroll } from "../src/payroll-db.ts"

const count = await withPayroll((db) => seedSyntheticEmployees(db))
console.log(`seeded ${count} employees`)
