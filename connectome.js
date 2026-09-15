/**
 * connectome.js — the Connectome class.
 *
 * The graph topology (which real FlyWire-pruned neurons exist, and which
 * synapses connect them) is parsed once and shared by every fly. What is
 * NOT shared is the synaptic weight vector: each Connectome instance owns
 * its own Float32Array of weights (a clone of the template, optionally
 * mutated), so 50 flies really do carry 50 distinct brains while the
 * expensive graph-shape bookkeeping (indices, region groupings, key-neuron
 * lookups) is computed exactly once.
 */

class Connectome {
  static graph = null;
  static nodeIds = [];
  static nodeIndex = new Map();
  static n = 0;
  static m = 0;
  static region = [];
  static type = [];
  static nodeX = null;
  static nodeY = null;
  static edgesPre = null;
  static edgesPost = null;
  static baseWeight = null;
  static edgeType = [];
  static regionGroups = {};
  static sensoryAL = [];
  static sensoryLC4 = [];
  static idxDNFWD = -1;
  static idxDNL = -1;
  static idxDNR = -1;
  static idxGFL = -1;
  static idxGFR = -1;
  static keyNeurons = []; // for the spike raster plot
  static params = { vThreshold: 1.0, vReset: 0.0, tauMembrane: 0.92, refractoryTicks: 2 };

  static async load(url = 'pruned_connectome.json') {
    const res = await fetch(url);
    const graph = await res.json();
    Connectome.graph = graph;

    const n = graph.nodes.length;
    Connectome.n = n;
    Connectome.nodeIds = new Array(n);
    Connectome.nodeIndex = new Map();
    Connectome.region = new Array(n);
    Connectome.type = new Array(n);
    Connectome.nodeX = new Float32Array(n);
    Connectome.nodeY = new Float32Array(n);
    Connectome.regionGroups = {};
    Connectome.sensoryAL = [];
    Connectome.sensoryLC4 = [];

    graph.nodes.forEach((node, i) => {
      Connectome.nodeIds[i] = node.id;
      Connectome.nodeIndex.set(node.id, i);
      Connectome.region[i] = node.region;
      Connectome.type[i] = node.type;
      Connectome.nodeX[i] = node.x;
      Connectome.nodeY[i] = node.y;
      if (!Connectome.regionGroups[node.region]) Connectome.regionGroups[node.region] = [];
      Connectome.regionGroups[node.region].push(i);
      if (node.region === 'AL' && node.type === 'sensory') Connectome.sensoryAL.push(i);
      if (node.region === 'LC4' && node.type === 'sensory') Connectome.sensoryLC4.push(i);
    });

    const edges = graph.edges.filter(e => Connectome.nodeIndex.has(e.pre) && Connectome.nodeIndex.has(e.post));
    const m = edges.length;
    Connectome.m = m;
    Connectome.edgesPre = new Int32Array(m);
    Connectome.edgesPost = new Int32Array(m);
    Connectome.baseWeight = new Float32Array(m);
    Connectome.edgeType = new Array(m);
    edges.forEach((e, i) => {
      Connectome.edgesPre[i] = Connectome.nodeIndex.get(e.pre);
      Connectome.edgesPost[i] = Connectome.nodeIndex.get(e.post);
      Connectome.baseWeight[i] = e.weight;
      Connectome.edgeType[i] = e.type || 'excitatory';
    });

    Connectome.idxDNFWD = Connectome.nodeIndex.get('DN_FWD') ?? -1;
    Connectome.idxDNL = Connectome.nodeIndex.get('DN_STEER_L') ?? -1;
    Connectome.idxDNR = Connectome.nodeIndex.get('DN_STEER_R') ?? -1;
    Connectome.idxGFL = Connectome.nodeIndex.get('GF_L') ?? -1;
    Connectome.idxGFR = Connectome.nodeIndex.get('GF_R') ?? -1;

    const keyIds = ['AL_12', 'AL_13', 'LC4_10', 'LC4_11', 'GF_L', 'GF_R', 'MB_DAN_00', 'MB_MBON_00', 'DN_DNp09', 'DN_FWD', 'DN_STEER_L', 'DN_STEER_R'];
    Connectome.keyNeurons = keyIds
      .filter(id => Connectome.nodeIndex.has(id))
      .map(id => ({ id, idx: Connectome.nodeIndex.get(id), region: Connectome.region[Connectome.nodeIndex.get(id)] }));

    if (graph.lif_params) {
      Connectome.params.vThreshold = graph.lif_params.v_threshold ?? 1.0;
      Connectome.params.vReset = graph.lif_params.v_reset ?? 0.0;
      Connectome.params.tauMembrane = graph.lif_params.tau_membrane ?? 0.92;
      Connectome.params.refractoryTicks = graph.lif_params.refractory_ms ? Math.max(1, Math.round(graph.lif_params.refractory_ms / 4)) : 2;
    }

    return graph;
  }

  static get regions() { return Connectome.graph ? Connectome.graph.regions : {}; }

  /** A fresh, lightly-mutated copy of the template weight vector — used for "randomized baseline" spawns. */
  static randomizedWeights(mutationScale = 0.35) {
    const w = new Float32Array(Connectome.m);
    for (let i = 0; i < Connectome.m; i++) {
      const noise = (Math.random() * 2 - 1) * mutationScale * Math.abs(Connectome.baseWeight[i]);
      w[i] = Connectome.baseWeight[i] + noise;
    }
    return w;
  }

  /** Clone + small mutation of an existing weight vector, for sampling the fitness roster. */
  static mutate(weights, mutationScale = 0.12) {
    const w = new Float32Array(weights.length);
    for (let i = 0; i < weights.length; i++) {
      const noise = (Math.random() * 2 - 1) * mutationScale * Math.abs(weights[i] || 0.01);
      w[i] = weights[i] + noise;
    }
    return w;
  }

  constructor(weights) {
    const n = Connectome.n, m = Connectome.m;
    this.weights = weights || Connectome.baseWeight.slice();
    this.v = new Float32Array(n);
    this.refractory = new Uint8Array(n);
    this.spiked = new Uint8Array(n);
    this.externalCurrent = new Float32Array(n);
    this.alWeightMultiplier = 1.0; // neuromodulator override (Fasting Hormone)
    this.forcedLC4 = -1; // neuromodulator override (Adrenaline): -1 = no override
    this.motorLock = null; // neuromodulator override (Dopamine Spike): {forward,left,right}
  }

  reset() {
    this.v.fill(0);
    this.refractory.fill(0);
    this.spiked.fill(0);
    this.externalCurrent.fill(0);
  }

  injectAL(amount) {
    const mult = this.alWeightMultiplier;
    for (const i of Connectome.sensoryAL) {
      this.externalCurrent[i] += amount * mult * (0.7 + Math.random() * 0.3);
    }
  }

  injectLC4(amount) {
    for (const i of Connectome.sensoryLC4) {
      this.externalCurrent[i] += amount * (0.6 + Math.random() * 0.4);
    }
  }

  step() {
    const { vThreshold, vReset, tauMembrane, refractoryTicks } = Connectome.params;
    const n = Connectome.n;
    const v = this.v, refractory = this.refractory, spiked = this.spiked, ext = this.externalCurrent;

    for (let i = 0; i < n; i++) {
      if (refractory[i] > 0) {
        refractory[i] -= 1;
        v[i] = vReset;
      } else {
        v[i] = v[i] * tauMembrane + ext[i];
      }
      spiked[i] = 0;
    }

    // Adrenaline override: pin the Giant Fiber / LC4 projection neurons hot.
    if (this.forcedLC4 >= 0) {
      for (const i of Connectome.sensoryLC4) v[i] = Math.max(v[i], this.forcedLC4);
      if (Connectome.idxGFL >= 0) v[Connectome.idxGFL] = Math.max(v[Connectome.idxGFL], this.forcedLC4);
      if (Connectome.idxGFR >= 0) v[Connectome.idxGFR] = Math.max(v[Connectome.idxGFR], this.forcedLC4);
    }

    const m = Connectome.m, pre = Connectome.edgesPre, post = Connectome.edgesPost, w = this.weights;
    for (let i = 0; i < n; i++) {
      if (refractory[i] === 0 && v[i] >= vThreshold) spiked[i] = 1;
    }
    for (let e = 0; e < m; e++) {
      if (spiked[pre[e]]) ext[post[e]] = (ext[post[e]] || 0) + w[e];
    }
    for (let i = 0; i < n; i++) {
      if (spiked[i]) { v[i] = vReset; refractory[i] = refractoryTicks; }
    }
    ext.fill(0);
  }

  regionActivity(regionName) {
    const group = Connectome.regionGroups[regionName];
    if (!group || group.length === 0) return 0;
    let sum = 0;
    for (const i of group) sum += Math.min(1, Math.max(0, this.v[i]));
    return sum / group.length;
  }

  spikeRate(regionName) {
    const group = Connectome.regionGroups[regionName];
    if (!group || group.length === 0) return 0;
    let s = 0;
    for (const i of group) s += this.spiked[i];
    return s / group.length;
  }

  readMotor() {
    if (this.motorLock) return this.motorLock;
    const fwd = Connectome.idxDNFWD >= 0 ? Math.min(1, Math.max(0, this.v[Connectome.idxDNFWD])) : 0;
    const left = Connectome.idxDNL >= 0 ? Math.min(1, Math.max(0, this.v[Connectome.idxDNL])) : 0;
    const right = Connectome.idxDNR >= 0 ? Math.min(1, Math.max(0, this.v[Connectome.idxDNR])) : 0;
    const panic = Math.max(this.regionActivity('GF'), this.spikeRate('GF'));
    return {
      forward: fwd, left, right, panic,
      gfFired: (Connectome.idxGFL >= 0 && this.spiked[Connectome.idxGFL]) || (Connectome.idxGFR >= 0 && this.spiked[Connectome.idxGFR]),
      hunger: this.regionActivity('AL'),
      dopamine: this.regionActivity('MB'),
    };
  }

  keyNeuronSpikes() {
    return Connectome.keyNeurons.map(k => this.spiked[k.idx] === 1);
  }

  nodeSnapshot() {
    // Used for the live per-fly connectome mini-graph.
    const n = Connectome.n;
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      out[i] = { id: Connectome.nodeIds[i], region: Connectome.region[i], x: Connectome.nodeX[i], y: Connectome.nodeY[i], v: this.v[i], spiked: this.spiked[i] === 1 };
    }
    return out;
  }
}
