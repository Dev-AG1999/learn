import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  agentRules: false,
  serverExternalPackages: ["unpdf", "sharp", "better-sqlite3-multiple-ciphers"],
  outputFileTracingIncludes: {
    "/api/chat/attachments": ["./scripts/sanitize-upload-worker.mjs", "./scripts/pdf-extract-worker.mjs", "./node_modules/unpdf/**/*", "./node_modules/sharp/**/*", "./node_modules/@img/**/*"],
    "/api/chat": ["./scripts/pdf-extract-worker.mjs", "./node_modules/unpdf/**/*"],
    "/api/documents": ["./scripts/pdf-extract-worker.mjs", "./scripts/sanitize-upload-worker.mjs", "./node_modules/unpdf/**/*", "./node_modules/sharp/**/*", "./node_modules/@img/**/*"],
    "/hr/documents": [
      "./scripts/sanitize-upload-worker.mjs",
      "./node_modules/unpdf/**/*",
      "./node_modules/sharp/**/*",
      "./node_modules/@img/**/*",
    ],
    "/hr/import/preview": [
      "./scripts/sanitize-upload-worker.mjs",
      "./node_modules/unpdf/**/*",
      "./node_modules/sharp/**/*",
      "./node_modules/@img/**/*",
    ],
    "/employee/*/claims": [
      "./scripts/sanitize-upload-worker.mjs",
      "./node_modules/unpdf/**/*",
      "./node_modules/sharp/**/*",
      "./node_modules/@img/**/*",
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Content-Security-Policy",
            value:
              "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
          },
          // Preserve Origin on native form POSTs so strict CSRF validation works.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          ...(process.env.NODE_ENV === "production"
            ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }]
            : []),
        ],
      },
    ]
  },
}

export default nextConfig
