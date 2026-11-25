# Writing Studio

AI chat plus creative-writing tools, as an installable web app. Works with any OpenAI-compatible API
(defaults to Featherless, https://api.featherless.ai/v1, 32K context cap).

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (context builder, reasoning splitter)
npm run build      # static site in dist/, host anywhere (Netlify, Cloudflare Pages, GitHub Pages…)
```

First launch opens Settings: paste your Featherless key, press **Test connection**, then **Pick models**,
search (e.g. `nemo 12b`), add a few, and give them nicknames.

`node dev/mock-server.mjs` starts a fake OpenAI-compatible server on http://localhost:8787/v1 for
testing without spending credits.

## Phase 1 features

- Model picker with nicknames, default model, per-model context length (effective limit = min(model, provider cap))
- Per-chat system prompt, saved presets, per-chat sampling params (temp, top-p, min-p, top-k, rep/freq/presence penalties)
- Streaming with Stop; reasoning shown in a collapsible block (`reasoning_content` field or inline `<think>` tags)
- Copy / Edit / Retry / Delete on every message, Delete-to-end, Save-&-regenerate for edited user messages
- Swipes: alternate replies with ‹ 1/3 ›; › on the last reply generates a new version
- "Add" inserts a message without generating; sending an empty box just generates the next reply
- Writing toggle per chat: Memory (top of context) and Author's Note (configurable depth, as a system message or inline)
- Token meter and a Context view showing exactly what is sent; messages that no longer fit are greyed out
- Everything stored locally in IndexedDB; JSON export/import (API keys excluded)
- Responsive phone layout; web manifest included (offline service worker comes in Phase 3)
