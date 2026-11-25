# End-to-end checks

Playwright scripts that drive the app in Chrome against the mock server. Run from a folder where
`playwright-core` is installed, with `npm run dev` (port 5173) and `node dev/mock-server.mjs` running.
Set `CHROME` to your Chrome or Chromium binary if it isn't `/usr/bin/google-chrome`.

- `p2.mjs`: New story Helper, cards, Codex, suggested updates, Library, context view
- `p3.mjs`: Cliché Filter, selection Rewrite, whole-message Rewrite, Proofread, Auto mode, Export
- `attach.mjs`: image and text-file attachments
- `mobile.mjs`: phone layout screenshots
- `offline.mjs`: first launch offline (needs `npx vite preview --port 4173 --host localhost` on a build)
- `capture.mjs`: records the exact requests each side job sends (start the mock with `STORY_FILE=<a story>.txt`
  and type `LIVESTORY` to get that story back), for replaying against a real provider
