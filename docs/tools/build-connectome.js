#!/usr/bin/env node
/**
 * build-connectome.js — deterministic generator for `connectome.json`.
 *
 * This emits a pruned, structurally-representative sub-circuit of the
 * Drosophila melanogaster brain in the adjacency-matrix format the runtime
 * `Connectome` class consumes. Every population name, its polarity, and the
 * direction of each projection follow the documented FlyWire / hemibrain
 * connectivity of these circuits:
 *
 *   ORN → PN                 olfactory receptor neurons feed antennal lobe PNs
 *   PN  → LH                 innate-attraction pathway (lateral horn)
 *   PN  → KC → MBON          learned-valence pathway (mushroom body)
 *   PAM → MBON               reward dopaminergic cluster potentiates approach
 *   PPL1 → MBON              punishment dopaminergic cluster suppresses approach
 *   NPF → PN                 neuropeptide F raises olfactory gain when starved
 *   LC4/LPLC2 → GF           looming detectors drive the Giant Fiber
 *   GF → MBON                escape command inhibits feeding drive
 *   GF → DNp09 / MDN         escape drives forward sprint / backward retreat
 *   OA(VPM) → LC4            octopaminergic stress sensitizes threat detection
 *   E-PG → DNa               heading compass biases steering commands
 *
 * Run: node tools/build-connectome.js > connectome.json
 *
 * The weights are hand-set to published *signs* and plausible relative
 * magnitudes, not scraped synapse counts — see the honesty note in README.
 */

// Deterministic PRNG so regenerating the file never churns the diff.
let seed = 0x5ee0;
function rand() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0x100000000;
}

const POPULATIONS = [
  // name,            count, threshold, tau,   refractory, role
  ['ORN_sugar_L', 3, 1.0, 0.80, 1, 'sensory'],
  ['ORN_sugar_R', 3, 1.0, 0.80, 1, 'sensory'],
  ['PN_L', 3, 1.0, 0.84, 1, 'interneuron'],
  ['PN_R', 3, 1.0, 0.84, 1, 'interneuron'],
  ['LH_L', 2, 1.0, 0.84, 1, 'interneuron'],
  ['LH_R', 2, 1.0, 0.84, 1, 'interneuron'],
  ['KC', 8, 1.15, 0.85, 2, 'interneuron'],
  ['MBON_approach', 3, 1.0, 0.86, 1, 'interneuron'],
  ['PAM_DAN', 4, 1.0, 0.88, 1, 'modulatory'],
  ['PPL1_DAN', 3, 1.0, 0.90, 1, 'modulatory'],
  ['NPF', 2, 1.0, 0.995, 1, 'modulatory'],   // very slow integrator: hunger
  ['LC4_L', 3, 0.9, 0.75, 1, 'sensory'],
  ['LC4_R', 3, 0.9, 0.75, 1, 'sensory'],
  ['LPLC2_L', 2, 0.95, 0.78, 1, 'sensory'],
  ['LPLC2_R', 2, 0.95, 0.78, 1, 'sensory'],
  ['GF', 2, 1.05, 0.70, 2, 'command'],
  ['OA_VPM', 3, 1.0, 0.985, 1, 'modulatory'], // slow: lingering stress hormone
  ['EPG', 4, 1.0, 0.86, 1, 'interneuron'],
  ['DNa_left', 3, 1.0, 0.80, 1, 'motor'],
  ['DNa_right', 3, 1.0, 0.80, 1, 'motor'],
  ['DNp09_fwd', 3, 1.0, 0.80, 1, 'motor'],
  ['MDN_escape', 2, 1.05, 0.78, 1, 'motor'],
];

const neurons = [];
const byPop = {};
for (const [pop, count, threshold, tau, refractory, role] of POPULATIONS) {
  byPop[pop] = [];
  for (let i = 0; i < count; i++) {
    const id = `${pop}_${i}`;
    byPop[pop].push(id);
    neurons.push({ id, population: pop, role, threshold, tau, refractory });
  }
}

const synapses = [];
function connect(prePop, postPop, weight, opts = {}) {
  const { fanout = Infinity, jitter = 0.12, skipSelf = false } = opts;
  for (const pre of byPop[prePop]) {
    let targets = byPop[postPop];
    if (fanout < targets.length) {
      targets = [...targets].sort(() => rand() - 0.5).slice(0, fanout);
    }
    for (const post of targets) {
      if (skipSelf && pre === post) continue;
      const w = weight * (1 + (rand() - 0.5) * 2 * jitter);
      synapses.push({ pre, post, weight: Number(w.toFixed(4)) });
    }
  }
}

// --- Olfactory / foraging pathway (sugar) -----------------------------
connect('ORN_sugar_L', 'PN_L', 0.90);
connect('ORN_sugar_R', 'PN_R', 0.90);
// Innate attraction: lateral horn preserves left/right bearing.
connect('PN_L', 'LH_L', 0.70);
connect('PN_R', 'LH_R', 0.70);
connect('LH_L', 'DNa_left', 0.55);
connect('LH_R', 'DNa_right', 0.55);
// Learned valence: sparse divergent PN→KC, then KC→MBON.
connect('PN_L', 'KC', 0.35, { fanout: 4 });
connect('PN_R', 'KC', 0.35, { fanout: 4 });
connect('KC', 'MBON_approach', 0.45, { fanout: 2 });
connect('MBON_approach', 'DNp09_fwd', 0.50);

// --- Reward / hunger --------------------------------------------------
connect('PAM_DAN', 'MBON_approach', 0.60);
connect('PAM_DAN', 'NPF', -0.90);          // satiation suppresses hunger drive
connect('NPF', 'PN_L', 0.50);              // starvation raises olfactory gain
connect('NPF', 'PN_R', 0.50);
connect('NPF', 'DNp09_fwd', 0.40);         // hunger drives search locomotion
connect('NPF', 'NPF', 0.15, { skipSelf: true, jitter: 0.02 }); // slow integrator

// --- Aversive / bitter ------------------------------------------------
connect('PPL1_DAN', 'MBON_approach', -1.20);
connect('PPL1_DAN', 'DNp09_fwd', -0.80);   // disgust → stop

// --- Looming / escape -------------------------------------------------
connect('LC4_L', 'GF', 0.80);
connect('LC4_R', 'GF', 0.80);
connect('LPLC2_L', 'GF', 0.65);
connect('LPLC2_R', 'GF', 0.65);
// Threat on one side drives the CONTRA-lateral turn command: this is the
// steering asymmetry that makes the fly turn away from a predator.
connect('LC4_L', 'DNa_right', 1.40);
connect('LC4_R', 'DNa_left', 1.40);
connect('LPLC2_L', 'DNa_right', 0.90);
connect('LPLC2_R', 'DNa_left', 0.90);
// The escape command outcompetes feeding by raw synaptic gain, not by any
// if-statement in the game: GF strongly inhibits the approach pathway.
connect('GF', 'MBON_approach', -1.50);
connect('GF', 'DNp09_fwd', 1.00);
connect('GF', 'MDN_escape', 1.20);
connect('GF', 'OA_VPM', 0.50);
connect('MDN_escape', 'DNp09_fwd', -0.70);

// --- Stress / arousal -------------------------------------------------
connect('OA_VPM', 'DNp09_fwd', 0.30);
connect('OA_VPM', 'LC4_L', 0.25);
connect('OA_VPM', 'LC4_R', 0.25);

// --- Heading compass --------------------------------------------------
connect('EPG', 'DNa_left', 0.20, { fanout: 2 });
connect('EPG', 'DNa_right', 0.20, { fanout: 2 });

const doc = {
  meta: {
    name: 'Pac-Fly pruned foraging/escape sub-circuit',
    species: 'Drosophila melanogaster',
    provenance:
      'Population identities, projection directions and synaptic signs follow published FlyWire/hemibrain connectivity for these circuits. Relative weight magnitudes are hand-set, not scraped synapse counts.',
    references: ['https://codex.flywire.ai', 'https://neuprint.janelia.org'],
    neuronCount: neurons.length,
    synapseCount: synapses.length,
    // Populations the runtime injects sensory current into.
    sensoryPorts: {
      sugarLeft: 'ORN_sugar_L',
      sugarRight: 'ORN_sugar_R',
      loomingLeft: 'LC4_L',
      loomingRight: 'LC4_R',
      auditoryLeft: 'LPLC2_L',
      auditoryRight: 'LPLC2_R',
      reward: 'PAM_DAN',
      punishment: 'PPL1_DAN',
      hungerDrive: 'NPF',
      heading: 'EPG',
    },
    // Populations the runtime reads motor/behavioural output from.
    motorPorts: {
      turnLeft: 'DNa_left',
      turnRight: 'DNa_right',
      forward: 'DNp09_fwd',
      reverse: 'MDN_escape',
      escapeCommand: 'GF',
    },
  },
  neurons,
  synapses,
};

process.stdout.write(JSON.stringify(doc, null, 1) + '\n');
