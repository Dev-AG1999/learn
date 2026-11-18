import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { gzipSync, gunzipSync } from "node:zlib"
import { randomUUID } from "node:crypto"
import { beforeAll, beforeEach, afterEach, expect, test, vi } from "vitest"
import { hashPassword } from "../src/auth/password.ts"
import { withAuth } from "../src/auth/repository.ts"
import { loginResponse } from "../src/auth/endpoints.ts"
import { withPayroll } from "../src/payroll-db.ts"
import { withFiles } from "../src/files/repository.ts"
import { signedFileUrl } from "../src/files/signing.ts"
import { FileError } from "../src/files/types.ts"
import { payslipPdf } from "../src/payslip-document.ts"
const mocks = vi.hoisted(() => ({
  scan: vi.fn(),
  put: vi.fn(),
  files: new Map<string, Uint8Array>(),
}))
vi.mock("../src/files/scanner.ts", () => ({
  clamAvScanner: () => ({ scan: mocks.scan }),
}))
vi.mock("../src/files/drive.ts", () => ({
  googleDriveStore: () => ({
    allocate: async () => `drive-${crypto.randomUUID()}`,
    put: mocks.put,
    get: async (id: string) => mocks.files.get(id)!,
    remove: async (id: string) => {
      mocks.files.delete(id)
    },
  }),
}))
import { POST as documents } from "../app/hr/documents/route.ts"
import { POST as claims } from "../app/employee/[employeeId]/claims/route.ts"
import { POST as preview } from "../app/hr/import/preview/route.ts"
import { downloadFileResponse, signedLinkResponse } from "../src/files/http.ts"
let dir: string,
  hash: string,
  hrCookie: string,
  employeeCookie: string,
  otherCookie: string,
  employeeId: string,
  hrId: string
const origin = "http://localhost:3000",
  password = "Secure file integration test password!"
const pdf = payslipPdf({
  employeeId: "emp-a",
  year: 2026,
  month: 1,
  currency: "INR",
  monthlyGrossMinor: 100000,
  unpaidDeductionMinor: 0,
  otherDeductionsMinor: 5000,
  approvedReimbursementsMinor: 0,
  netMinor: 95000,
})
beforeAll(async () => {
  hash = await hashPassword(password)
})
async function login(username: string) {
  const response = await loginResponse(
    new Request(`${origin}/auth/login`, {
      method: "POST",
      headers: { Origin: origin },
      body: new URLSearchParams({ username, password }),
    }),
    false
  )
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ")
}
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "secure-upload-http-"))
  vi.stubEnv("PAYROLL_DB", join(dir, "db.sqlite"))
  vi.stubEnv("AUTH_JWT_SECRET", "ab".repeat(32))
  vi.stubEnv("APP_ORIGIN", origin)
  vi.stubEnv("DRIVE_TOKEN_SECRET", "cd".repeat(32))
  vi.stubEnv("GOOGLE_DRIVE_CLIENT_ID", "synthetic-id")
  vi.stubEnv("GOOGLE_DRIVE_CLIENT_SECRET", "synthetic-secret")
  vi.stubEnv("FILE_UPLOADS_ENABLED", "true")
  vi.clearAllMocks()
  mocks.files.clear()
  mocks.scan.mockResolvedValue({
    version: "ClamAV synthetic",
    scannedAt: Date.now(),
  })
  mocks.put.mockImplementation(async (id: string, bytes: Uint8Array) => {
    mocks.files.set(id, new Uint8Array(bytes))
  })
  await withPayroll(async (db) => {
    for (const employeeId of ["emp-a", "emp-b"])
      await db.saveMonth({
        employeeId,
        year: 2026,
        month: 1,
        annualCtcMinor: 1200000,
        currency: "INR",
        calendarDays: 31,
        unpaidLeaveDays: 0,
        otherDeductionsMinor: 0,
        claims: [],
        confirmed: true,
      })
  })
  await withAuth((db) => {
    db.provision("hr-a", hash, "hr", null)
    db.provision("employee", hash, "employee", "emp-a")
    db.provision("other", hash, "employee", "emp-b")
    employeeId = db.findUser("employee")!.userId
    hrId = db.findUser("hr-a")!.userId
  })
  await withFiles((db) =>
    db.saveConnection({
      userId: hrId,
      driveUserId: "google-user",
      folderId: "private-folder",
      refreshToken: "private-refresh",
      accessToken: "private-access",
      expiresAt: Date.now() + 3600000,
    })
  )
  hrCookie = await login("hr-a")
  employeeCookie = await login("employee")
  otherCookie = await login("other")
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  vi.unstubAllEnvs()
})
function formRequest(
  path: string,
  cookie: string,
  fields: Record<string, string>,
  file?: {
    name: string
    bytes: Uint8Array
    field?: string
    compressed?: boolean
  },
  from = origin
) {
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) form.set(key, value)
  if (file) {
    const field = file.field ?? "attachment"
    form.set(
      field,
      new File(
        [
          new Uint8Array(
            file.compressed === false ? file.bytes : gzipSync(file.bytes)
          ),
        ],
        file.name
      )
    )
    if (file.compressed !== false) form.set(`${field}Encoding`, "gzip")
  }
  return new Request(`${origin}${path}`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: from, Accept: "application/json" },
    body: form,
  })
}
test("existing HR document route returns a signed URL for a compressed, scanned private attachment", async () => {
  const response = await documents(
    formRequest(
      "/hr/documents",
      hrCookie,
      { documentId: "policy", body: "Approved policy text" },
      { name: "policy.pdf", bytes: pdf }
    )
  )
  expect(response.status).toBe(200)
  const result = await response.json()
  expect(result.signedUrl).toContain("signature=")
  expect(result.signedUrl).not.toContain("google")
  const fileId = result.signedUrl.split("/")[3]
  const downloaded = await downloadFileResponse(
    new Request(origin + result.signedUrl, { headers: { Cookie: hrCookie } }),
    fileId
  )
  expect(downloaded.status).toBe(200)
  expect(downloaded.headers.get("Content-Type")).toBe("application/gzip")
  expect(gunzipSync(Buffer.from(await downloaded.arrayBuffer()))).toEqual(
    Buffer.from(pdf)
  )
  expect(mocks.scan).toHaveBeenCalledTimes(2)
  expect(
    (
      await withFiles((db) =>
        db.linked({ userId: hrId, role: "hr" }, "document", "policy")
      )
    )[0].status
  ).toBe("ready")
})
test("employee attachment stays linked to its pending claim and is visible to HR", async () => {
  const response = await claims(
    formRequest(
      "/employee/emp-a/claims",
      employeeCookie,
      {
        year: "2026",
        month: "1",
        amountMinor: "500",
        receipt: "Receipt A",
        confirmed: "yes",
      },
      { name: "receipt.pdf", bytes: pdf }
    ),
    { params: Promise.resolve({ employeeId: "emp-a" }) }
  )
  expect(response.status).toBe(200)
  const data = await response.json(),
    claim = (await withPayroll((db) => db.getClaims("emp-a", 2026, 1)))[0]
  expect(claim.status).toBe("pending")
  const attachments = await withFiles((db) =>
    db.linked({ userId: hrId, role: "hr" }, "claim", claim.id)
  )
  expect(attachments).toHaveLength(1)
  const fresh = await signedLinkResponse(
    new Request(origin + "/api/files/" + attachments[0].id + "/link", {
      headers: { Cookie: employeeCookie },
    }),
    attachments[0].id
  )
  expect(fresh.status).toBe(200)
  expect((await fresh.json()).signedUrl).toContain("signature=")
  expect(
    (
      await signedLinkResponse(
        new Request(origin + "/api/files/" + attachments[0].id + "/link", {
          headers: { Cookie: otherCookie },
        }),
        attachments[0].id
      )
    ).status
  ).toBe(404)

  expect(
    await withFiles((db) =>
      db.linked({ userId: "other", role: "employee" }, "claim", claim.id)
    )
  ).toHaveLength(0)
  const own = await downloadFileResponse(
    new Request(origin + data.signedUrl, {
      headers: { Cookie: employeeCookie },
    }),
    attachments[0].id
  )
  expect(own.status).toBe(200)
  const other = await downloadFileResponse(
    new Request(origin + data.signedUrl, { headers: { Cookie: otherCookie } }),
    attachments[0].id
  )
  expect(other.status).toBe(403)
  const hrUrl = signedFileUrl(attachments[0].id, hrId)
  expect(
    (
      await downloadFileResponse(
        new Request(origin + hrUrl, { headers: { Cookie: hrCookie } }),
        attachments[0].id
      )
    ).status
  ).toBe(200)
})
test("virus detection prevents claim creation and does not upload to Drive", async () => {
  mocks.scan.mockRejectedValueOnce(
    new FileError("Antivirus rejected file", 422)
  )
  const response = await claims(
    formRequest(
      "/employee/emp-a/claims",
      employeeCookie,
      {
        year: "2026",
        month: "1",
        amountMinor: "500",
        receipt: "Receipt A",
        confirmed: "yes",
      },
      { name: "receipt.pdf", bytes: pdf }
    ),
    { params: Promise.resolve({ employeeId: "emp-a" }) }
  )
  expect(response.status).toBe(422)
  expect(mocks.put).not.toHaveBeenCalled()
  expect(await withPayroll((db) => db.getClaims("emp-a", 2026, 1))).toEqual([])
})
test("scanner outage blocks policy and sheet persistence", async () => {
  mocks.scan.mockRejectedValue(new FileError("Antivirus unavailable", 503))
  expect(
    (
      await documents(
        formRequest(
          "/hr/documents",
          hrCookie,
          { documentId: "policy", body: "Unique new policy" },
          { name: "policy.pdf", bytes: pdf }
        )
      )
    ).status
  ).toBe(503)
  expect(
    await withPayroll((db) => db.answerFromDocuments("Unique new policy"))
  ).toBeNull()
  expect(mocks.put).not.toHaveBeenCalled()
})
test("salary preview scans the original CSV, stores gzip in Drive and still requires explicit payroll commit", async () => {
  const csv = Buffer.from(
    "employeeId,year,month,annualCtcMinor,currency,unpaidLeaveDays,otherDeductionsMinor\nNEW-FILE,2026,1,1200000,INR,0,0"
  )
  const response = await preview(
    formRequest(
      "/hr/import/preview",
      hrCookie,
      {},
      { name: "salary.csv", bytes: csv, field: "sheet" }
    )
  )
  expect(response.status).toBe(200)
  const result = await response.json()
  expect(result.reviewUrl).toContain("/hr/import/review/")
  expect(result.signedUrl).toContain("signature=")
  expect(mocks.scan.mock.calls[0][0]).toEqual(csv)
  expect(await withPayroll((db) => db.get("NEW-FILE", 2026, 1))).toBeNull()
})
test("invalid salary data never reaches Drive even if antivirus passes", async () => {
  const response = await preview(
    formRequest(
      "/hr/import/preview",
      hrCookie,
      {},
      {
        name: "salary.csv",
        bytes: Buffer.from("wrong,headings\nA,1"),
        field: "sheet",
      }
    )
  )
  expect(response.status).toBe(422)
  expect((await response.json()).failures[0].message).toContain(
    "Required columns"
  )
  expect(mocks.put).not.toHaveBeenCalled()
})
test("CSRF and employee ownership are checked before scanner or Drive calls", async () => {
  expect(
    (
      await documents(
        formRequest(
          "/hr/documents",
          hrCookie,
          { documentId: "x", body: "x" },
          { name: "x.pdf", bytes: pdf },
          "https://evil.test"
        )
      )
    ).status
  ).toBe(403)
  expect(
    (
      await claims(formRequest("/employee/emp-b/claims", employeeCookie, {}), {
        params: Promise.resolve({ employeeId: "emp-b" }),
      })
    ).status
  ).toBe(403)
  expect(mocks.scan).not.toHaveBeenCalled()
  expect(mocks.put).not.toHaveBeenCalled()
})
test("a client cannot bypass mandatory browser encoding with a plaintext file", async () => {
  const response = await documents(
    formRequest(
      "/hr/documents",
      hrCookie,
      { documentId: "x" },
      { name: "x.pdf", bytes: pdf, compressed: false }
    )
  )
  expect(response.status).toBe(400)
  expect(mocks.put).not.toHaveBeenCalled()
})
test("modified Google Drive content fails the stored hash check", async () => {
  const response = await documents(
      formRequest(
        "/hr/documents",
        hrCookie,
        { documentId: "x" },
        { name: "x.pdf", bytes: pdf }
      )
    ),
    data = await response.json()
  const file = (
    await withFiles((db) =>
      db.linked({ userId: hrId, role: "hr" }, "document", "x")
    )
  )[0]
  mocks.files.set(file.driveId!, gzipSync(Buffer.from("changed")))
  expect(
    (
      await downloadFileResponse(
        new Request(origin + data.signedUrl, { headers: { Cookie: hrCookie } }),
        file.id
      )
    ).status
  ).toBe(409)
})
test("expired or tampered signed URLs fail before storage access", async () => {
  const id = randomUUID(),
    url = signedFileUrl(id, employeeId, Date.now() - 600000)
  expect(
    (
      await downloadFileResponse(
        new Request(origin + url, { headers: { Cookie: employeeCookie } }),
        id
      )
    ).status
  ).toBe(403)
  const tampered = signedFileUrl(id, employeeId).replace(
    "signature=",
    "signature=x"
  )
  expect(
    (
      await downloadFileResponse(
        new Request(origin + tampered, { headers: { Cookie: employeeCookie } }),
        id
      )
    ).status
  ).toBe(403)
})
