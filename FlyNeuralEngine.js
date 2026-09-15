/**
 * FlyNeuralEngine.js — a lightweight biochemical state machine mapping
 * arcade gameplay events onto named Drosophila functional circuits
 * (FlyWire / neuPrint nomenclature). This is intentionally NOT a spiking
 * network simulation — it is a small set of decaying/accumulating scalars
 * that a 3D visualizer (or any other observer) can read every frame. It
 * never touches the DOM, the canvas, or Three.js, and it never calls back
 * into PacmanGame — the only coupling is one-directional: the game's event
 * callbacks feed data in here.
 *
 * @typedef {Object} FlyNeuralState
 * @property {number} headingAngle       0..2*PI — fed by the Ellipsoid Body's E-PG heading compass
 * @property {number} npfLevel           0..1 — Neuropeptide F, hunger/starvation drive
 * @property {number} dopamineTransient  0..1 — PAM/MBON reward spike, exponential decay
 * @property {number} octopamineLevel    0..1 — stress/fear tone from ghost proximity
 * @property {number} ppl1Transient      0..1 — PPL1 aversive/negative-reinforcement spike
 * @property {boolean} giantFiberFiring  Giant Fiber escape reflex flag
 * @property {boolean} stunned           Gr66a bitter-gustatory stun flag
 */

class FlyNeuralEngine {
  constructor() {
    /** @type {FlyNeuralState} */
    this.state = {
      headingAngle: 0,
      npfLevel: 0.2,
      dopamineTransient: 0,
      octopamineLevel: 0,
      ppl1Transient: 0,
      giantFiberFiring: false,
      stunned: false,
    };

    this._npfGrowthRate = 0.035; // per second while foraging without food
    this._dopamineDecay = 3.2;   // exponential decay constant, 1/s
    this._octopamineDecay = 1.6; // 1/s
    this._ppl1Decay = 2.4;       // 1/s
    this._giantFiberUntil = 0;
    this._stunnedUntil = 0;

    this._loomingThreshold = 3.2; // tile-distance below which GF fires
  }

  /** Advance decay/growth dynamics. Call once per simulation tick with dt in seconds. */
  update(dt) {
    const s = this.state;
    const now = performance.now();

    s.npfLevel = Math.min(1, s.npfLevel + this._npfGrowthRate * dt);
    s.dopamineTransient = Math.max(0, s.dopamineTransient - this._dopamineDecay * dt * s.dopamineTransient - 0.02 * dt);
    s.octopamineLevel = Math.max(0, s.octopamineLevel - this._octopamineDecay * dt);
    s.ppl1Transient = Math.max(0, s.ppl1Transient - this._ppl1Decay * dt * s.ppl1Transient - 0.02 * dt);

    s.giantFiberFiring = now < this._giantFiberUntil;
    s.stunned = now < this._stunnedUntil;
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
    this.state.octopamineLevel = Math.min(1, Math.max(this.state.octopamineLevel, proximity));
    if (minDistanceToGhost < this._loomingThreshold) {
      this._giantFiberUntil = performance.now() + 900;
    }
  }

  /** Gr66a bitter gustatory receptor neurons -> PPL1 negative-reinforcement circuit. */
  onHazardEaten() {
    this.state.ppl1Transient = 1.0;
    this._stunnedUntil = performance.now() + 900;
  }

  isStunned() { return this.state.stunned; }
  isGiantFiberFiring() { return this.state.giantFiberFiring; }
}
