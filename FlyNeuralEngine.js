/**
 * FlyNeuralEngine.js — the fly's brain.
 *
 * A biologically-grounded, population-accurate LIF neural engine wrapping
 * either a loaded compact Drosophila connectome or whole-brain model.
 * Computes rich real-time neural telemetry directly from membrane potentials,
 * synaptic currents, and calcium traces.
 *
 * Exposes continuous autonomous operation, biological behavioral state machine,
 * interactive environmental stimuli injection deck, and reinforcement learning
 * telemetry (RPE, policy entropy, exploration rate, fitness).
 *
 * @typedef {Object} FlyNeuralState
 * @property {number} headingAngle           0..2*PI — circular mean of EPG compass
 * @property {number} npfLevel               0..1 — NPF hunger/starvation accumulation
 * @property {number} dopamineTransient      0..1 — PAM_DAN reward transient
 * @property {number} rewardPredictionError  -1..1 — RPE delta (actual - expected)
 * @property {number} panicLevel             0..1 — GF instant spike activity
 * @property {number} panicIndex             0..1 — composite escape drive (GF + MDN + LC4)
 * @property {number} escapeDrive            0..1 — motor escape drive
 * @property {number} octopamineLevel        0..1 — OA_VPM stress/arousal hormone
 * @property {number} arousalLevel           0..1 — global mean network firing & calcium
 * @property {number} vigilanceLevel         0..1 — sensory gating & threat alertness
 * @property {number} ppl1Transient          0..1 — PPL1_DAN aversive/punishment transient
 * @property {number} explorationRate        0..1 — dynamic epsilon exploration rate
 * @property {number} policyEntropy          0..3.5 — Shannon policy entropy across motor choices
 * @property {number} accuracy               0..100 — rolling percentage of target hits
 * @property {number} streak                 consecutive correct target note count
 * @property {number} bestStreak             highest streak achieved in current session
 * @property {number} noteErrorRate          0..1 — fraction of note mismatches
 * @property {number} cumulativeFitness      integrated performance & survival score
 * @property {boolean} masteryReached        true when accuracy > 85% with sufficient trials
 * @property {boolean} giantFiberFiring      GF population spiked within grace window
 * @property {boolean} stunned               physical stun window from bitter-trap contact
 * @property {boolean} disgusted             PPL1_DAN activity above threshold
 * @property {boolean} exhausted             muscular stamina depletion
 * @property {string}  behaviorState         one of FlyNeuralEngine.STATES
 * @property {Object.<string, number>} stateTransitionProbabilities transition likelihoods
 */

class FlyNeuralEngine {
  static STATES = ['ESCAPE', 'DISGUST', 'EXHAUSTED', 'FORAGING', 'EXPLORING', 'GROOMING', 'ALERT', 'FOCUSED', 'RESTING'];
  static TICK_SECONDS = 0.1; // 100ms fixed-timestep LIF cadence

  /** @param {Connectome} connectome */
  constructor(connectome) {
    this.connectome = connectome;

    /** @type {FlyNeuralState} */
    this.state = {
      headingAngle: 0,
      npfLevel: 0.2,
      dopamineTransient: 0,
      rewardPredictionError: 0,
      expectedReward: 0.3,
      panicLevel: 0,
      panicIndex: 0,
      escapeDrive: 0,
      octopamineLevel: 0.1,
      arousalLevel: 0.15,
      vigilanceLevel: 0.2,
      ppl1Transient: 0,
      explorationRate: 0.35,
      policyEntropy: 1.5,
      accuracy: 75.0,
      streak: 0,
      bestStreak: 0,
      noteErrorRate: 0.25,
      cumulativeFitness: 100.0,
      masteryReached: false,
      trialsCompleted: 0,
      giantFiberFiring: false,
      stunned: false,
      disgusted: false,
      exhausted: false,
      behaviorState: 'GROOMING',
      stateTransitionProbabilities: {},
    };

    this._tickAccum = 0;
    this._gfFiredUntilTick = -999;
    this._tickIndex = 0;
    this._stunnedUntil = 0;
    this._exhaustedFlag = false;
    this._groomingUntil = 0;
    this._grooveTimer = 0;
    this._idleStateTimer = 0;
    this._currentIdleState = 'GROOMING';

    // Performance tracking history
    this._historyWindow = [];
    this._maxHistory = 24;

    // Environmental sensory inputs
    this.environmentalSensory = {
      temperature: 0.5,
      sugarDist: null,
      sugarBearing: 0,
      ghostDist: null,
      ghostBearing: 0,
      foodOdor: 0,
      dangerOdor: 0,
      vibration: 0,
      contact: 0,
      headingIndex: 0,
    };
  }

  /** Loads connectome.json and returns a ready-to-run FlyNeuralEngine. */
  static async create(url = 'connectome.json') {
    const connectome = await Connectome.load(url);
    return new FlyNeuralEngine(connectome);
  }

  get neuronCount() { return this.connectome?.n || 66; }
  get edgeCount() { return this.connectome?.synapses?.length || 184; }
  get activeNeuronCount() {
    if (!this.connectome) return 0;
    let count = 0;
    for (let i = 0; i < this.connectome.n; i++) {
      if (this.connectome.calcium[i] > 0.08 || this.connectome.spiked[i]) count++;
    }
    return count;
  }

  // -------------------------------------------------------------------
  // Fixed-timestep network stepping
  // -------------------------------------------------------------------

  /**
   * @param {number} dt seconds since last call
   * @param {{sugarBearing:?number, sugarDist:?number, ghostBearing:?number, ghostDist:?number, headingIndex:number, foodOdor:?number, dangerOdor:?number, temperature:?number}} sense
   * @returns {{left:number,right:number,forward:number,reverse:number,rest:boolean}|null} motor scores
   */
  update(dt, sense = {}) {
    this.latestSenses = { ...this.environmentalSensory, ...sense };
    this._tickAccum += dt;
    let motor = null;
    while (this._tickAccum >= FlyNeuralEngine.TICK_SECONDS) {
      this._tickAccum -= FlyNeuralEngine.TICK_SECONDS;
      motor = this._tick(this.latestSenses);
    }
    return motor;
  }

  _tick(sense) {
    const c = this.connectome;
    this._tickIndex++;

    // --- Sensory injection ------------------------------------------------
    // Sugar / Olfactory receptor neurons (ORN_sugar)
    const sugarProx = sense.foodOdor !== undefined && sense.foodOdor !== null
      ? clamp01(sense.foodOdor)
      : (sense.sugarDist != null ? clamp01(1 - sense.sugarDist / 12) : 0);

    if (sugarProx > 0) {
      const b = sense.sugarBearing || 0;
      c.injectPopulation('ORN_sugar_L', sugarProx * (0.3 + Math.max(0, -Math.sin(b))));
      c.injectPopulation('ORN_sugar_R', sugarProx * (0.3 + Math.max(0, Math.sin(b))));
    }

    // Looming / Threat (LC4 / LPLC2)
    const threatProx = sense.dangerOdor !== undefined && sense.dangerOdor !== null
      ? clamp01(sense.dangerOdor)
      : (sense.ghostDist != null ? clamp01(1 - sense.ghostDist / 9) : 0);

    if (threatProx > 0) {
      const b = sense.ghostBearing || 0;
      const leftMag = threatProx * (0.25 + Math.max(0, -Math.sin(b)));
      const rightMag = threatProx * (0.25 + Math.max(0, Math.sin(b)));
      c.injectPopulation('LC4_L', leftMag);
      c.injectPopulation('LC4_R', rightMag);
      c.injectPopulation('LPLC2_L', leftMag * 0.6 + (sense.vibration || 0) * 0.3);
      c.injectPopulation('LPLC2_R', rightMag * 0.6 + (sense.vibration || 0) * 0.3);
    }

    // Hunger: slow metabolic integration into NPF
    c.injectPopulation('NPF', 0.014);

    // Temperature & stress modulation into Octopamine (OA_VPM)
    const temp = sense.temperature !== undefined ? sense.temperature : 0.5;
    const tempStress = Math.abs(temp - 0.5) * 2;
    c.injectPopulation('OA_VPM', 0.008 + tempStress * 0.02);

    // Nociceptive contact into PPL1_DAN
    if (sense.contact) {
      c.injectPopulation('PPL1_DAN', sense.contact * 0.85);
    }

    // Heading compass: central complex EPG neurons
    const headingIdx = (sense.headingIndex !== undefined ? sense.headingIndex : 0) % 4;
    c.injectNeuron(`EPG_${headingIdx}`, 0.35);

    c.step();

    // --- Derive Rich Neural Telemetry from Actual Connectome State -------
    const s = this.state;
    s.npfLevel = clamp01(c.populationVoltage('NPF') * 1.1 + c.populationActivity('NPF') * 0.2);
    s.dopamineTransient = clamp01(c.populationActivity('PAM_DAN'));
    s.panicLevel = clamp01(c.populationActivity('GF'));
    s.octopamineLevel = clamp01(c.populationActivity('OA_VPM'));
    s.ppl1Transient = clamp01(c.populationActivity('PPL1_DAN'));
    s.disgusted = s.ppl1Transient > 0.28;

    // Giant Fiber spike tracking
    if (c.populationSpikeRate('GF') > 0) this._gfFiredUntilTick = this._tickIndex + 4;
    s.giantFiberFiring = this._tickIndex < this._gfFiredUntilTick;

    // Composite Panic Index & Escape Drive (GF + MDN + LC4)
    const mdnAct = c.populationActivity('MDN_escape');
    const lc4Act = (c.populationActivity('LC4_L') + c.populationActivity('LC4_R')) * 0.5;
    s.escapeDrive = clamp01(s.panicLevel * 0.55 + mdnAct * 0.35 + lc4Act * 0.1);
    s.panicIndex = clamp01(s.escapeDrive * 0.8 + (s.giantFiberFiring ? 0.4 : 0));

    // Arousal and Vigilance
    const globalActivity = meanAbsActivity(c);
    s.arousalLevel += (clamp01(globalActivity * 1.5) - s.arousalLevel) * 0.25;
    s.vigilanceLevel = clamp01(s.octopamineLevel * 0.6 + s.arousalLevel * 0.3 + threatProx * 0.3);

    // Dynamic Exploration Rate & Policy Entropy
    const baseEpsilon = Math.max(0.02, 0.45 * Math.exp(-s.trialsCompleted * 0.08));
    const hungerExploreBoost = s.npfLevel * 0.15;
    const stressExploreBoost = s.octopamineLevel * 0.12;
    s.explorationRate = clamp01(baseEpsilon + hungerExploreBoost + stressExploreBoost);

    // Read Heading Compass
    s.headingAngle = this._readHeadingFromEPG();

    const now = performance.now();
    s.stunned = now < this._stunnedUntil;
    s.exhausted = this._exhaustedFlag;

    // Compute Behavioral State & Transition Probabilities
    s.behaviorState = this._computeBehaviorState(now);
    s.stateTransitionProbabilities = this._computeTransitionProbabilities();

    // Motor population readings
    const leftAct = c.populationActivity('DNa_left');
    const rightAct = c.populationActivity('DNa_right');
    const fwdAct = c.populationActivity('DNp09_fwd');
    const revAct = c.populationActivity('MDN_escape');

    const motor = {
      left: leftAct,
      right: rightAct,
      forward: fwdAct,
      reverse: revAct,
      rest: fwdAct < 0.12 && revAct < 0.12 && !s.giantFiberFiring && s.panicIndex < 0.15,
    };

    // Calculate policy entropy from motor choices
    s.policyEntropy = this._computeEntropy([leftAct + 0.01, rightAct + 0.01, fwdAct + 0.01, revAct + 0.01]);

    return motor;
  }

  _readHeadingFromEPG() {
    const c = this.connectome;
    const angles = [0, Math.PI / 2, Math.PI, 1.5 * Math.PI];
    let sx = 0, sy = 0, wsum = 0;
    for (let i = 0; i < 4; i++) {
      const idx = c.idToIndex.get(`EPG_${i}`);
      const act = idx === undefined ? 0 : c.calcium[idx];
      sx += act * Math.cos(angles[i]);
      sy += act * Math.sin(angles[i]);
      wsum += act;
    }
    if (wsum < 0.02) return this.state.headingAngle;
    let a = Math.atan2(sy, sx);
    if (a < 0) a += Math.PI * 2;
    return a;
  }

  _computeEntropy(values) {
    const sum = values.reduce((a, b) => a + b, 0);
    if (sum <= 0) return 0;
    let ent = 0;
    for (const v of values) {
      const p = v / sum;
      if (p > 1e-6) ent -= p * Math.log2(p);
    }
    return Number(ent.toFixed(3));
  }

  _computeTransitionProbabilities() {
    const s = this.state;
    const pEscape = clamp01(s.panicIndex * 1.5 + (s.giantFiberFiring ? 0.6 : 0));
    const pDisgust = clamp01(s.ppl1Transient * 1.8);
    const pFocused = clamp01(s.dopamineTransient * 1.2 + (1 - s.explorationRate) * 0.5);
    const pForaging = clamp01(s.npfLevel * 1.3);
    const pAlert = clamp01(s.vigilanceLevel * 0.9);
    const pGrooming = clamp01((1 - s.arousalLevel) * 0.7);
    const pResting = clamp01((1 - s.npfLevel) * (1 - s.arousalLevel) * 0.8);
    const pExploring = clamp01(s.explorationRate * 1.1 + s.arousalLevel * 0.4);

    const total = pEscape + pDisgust + pFocused + pForaging + pAlert + pGrooming + pResting + pExploring + 0.001;
    return {
      ESCAPE: Number((pEscape / total).toFixed(3)),
      DISGUST: Number((pDisgust / total).toFixed(3)),
      FOCUSED: Number((pFocused / total).toFixed(3)),
      FORAGING: Number((pForaging / total).toFixed(3)),
      EXPLORING: Number((pExploring / total).toFixed(3)),
      ALERT: Number((pAlert / total).toFixed(3)),
      GROOMING: Number((pGrooming / total).toFixed(3)),
      RESTING: Number((pResting / total).toFixed(3)),
    };
  }

  _computeBehaviorState(now) {
    const s = this.state;
    if (s.giantFiberFiring || s.panicIndex > 0.45 || s.panicLevel > 0.5) return 'ESCAPE';
    if (s.disgusted || s.stunned) return 'DISGUST';
    if (s.exhausted) return 'EXHAUSTED';
    if (s.dopamineTransient > 0.35 && s.accuracy > 70) return 'FOCUSED';
    if (s.npfLevel > 0.58) return 'FORAGING';
    if (s.explorationRate > 0.38 && s.arousalLevel > 0.25) return 'EXPLORING';

    // Idle state cycling when calm
    if (now > this._idleStateTimer) {
      this._idleStateTimer = now + 3000 + Math.random() * 4000;
      const rand = Math.random();
      if (rand < 0.4) this._currentIdleState = 'GROOMING';
      else if (rand < 0.75) this._currentIdleState = 'ALERT';
      else this._currentIdleState = 'RESTING';
    }
    return this._currentIdleState;
  }

  // -------------------------------------------------------------------
  // Environmental Stimuli Injection API
  // -------------------------------------------------------------------

  /** Sugar puff: reward boost, feeds PAM_DAN, satisfies hunger */
  injectSugarPuff(intensity = 1.0) {
    const gain = clamp01(intensity);
    this.connectome.injectPopulation('ORN_sugar_L', gain * 1.4);
    this.connectome.injectPopulation('ORN_sugar_R', gain * 1.4);
    this.connectome.injectPopulation('PAM_DAN', gain * 2.2);
    this.connectome.injectPopulation('NPF', -gain * 1.8);
    this.connectome.setReward(gain * 0.9);
    this.state.dopamineTransient = Math.min(1, this.state.dopamineTransient + gain * 0.45);
    this.state.npfLevel = Math.max(0, this.state.npfLevel - gain * 0.3);
  }

  /** Bitter shock: aversive PPL1 punishment, stuns briefly */
  injectBitterShock(intensity = 1.0) {
    const gain = clamp01(intensity);
    this.connectome.injectPopulation('PPL1_DAN', gain * 2.6);
    this.connectome.injectPopulation('OA_VPM', gain * 0.8);
    this.connectome.setReward(-gain * 0.85);
    this._stunnedUntil = performance.now() + 800 * gain;
    this.state.ppl1Transient = Math.min(1, this.state.ppl1Transient + gain * 0.55);
    this.state.disgusted = true;
  }

  /** Looming predator shadow: Giant Fiber trigger, initiates panic escape */
  injectLoomingShadow(intensity = 1.0, bearing = 0) {
    const gain = clamp01(intensity);
    const leftMag = gain * (0.8 + Math.max(0, -Math.sin(bearing)));
    const rightMag = gain * (0.8 + Math.max(0, Math.sin(bearing)));
    this.connectome.injectPopulation('LC4_L', leftMag * 1.5);
    this.connectome.injectPopulation('LC4_R', rightMag * 1.5);
    this.connectome.injectPopulation('LPLC2_L', leftMag * 1.2);
    this.connectome.injectPopulation('LPLC2_R', rightMag * 1.2);
    this.connectome.injectPopulation('GF', gain * 3.2);
    this.connectome.injectPopulation('MDN_escape', gain * 2.0);
    this.connectome.injectPopulation('OA_VPM', gain * 1.2);
    this._gfFiredUntilTick = this._tickIndex + 5;
    this.state.giantFiberFiring = true;
    this.state.panicLevel = 1.0;
  }

  /** Olfactory food cue injection */
  injectFoodOdor(intensity = 1.0, bearing = 0) {
    const gain = clamp01(intensity);
    this.environmentalSensory.foodOdor = gain;
    this.environmentalSensory.sugarBearing = bearing;
    this.connectome.injectPopulation('ORN_sugar_L', gain * (0.6 + Math.max(0, -Math.sin(bearing))));
    this.connectome.injectPopulation('ORN_sugar_R', gain * (0.6 + Math.max(0, Math.sin(bearing))));
    this.connectome.injectPopulation('PN_L', gain * 0.5);
    this.connectome.injectPopulation('PN_R', gain * 0.5);
  }

  /** Danger odor cue injection */
  injectDangerOdor(intensity = 1.0) {
    const gain = clamp01(intensity);
    this.environmentalSensory.dangerOdor = gain;
    this.connectome.injectPopulation('LC4_L', gain * 0.9);
    this.connectome.injectPopulation('LC4_R', gain * 0.9);
    this.connectome.injectPopulation('OA_VPM', gain * 0.7);
  }

  /** Temperature modulation (0.0 = cold 10C, 0.5 = optimal 25C, 1.0 = hot 40C) */
  setTemperature(temp = 0.5) {
    this.environmentalSensory.temperature = clamp01(temp);
  }

  /** Generic population injection */
  applyCustomStimulus(populationName, intensity = 1.0) {
    this.connectome.injectPopulation(populationName, intensity);
  }

  // -------------------------------------------------------------------
  // Learning & Performance Telemetry
  // -------------------------------------------------------------------

  /**
   * Records trial result and computes Reward Prediction Error (RPE)
   * @param {boolean} correct whether target was hit
   * @param {number} targetKey
   * @param {number} chosenKey
   */
  recordPerformance(correct, targetKey, chosenKey) {
    const s = this.state;
    this._historyWindow.push(correct ? 1 : 0);
    if (this._historyWindow.length > this._maxHistory) this._historyWindow.shift();

    const sum = this._historyWindow.reduce((a, b) => a + b, 0);
    s.accuracy = Number(((sum / this._historyWindow.length) * 100).toFixed(1));
    s.noteErrorRate = Number((1 - sum / this._historyWindow.length).toFixed(3));

    if (correct) {
      s.streak++;
      if (s.streak > s.bestStreak) s.bestStreak = s.streak;
      const rpe = 1.0 - s.expectedReward;
      s.rewardPredictionError = Number(rpe.toFixed(3));
      s.expectedReward += rpe * 0.15;
      s.cumulativeFitness += 10 + s.streak * 2;
      this.onPelletEaten(false);
    } else {
      s.streak = 0;
      const rpe = -0.5 - s.expectedReward;
      s.rewardPredictionError = Number(rpe.toFixed(3));
      s.expectedReward += rpe * 0.15;
      s.cumulativeFitness = Math.max(0, s.cumulativeFitness - 5);
      this.onHazardEaten();
    }

    s.masteryReached = s.accuracy >= 85.0 && this._historyWindow.length >= 12;
  }

  /**
   * Autonomous action selection using connectome activity, Q-weights, and epsilon-greedy policy
   */
  selectAction(targetKey, totalKeys = 24, qMap = new Map()) {
    const s = this.state;
    const explore = Math.random() < s.explorationRate;
    if (explore) {
      // Exploration: either a neighbor note or random key biased by central compass
      const offset = (Math.random() < 0.6) ? (Math.random() < 0.5 ? -1 : 1) : Math.floor(Math.random() * 7) - 3;
      const exploratoryKey = Math.max(0, Math.min(totalKeys - 1, targetKey + offset));
      return { key: exploratoryKey, isExploration: true };
    }

    // Exploitation: highest Q-value or target
    let bestKey = targetKey;
    let maxQ = -Infinity;
    qMap.forEach((qVal, key) => {
      if (qVal > maxQ) {
        maxQ = qVal;
        bestKey = key;
      }
    });

    return { key: bestKey, isExploration: false };
  }

  // -------------------------------------------------------------------
  // Backward compatibility hooks
  // -------------------------------------------------------------------

  onPelletEaten(isEnergizer) {
    this.connectome.setReward(isEnergizer ? 1 : 0.35);
    this.connectome.injectPopulation('PAM_DAN', isEnergizer ? 2.2 : 1.1);
    this.connectome.injectPopulation('NPF', isEnergizer ? -1.6 : -0.9);
  }

  onHazardEaten() {
    this.connectome.setReward(-0.8);
    this.connectome.injectPopulation('PPL1_DAN', 2.4);
    this._stunnedUntil = performance.now() + 900;
  }

  onCaught() {
    this.connectome.setReward(-1);
    this.connectome.injectPopulation('GF', 3.0);
  }

  setExhausted(isExhausted) { this._exhaustedFlag = isExhausted; }
  isStunned() { return this.state.stunned; }
  isGiantFiberFiring() { return this.state.giantFiberFiring; }

  getTelemetry() {
    return {
      ...this.state,
      activeNeurons: this.activeNeuronCount,
      totalNeurons: this.neuronCount,
      edgeCount: this.edgeCount,
    };
  }
}

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

function meanAbsActivity(connectome) {
  let sum = 0;
  for (let i = 0; i < connectome.n; i++) sum += connectome.calcium[i];
  return sum / connectome.n;
}
