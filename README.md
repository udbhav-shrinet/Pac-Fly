# Fruit Fly Connectome Reddit Simulator

A single-page, dark-mode web app where a simplified simulated fruit fly
brain reads live Reddit posts and computes its own reactions. It's a real,
functioning app, not a mockup: plain HTML/CSS/JS, no build step, no API
keys, no paid services.

## How it works

The app fetches `https://www.reddit.com/r/{subreddit}/hot.json` directly
from the browser — Reddit's public, unauthenticated, read-only JSON
endpoint. Reddit doesn't always send a CORS header that allows that direct
browser fetch, so if it's blocked (or the request otherwise fails), the app
retries once through a free public CORS-passthrough proxy
(`api.allorigins.win`, no key, no cost) before giving up. If both attempts
fail, it falls back to a small built-in offline sample dataset
(`offline-data.js`). The status indicator reflects whichever path won:
**LIVE** for a real Reddit response (direct or proxied), or **OFFLINE
SAMPLE**. The app never breaks or looks empty.

Every post — live or offline — runs through the same brain pipeline
(`brain.js`), driven entirely by the post's real stats (title length,
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

- **Header** — subreddit search bar and a live/offline status indicator.
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

Any static file server works, e.g.:

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000`. No build step, no dependencies to install.

## Files

- `index.html` — page structure and layout.
- `styles.css` — dark-slate theme, 3D scene, gauges, tag chips.
- `brain.js` — the simulated fruit fly brain (pure functions, no DOM).
- `offline-data.js` — built-in offline sample dataset.
- `app.js` — Reddit fetch/fallback, feed navigation, sidebar rendering.
