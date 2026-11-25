# Web search for the Research Helper (optional)

The Research Helper reads Wikipedia and Fandom wikis with no setup. For general web search, a web
app needs a small relay, because search sites don't let web pages call them directly. This folder
has one: a Cloudflare Worker that you run on your own free account. It stores nothing and nobody
else runs it for you.

## Set it up (about five minutes)

1. Sign up at [dash.cloudflare.com](https://dash.cloudflare.com) (free).
2. Go to **Workers & Pages → Create → Create Worker**, name it (for example `writing-search`), and
   press **Deploy**.
3. Press **Edit code**, replace everything with the contents of `search-worker.js`, and press
   **Deploy** again.
4. Optional but recommended: in the Worker's **Settings → Variables**, add `ALLOWED_ORIGIN` with
   the address you use the app at, for example `https://alex-lacy.github.io`. Then only your copy
   of the app can use your relay.
5. Copy the Worker's address (like `https://writing-search.your-name.workers.dev`), paste it into
   Writing Studio under **Settings → Models → Advanced: web search**, and press **Test**.

Cloudflare's free plan allows 100,000 requests a day, far more than research needs.

## What it does

- `GET /?q=words` returns up to 10 results from DuckDuckGo's plain HTML page: title, link, snippet.
- `GET /?url=https://…` returns a page's title and readable text.
