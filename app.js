(function () {
  const els = {
    subForm: document.getElementById("sub-form"),
    subInput: document.getElementById("sub-input"),
    statusDot: document.getElementById("status-dot"),
    statusText: document.getElementById("status-text"),
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
  };

  const MODULATORS = ["dopamine", "serotonin", "octopamine", "tyramine"];

  let subreddit = "popular";
  let posts = [];
  let index = 0;
  let tags = [];
  let autoplayTimer = null;
  const MAX_TAGS = 60;

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

  async function fetchSubreddit(sub) {
    const url =
      "https://www.reddit.com/r/" +
      encodeURIComponent(sub) +
      "/hot.json?limit=15&raw_json=1";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const json = await res.json();
      const children = (json && json.data && json.data.children) || [];
      if (!children.length) throw new Error("empty response");
      return children.map((c) => normalizePost(c.data));
    } finally {
      clearTimeout(timer);
    }
  }

  function setStatus(mode, text) {
    els.statusDot.className = "status-dot " + mode;
    els.statusText.textContent = text;
  }

  async function loadSubreddit(sub) {
    subreddit = sub;
    stopAutoplay();
    setStatus("loading", "Connecting to r/" + sub + "…");
    els.postTitle.textContent = "Loading feed…";
    els.postMeta.textContent = "r/" + sub + " · loading…";
    els.postStats.textContent = "";

    try {
      posts = await fetchSubreddit(sub);
      setStatus("live", "LIVE · r/" + sub);
    } catch (err) {
      posts = OFFLINE_POSTS.slice();
      setStatus("offline", "OFFLINE SAMPLE · live fetch failed");
    }

    index = 0;
    tags = [];
    renderTagStrip();
    updateSidebar();
    renderPhone();
  }

  function renderPhone() {
    const post = posts[index];
    if (!post) return;
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
  }

  function fmtPct(x) {
    return Math.round(x * 100) + "%";
  }
  function fmtSigned(x) {
    return (x >= 0 ? "+" : "") + x.toFixed(2);
  }

  function restartAnimation(el, className) {
    el.classList.remove(className);
    // Force reflow so the animation/transition can replay.
    void el.offsetWidth;
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

  function renderTagStrip() {
    els.tagStrip.innerHTML = "";
    if (!tags.length) {
      els.tagStrip.appendChild(els.tagStripEmpty);
      return;
    }
    tags
      .slice()
      .reverse()
      .forEach((entry) => {
        els.tagStrip.appendChild(buildChip(entry));
      });
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
        "Scan a subreddit and swipe through posts to generate a vibe summary…";
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

    return (
      "r/" +
      subreddit +
      " currently reads as " +
      state +
      " to the simulated fly. Of " +
      n +
      " posts scanned, " +
      sweetPct +
      "% triggered the sweet/appetitive antennal-lobe channel and " +
      geosminPct +
      "% triggered geosmin/aversive alarm. Mean mushroom-body valence is " +
      fmtSigned(meanValence) +
      ", suggesting " +
      tone +
      " emotional tone, with " +
      arousal +
      " auditory arousal (mean spike frequency " +
      Math.round(meanFreq) +
      " Hz). Octopamine averages " +
      fmtPct(means.octopamine) +
      " and the dominant motor response was " +
      motorNames[dominantMotorKey] +
      " (" +
      motorPct +
      "% of posts)."
    );
  }

  function tagAndAdvance() {
    if (!posts.length) return;
    const post = posts[index];
    const brain = FlyBrain.analyzePost(post);
    tags.push({ post, brain });
    if (tags.length > MAX_TAGS) tags.shift();

    renderTagStrip();
    triggerFlyReaction(brain.motor);
    updateSidebar();

    index = (index + 1) % posts.length;
    renderPhone();
  }

  function goPrev() {
    if (!posts.length) return;
    index = (index - 1 + posts.length) % posts.length;
    renderPhone();
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

  els.nextBtn.addEventListener("click", tagAndAdvance);
  els.prevBtn.addEventListener("click", goPrev);
  els.autoplayBtn.addEventListener("click", () => {
    if (autoplayTimer) stopAutoplay();
    else startAutoplay();
  });

  loadSubreddit(subreddit);
})();
