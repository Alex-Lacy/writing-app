# Writing Studio

AI chat plus creative-writing tools, as an installable web app. Works with any OpenAI-compatible API
(defaults to Featherless, https://api.featherless.ai/v1, 32K context cap).

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests
npm run build      # static site in dist/, host anywhere (Netlify, Cloudflare Pages, GitHub Pages…)
```

First launch opens Settings: paste your Featherless key, press **Test connection**, then **Pick models**,
search (e.g. `nemo 12b`), add a few, and give them nicknames.

`node dev/mock-server.mjs` starts a fake OpenAI-compatible server on http://localhost:8787/v1 for
testing without spending credits.

## Features

**Writing and chat**
- Any OpenAI-compatible provider; model picker with nicknames; per-chat system prompt, presets and sampling settings
- Streaming with Stop; reasoning shown in a collapsible block; thinking on/off/light/deep where the model allows
- Copy / Edit / Retry / Delete, versions (swipes ‹ 1/3 ›), Continue, Length control per reply
- Token meter and a Context view showing exactly what is sent, coloured by source

**Story panel (▤)**
- **Setup**: Background (always sent), Steering (sent near the end, pulls hardest), Style modules, Story tags,
  Global notes switch, Auto-summary, generation settings
- **Codex**: entries sent only when their names come up; each story has its own book, shared books live in the Library
- **Helper**: built-in assistants (New story, Story setup, Codex keeper, Style editor) and your own; they propose
  changes as cards you accept
- **Cliché Filter**: highlights stock AI phrases (95 rules, free), or rewrites the sentences they're in
  (Suggest / Auto); your own rules and word lists
- **Suggestions**: every proposed change with before/after, Accept / Edit / Reject / Undo; suggested updates to
  the notes every ~1,500 words of new story

**Per message**: Rewrite with your feedback (whole message as a new version, or a highlighted passage),
Proofread (consistency and facts; grammar too on your own messages). Highlight text to get the toolbar.

**Library**: shared Codex books (grouped by series, archive), Style modules, Global notes, Helpers.

**Export**: the story as Word, Markdown or text, with notes stripped and optional chapters at scene breaks.

**Look**: dark, black, light, sepia or system theme; story font, size, spacing and width; focus mode and
hideable sidebars. Everything is stored on the device (IndexedDB), with JSON backup and restore.

Side jobs use their own models (Settings → General → Advanced): by default DeepSeek V4 Pro for the Helper and Proofread,
DeepSeek V4.1 Flash for updates, summaries and the Cliché Filter, and the story model for rewrites.
