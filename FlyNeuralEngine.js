/**
 * FlyNeuralEngine.js — a lightweight biochemical state machine mapping
 * arcade gameplay events onto named Drosophila functional circuits
 * (FlyWire / neuPrint nomenclature). This is intentionally NOT a spiking
 * network simulation — it is a small set of decaying/accumulating scalars
 * that a 3D visualizer (or any other observer) can read every frame. It
 * never touches the DOM, the canvas, or Three.js, and it never calls back
 * into PacmanGame — the only coupling is one-directional: the game's event
 * callbacks feed data in here, and (for a couple of fields the game itself
 * can't compute, like stamina) the bootstrap layer pushes small setters in.
 *
 * @typedef {Object} FlyNeuralState
 * @property {number} headingAngle       0..2*PI — fed by the Ellipsoid Body's E-PG heading compass
 * @property {number} npfLevel           0..1 — Neuropeptide F, hunger/starvation drive
 * @property {number} dopamineTransient  0..1 — PAM/MBON reward spike, exponential decay
 * @property {number} panicLevel         0..1 — instantaneous Giant Fiber / LC4 looming fear spike, fast decay
 * @property {number} octopamineLevel    0..1 — slow-building stress hormone, lingers after repeated threat
 * @property {number} arousalLevel       0..1 — smoothed composite alertness/hyper-awareness
 * @property {number} ppl1Transient      0..1 — PPL1 aversive/negative-reinforcement spike (bitter trap)
 * @property {boolean} giantFiberFiring  Giant Fiber escape reflex flag
 * @property {boolean} stunned           Gr66a bitter-gustatory stun flag
 * @property {boolean} disgusted         brief flag distinct from stunned, for the toxin-reaction UI
 * @property {boolean} exhausted         stamina has hit bottom — fly is dozing/slumping
 * @property {string}  behaviorState     one of FlyNeuralEngine.STATES — the "mood ticker" label
 */

class FlyNeuralEngine {
  static STATES = ['ESCAPE', 'DISGUST', 'EXHAUSTED', 'FORAGING', 'GROOMING', 'ALERT'];

  constructor() {
    /** @type {FlyNeuralState} */
    this.state = {
      headingAngle: 0,
      npfLevel: 0.2,
      dopamineTransient: 0,
      panicLevel: 0,
      octopamineLevel: 0,
      arousalLevel: 0.15,
      ppl1Transient: 0,
      giantFiberFiring: false,
      stunned: false,
      disgusted: false,
      exhausted: false,
      behaviorState: 'GROOMING',
    };

    this._npfGrowthRate = 0.035;  // per second while foraging without food
    this._dopamineDecay = 3.2;    // exponential decay constant, 1/s
    this._panicDecay = 2.6;       // fast — a startle, not a mood
    this._octopamineDecay = 0.35; // slow — a lingering stress hormone
    this._octopamineBuild = 0.9;  // how fast sustained panic converts to stress
    this._ppl1Decay = 2.4;
    this._giantFiberUntil = 0;
    this._stunnedUntil = 0;
    this._disgustedUntil = 0;
    this._exhaustedFlag = false;

    this._loomingThreshold = 3.2; // tile-distance below which GF fires
    this._grooveTimer = 0;
    this._groomingUntil = 0;
  }

  /** Advance decay/growth dynamics. Call once per simulation tick with dt in seconds. */
  update(dt) {
    const s = this.state;
    const now = performance.now();

    s.npfLevel = Math.min(1, s.npfLevel + this._npfGrowthRate * dt);
    s.dopamineTransient = Math.max(0, s.dopamineTransient - this._dopamineDecay * dt * s.dopamineTransient - 0.02 * dt);
    s.panicLevel = Math.max(0, s.panicLevel - this._panicDecay * dt);
    s.ppl1Transient = Math.max(0, s.ppl1Transient - this._ppl1Decay * dt * s.ppl1Transient - 0.02 * dt);

    // Stress hormone: builds while panic runs hot, lingers long after.
    if (s.panicLevel > 0.4) {
      s.octopamineLevel = Math.min(1, s.octopamineLevel + this._octopamineBuild * dt * s.panicLevel);
    } else {
      s.octopamineLevel = Math.max(0, s.octopamineLevel - this._octopamineDecay * dt);
    }

    // Arousal: a smoothed composite of everything demanding attention.
    const arousalTarget = Math.max(
      s.panicLevel * 0.95,
      s.octopamineLevel * 0.55,
      s.npfLevel > 0.75 ? 0.45 : 0.12,
      s.ppl1Transient * 0.6
    );
    s.arousalLevel += (arousalTarget - s.arousalLevel) * Math.min(1, dt * 4);

    s.giantFiberFiring = now < this._giantFiberUntil;
    s.stunned = now < this._stunnedUntil;
    s.disgusted = now < this._disgustedUntil;
    s.exhausted = this._exhaustedFlag;

    s.behaviorState = this._computeBehaviorState(now);
  }

  _computeBehaviorState(now) {
    const s = this.state;
    if (s.disgusted) return 'DISGUST';
    if (s.giantFiberFiring || s.panicLevel > 0.55) return 'ESCAPE';
    if (s.exhausted) return 'EXHAUSTED';
    if (s.npfLevel > 0.55) return 'FORAGING';

    // Idle flavor: alternate between a calm "GROOMING" beat and a mildly
    // alert scan when nothing urgent is going on, just for texture.
    if (now > this._groomingUntil) {
      this._groomingUntil = now + 2200 + Math.random() * 2600;
      this._grooveTimer = Math.random() < 0.5 ? 1 : 0;
    }
    return this._grooveTimer ? 'GROOMING' : 'ALERT';
  }

  // -------------------------------------------------------------------
  // Event handlers — wired directly to PacmanGame's callbacks.
  // -------------------------------------------------------------------

  /** Ellipsoid Body E-PG heading compass: the active phase bump tracks facing direction. */
  onDirectionChange(newHeadingAngle) {
    this.state.headingAngle = newHeadingAngle;
  }

  /** Mushroom Body Kenyon cell / PAM cluster dopaminergic reward on pellet capture. */
  onPelletEaten(isEnergizer) {
    this.state.npfLevel = Math.max(0, this.state.npfLevel - (isEnergizer ? 0.4 : 0.12));
    this.state.dopamineTransient = Math.min(1, this.state.dopamineTransient + (isEnergizer ? 1.0 : 0.55));
  }

  /** LC4/LPLC2 looming detection feeding the Giant Fiber escape command neuron. */
  onGhostDistanceUpdate(minDistanceToGhost) {
    const proximity = Math.max(0, 1 - minDistanceToGhost / 9);
    this.state.panicLevel = Math.min(1, Math.max(this.state.panicLevel, proximity));
    if (minDistanceToGhost < this._loomingThreshold) {
      this._giantFiberUntil = performance.now() + 900;
    }
  }

  /** Gr66a bitter gustatory receptor neurons -> PPL1 negative-reinforcement circuit. */
  onHazardEaten() {
    this.state.ppl1Transient = 1.0;
    this._stunnedUntil = performance.now() + 900;
    this._disgustedUntil = performance.now() + 1400;
  }

  /** A ghost actually made contact — a much bigger startle than mere looming. */
  onCaught() {
    this.state.panicLevel = 1.0;
    this.state.octopamineLevel = Math.min(1, this.state.octopamineLevel + 0.5);
    this._giantFiberUntil = performance.now() + 1200;
  }

  /** Pushed in by the bootstrap layer each tick — PacmanGame owns the stamina number. */
  setExhausted(isExhausted) { this._exhaustedFlag = isExhausted; }

  isStunned() { return this.state.stunned; }
  isGiantFiberFiring() { return this.state.giantFiberFiring; }
}
