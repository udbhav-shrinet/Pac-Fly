/*
 * FlyBrain — a simplified simulated fruit fly brain.
 * One shared pipeline runs identically on every Reddit post's real stats
 * (title length, score, comment count, upvote ratio) and text (via a small
 * reward/threat/arousal keyword lexicon). Nothing here is hardcoded per post.
 *
 * Pipeline: Antennal Lobe -> Mushroom Body -> Hearing -> Neuromodulators
 *           -> Decision Layer (motor output) -> Behavioral State (aggregate)
 */
(function (global) {
  const REWARD_WORDS = [
    "love", "amazing", "win", "won", "great", "awesome", "best", "yummy",
    "sweet", "delicious", "happy", "free", "gift", "success", "lol", "haha",
    "funny", "cute", "nice", "celebrat", "wholesome", "adorable", "incredible",
    "beautiful", "thank", "perfect", "hooray", "yay",
  ];

  const THREAT_WORDS = [
    "hate", "kill", "death", "dead", "war", "attack", "scary", "disgust",
    "fear", "danger", "threat", "warning", "blood", "fight", "angry", "rage",
    "toxic", "fail", "crash", "disaster", "violen", "abuse", "cancer",
    "virus", "scam", "banned", "lawsuit", "explosion",
  ];

  const AROUSAL_WORDS = [
    "breaking", "urgent", "shocking", "insane", "crazy", "huge", "massive",
    "explosive", "incredible", "unbelievable", "wow", "omg", "viral",
    "explod", "alert", "chaos", "record", "finally",
  ];

  function clamp(x, a, b) {
    return Math.max(a, Math.min(b, x));
  }

  function sigmoid(x) {
    return 1 / (1 + Math.exp(-x));
  }

  function noise(scale) {
    return (Math.random() - 0.5) * scale;
  }

  function logNorm(x, div) {
    return clamp(Math.log10(x + 1) / div, 0, 1);
  }

  function countHits(text, words) {
    let n = 0;
    for (const w of words) if (text.includes(w)) n++;
    const bangs = (text.match(/!/g) || []).length;
    return n + bangs * 0.3;
  }

  function matchedWords(text, words) {
    const out = [];
    for (const w of words) if (text.includes(w)) out.push(w);
    return out;
  }

  function analyzePost(post) {
    const title = post.title || "";
    const body = post.selftext || "";
    const text = (title + " " + body).toLowerCase();
    const titleLen = title.length;

    const score = Math.max(0, post.score || 0);
    const comments = Math.max(0, post.num_comments || 0);
    const ratio = clamp(
      typeof post.upvote_ratio === "number" ? post.upvote_ratio : 0.85,
      0,
      1
    );

    const rewardHits = countHits(text, REWARD_WORDS);
    const threatHits = countHits(text, THREAT_WORDS);
    const arousalHits = countHits(text, AROUSAL_WORDS);
    const rewardMatches = matchedWords(text, REWARD_WORDS);
    const threatMatches = matchedWords(text, THREAT_WORDS);
    const arousalMatches = matchedWords(text, AROUSAL_WORDS);

    const normScore = logNorm(score, 4.5);
    const normComments = logNorm(comments, 3.2);

    // Antennal lobe: sweet/appetitive vs geosmin/aversive channel activation.
    const sweet = sigmoid(
      rewardHits * 1.15 + normScore * 1.1 + ratio * 1.6 -
      threatHits * 0.4 - 3.4 + noise(0.4)
    );
    const geosmin = sigmoid(
      threatHits * 1.35 + (1 - ratio) * 2.2 -
      rewardHits * 0.35 - 2.2 + noise(0.4)
    );

    // Mushroom body: weighted sum through a sigmoid -> valence in [-1, 1].
    const mbInput =
      sweet * 2.2 - geosmin * 2.4 + normScore * 0.6 +
      (ratio - 0.5) * 1.4 - normComments * 0.15;
    const valence = clamp(2 * sigmoid(mbInput) - 1 + noise(0.06), -1, 1);

    // Hearing: raw spike frequency (Hz) from title length, arousal, engagement.
    const spikeFreq = clamp(
      18 + titleLen * 0.28 + arousalHits * 14 + normComments * 55 + noise(6),
      4,
      260
    );

    // Neuromodulators — each a function of the above plus stochastic noise.
    const dopamine = clamp(
      0.5 + valence * 0.38 + normScore * 0.18 + noise(0.09), 0, 1
    );
    const serotonin = clamp(
      0.5 + ratio * 0.32 - geosmin * 0.28 - Math.abs(valence) * 0.05 +
      noise(0.09), 0, 1
    );
    const octopamine = clamp(
      0.28 + (spikeFreq / 260) * 0.45 + geosmin * 0.35 +
      arousalHits * 0.03 + noise(0.09), 0, 1
    );
    const tyramine = clamp(
      0.28 + geosmin * 0.5 + (1 - serotonin) * 0.22 - dopamine * 0.1 +
      noise(0.09), 0, 1
    );

    // Decision layer: motor output from thresholded, noisy competing scores.
    const scores = {
      approach: sweet * 1.3 + valence * 0.9 + dopamine * 0.6 + noise(0.25),
      evade: geosmin * 1.35 + octopamine * 0.95 + tyramine * 0.45 + noise(0.25),
      groom: serotonin * 1.05 - Math.abs(valence) * 0.35 -
        octopamine * 0.4 + noise(0.25),
      forage: 0.55 + normComments * 0.5 -
        Math.max(sweet, geosmin) * 0.35 + noise(0.25),
    };
    let motor = "forage";
    let best = -Infinity;
    for (const key in scores) {
      if (scores[key] > best) {
        best = scores[key];
        motor = key;
      }
    }

    const motorLabels = {
      approach: "Proboscis Extension",
      evade: "Tergotrochanteral Jump",
      groom: "Grooming",
      forage: "Foraging Scan",
    };

    return {
      titleLen,
      sweet,
      geosmin,
      dominantChannel: sweet >= geosmin ? "sweet" : "geosmin",
      valence,
      spikeFreq,
      dopamine,
      serotonin,
      octopamine,
      tyramine,
      motor,
      motorLabel: motorLabels[motor],
      rewardHits,
      threatHits,
      arousalHits,
      rewardMatches,
      threatMatches,
      arousalMatches,
    };
  }

  // Derived, human-readable tags for the post log and live sense readouts.
  // Pure function of an already-computed brain result — no new randomness.
  function classify(brain) {
    const highArousal = brain.spikeFreq > 100;
    let emotion;
    if (highArousal && brain.valence >= 0) emotion = "Elated";
    else if (highArousal && brain.valence < 0) emotion = "Alarmed";
    else if (!highArousal && brain.valence >= 0) emotion = "Content";
    else emotion = "Bored";

    const feeling =
      brain.valence > 0.15
        ? "Positive"
        : brain.valence < -0.15
        ? "Negative"
        : "Neutral";

    const stressLevel = (brain.octopamine + brain.tyramine) / 2;
    const stress =
      stressLevel > 0.6 ? "High Stress" : stressLevel > 0.45 ? "Moderate Stress" : "Low Stress";

    const vision =
      brain.titleLen > 80
        ? "Dense Mosaic"
        : brain.titleLen > 40
        ? "Layered Pattern"
        : "Simple Pattern";

    const hearing =
      brain.spikeFreq > 150
        ? "Loud Chatter"
        : brain.spikeFreq > 80
        ? "Moderate Murmur"
        : "Quiet Hum";

    const smellIntensity =
      brain.dominantChannel === "sweet" ? brain.sweet : brain.geosmin;
    const smell =
      (brain.dominantChannel === "sweet" ? "Sweet Plume" : "Geosmin Alarm") +
      (smellIntensity > 0.6 ? " (Strong)" : smellIntensity > 0.35 ? " (Faint)" : " (Trace)");

    return { emotion, feeling, stress, vision, hearing, smell };
  }

  // Behavioral state machine: aggregate neuromodulator averages -> one state.
  function aggregateState(means) {
    const { dopamine, serotonin, octopamine, tyramine } = means;
    const HI = 0.56;
    const LO = 0.44;
    if (octopamine >= HI && tyramine >= LO) return "Predator Evasion";
    if (dopamine >= HI && serotonin >= LO) return "Foraging";
    if (serotonin >= HI && octopamine < LO) return "Resting";
    if (tyramine >= HI && dopamine < LO) return "Grooming";
    return "Locomotion";
  }

  global.FlyBrain = {
    analyzePost,
    aggregateState,
    classify,
    REWARD_WORDS,
    THREAT_WORDS,
    AROUSAL_WORDS,
  };
})(window);
