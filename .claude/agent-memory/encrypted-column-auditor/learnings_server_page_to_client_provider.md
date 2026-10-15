---
name: server-page-to-client-provider
description: How to audit a dashboard section whose encrypted rows are read in a server component and decrypted in a client provider
metadata:
  type: reference
---

A content read does not have to be in `app/api/`. The dashboard reads `sessions` rows in the server component (`app/(app)/dashboard/page.tsx`) and hands them, untouched, to a `'use client'` provider that decrypts them. To audit this shape:

- In the server component, list every use of the rows variable. Only `.length` (a row count) and passing it on as a prop are safe; any `.map`/`.filter`/`.reduce` over a content column is a finding.
- A `'use client'` component is still rendered on the server for the first HTML. So the render body of the provider runs server-side with the ciphertext rows: check that everything outside `useEffect` either branches on `isEncryptedBlob` first or only touches plaintext columns. The decrypt itself must be inside an effect (no key exists on the server).
- For `sessions`, the kind of a row (saved session vs automatic backup) lives inside the blob (`auto: true`), and the `name`/`description` columns are written empty for encrypted rows. So any count that separates the two, and any name shown, must come from the decrypted payload; a server-side count can only be labelled as both together.
- Follow the delete path too: the route only needs `id` + `user_id`, so it should have no `.select()` at all.
