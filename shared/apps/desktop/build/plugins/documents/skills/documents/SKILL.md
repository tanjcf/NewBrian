---
name: documents
description: Create, edit, inspect, and verify Word-compatible DOCX documents in the active codeCN workspace.
---
# Documents

- Work only inside the active workspace unless the user explicitly approves another location.
- Prefer DOCX for editable deliverables and preserve supplied structure, tables, headings, and Chinese text.
- Use available shell/runtime libraries to generate the file; never claim success from source code alone.
- After writing, verify the DOCX is a valid ZIP/OOXML file, reopen or extract its text, and report the real path and byte size.
- Keep generator scripts out of the final deliverable list unless the user asked for them.
