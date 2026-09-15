# 🪰 Pac-Fly: The Minimal Viable Connectome

**We took a real, synaptically-resolved map of a fruit fly's brain, surgically removed everything except the parts that let it panic and eat, and shipped the rest as a population of independent, `Float32Array`-backed spiking brains running live in your browser tab.**

No PyTorch. No ONNX runtime. No server. Just a JSON graph of weighted synapses, an OOP simulation engine, and a `for` loop doing leaky integrate-and-fire math on up to 40 flies at once, rendered on a `<canvas>` inside a full computational-biology research dashboard.

Zero dependencies · 100% client-side · Runs on GitHub Pages

---

## What is actually happening here

In 2023–2024, the FlyWire Consortium (Princeton, Allen Institute, and a small army of citizen-scientist "flywires") finished reconstructing the **complete synaptic wiring diagram of the adult *Drosophila melanogaster* brain** — roughly 139,000 neurons and ~50 million synapses, imaged at nanometer resolution. It's one of the most important datasets biology has ever produced, and it's free at [codex.flywire.ai](https://codex.flywire.ai).

We don't need almost any of that to make a swarm of virtual flies forage and flee. So we performed a **digital lobotomy**, pruning the graph down to four circuits and throwing the rest in the trash:

| Circuit | Kept? | Why |
|---|---|---|
| **Antennal Lobe (AL)** | ✅ | Olfactory/gustatory input — hunger drive |
| **LC4 lobula columnar neurons** | ✅ | Looming-object detectors — "something is closing in fast" |
| **Giant Fiber (GF)** | ✅ | The fly's single-neuron panic button — the fastest escape reflex in the animal kingdom |
| **Mushroom Body (MB) / dopaminergic neurons** | ✅ | Reward and reinforcement |
| **DNp09 / MDN descending neurons** | ✅ | Steering and forward-walking motor commands |
| Courtship, grooming, circadian, oviposition circuits | ❌ **lobotomized** | Not relevant to being chased around a petri dish |

What's left is **268 neurons and 612 synapses** per fly — small enough that dozens of independent instances run at once without breaking a sweat.

## Architecture: a real multi-agent engine, not a monolith

Version 2 rebuilt the whole thing around four decoupled classes so a *population* of distinct brains could run simultaneously without stepping on each other or the frame rate:

```
SimulationManager   the root loop — fixed 100ms timestep accumulator,
                     canvas rendering, UI wiring, analytics, CSV export

Environment          spatial hashing for fast proximity queries, the
                     sugar gradient field, predator (Ghost) state

FlyAgent              physical body: continuous-space kinematics, energy
                      budget, sensory gathering, motor execution

Connectome            the isolated neural network — graph topology is
                      parsed ONCE and shared; every fly gets its own
                      Float32Array of synaptic weights, membrane
                      potentials, and refractory state
```

`Connectome` intentionally separates **shape** (which neurons connect to which — identical across the population, computed once) from **weights** (how strongly — unique per fly, mutable, inheritable). That's what makes 40 simultaneous brains cheap: the expensive bookkeeping happens once, and each tick is just two flat-array passes (`O(neurons)` leak/threshold, `O(synapses)` propagation) per fly, no allocation, no garbage collector stalls.

## The LIF model

Every tick, exactly two kinds of current get injected into each fly's sensory neurons from the outside world — nothing else touches the network:

```
v(t+1) = v(t) · τ_membrane + I_external(t)
if v(t+1) >= threshold: SPIKE, propagate weight to postsynaptic neurons, enter refractory period
```

- **Sugar proximity → Antennal Lobe** sensory neurons
- **Ghost proximity/heading → LC4** sensory neurons (or rerouted — see Sensory Mutations below)

Everything downstream — the Giant Fiber's escape response, the Mushroom Body's dopamine spike on capture, panic suppressing hunger via a real inhibitory GF → MB synapse — is emergent graph propagation, not scripted behavior. The only things game code is allowed to touch are inputs (sensory current) and outputs (reading `DNp09`/`MDN`/`GF` activation to drive the body).

## The Arena

A grid-lined petri dish. Flies render as directional triangles with fading motion trails so you can read velocity and trajectory at a glance; color shifts from amber (healthy) through orange to red as energy depletes. Ghosts are continuous-motion predators with their own heading vector. A toggleable **pheromone heatmap** overlay blends the live sugar gradient (green) against predator threat radii (red) across the whole canvas.

## Neural Telemetry — tracks whichever fly you click

Click any fly in the arena to select it. The right-hand panel switches to a live read of *that* fly's brain:

- **Oscilloscopes** — rolling waveforms for AL (cyan), LC4 (red), MB (amber), DN (white)
- **Spike raster plot** — the classic neurobiology scatter: 12 key neurons on the Y-axis, the last 5 seconds on the X-axis, a dot every time one crosses threshold
- **Live connectome graph** — a node-link miniature of the selected fly's actual brain, nodes flashing white on spike

## Population Analytics

- **Energy histogram** — live distribution of energy across the whole swarm
- **Survival curve** — population size over simulated time (a Kaplan–Meier-style decay as flies are eaten, starve, or get culled)
- **Spatial density heatmap** — where the swarm has actually been spending its time

## God Controls

**Population** — `+ Spawn Fly` (randomized baseline weights, or sampled from the Fit Roster) · `− Cull Fly` (removes the lowest-energy fly) · an Injection Target selector (`All Flies` / `Selected Fly`) that scopes everything below it.

**Neuromodulators** — direct neurochemical overrides on the target:
- **Inject Adrenaline** — pins LC4/GF activation to maximum, forces ~1.5x speed and 3x energy drain, erratic evasive steering, for 4 seconds
- **Inject Fasting Hormone** — drops energy to 10% and scales AL synaptic gain 1.8x, for 6 seconds — desperate, threat-ignoring foraging
- **Trigger Dopamine Spike** — locks the current motor output in place for 3 seconds, producing compulsive repetitive looping

**Environment** — ghosts, sugar blooms, and the pheromone heatmap toggle.

**Data** — one-click **CSV export** of the selected fly's full telemetry history (`tick, time_s, AL_state, LC4_state, MB_state, DN_output`).

## Sensory Mutations — behavioral inversion, live

A radio group controls how ghost coordinates get routed into the sensory layer for every fly, in real time:

- **Mode A — Biological Standard**: ghosts → LC4 (threat), sugar → AL (food). Normal prey behavior.
- **Mode B — Apex Predator**: ghost position is inverted and routed into AL instead, bypassing LC4 entirely — the fly perceives predators as a giant moving sugar source and chases them.
- **Mode C — Optic Flow Stealth**: computes the dot product of each ghost's forward vector against the ghost→fly vector. Behind the ghost's field of view → routed to AL (stalk). Ghost turning to face the fly → snaps to LC4 (panic). Flies creep up behind predators and scatter the instant they're "seen."

## Fitness Roster — a lightweight evolutionary loop

Any fly that survives 60 simulated seconds has its weight vector snapshotted into a capped Fit Roster. New spawns have a 50% chance of sampling a roster genome (with small Gaussian mutation) instead of a fully random baseline — so the population's baseline wiring drifts toward whatever survived, one reboot at a time.

## Event Log

A scrolling console logs every biologically meaningful event as it happens: spawns, culls, captures, starvation, roster credits, mode switches, neuromodulator injections.

## Stack

- `index.html` / `styles.css` — semantic markup, dark computational-biology dashboard aesthetic, zero build step
- `pruned_connectome.json` — the shared graph: 268 nodes, 612 weighted synapses, region metadata, LIF parameters
- `connectome.js` — the `Connectome` class: static shared topology + per-instance `Float32Array` weights/state
- `environment.js` — the `Environment` class: `SpatialHash`, sugar sources, ghost AI, heatmap field
- `flyAgent.js` — the `FlyAgent` class: kinematics, energy, sensing, neuromodulator overrides
- `simulation.js` — the `SimulationManager` class: fixed-timestep loop, rendering, all UI wiring, analytics, CSV export, fitness roster

No `npm install`. Open `index.html` or push to GitHub Pages and it runs.

## Run it

```bash
git clone https://github.com/udbhav-shrinet/pac-fly.git
cd pac-fly
python3 -m http.server 8000
# open http://localhost:8000
```

## On scientific honesty

This is a **structurally accurate, illustratively pruned subset**, not a database dump of the real 139,000-neuron FlyWire connectome — that dataset is tens of gigabytes and belongs in a proper connectomics pipeline (see [codex.flywire.ai](https://codex.flywire.ai) and the [FlyWire paper](https://www.nature.com/articles/s41586-024-07558-y)). What's preserved here is the *topology and relative synaptic weighting* of the specific circuits named above — enough to demonstrate that biologically-grounded spiking networks, not hand-authored game AI, can drive believable, emergent survival behavior for an entire population in a browser tab.

## License

MIT. Lobotomize responsibly.
