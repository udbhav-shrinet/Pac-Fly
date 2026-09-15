/**
 * brain.js — The Minimal Viable Connectome
 *
 * Loads a pruned FlyWire connectome graph (nodes + weighted synapses) and
 * runs it as a Leaky Integrate-and-Fire (LIF) spiking network. Environmental
 * stimuli (ghost proximity, sugar proximity) are injected as current into
 * sensory nodes; the network propagates spikes through real synaptic weights
 * across AL -> MB, LC4 -> GF, and the descending motor pathway; motor nodes
 * are read back out as driving signals for the game loop.
 *
 * No behavior trees. No hand-authored "if ghost near then flee" logic.
 * The only game-specific code here is the sensory injection and the motor
 * readout — everything between those two points is graph propagation.
 */

const Brain = (() => {
  const params = {
    vThreshold: 1.0,
    vReset: 0.0,
    tauMembrane: 0.92,   // leak factor applied each tick before input
    refractoryTicks: 2,
  };

  let graph = null;          // raw parsed JSON
  let nodes = new Map();     // id -> node state
  let incoming = new Map();  // id -> [{pre, weight, type}]
  let outgoing = new Map();  // id -> [{post, weight, type}]
  let ready = false;

  function reset() {
    for (const n of nodes.values()) {
      n.v = 0;
      n.spiked = false;
      n.refractory = 0;
      n.trace = new Array(64).fill(0);
    }
  }

  async function load(url = 'pruned_connectome.json') {
    const res = await fetch(url);
    graph = await res.json();

    nodes = new Map();
    incoming = new Map();
    outgoing = new Map();

    for (const n of graph.nodes) {
      nodes.set(n.id, {
        id: n.id,
        region: n.region,
        type: n.type,
        x: n.x, y: n.y,
        v: 0,
        spiked: false,
        refractory: 0,
        externalCurrent: 0,
        trace: new Array(64).fill(0),
      });
      incoming.set(n.id, []);
      outgoing.set(n.id, []);
    }

    for (const e of graph.edges) {
      if (!nodes.has(e.pre) || !nodes.has(e.post)) continue;
      incoming.get(e.post).push({ pre: e.pre, weight: e.weight, type: e.type || 'excitatory' });
      outgoing.get(e.pre).push({ post: e.post, weight: e.weight, type: e.type || 'excitatory' });
    }

    if (graph.lif_params) Object.assign(params, {
      vThreshold: graph.lif_params.v_threshold ?? params.vThreshold,
      vReset: graph.lif_params.v_reset ?? params.vReset,
      tauMembrane: graph.lif_params.tau_membrane ?? params.tauMembrane,
      refractoryTicks: graph.lif_params.refractory_ms ? Math.max(1, Math.round(graph.lif_params.refractory_ms / 4)) : params.refractoryTicks,
    });

    ready = true;
    return graph;
  }

  function nodesByRegion(region) {
    const out = [];
    for (const n of nodes.values()) if (n.region === region) out.push(n);
    return out;
  }

  function nodesByIdPrefix(prefix) {
    const out = [];
    for (const n of nodes.values()) if (n.id.startsWith(prefix)) out.push(n);
    return out;
  }

  /**
   * Inject sensory current.
   * sugarProximity: 0..1, higher = closer/stronger sugar signal (drives AL)
   * ghostSignals: array of {proximity, approaching} 0..1 each, drives LC4 (looming)
   */
  function injectStimuli({ sugarProximity = 0, ghostSignals = [] }) {
    const alSensory = nodesByIdPrefix('AL_').filter(n => n.type === 'sensory');
    for (const n of alSensory) {
      n.externalCurrent += sugarProximity * (0.7 + Math.random() * 0.3);
    }

    const lcSensory = nodesByIdPrefix('LC4_').filter(n => n.type === 'sensory');
    // Looming = proximity weighted more heavily when the ghost is closing distance
    let loomingDrive = 0;
    for (const g of ghostSignals) {
      loomingDrive += g.proximity * (g.approaching ? 1.4 : 0.7);
    }
    loomingDrive = Math.min(1.6, loomingDrive);
    for (const n of lcSensory) {
      n.externalCurrent += loomingDrive * (0.6 + Math.random() * 0.4);
    }
  }

  /** Advance the network by one simulation tick (LIF integration + spike propagation). */
  function step() {
    if (!ready) return;

    // 1. Leak + integrate external current for this tick
    for (const n of nodes.values()) {
      if (n.refractory > 0) {
        n.refractory -= 1;
        n.v = params.vReset;
      } else {
        n.v = n.v * params.tauMembrane + n.externalCurrent;
      }
      n.spiked = false;
    }

    // 2. Determine spikes (threshold crossing)
    const spikers = [];
    for (const n of nodes.values()) {
      if (n.refractory === 0 && n.v >= params.vThreshold) {
        n.spiked = true;
        spikers.push(n);
      }
    }

    // 3. Propagate spikes along outgoing synapses as current for NEXT tick
    for (const n of spikers) {
      n.v = params.vReset;
      n.refractory = params.refractoryTicks;
      const edges = outgoing.get(n.id) || [];
      for (const e of edges) {
        const post = nodes.get(e.post);
        if (!post) continue;
        post.externalCurrent = (post.externalCurrent || 0) + e.weight;
      }
    }

    // 4. Clear external current inputs (they were one-shot for this tick),
    //    but re-seed continuous sensory drive happens via injectStimuli() each frame
    for (const n of nodes.values()) {
      n.externalCurrent = 0;
    }

    // 5. Record trace history for telemetry graphs
    for (const n of nodes.values()) {
      n.trace.push(n.v);
      if (n.trace.length > 64) n.trace.shift();
    }
  }

  function regionActivity(region) {
    const ns = nodesByRegion(region);
    if (ns.length === 0) return 0;
    let sum = 0;
    for (const n of ns) sum += Math.min(1, Math.max(0, n.v));
    return sum / ns.length;
  }

  function spikeRate(region) {
    const ns = nodesByRegion(region);
    if (ns.length === 0) return 0;
    let spiked = 0;
    for (const n of ns) if (n.spiked) spiked++;
    return spiked / ns.length;
  }

  /** Read motor output: forward drive + left/right steering bias, and GF panic state. */
  function readMotorOutput() {
    const fwd = nodes.get('DN_FWD');
    const steerL = nodes.get('DN_STEER_L');
    const steerR = nodes.get('DN_STEER_R');
    const gfL = nodes.get('GF_L');
    const gfR = nodes.get('GF_R');

    const panic = Math.max(regionActivity('GF'), spikeRate('GF'));
    const forward = fwd ? Math.min(1, Math.max(0, fwd.v)) : 0;
    const left = steerL ? Math.min(1, Math.max(0, steerL.v)) : 0;
    const right = steerR ? Math.min(1, Math.max(0, steerR.v)) : 0;

    return {
      forward,
      left,
      right,
      panic,
      gfFired: (gfL && gfL.spiked) || (gfR && gfR.spiked),
      hunger: regionActivity('AL'),
      dopamine: regionActivity('MB'),
    };
  }

  function getTrace(region) {
    const ns = nodesByRegion(region);
    if (ns.length === 0) return new Array(64).fill(0);
    const len = 64;
    const avg = new Array(len).fill(0);
    for (const n of ns) {
      for (let i = 0; i < len; i++) avg[i] += (n.trace[i] || 0);
    }
    for (let i = 0; i < len; i++) avg[i] /= ns.length;
    return avg;
  }

  function allNodes() {
    return Array.from(nodes.values());
  }

  function allEdges() {
    return graph ? graph.edges : [];
  }

  function isReady() { return ready; }

  return {
    load,
    reset,
    step,
    injectStimuli,
    regionActivity,
    spikeRate,
    readMotorOutput,
    getTrace,
    allNodes,
    allEdges,
    isReady,
    get regions() { return graph ? graph.regions : {}; },
  };
})();
