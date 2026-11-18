# AI is deferred

The current milestone is compression, malware scanning, private Google Drive
storage and signed downloads **inside the existing upload forms**. See
[SECURE_UPLOADS.md](SECURE_UPLOADS.md) for the implemented workflow and setup.

Earlier AI provider/retrieval code is retained as deferred scaffolding. Public AI
routes are disabled, old assistant pages redirect to the existing dashboard, and
no assistant or Files navigation tabs are added. Do not follow the previous S3
setup: AWS SDK/storage usage has been removed.

After this milestone is reviewed and committed, the future document assistant can
consume authorized, scan-passed files from Drive. Ollama local inference remains
the proposed free-model option; it is not called during uploads. No file, image,
policy text or salary sheet is sent to an AI provider in the current workflow.
