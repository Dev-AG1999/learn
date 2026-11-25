import { UploadStatus } from "./status.tsx"

export default async function UploadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <main className="workspace">
    <h1>Upload status</h1>
    <UploadStatus id={id} />
  </main>
}
