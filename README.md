# Fruit Fly Connectome Reddit Simulator

A single-page, dark-mode web app where a simplified simulated fruit fly
brain reads live Reddit posts and computes its own reactions. It's a real,
functioning app, not a mockup: plain HTML/CSS/JS front end, no API keys,
no paid services, and one tiny serverless function.

## How it works

The primary fetch path is a same-origin serverless function,
[`api/reddit.js`](api/reddit.js), that fetches
`https://www.reddit.com/r/{subreddit}/hot.json` — Reddit's public,
unauthenticated, read-only JSON endpoint — **server-side**. CORS is a
browser-only restriction, so a server fetching Reddit directly is never
blocked by it; this is what makes live data reliable. The front end calls
`/api/reddit?sub={subreddit}` at its own origin, no CORS involved at all.

That function only runs where it's deployed (see **Deploy**, below). When
it isn't present — running the front end off a plain static file server,
or opening `index.html` directly — that call 404s immediately and the app
falls straight through to a browser-side fallback chain: a direct fetch to
Reddit (works only if Reddit happens to send a permissive CORS header),
then a short chain of free public CORS-passthrough proxies
(`api.allorigins.win`, `corsproxy.io`, `api.codetabs.com` — no keys, no
cost), since any single public proxy can be down or rate-limited on its
own.

There is no offline sample data and no canned fallback content — this is a
live-data-only app. If every attempt fails, the app does not go dead: it
shows **RETRYING** with the actual failure reason (e.g. "network/CORS
blocked", an HTTP status, or "timed out") and automatically retries with
exponential backoff (3s, 6s, 12s, up to a 30s cap) until a real Reddit
response comes back — live data always wins over nothing. A **Retry Now**
button next to the status indicator forces an immediate attempt instead of
waiting out the backoff. Once a fetch succeeds, the status switches to
**LIVE**.

Every post runs through the same brain pipeline (`brain.js`), driven
entirely by the post's real stats (title length,
score, comment count, upvote ratio) and text (via a small reward/threat/
arousal keyword lexicon). Nothing is hardcoded per post:

1. **Antennal lobe** — two "smell" channels: sweet/appetitive vs.
   geosmin/aversive, from keyword hits plus engagement.
2. **Mushroom body** — a weighted sum through a sigmoid produces a
   valence score from -1 to +1 (the reward/learning signal).
3. **Hearing** — raw spike frequency (Hz) from title length, arousal
   words, and comment engagement.
4. **Neuromodulators** — dopamine, serotonin, octopamine, and tyramine,
   each a function of the above plus a small random noise term, since
   real neurons are stochastic.
5. **Decision layer** — a motor output (Proboscis Extension/approach,
   Tergotrochanteral evasion, Grooming, or Foraging Scan) chosen by
   comparing computed values against thresholds with noise, so
   borderline posts can tip either way.
6. **Behavioral state machine** — aggregates the neuromodulator averages
   across all tagged posts to pick an overall state: Foraging, Predator
   Evasion, Resting, Locomotion, or Grooming.

## Interface

- **Header** — subreddit search bar, a status indicator (LIVE / connecting /
  retrying), and a Retry Now button.
- **Scene (top-left)** — a stylized, CSS-3D fruit fly watching a
  smartphone. The phone screen shows one Reddit post at a time; clicking
  Next (or Auto-Swipe) "tags" the post with color-coded stickers of the
  fly's computed reaction (spike frequency, mushroom-body valence,
  dominant antennal-lobe channel, octopamine level, motor output) and
  plays a matching reaction animation on the fly.
- **Sidebar (top-right)** — a "Currently Sensing" live readout (emotion,
  stress, feeling) for the post on screen right now, plus four
  neuromodulator gauges, the aggregate behavioral state, mean spike
  frequency, and mean valence, all averaged across every tagged post.
- **Senses row** — three real-time panels showing exactly what the fly
  is perceiving about the *current* post, updated the instant it appears
  (before it's even tagged): **Vision** renders the headline as a
  fragmented compound-eye mosaic; **Hearing** draws a live oscilloscope
  trace whose frequency and amplitude track the computed spike rate;
  **Smell** animates a rising particle plume of sweet (green) vs.
  geosmin (orange) cues, with the actual keywords detected.
- **Scan log** — every tagged post, newest first, with its full tag set:
  hormone snapshot, emotional state, feeling (sentiment), stress level,
  and a senses summary (vision/hearing/smell descriptors), next to its
  motor output.
- **Fly Field Report** — an auto-generated, slightly narrative summary
  (full width, bottom) of the subreddit's overall "vibe" based entirely
  on the aggregated tags and the fly's behavioral state.

## Run

For the front end alone (no reliable live fetch, since `/api/reddit`
won't exist — it'll fall through to the browser-side chain):

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000`.

## Deploy

For live fetch to actually work reliably, deploy to
[Vercel](https://vercel.com) (free Hobby tier covers this): import this
repository as a new project. Vercel auto-detects the `api/` directory as
a serverless function with zero configuration — no build step, no
framework, nothing to set up. Every push to the deployed branch updates
both the static site and the function together.

## Files

- `index.html` — page structure and layout.
- `styles.css` — dark-slate theme, 3D scene, gauges, tag chips.
- `brain.js` — the simulated fruit fly brain (pure functions, no DOM).
- `app.js` — Reddit fetch/retry, feed navigation, sidebar rendering.
- `api/reddit.js` — the serverless function that fetches Reddit
  server-side, sidestepping CORS entirely.
