# 🟡 Pac-Fly: FlyWire Brain × Arcade Arena

**A pixel-accurate recreation of the 1980 arcade Pac-Man maze, controlled entirely by a real leaky integrate-and-fire spiking network that loads and processes a Drosophila melanogaster connectome adjacency matrix at runtime.**

Pac-Man does not take player input. He is not driven by a distance-scoring heuristic. Every direction change comes from reading descending-neuron motor populations out of a 66-neuron, 270-synapse graph after it has been stepped — the same way `readMotor()` would work in a real closed-loop connectome simulation.

Zero build step. Open `index.html` and it runs.

## 🧠 The whole-brain upgrade

Pac-Fly now ships a **FlyWire FAFB v783-derived binary graph**: **139,255
neurons and 2,698,236 aggregated connections**. The graph is decompressed and
simulated in `FullBrainWorker.js`, not on the rendering thread. CSR typed
arrays, active-group gating, and a 10 Hz tick keep the interface responsive;
the UI can render the live fire state without freezing the arena.

This is a real structural connectome-driven model, not an LLM and not a
marketing-only counter. The bridge injects food, looming danger, touch,
gustatory reward, bitter punishment, and hunger into annotated FlyWire-derived
functional groups, then reads walking, turning, backup, flight, and startle
groups back into the arena motor contract.

**Scientific boundary:** FlyWire provides a measured wiring diagram, not a
validated whole-brain biophysical simulation. Membrane constants, synaptic
normalization, group-level sensory interfaces, and behavior readouts are
explicit modeling assumptions. The original 66-neuron circuit remains as a
fallback when the binary asset or Worker is unavailable.

### ⚡ Interactive research mode

- 🧂 Click **Sugar** to place food; normal sugar gives a small reward.
- ⚪ Power pellets are high-salience rewards and produce a larger dopaminergic
  signal.
- 🟣 Bitter traps stimulate aversive gustatory pathways and remove a ghost on
  contact.
- 🕹️ Toggle **Human chase mode** through the arena controls to enter the maze
  and pursue the autonomous fly (the connectome still controls the fly).
- 🌗 Switch the lab between dark fluorescence and clinical light mode.
- 📈 Watch hunger, fear, dopamine, arousal, drive balance, and behavior history
  update from the running brain backend.

### 📦 Asset provenance

The checked-in binary is derived from the public FlyWire FAFB v783 release and
is redistributed as a compact browser artifact. Credit the FlyWire Consortium
and cite: Dorkenwald et al., *Neuronal wiring diagram of an adult brain*,
Nature 634, 124–138 (2024), DOI
[10.1038/s41586-024-07558-y](https://doi.org/10.1038/s41586-024-07558-y).
The upstream data is versioned; do not silently replace it with a different
materialization.

## V2 research console

The V2 interface is a non-scrolling three-column research console. The arena
uses a compact 12px logical tile scale so the complete 28x31 maze remains
visible beside the brain and telemetry panels. God Mode supports click-to-place
sugar and bitter traps, clearing or filling sugar, predator versus prey ghost
behavior, and independent fly and ghost speed scaling. A light-mode toggle
preserves the same hierarchy with clinical high-contrast colors.

Telemetry includes a drive-balance radar, fear-versus-dopamine bubble plot
(bubble radius is an aggregate activity proxy), and a color-coded recent-state
sequence. These are **model readouts**, not measured hormone concentrations or
behavioral observations from a living fly. The FlyWire graph has no validated
NPF/GF/neuromodulator calibration in this app, so the UI labels those values as
proxies. Arena heading is the game heading; it is not an inferred biological
compass state from the whole-brain graph.

An energizer creates an 8-second frightened-ghost interval. Capturing a
frightened ghost awards 200 points and sends a larger reward event to the
FlyWire bridge; ordinary sugar remains a small reward. The timeline uses
state-transition durations across its recent 12.6-second window rather than
claiming long-term behavioral occupancy.

---

## What this actually is

Four things, cleanly separated, bridged by one small file:

1. **`connectome.json`** — the adjacency matrix. 66 neurons across 22 functionally-named populations (olfactory receptor neurons, projection neurons, Kenyon cells, mushroom body output neurons, dopaminergic clusters, looming detectors, the Giant Fiber, octopaminergic neurons, the Ellipsoid Body heading compass, descending motor neurons) and 270 weighted, directed synapses between them. Generated deterministically by [`tools/build-connectome.js`](tools/build-connectome.js) — see [the format](#the-adjacency-matrix-format) and [the honesty note](#on-scientific-honesty) below.

2. **`Connectome.js`** — the actual brain. Fetches and parses `connectome.json`, then runs a real leaky integrate-and-fire (LIF) simulation over it: `v[t+1] = v[t]·τ + I_external + I_synaptic`, threshold, spike, one-tick synaptic delay, refractory period, all as flat typed arrays. `injectPopulation()` / `injectNeuron()` push sensory current in; `populationActivity()` / `populationVoltage()` read it back out. This file has never heard of Pac-Man, ghosts, or sugar — it only knows neurons and synapses.

3. **`PacmanGame.js`** — the arcade body. The real 28×31 tile maze from the original ROM, double-stroke neon-blue walls, the ghost house, the horizontal warp tunnel, tile-snapped movement (Pac-Man can only turn when centered on a tile intersection, exactly like 1980), and four ghosts running the *actual* classic targeting algorithm (Blinky chases directly, Pinky ambushes 4 tiles ahead, Inky reflects Blinky's position through a point ahead of Pac-Man, Clyde chases-then-flees on a distance threshold). Every decision point it hands `callbacks.brainTick(sense)` a sensory snapshot — bearing and distance to the nearest sugar, bearing and distance to the nearest sensed ghost, current heading — and reads back `{left, right, forward, reverse, rest}` motor scores. **It never decides direction itself.**

4. **`FlyNeuralEngine.js` + `BrainVisualizer.js`** — the thin biologically-named wrapper (injects sensory current, steps the network on a fixed 100ms cadence, derives dashboard readouts from population activity) and the Three.js viewport that renders five of those populations as glowing, GCaMP-calcium-style 3D structures.

`main.js` is the only file that knows all four exist. `PacmanGame` never imports `Connectome`; `Connectome` never imports `PacmanGame`; `BrainVisualizer` only ever reads a state snapshot it's handed. **If the Three.js CDN fails to load, the arcade game is completely unaffected** — that decoupling isn't a nice-to-have, it's the actual architecture.

## How a movement decision actually happens

No `if (ghostNear) fleeDirection = ...` exists anywhere in this codebase. Instead, every ~100ms:

1. `PacmanGame` computes the *physically safe* candidate directions (walls excluded always; a ghost's own tile or a known bitter-trap tile excluded whenever any alternative exists — a hard rule, not a heuristic).
2. It measures the signed bearing and distance to the nearest pellet and nearest sensed ghost, relative to Pac-Man's current heading, and calls `engine.update(dt, sense)`.
3. Inside `FlyNeuralEngine`, that sensory data is injected as current into `ORN_sugar_L/R` (olfactory) and `LC4_L/R` + `LPLC2_L/R` (visual looming + an auditory-proxy population), split left/right by bearing sign. The network is stepped once.
4. The LIF dynamics propagate: `ORN → PN → KC → MBON_approach → DNp09_fwd` for foraging; `LC4/LPLC2 → GF → DNa_left/right, DNp09_fwd, MDN_escape` for escape — and **`GF → MBON_approach` is an inhibitory synapse with a larger magnitude than the reward pathway's own gain**, which is *why* fleeing dominates foraging. That priority is an emergent property of synaptic weight, not a branch in game code.
5. Motor populations (`DNa_left`, `DNa_right`, `DNp09_fwd`, `MDN_escape`) are read back as calcium-integrated activity (see below) and returned to `PacmanGame`, which maps them onto whichever safe candidate direction is relatively left/right/straight/reverse from the current heading, and picks the highest score.
6. If both `forward` and `reverse` motor drive come back below threshold *and* the fly isn't currently escaping, `rest: true` is returned — Pac-Man simply stops. No forced constant motion. This is checked twice: once by the network's own low-forward-drive readout, and once more as a hard safety override in `PacmanGame` that never honors `rest` with a predator within 5 tiles, regardless of what the network says that instant.

## Calcium vs. voltage: why two readouts

`populationActivity()` doesn't read raw membrane potential — it reads a per-neuron **calcium trace** that jumps on every spike and decays geometrically (~0.78/tick), the same integrated signal real GCaMP calcium imaging measures. Raw voltage gets hard-reset to exactly 0 on every refractory tick, which makes it a bad, extremely sample-time-sensitive signal for anything downstream (a motor score read one tick later than a spike would read a false 0). The one exception is `NPF` (hunger), read via `populationVoltage()` instead: it's designed as a slow *graded sub-threshold accumulator* — the whole point is a smoothly climbing hunger level, not a burst — so it deliberately reads the raw, leaky membrane potential rather than calcium.

## The adjacency matrix format

```jsonc
{
  "meta": {
    "sensoryPorts": { "sugarLeft": "ORN_sugar_L", "loomingLeft": "LC4_L", "reward": "PAM_DAN", ... },
    "motorPorts": { "turnLeft": "DNa_left", "forward": "DNp09_fwd", "escapeCommand": "GF", ... }
  },
  "neurons": [
    { "id": "LC4_L_0", "population": "LC4_L", "role": "sensory", "threshold": 0.9, "tau": 0.75, "refractory": 1 }
  ],
  "synapses": [
    { "pre": "LC4_L_0", "post": "DNa_right_1", "weight": 1.42 }
  ]
}
```

- **`neurons`** is a flat list; `population` groups them for injection/readout, `threshold`/`tau`/`refractory` are per-neuron LIF parameters (a slow population like `NPF` gets `tau≈0.995`; a fast one like `GF` gets `tau≈0.70` — the *time constant itself*, not a hand-coded decay rate elsewhere, is what makes panic feel instant and stress feel like it lingers).
- **`synapses`** is a flat directed, weighted edge list — positive weight excitatory, negative inhibitory. `Connectome.js` compiles this into a CSR-style adjacency list once at load time so each simulation step is `O(spikes × fanout)`, not `O(neurons²)`.
- Regenerate it with `node tools/build-connectome.js > connectome.json` — the generator is deterministic (seeded PRNG) so the diff never churns from a re-run.

## Predator avoidance is real, not decorative

Ghosts are sensed well before they're adjacent (looming detection, not eyesight). A direction that would step onto a ghost's current tile is a **hard exclusion** whenever any other option exists — this is enforced in `PacmanGame`, upstream of any neural scoring, so the connectome is only ever asked to rank *already-safe* options. Contact still matters: real pixel-distance collision detection costs a life, resets Pac-Man and every ghost to their spawn tiles with a brief invulnerability window, and fires a maximal `GF` (Giant Fiber) current injection through the network.

## Live telemetry

The right-hand panel is a set of scrolling oscilloscope graphs sampled at a fixed cadence, a circular alertness ring, and a text "drive state" ticker — all reading the same `FlyNeuralState`, which is itself entirely derived from live population activity in the connectome:

- **Hunger (NPF)** — `populationVoltage('NPF')`, a graded accumulator; blinks red past 85%
- **Panic (LC4/GF)** — `populationActivity('GF')`, calcium-fast, reads as a near-instant spike
- **Stress (octopamine)** — `populationActivity('OA_VPM')`, same calcium trace but on a slow-`tau` population, so it lingers
- **Dopamine (PAM/MBON)** — `populationActivity('PAM_DAN')`, spikes on pellet capture
- **Stamina** — the one non-neural stat, by design: it's muscular/metabolic (post-sprint exhaustion), not a circuit
- **Alertness ring** — a smoothed mean calcium activity across the *entire* 66-neuron network
- **Drive state ticker** — `ESCAPE`, `DISGUST`, `EXHAUSTED`, `FORAGING`, `GROOMING`, or `ALERT`, in priority order

## The 3D viewport

`BrainVisualizer.js` renders five regions with `MeshStandardMaterial` and dynamic `emissive` values, composited through `UnrealBloomPass` for the soft calcium-fluorescence-microscopy look — Ellipsoid Body (a torus + orbiting phase bump tracking the network's own `EPG` population activity), Mushroom Body (gold on dopamine), PAM cluster, Giant Fiber System (white/cyan burst), and a bonus PPL1 cluster (purple, aversive). Drag to orbit; auto-rotates when idle. All of it is driven by polling `engine.state` once per frame — no events flow *into* the game from here.

## Interacting with it

Pac-Man is **not player-controlled**. You only act on his environment:

- **`+ Place Bitter Trap`** — arms hazard-placement mode; click any open floor tile to drop one. A contact spikes `PPL1_DAN` (aversive dopaminergic), stuns him briefly, and he routes around known traps afterward.
- **Drag** on the 3D viewport — orbit the camera

## Stack

- `index.html` / `styles.css` — arcade-cabinet-black layout, HUD sidebar, zero build step
- `connectome.json` — the adjacency matrix (generated by `tools/build-connectome.js`)
- `Connectome.js` — the LIF simulation engine: load, step, inject, read
- `PacmanGame.js` — maze, tile-snapped movement, ghost AI, sensing, rendering, self-contained render loop
- `FlyNeuralEngine.js` — thin wrapper: sensory injection, fixed-timestep stepping, `FlyNeuralState` derivation
- `BrainVisualizer.js` — the Three.js 3D viewport, self-contained render loop
- `main.js` — the only file that wires all four together

Three.js (r128) and its `OrbitControls` / `EffectComposer` / `UnrealBloomPass` examples load from a pinned CDN version in `index.html`. No `npm install`, no bundler.

## Run it

```bash
git clone https://github.com/udbhav-shrinet/pac-fly.git
cd pac-fly
python3 -m http.server 8000
# open http://localhost:8000
```

`connectome.json` is fetched over HTTP at startup, so this needs a local server (or GitHub Pages) — opening `index.html` directly via `file://` will fail the fetch in most browsers.

## On scientific honesty

The maze is genuinely pixel-accurate to the original arcade ROM's tile data, and the ghost AI genuinely runs the real classic targeting algorithm. The connectome is a **real, runtime-loaded, runtime-simulated adjacency-matrix LIF network** — not a synthetic feedforward net, not a NEAT genome, not a hand-tuned scalar state machine pretending to be one. What it is *not* is a literal export of FlyWire or hemibrain synapse-count data: population identities, projection directions, and synaptic *signs* follow published connectivity for these circuits (ORN→PN, PN→KC→MBON, PAM/PPL1→MBON, LC4/LPLC2→GF, GF→MBON/DNp09/MDN, EPG→DNa), but the relative weight *magnitudes* are hand-set in `tools/build-connectome.js`, not scraped synapse counts. If you want the real 139,000-neuron, tens-of-millions-of-synapses dataset, it's free at [codex.flywire.ai](https://codex.flywire.ai) and [neuprint.janelia.org](https://neuprint.janelia.org).

## License

MIT.
