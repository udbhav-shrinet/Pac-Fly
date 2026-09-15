/**
 * Connectome.js — a real leaky integrate-and-fire (LIF) spiking network
 * that loads and processes the `connectome.json` adjacency matrix at
 * runtime. This is the actual "brain": every population's membrane
 * potential, spike, and synaptic propagation step happens here, driven
 * entirely by the loaded graph — nothing here is a hand-coded rule about
 * "if ghost is near, flee." Escape dominating foraging is an emergent
 * property of the GF→MBON_approach inhibitory synapse weight being larger
 * in magnitude than the reward pathway, not an if-statement.
 *
 * Model: v[t+1] = v[t] * tau + I_external[t] + I_synaptic[t]
 *        spike when v >= threshold, then v resets to 0 and the neuron
 *        enters a refractory period during which it cannot integrate.
 *        On spike, the neuron's weighted synapses push current into
 *        their postsynaptic targets on the *next* step (biological delay
 *        of one simulation tick, not instantaneous propagation).
 */

class Connectome {
  /** @param {{meta:object, neurons:Array, synapses:Array}} doc */
  constructor(doc) {
    this.meta = doc.meta;
    const neurons = doc.neurons;
    const n = neurons.length;

    this.n = n;
    this.idToIndex = new Map();
    this.indexToId = new Array(n);
    this.population = new Array(n);
    neurons.forEach((neuron, i) => {
      this.idToIndex.set(neuron.id, i);
      this.indexToId[i] = neuron.id;
      this.population[i] = neuron.population;
    });

    this.threshold = new Float32Array(n);
    this.tau = new Float32Array(n);
    this.refractoryLimit = new Int16Array(n);
    neurons.forEach((neuron, i) => {
      this.threshold[i] = neuron.threshold;
      this.tau[i] = neuron.tau;
      this.refractoryLimit[i] = neuron.refractory;
    });

    this.v = new Float32Array(n);
    this.refractory = new Int16Array(n);
    this.spiked = new Uint8Array(n);
    this.preTrace = new Float32Array(n);
    this.postTrace = new Float32Array(n);
    this.rewardSignal = 0;
    this.externalCurrent = new Float32Array(n);
    this.pendingCurrent = new Float32Array(n); // synaptic input queued for next step

    // Calcium-style integrated activity trace: jumps on every spike, decays
    // geometrically each tick. This — not raw membrane potential — is what
    // populationActivity() reads. Raw v gets forced to exactly 0 on every
    // refractory tick, which makes single-neuron voltage a poor, extremely
    // sample-time-sensitive signal for anything downstream (motor readout,
    // dashboard). A calcium/firing-rate-integrated trace is also literally
    // what GCaMP imaging (what BrainVisualizer is modeled on) measures.
    this.calcium = new Float32Array(n);
    this.CALCIUM_DECAY = 0.78; // per 100ms tick — a few-hundred-ms window

    // Compact CSR-style adjacency: for each pre-synaptic neuron, the list
    // of (postIndex, weight) pairs it projects to. Built once from the
    // sparse synapse list so each simulation step is O(spikes × fanout),
    // not O(neurons²).
    this._outgoing = Array.from({ length: n }, () => []);
    for (const syn of doc.synapses) {
      const pre = this.idToIndex.get(syn.pre);
      const post = this.idToIndex.get(syn.post);
      if (pre === undefined || post === undefined) continue;
      this._outgoing[pre].push([post, syn.weight]);
    }

    // Population index: name -> array of neuron indices.
    this._popIndex = new Map();
    neurons.forEach((neuron, i) => {
      if (!this._popIndex.has(neuron.population)) this._popIndex.set(neuron.population, []);
      this._popIndex.get(neuron.population).push(i);
    });

    this.sensoryPorts = doc.meta.sensoryPorts || {};
    this.motorPorts = doc.meta.motorPorts || {};

    this._tickCount = 0;
  }

  /** Fetches and parses connectome.json, returns a ready Connectome instance. */
  static async load(url = 'connectome.json') {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Connectome: failed to fetch ${url} (${res.status})`);
    const doc = await res.json();
    return new Connectome(doc);
  }

  /** Injects external current into every neuron of a named population. */
  injectPopulation(populationName, current) {
    const idxs = this._popIndex.get(populationName);
    if (!idxs) return;
    for (const i of idxs) this.externalCurrent[i] += current;
  }

  /** Injects external current into one specific neuron by id (e.g. an EPG heading-bump cell). */
  injectNeuron(id, current) {
    const i = this.idToIndex.get(id);
    if (i === undefined) return;
    this.externalCurrent[i] += current;
  }

  setReward(value) { this.rewardSignal = Math.max(-1, Math.min(1, value)); }

  applyPlasticity() {
    if (!this.rewardSignal) return;
    for (let pre = 0; pre < this.n; pre++) {
      for (const edge of this._outgoing[pre]) {
        const [post] = edge;
        edge[1] = Math.max(-2, Math.min(2, edge[1] + this.rewardSignal * 0.0008 * (this.preTrace[pre] * this.postTrace[post] - 0.4 * this.preTrace[post] * this.postTrace[pre])));
      }
    }
    this.rewardSignal *= 0.82;
  }

  /** One LIF simulation tick: leak + integrate, threshold, propagate, refractory. */
  step() {
    const { n, v, tau, threshold, refractory, refractoryLimit, spiked, externalCurrent, pendingCurrent } = this;
    for (let i = 0; i < n; i++) {
      this.preTrace[i] *= 0.92;
      this.postTrace[i] *= 0.92;
      if (spiked[i]) this.preTrace[i] = this.postTrace[i] = 1;
    }
    this.applyPlasticity();

    for (let i = 0; i < n; i++) {
      if (refractory[i] > 0) {
        refractory[i]--;
        spiked[i] = 0;
        v[i] = 0;
        continue;
      }
      v[i] = v[i] * tau[i] + externalCurrent[i] + pendingCurrent[i];
      if (v[i] < 0) v[i] = 0;

      if (v[i] >= threshold[i]) {
        spiked[i] = 1;
        v[i] = threshold[i]; // hold at threshold for one tick so readouts see the spike amplitude
        refractory[i] = refractoryLimit[i];
      } else {
        spiked[i] = 0;
      }
    }

    // Queue synaptic current for the *next* tick (one-tick synaptic delay).
    pendingCurrent.fill(0);
    for (let i = 0; i < n; i++) {
      if (!spiked[i]) continue;
      for (const [post, weight] of this._outgoing[i]) {
        pendingCurrent[post] += weight;
      }
    }

    const decay = this.CALCIUM_DECAY;
    for (let i = 0; i < n; i++) {
      this.calcium[i] = this.calcium[i] * decay + (spiked[i] ? 1 : 0);
    }

    externalCurrent.fill(0);
    this._tickCount++;
  }

  /**
   * Mean calcium-trace activity across a population, roughly 0..1 (can
   * exceed 1 briefly under a fast burst). This is the integrated,
   * decaying signal — not raw instantaneous membrane potential, which
   * gets hard-reset to 0 every refractory tick and would otherwise make
   * every reader of this function extremely sensitive to exactly which
   * 100ms tick it happened to sample on.
   */
  populationActivity(populationName) {
    const idxs = this._popIndex.get(populationName);
    if (!idxs || idxs.length === 0) return 0;
    let sum = 0;
    for (const i of idxs) sum += this.calcium[i];
    return sum / idxs.length;
  }

  /**
   * Mean raw membrane potential (normalized 0..1 by threshold) across a
   * population. Unlike populationActivity(), this is NOT calcium-smoothed —
   * appropriate specifically for a population meant to be read as a
   * graded sub-threshold accumulator (e.g. NPF hunger) rather than a
   * spike/burst signal, where calcium's "only moves on a spike" behavior
   * would leave the readout sitting at 0 until the very first threshold
   * crossing.
   */
  populationVoltage(populationName) {
    const idxs = this._popIndex.get(populationName);
    if (!idxs || idxs.length === 0) return 0;
    let sum = 0;
    for (const i of idxs) sum += this.v[i] / this.threshold[i];
    return sum / idxs.length;
  }

  /** Fraction of a population that spiked on the most recent tick. */
  populationSpikeRate(populationName) {
    const idxs = this._popIndex.get(populationName);
    if (!idxs || idxs.length === 0) return 0;
    let sum = 0;
    for (const i of idxs) sum += this.spiked[i];
    return sum / idxs.length;
  }

  /** Snapshot of every neuron's normalized potential + spike flag, for visualization. */
  snapshot() {
    const out = new Array(this.n);
    for (let i = 0; i < this.n; i++) {
      out[i] = {
        id: this.indexToId[i],
        population: this.population[i],
        v: this.v[i] / this.threshold[i],
        spiked: !!this.spiked[i],
      };
    }
    return out;
  }
}
