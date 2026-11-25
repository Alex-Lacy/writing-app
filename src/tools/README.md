# Tools (Phase 2+)

Each tool is a self-contained folder that talks to the rest of the app only through:

- `store/store.ts` actions (read messages, edit a swipe, add a message)
- `context/build.ts` contributors (return `ContextBlock[]`)
- `providers/openai.ts` `complete()` for one-shot model calls

Planned folders: `lorebook/`, `condense/`, `compile/`, `slopSlayer/`, `search/`.
See ../../ARCHITECTURE.md.
