(function () {
  const els = {
    subForm: document.getElementById("sub-form"),
    subInput: document.getElementById("sub-input"),
    statusDot: document.getElementById("status-dot"),
    statusText: document.getElementById("status-text"),
    retryBtn: document.getElementById("retry-btn"),
    postCard: document.getElementById("post-card"),
    postMeta: document.getElementById("post-meta"),
    postTitle: document.getElementById("post-title"),
    postStats: document.getElementById("post-stats"),
    fly: document.getElementById("fly"),
    tagStrip: document.getElementById("tag-strip"),
    tagStripEmpty: document.getElementById("tag-strip-empty"),
    prevBtn: document.getElementById("prev-btn"),
    nextBtn: document.getElementById("next-btn"),
    autoplayBtn: document.getElementById("autoplay-btn"),
    postCounter: document.getElementById("post-counter"),
    stateValue: document.getElementById("state-value"),
    meanFreq: document.getElementById("mean-freq"),
    meanValence: document.getElementById("mean-valence"),
    vibeSummary: document.getElementById("vibe-summary"),
    liveEmotion: document.getElementById("live-emotion"),
    liveStress: document.getElementById("live-stress"),
    liveFeeling: document.getElementById("live-feeling"),
    visionReadout: document.getElementById("vision-readout"),
    compoundEye: document.getElementById("compound-eye"),
    hearingReadout: document.getElementById("hearing-readout"),
    hearingCanvas: document.getElementById("hearing-canvas"),
    smellReadout: document.getElementById("smell-readout"),
    plume: document.getElementById("plume"),
    logList: document.getElementById("log-list"),
    logEmpty: document.getElementById("log-empty"),
  };

  const MODULATORS = ["dopamine", "serotonin", "octopamine", "tyramine"];
  const MAX_TAGS = 60;

  let subreddit = "popular";
  let posts = [];
  let index = 0;
  let currentBrain = null;
  let tags = [];
  let autoplayTimer = null;
  let loadToken = 0;
  let activeAbortController = null;
  let isTransitioning = false;
  let retryTimer = null;
  let retryAttempt = 0;
  let retryDelayMs = 0;

  const INITIAL_RETRY_MS = 3000;
  const MAX_RETRY_MS = 30000;

  function describeError(err) {
    if (!err) return "unknown error";
    if (err.name === "AbortError") return "timed out";
    const msg = err.message || String(err);
    if (/Failed to fetch|NetworkError|TypeError/i.test(msg)) {
      return "network/CORS blocked";
    }
    return msg;
  }

  function normalizePost(d) {
    return {
      title: d.title || "(untitled)",
      score: typeof d.score === "number" ? d.score : 0,
      num_comments: typeof d.num_comments === "number" ? d.num_comments : 0,
      upvote_ratio:
        typeof d.upvote_ratio === "number" ? d.upvote_ratio : 0.85,
      selftext: d.selftext || "",
    };
  }

  // Wraps fetch() with its own timeout while still honoring an outer
  // "cancel everything for this load" signal (used when a newer subreddit
  // request supersedes this one).
  function fetchWithTimeout(url, outerSignal, timeoutMs) {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (outerSignal.aborted) controller.abort();
    else outerSignal.addEventListener("abort", onAbort);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    }).finally(() => {
      clearTimeout(timer);
      outerSignal.removeEventListener("abort", onAbort);
    });
  }

  function parseRedditJson(json) {
    const children = (json && json.data && json.data.children) || [];
    if (!children.length) throw new Error("empty response");
    return children.map((c) => normalizePost(c.data));
  }

  function redditUrl(sub) {
    return (
      "https://www.reddit.com/r/" +
      encodeURIComponent(sub) +
      "/hot.json?limit=15&raw_json=1"
    );
  }

  // Attempt 0: a same-origin serverless function (api/reddit.js) that
  // fetches Reddit server-side, where CORS does not apply at all. This is
  // the reliable path, but only exists when this site is deployed on
  // Vercel (or another host running that function) — when it's not
  // present (e.g. a plain static file server, or file:// locally), this
  // 404s immediately and falls straight through to the attempts below.
  async function fetchViaServerlessProxy(sub, outerSignal) {
    try {
      const res = await fetchWithTimeout(
        "/api/reddit?sub=" + encodeURIComponent(sub),
        outerSignal,
        6000
      );
      if (!res.ok) throw new Error("HTTP " + res.status);
      return parseRedditJson(await res.json());
    } catch (err) {
      console.warn("[FlyBrain] serverless proxy fetch failed:", err);
      throw err;
    }
  }

  // Attempt 1: fetch Reddit's public JSON endpoint directly from the
  // browser. This works when Reddit's response includes a permissive CORS
  // header for the requesting origin; it does not always.
  async function fetchDirect(sub, outerSignal) {
    try {
      const res = await fetchWithTimeout(redditUrl(sub), outerSignal, 5000);
      if (!res.ok) throw new Error("HTTP " + res.status);
      return parseRedditJson(await res.json());
    } catch (err) {
      console.warn("[FlyBrain] direct Reddit fetch failed:", err);
      throw err;
    }
  }

  // Attempt 2+: the same public, unauthenticated Reddit endpoint, relayed
  // through free public CORS-passthrough proxies (no key, no cost) for
  // browsers that Reddit's own CORS policy blocks directly. Any single
  // public proxy can be down or rate-limited on its own, so several
  // independent ones are tried in sequence before giving up.
  const PROXY_URL_BUILDERS = [
    (target) => "https://api.allorigins.win/raw?url=" + encodeURIComponent(target),
    (target) => "https://corsproxy.io/?url=" + encodeURIComponent(target),
    (target) => "https://api.codetabs.com/v1/proxy?quest=" + encodeURIComponent(target),
  ];

  async function fetchViaProxies(sub, outerSignal) {
    const target = redditUrl(sub);
    let lastErr = new Error("no proxy attempted");
    for (const buildUrl of PROXY_URL_BUILDERS) {
      const proxyUrl = buildUrl(target);
      try {
        const res = await fetchWithTimeout(proxyUrl, outerSignal, 6000);
        if (!res.ok) throw new Error("HTTP " + res.status);
        return parseRedditJson(await res.json());
      } catch (err) {
        console.warn("[FlyBrain] proxy fetch failed (" + proxyUrl + "):", err);
        lastErr = err;
      }
    }
    throw lastErr;
  }

  function setStatus(mode, text) {
    els.statusDot.className = "status-dot " + mode;
    els.statusText.textContent = text;
  }

  // Loads a subreddit's feed. Guarded against races: if the user submits a
  // new subreddit while an older attempt is still in flight or retrying,
  // the older attempt's result is discarded when it lands.
  //
  // There is no offline sample data: a failed fetch (direct + every proxy)
  // is not a dead end, it's a reason to keep trying. The app retries
  // automatically with exponential backoff — visibly, with a live status
  // and a manual "Retry Now" button — until a real Reddit response comes
  // back, live data always wins over nothing.
  function loadSubreddit(sub) {
    subreddit = sub;
    stopAutoplay();
    clearTimeout(retryTimer);

    loadToken += 1;
    retryAttempt = 0;
    retryDelayMs = INITIAL_RETRY_MS;

    posts = [];
    index = 0;
    tags = [];
    renderTagStrip();
    renderLog();
    updateSidebar();

    attemptFetch(sub, loadToken);
  }

  async function attemptFetch(sub, myToken) {
    if (myToken !== loadToken) return; // superseded by a newer request

    if (activeAbortController) activeAbortController.abort();
    const controller = new AbortController();
    activeAbortController = controller;

    retryAttempt += 1;
    const attemptLabel =
      retryAttempt === 1 ? "" : " (retry " + (retryAttempt - 1) + ")";
    setStatus("loading", "Connecting to r/" + sub + attemptLabel + "…");
    if (retryAttempt === 1) {
      els.postTitle.textContent = "Loading feed…";
      els.postMeta.textContent = "r/" + sub + " · loading…";
      els.postStats.textContent = "";
    }

    let fetched;
    let lastErr;
    try {
      fetched = await fetchViaServerlessProxy(sub, controller.signal);
    } catch (serverlessErr) {
      lastErr = serverlessErr;
      try {
        fetched = await fetchDirect(sub, controller.signal);
        lastErr = null;
      } catch (directErr) {
        lastErr = directErr;
        try {
          fetched = await fetchViaProxies(sub, controller.signal);
          lastErr = null;
        } catch (proxyErr) {
          lastErr = proxyErr;
        }
      }
    }

    if (myToken !== loadToken) return; // superseded while this was in flight

    if (fetched) {
      posts = fetched;
      retryAttempt = 0;
      retryDelayMs = INITIAL_RETRY_MS;
      setStatus("live", "LIVE · r/" + sub);
      index = 0;
      tags = [];
      renderTagStrip();
      renderLog();
      updateSidebar();
      showPost();
      return;
    }

    const reason = describeError(lastErr);
    const waitSec = Math.round(retryDelayMs / 1000);
    console.warn(
      "[FlyBrain] live fetch attempt " + retryAttempt + " failed (" + reason + "), retrying in " + waitSec + "s"
    );
    setStatus(
      "offline",
      "RETRYING · " + reason + " · next try in " + waitSec + "s"
    );
    els.postTitle.textContent = "Waiting for live Reddit data…";
    els.postMeta.textContent = "r/" + sub + " · fetch failed: " + reason;
    els.postStats.textContent =
      "Attempt " + retryAttempt + " · retrying automatically, or use Retry Now.";

    retryTimer = setTimeout(() => {
      retryDelayMs = Math.min(retryDelayMs * 2, MAX_RETRY_MS);
      attemptFetch(sub, myToken);
    }, retryDelayMs);
  }

  function retryNow() {
    clearTimeout(retryTimer);
    retryDelayMs = INITIAL_RETRY_MS;
    attemptFetch(subreddit, loadToken);
  }

  function showPost() {
    const post = posts[index];
    if (!post) return;
    currentBrain = FlyBrain.analyzePost(post);

    els.postMeta.textContent = "r/" + subreddit + " · post " + (index + 1);
    els.postTitle.textContent = post.title;
    els.postStats.textContent =
      "▲ " +
      post.score +
      "  ·  💬 " +
      post.num_comments +
      "  ·  " +
      Math.round(post.upvote_ratio * 100) +
      "% upvoted";
    els.postCounter.textContent = index + 1 + " / " + posts.length;

    renderLiveReadout(post, currentBrain);
    renderSenses(post, currentBrain);
  }

  function fmtPct(x) {
    return Math.round(x * 100) + "%";
  }
  function fmtSigned(x) {
    return (x >= 0 ? "+" : "") + x.toFixed(2);
  }

  function restartAnimation(el, className) {
    el.classList.remove(className);
    void el.offsetWidth; // force reflow so the animation can replay
    el.classList.add(className);
  }

  function triggerFlyReaction(motor) {
    const cls = "react-" + motor;
    ["react-approach", "react-evade", "react-groom", "react-forage"].forEach(
      (c) => els.fly.classList.remove(c)
    );
    restartAnimation(els.fly, cls);
    setTimeout(() => els.fly.classList.remove(cls), 900);
  }

  function triggerFlyGlance() {
    restartAnimation(els.fly, "glance");
    setTimeout(() => els.fly.classList.remove("glance"), 500);
  }

  /* ---------------- Currently Sensing (live pills) ---------------- */

  function renderLiveReadout(post, brain) {
    const c = FlyBrain.classify(brain);
    els.liveEmotion.textContent = c.emotion;
    els.liveEmotion.className = "live-pill emo-" + c.emotion.toLowerCase();
    els.liveStress.textContent = c.stress;
    els.liveStress.className =
      "live-pill stress-" + c.stress.split(" ")[0].toLowerCase();
    els.liveFeeling.textContent = c.feeling;
    els.liveFeeling.className =
      "live-pill feel-" + c.feeling.toLowerCase();
  }

  /* ---------------- Senses: Vision / Hearing / Smell ---------------- */

  function renderSenses(post, brain) {
    renderVision(post, brain);
    renderHearing(brain);
    renderSmell(post, brain);
  }

  function renderVision(post, brain) {
    const c = FlyBrain.classify(brain);
    els.visionReadout.textContent =
      "Mosaic of a " +
      brain.titleLen +
      "-char headline · " +
      c.vision +
      " · " +
      (brain.dominantChannel === "sweet" ? "green-tinted" : "amber-tinted") +
      " facets";

    els.compoundEye.innerHTML = "";
    const title = post.title;
    const hue = brain.dominantChannel === "sweet" ? 145 : 32;
    for (let i = 0; i < 18; i++) {
      const cell = document.createElement("div");
      cell.className = "eye-cell";
      cell.style.setProperty(
        "--tint",
        "hsl(" + hue + "deg 70% " + (40 + (i % 4) * 6) + "%)"
      );
      cell.style.filter = "hue-rotate(" + i * 6 + "deg) saturate(1.3)";
      const span = document.createElement("span");
      span.textContent = title;
      span.style.marginLeft = -((i * 41) % 240) + "px";
      cell.appendChild(span);
      els.compoundEye.appendChild(cell);
    }
  }

  function renderHearing(brain) {
    const c = FlyBrain.classify(brain);
    els.hearingReadout.textContent =
      Math.round(brain.spikeFreq) +
      " Hz chatter · " +
      c.hearing +
      (brain.arousalHits > 0
        ? " · " + Math.round(brain.arousalHits) + " urgent cue(s)"
        : " · steady murmur");
  }

  let hearingPhase = 0;
  function drawHearingFrame() {
    const canvas = els.hearingCanvas;
    const ctx = canvas.getContext("2d");
    const brain = currentBrain;
    const freq = brain ? brain.spikeFreq : 20;
    const amp = brain ? 8 + brain.arousalHits * 5 : 6;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#3ddcff";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    const w = canvas.width;
    const h = canvas.height;
    const mid = h / 2;
    const speed = freq / 900;
    for (let x = 0; x < w; x++) {
      const envelope = Math.sin((x / w) * Math.PI);
      const y = mid + Math.sin(x * speed + hearingPhase) * amp * envelope;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    hearingPhase += 0.12 + freq / 600;
    requestAnimationFrame(drawHearingFrame);
  }

  function renderSmell(post, brain) {
    const c = FlyBrain.classify(brain);
    const cues =
      brain.dominantChannel === "sweet"
        ? brain.rewardMatches
        : brain.threatMatches;
    els.smellReadout.textContent =
      c.smell +
      " · " +
      (cues.length ? "cues: " + cues.slice(0, 3).join(", ") : "no strong keyword cues");

    els.plume.innerHTML = "";
    const sweetCount = Math.round(4 + brain.sweet * 12);
    const geosminCount = Math.round(4 + brain.geosmin * 12);
    for (let i = 0; i < sweetCount; i++) spawnParticle("sweet");
    for (let i = 0; i < geosminCount; i++) spawnParticle("geosmin");
  }

  function spawnParticle(kind) {
    const p = document.createElement("div");
    p.className = "plume-particle " + kind;
    p.style.left = Math.random() * 92 + "%";
    p.style.animationDuration = 1.8 + Math.random() * 1.8 + "s";
    p.style.animationDelay = Math.random() * 2 + "s";
    els.plume.appendChild(p);
  }

  /* ---------------- Tag strip (phone-side stickers) ---------------- */

  function renderTagStrip() {
    els.tagStrip.innerHTML = "";
    if (!tags.length) {
      els.tagStrip.appendChild(els.tagStripEmpty);
      return;
    }
    tags
      .slice()
      .reverse()
      .forEach((entry) => els.tagStrip.appendChild(buildChip(entry)));
  }

  function buildChip(entry) {
    const b = entry.brain;
    const chip = document.createElement("div");
    chip.className = "tag-chip motor-" + b.motor;

    const title = document.createElement("div");
    title.className = "chip-title";
    title.textContent = entry.post.title;
    chip.appendChild(title);

    const freq = document.createElement("span");
    freq.textContent = "🔊 " + Math.round(b.spikeFreq) + "Hz";
    chip.appendChild(freq);

    const valence = document.createElement("span");
    valence.className = b.valence >= 0 ? "val-pos" : "val-neg";
    valence.textContent = "MB " + fmtSigned(b.valence);
    chip.appendChild(valence);

    const channel = document.createElement("span");
    channel.textContent =
      b.dominantChannel === "sweet" ? "🍯 SWEET" : "☠ GEOSMIN";
    chip.appendChild(channel);

    const oct = document.createElement("span");
    oct.textContent = "OA " + fmtPct(b.octopamine);
    chip.appendChild(oct);

    const motor = document.createElement("div");
    motor.className = "chip-motor";
    motor.textContent = "→ " + b.motorLabel;
    chip.appendChild(motor);

    return chip;
  }

  /* ---------------- Scan log (full tag set per post) ---------------- */

  function renderLog() {
    els.logList.innerHTML = "";
    if (!tags.length) {
      els.logList.appendChild(els.logEmpty);
      return;
    }
    tags
      .slice()
      .reverse()
      .forEach((entry) => els.logList.appendChild(buildLogRow(entry)));
  }

  function buildLogRow(entry) {
    const b = entry.brain;
    const c = FlyBrain.classify(b);
    const row = document.createElement("div");
    row.className = "log-row motor-" + b.motor;

    const header = document.createElement("div");
    header.className = "log-row-header";
    const title = document.createElement("span");
    title.className = "log-row-title";
    title.textContent = entry.post.title;
    const motor = document.createElement("span");
    motor.className = "log-row-motor";
    motor.textContent = "→ " + b.motorLabel;
    header.appendChild(title);
    header.appendChild(motor);
    row.appendChild(header);

    const tagsRow = document.createElement("div");
    tagsRow.className = "log-row-tags";

    const hormoneTag = document.createElement("span");
    hormoneTag.className = "log-tag";
    hormoneTag.textContent =
      "DA " + fmtPct(b.dopamine) +
      " · 5HT " + fmtPct(b.serotonin) +
      " · OA " + fmtPct(b.octopamine) +
      " · TY " + fmtPct(b.tyramine);
    tagsRow.appendChild(hormoneTag);

    const emotionTag = document.createElement("span");
    emotionTag.className = "log-tag tag-emotion";
    emotionTag.textContent = "😶 " + c.emotion;
    tagsRow.appendChild(emotionTag);

    const feelingTag = document.createElement("span");
    feelingTag.className =
      "log-tag tag-feeling " +
      (b.valence > 0.15 ? "pos" : b.valence < -0.15 ? "neg" : "");
    feelingTag.textContent = "Feeling: " + c.feeling;
    tagsRow.appendChild(feelingTag);

    const stressTag = document.createElement("span");
    stressTag.className = "log-tag tag-stress";
    stressTag.textContent = c.stress;
    tagsRow.appendChild(stressTag);

    const sensesTag = document.createElement("span");
    sensesTag.className = "log-tag tag-senses";
    sensesTag.textContent =
      "👁 " + c.vision + "  🔊 " + c.hearing + "  👃 " + c.smell;
    tagsRow.appendChild(sensesTag);

    row.appendChild(tagsRow);
    return row;
  }

  /* ---------------- Sidebar vitals + field report ---------------- */

  function updateSidebar() {
    if (!tags.length) {
      MODULATORS.forEach((m) => {
        document.getElementById("fill-" + m).style.width = "0%";
        document.getElementById("val-" + m).textContent = "—";
      });
      els.stateValue.textContent = "—";
      els.meanFreq.textContent = "— Hz";
      els.meanValence.textContent = "—";
      els.vibeSummary.textContent =
        "Scan a subreddit and swipe through posts to generate a field report…";
      return;
    }

    const means = { dopamine: 0, serotonin: 0, octopamine: 0, tyramine: 0 };
    let freqSum = 0;
    let valenceSum = 0;
    let sweetCount = 0;
    const motorCounts = { approach: 0, evade: 0, groom: 0, forage: 0 };

    tags.forEach(({ brain }) => {
      MODULATORS.forEach((m) => (means[m] += brain[m]));
      freqSum += brain.spikeFreq;
      valenceSum += brain.valence;
      if (brain.dominantChannel === "sweet") sweetCount++;
      motorCounts[brain.motor]++;
    });

    const n = tags.length;
    MODULATORS.forEach((m) => (means[m] /= n));
    const meanFreq = freqSum / n;
    const meanValence = valenceSum / n;

    MODULATORS.forEach((m) => {
      document.getElementById("fill-" + m).style.width = fmtPct(means[m]);
      document.getElementById("val-" + m).textContent = fmtPct(means[m]);
    });

    const state = FlyBrain.aggregateState(means);
    els.stateValue.textContent = state;
    els.meanFreq.textContent = Math.round(meanFreq) + " Hz";
    els.meanValence.textContent = fmtSigned(meanValence);

    els.vibeSummary.textContent = buildVibeSummary({
      n,
      sweetCount,
      motorCounts,
      state,
      meanFreq,
      meanValence,
      means,
    });
  }

  const STATE_EMOJI = {
    "Predator Evasion": "🚨",
    Foraging: "🍯",
    Resting: "😴",
    Grooming: "🪶",
    Locomotion: "🚶",
  };

  function buildVibeSummary(agg) {
    const { n, sweetCount, motorCounts, state, meanFreq, meanValence, means } =
      agg;
    const sweetPct = Math.round((sweetCount / n) * 100);
    const geosminPct = 100 - sweetPct;

    let dominantMotorKey = "forage";
    let best = -1;
    Object.keys(motorCounts).forEach((k) => {
      if (motorCounts[k] > best) {
        best = motorCounts[k];
        dominantMotorKey = k;
      }
    });
    const motorNames = {
      approach: "Proboscis Extension (approach)",
      evade: "Tergotrochanteral evasion",
      groom: "Grooming",
      forage: "Foraging Scan",
    };
    const motorPct = Math.round((motorCounts[dominantMotorKey] / n) * 100);

    const tone =
      meanValence > 0.15
        ? "a broadly positive"
        : meanValence < -0.15
        ? "a broadly negative"
        : "a mixed, ambivalent";
    const arousal = meanFreq > 90 ? "high" : meanFreq > 45 ? "moderate" : "low";
    const emoji = STATE_EMOJI[state] || "🪰";

    const verdict =
      state === "Predator Evasion"
        ? "The fly keeps flinching off the glass — this feed reads like a minefield."
        : state === "Foraging"
        ? "The fly keeps creeping its proboscis toward the screen, hunting for the next reward hit."
        : state === "Resting"
        ? "The fly has mostly settled, wings folded, barely twitching at the scroll."
        : state === "Grooming"
        ? "The fly keeps pausing to groom itself between posts — a self-soothing, low-stakes feed."
        : "The fly just keeps pacing the glass, neither drawn in nor repelled.";

    return (
      emoji +
      " r/" +
      subreddit +
      " currently reads as " +
      state +
      " to the simulated fly. Of " +
      n +
      " posts scanned, " +
      sweetPct +
      "% lit up the sweet/appetitive antennal-lobe channel and " +
      geosminPct +
      "% triggered a geosmin/aversive alarm. Mean mushroom-body valence sits at " +
      fmtSigned(meanValence) +
      ", suggesting " +
      tone +
      " emotional tone, with " +
      arousal +
      " auditory arousal (mean spike frequency " +
      Math.round(meanFreq) +
      " Hz) and octopamine averaging " +
      fmtPct(means.octopamine) +
      ". Its dominant motor response was " +
      motorNames[dominantMotorKey] +
      " (" +
      motorPct +
      "% of posts). " +
      verdict
    );
  }

  /* ---------------- Navigation ---------------- */

  // Every post change scrolls the phone card off-screen (as if the feed
  // were swiped) before the next post scrolls in, so the fly visibly sees
  // each post pass rather than having the content snap instantly.
  const SCROLL_MS = 240;

  function navigateTo(newIndex, tag) {
    if (!posts.length || isTransitioning) return;
    isTransitioning = true;

    els.postCard.classList.add("scroll-out");
    setTimeout(() => {
      if (tag && currentBrain) {
        tags.push({ post: posts[index], brain: currentBrain });
        if (tags.length > MAX_TAGS) tags.shift();
        renderTagStrip();
        renderLog();
        triggerFlyReaction(currentBrain.motor);
        updateSidebar();
      } else {
        triggerFlyGlance();
      }

      index = newIndex;
      showPost();

      els.postCard.classList.remove("scroll-out");
      els.postCard.classList.add("scroll-in");
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          els.postCard.classList.remove("scroll-in");
          isTransitioning = false;
        });
      });
    }, SCROLL_MS);
  }

  function tagAndAdvance() {
    if (!posts.length || !currentBrain) return;
    navigateTo((index + 1) % posts.length, true);
  }

  function goPrev() {
    if (!posts.length) return;
    navigateTo((index - 1 + posts.length) % posts.length, false);
  }

  function stopAutoplay() {
    if (autoplayTimer) {
      clearInterval(autoplayTimer);
      autoplayTimer = null;
    }
    els.autoplayBtn.setAttribute("aria-pressed", "false");
    els.autoplayBtn.textContent = "▶ Auto-Swipe";
  }

  function startAutoplay() {
    autoplayTimer = setInterval(tagAndAdvance, 3200);
    els.autoplayBtn.setAttribute("aria-pressed", "true");
    els.autoplayBtn.textContent = "⏸ Stop";
  }

  els.subForm.addEventListener("submit", (e) => {
    e.preventDefault();
    let value = els.subInput.value.trim().replace(/^r\//i, "");
    value = value.replace(/[^a-zA-Z0-9_]/g, "");
    if (!value) value = "popular";
    els.subInput.value = value;
    loadSubreddit(value);
  });

  els.retryBtn.addEventListener("click", retryNow);
  els.nextBtn.addEventListener("click", tagAndAdvance);
  els.prevBtn.addEventListener("click", goPrev);
  els.autoplayBtn.addEventListener("click", () => {
    if (autoplayTimer) stopAutoplay();
    else startAutoplay();
  });

  requestAnimationFrame(drawHearingFrame);
  loadSubreddit(subreddit);
})();
