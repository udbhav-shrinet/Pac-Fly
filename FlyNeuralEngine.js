/**
 * FlyNeuralEngine.js — the fly's brain. This is a thin, biologically-named
 * wrapper around a real `Connectome` (a loaded adjacency-matrix LIF spiking
 * network, see Connectome.js and connectome.json) — it is NOT a hand-tuned
 * scalar state machine. Every dashboard readout below is computed by
 * reading actual membrane-potential activity out of specific neuron
 * populations after the network has been stepped; nothing here just
 * decays a number on a timer.
 *
 * Movement itself is decided the same way: `brainTick()` injects sensory
 * current (sugar/ghost bearing and proximity) into sensory populations,
 * steps the network once, and returns motor scores read from the
 * DNa_left / DNa_right / DNp09_fwd / MDN_escape descending-neuron
 * populations. PacmanGame turns those scores into an actual maze move —
 * it never decides direction itself.
 *
 * @typedef {Object} FlyNeuralState
 * @property {number} headingAngle       0..2*PI — circular mean of the EPG heading-compass population's activity
 * @property {number} npfLevel           0..1 — NPF population activity (hunger/starvation drive)
 * @property {number} dopamineTransient  0..1 — PAM_DAN population activity (reward), decays via the population's own LIF leak
 * @property {number} panicLevel         0..1 — GF (Giant Fiber) population activity — fast time constant, so this reads as an instant spike
 * @property {number} octopamineLevel    0..1 — OA_VPM population activity — slow time constant, so this lingers after repeated threat
 * @property {number} arousalLevel       0..1 — smoothed mean |activity| across the whole network
 * @property {number} ppl1Transient      0..1 — PPL1_DAN population activity (aversive/bitter)
 * @property {boolean} giantFiberFiring  GF population spiked within the last few ticks
 * @property {boolean} stunned           physical stun window from a bitter-trap contact
 * @property {boolean} disgusted         PPL1_DAN activity above threshold
 * @property {boolean} exhausted         pushed in from PacmanGame — stamina bottomed out (muscular, not neural)
 * @property {string}  behaviorState     one of FlyNeuralEngine.STATES — the "mood ticker" label
 */

class FlyNeuralEngine {
  static STATES = ['ESCAPE', 'DISGUST', 'EXHAUSTED', 'FORAGING', 'GROOMING', 'ALERT'];
  static TICK_SECONDS = 0.1; // fixed-timestep cadence the network is stepped at, independent of render FPS

  /** @param {Connectome} connectome */
  constructor(connectome) {
    this.connectome = connectome;

    /** @type {FlyNeuralState} */
    this.state = {
      headingAngle: 0,
      npfLevel: 0.2,
      dopamineTransient: 0,
      panicLevel: 0,
      octopamineLevel: 0,
      arousalLevel: 0.1,
      ppl1Transient: 0,
      giantFiberFiring: false,
      stunned: false,
      disgusted: false,
      exhausted: false,
      behaviorState: 'GROOMING',
    };

    this._tickAccum = 0;
    this._gfFiredUntilTick = -999;
    this._tickIndex = 0;
    this._stunnedUntil = 0;
    this._exhaustedFlag = false;
    this._groomingUntil = 0;
    this._grooveTimer = 0;
  }

  /** Loads connectome.json and returns a ready-to-run FlyNeuralEngine. */
  static async create(url = 'connectome.json') {
    const connectome = await Connectome.load(url);
    return new FlyNeuralEngine(connectome);
  }

  // -------------------------------------------------------------------
  // Fixed-timestep network stepping. Called every render frame with the
  // real dt; internally accumulates and steps the LIF network at a fixed
  // 100ms cadence so the hand-set synaptic time constants (NPF tau=0.995
  // for slow hunger integration, GF tau=0.70 for a fast panic spike, etc)
  // mean what they were calibrated to mean.
  // -------------------------------------------------------------------

  /**
   * @param {number} dt seconds since last call
   * @param {{sugarBearing:?number, sugarDist:?number, ghostBearing:?number, ghostDist:?number, headingIndex:number}} sense
   * @returns {{left:number,right:number,forward:number,reverse:number,rest:boolean}|null} motor scores, or null if no tick ran this frame
   */
  update(dt, sense) {
    this._tickAccum += dt;
    let motor = null;
    while (this._tickAccum >= FlyNeuralEngine.TICK_SECONDS) {
      this._tickAccum -= FlyNeuralEngine.TICK_SECONDS;
      motor = this._tick(sense);
    }
    return motor;
  }

  _tick(sense) {
    const c = this.connectome;
    this._tickIndex++;

    // --- Sensory injection ------------------------------------------------
    // Olfactory (sugar): split left/right by signed bearing, small forward
    // baseline so a target dead ahead still drives search behavior.
    if (sense.sugarDist != null) {
      const prox = clamp01(1 - sense.sugarDist / 12);
      const b = sense.sugarBearing;
      c.injectPopulation('ORN_sugar_L', prox * (0.25 + Math.max(0, -Math.sin(b))));
      c.injectPopulation('ORN_sugar_R', prox * (0.25 + Math.max(0, Math.sin(b))));
    }

    // Looming (ghost): visual (LC4) + auditory-proxy (LPLC2). Wired
    // contralaterally downstream (see build-connectome.js) so a threat on
    // the left drives a RIGHT turn command automatically — the network's
    // own wiring produces the "turn away" behavior, not game code.
    if (sense.ghostDist != null) {
      const prox = clamp01(1 - sense.ghostDist / 9);
      const b = sense.ghostBearing;
      const leftMag = prox * (0.2 + Math.max(0, -Math.sin(b)));
      const rightMag = prox * (0.2 + Math.max(0, Math.sin(b)));
      c.injectPopulation('LC4_L', leftMag);
      c.injectPopulation('LC4_R', rightMag);
      c.injectPopulation('LPLC2_L', leftMag * 0.6);
      c.injectPopulation('LPLC2_R', rightMag * 0.6);
    }

    // Hunger: a small constant metabolic drive every tick; NPF's own tau
    // (0.995) is what makes this integrate slowly instead of decaying.
    c.injectPopulation('NPF', 0.012);

    // Heading compass: reinforce whichever EPG cell matches current facing.
    c.injectNeuron(`EPG_${sense.headingIndex}`, 0.35);

    c.step();

    // --- Derive the dashboard state from real population activity --------
    const s = this.state;
    s.npfLevel = clamp01(c.populationVoltage('NPF')); // graded accumulator, not a burst signal — see populationVoltage()
    s.dopamineTransient = clamp01(c.populationActivity('PAM_DAN'));
    s.panicLevel = clamp01(c.populationActivity('GF'));
    s.octopamineLevel = clamp01(c.populationActivity('OA_VPM'));
    s.ppl1Transient = clamp01(c.populationActivity('PPL1_DAN'));
    s.disgusted = s.ppl1Transient > 0.3;

    if (c.populationSpikeRate('GF') > 0) this._gfFiredUntilTick = this._tickIndex + 3;
    s.giantFiberFiring = this._tickIndex < this._gfFiredUntilTick;

    const globalActivity = meanAbsActivity(c);
    s.arousalLevel += (clamp01(globalActivity * 1.4) - s.arousalLevel) * 0.35;

    s.headingAngle = this._readHeadingFromEPG();

    const now = performance.now();
    s.stunned = now < this._stunnedUntil;
    s.exhausted = this._exhaustedFlag;
    s.behaviorState = this._computeBehaviorState(now);

    // --- Read motor populations for the movement decision -----------------
    return {
      left: c.populationActivity('DNa_left'),
      right: c.populationActivity('DNa_right'),
      forward: c.populationActivity('DNp09_fwd'),
      reverse: c.populationActivity('MDN_escape'),
      // Use the grace-windowed giantFiberFiring flag, not raw panicLevel:
      // GF's fast tau means panicLevel can dip toward zero between bursts
      // within the same sustained threat encounter, which would otherwise
      // let a "rest" decision sneak in while a ghost is still bearing down.
      rest: c.populationActivity('DNp09_fwd') < 0.12 && c.populationActivity('MDN_escape') < 0.12
        && !s.giantFiberFiring && s.panicLevel < 0.15,
    };
  }

  _readHeadingFromEPG() {
    const c = this.connectome;
    const angles = [0, Math.PI / 2, Math.PI, 1.5 * Math.PI]; // right, down, left, up — matches PacmanGame's DIRS order
    let sx = 0, sy = 0, wsum = 0;
    for (let i = 0; i < 4; i++) {
      const idx = c.idToIndex.get(`EPG_${i}`);
      const act = idx === undefined ? 0 : c.calcium[idx];
      sx += act * Math.cos(angles[i]);
      sy += act * Math.sin(angles[i]);
      wsum += act;
    }
    if (wsum < 0.02) return this.state.headingAngle; // no clear bump yet — hold last reading
    let a = Math.atan2(sy, sx);
    if (a < 0) a += Math.PI * 2;
    return a;
  }

  _computeBehaviorState(now) {
    const s = this.state;
    if (s.disgusted) return 'DISGUST';
    if (s.giantFiberFiring || s.panicLevel > 0.55) return 'ESCAPE';
    if (s.exhausted) return 'EXHAUSTED';
    if (s.npfLevel > 0.55) return 'FORAGING';
    if (now > this._groomingUntil) {
      this._groomingUntil = now + 2200 + Math.random() * 2600;
      this._grooveTimer = Math.random() < 0.5 ? 1 : 0;
    }
    return this._grooveTimer ? 'GROOMING' : 'ALERT';
  }

  // -------------------------------------------------------------------
  // Discrete event injections — wired directly to PacmanGame's callbacks.
  // These push current in immediately; it's consumed on the next tick.
  // -------------------------------------------------------------------

  /** PAM cluster dopaminergic reward pulse on pellet capture. */
  onPelletEaten(isEnergizer) {
    this.connectome.injectPopulation('PAM_DAN', isEnergizer ? 2.2 : 1.1);
    // Sugar is the only satiation event. The constant NPF drive in _tick()
    // continues to deplete hunger between meals.
    this.connectome.injectPopulation('NPF', isEnergizer ? -1.6 : -0.9);
  }

  /** PPL1 aversive pulse + physical stun window on bitter-trap contact. */
  onHazardEaten() {
    this.connectome.injectPopulation('PPL1_DAN', 2.4);
    this._stunnedUntil = performance.now() + 900;
  }

  /** A ghost made contact — drive the Giant Fiber straight past threshold. */
  onCaught() {
    this.connectome.injectPopulation('GF', 3.0);
  }

  /** Pushed in by the bootstrap layer each frame — PacmanGame owns the stamina number. */
  setExhausted(isExhausted) { this._exhaustedFlag = isExhausted; }

  isStunned() { return this.state.stunned; }
  isGiantFiberFiring() { return this.state.giantFiberFiring; }
}

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

function meanAbsActivity(connectome) {
  let sum = 0;
  for (let i = 0; i < connectome.n; i++) sum += connectome.calcium[i];
  return sum / connectome.n;
}
