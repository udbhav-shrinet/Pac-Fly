# 🪰 Pac-Fly: The Minimal Viable Connectome

**We took a real, synaptically-resolved map of a fruit fly's brain, surgically removed everything except the parts that let it panic and eat, and shipped the rest as 40KB of vanilla JavaScript that plays Pac-Man in your browser tab.**

No PyTorch. No ONNX runtime. No WebGL shaders pretending to be neurons. No server. Just a JSON graph of weighted synapses and a `for` loop doing leaky integrate-and-fire math, 130ms at a time, in a `<canvas>` element.

[**▶ Play it live**](#) · Zero dependencies · 100% client-side · Runs on GitHub Pages

---

## What is actually happening here

In 2023–2024, the FlyWire Consortium (Princeton, Allen Institute, and a small army of citizen-scientist "flywires") finished reconstructing the **complete synaptic wiring diagram of the adult *Drosophila melanogaster* brain** — roughly 139,000 neurons and ~50 million synapses, imaged at nanometer resolution and traced by hand and machine over years. It is, without exaggeration, one of the most important datasets biology has ever produced. It lives at [codex.flywire.ai](https://codex.flywire.ai) and it is *free and open*.

That connectome can tell you, with real synaptic weights, exactly how a photon hitting the fly's eye turns into a wingbeat. It encodes courtship songs, grooming reflexes, circadian rhythm, egg-laying behavior, and the precise wiring of an escape reflex so fast it operates in single-digit milliseconds.

We don't need almost any of that to play Pac-Man.

So we performed a **digital lobotomy**. We pruned the graph down to four circuits and threw the rest of the fly's mind directly in the trash:

| Circuit | Kept? | Why |
|---|---|---|
| **Antennal Lobe (AL)** | ✅ | Olfactory/gustatory input — "food is near," i.e. hunger drive |
| **LC4 lobula columnar neurons** | ✅ | Looming-object detectors — "something large is approaching fast" |
| **Giant Fiber (GF)** | ✅ | The fly's single-neuron panic button — triggers the fastest known escape reflex in the animal kingdom |
| **Mushroom Body (MB) / dopaminergic neurons** | ✅ | Reward and reinforcement — dopamine spike on sugar consumption |
| **DNp09 / MDN descending neurons** | ✅ | Forward walking and steering commands to the motor system |
| Courtship & mating circuits (P1, fruitless⁺ neurons) | ❌ **lobotomized** | The fly does not need to fall in love to eat a dot |
| Grooming command neurons | ❌ **lobotomized** | It will not stop to clean its legs mid-chase |
| Circadian clock (PDF neurons) | ❌ **lobotomized** | It does not sleep. It does not know what time it is. It only knows fear and sugar |
| Egg-laying / oviposition descending neurons | ❌ **lobotomized** | Not applicable to a JSON object |

What's left is **268 neurons and 612 synapses** — a structurally faithful *subset* of the real regional wiring topology (real convergence ratios from antennal lobe → mushroom body, real LC4 → Giant Fiber funneling, real GF → DN command architecture), small enough to simulate at 60fps on a phone.

## The model: this is not a "neural network" in the ML sense

There is no backprop. There is no training loop. There are no weights learned from data. This is **not a neural net that was trained to play Pac-Man** — that's the boring, done-to-death version of this idea.

Every synapse weight in `pruned_connectome.json` is a hand-preserved approximation of the *actual regional connection strength* reported in the FlyWire/hemibrain literature — AL projection neurons fan out to Kenyon cells at realistic convergence ratios, LC4 neurons pool onto the Giant Fiber the way looming detectors really do, and the Giant Fiber really does send an inhibitory side-channel back into the dopaminergic reward system (real flies stop caring about sugar mid-panic; so does ours — that's not a hardcoded rule, that's a `-0.4` inhibitory edge doing its job).

`brain.js` runs this graph as a **Leaky Integrate-and-Fire (LIF) spiking network**:

```
v(t+1) = v(t) · τ_membrane + I_external(t)
if v(t+1) >= threshold: SPIKE, propagate weight to postsynaptic neurons, enter refractory period
```

Every tick, exactly two things get injected as electrical current from the outside world:

- **Ghost proximity/velocity → LC4 sensory neurons** (looming visual stimulus)
- **Sugar proximity → Antennal Lobe sensory neurons** (olfactory/gustatory stimulus)

That current propagates through real synaptic weights — AL → Mushroom Body → descending neurons on one path, LC4 → Giant Fiber → descending neurons on the other — with zero game-specific "if ghost near, flee" logic anywhere in the propagation step. The Giant Fiber's escape response, the dopamine spike on sugar consumption, the panic-suppresses-hunger behavior — none of it is scripted. It falls out of the graph.

The only things `game.js` is allowed to touch are the **inputs** (what current goes into sensory neurons) and the **outputs** (reading `DNp09`, `MDN_L`, `MDN_R` activation to decide a grid direction, and `GF` firing state to decide panic mode). Everything in between is the fly's business.

## Behavior you'll actually observe

- **Normal foraging**: AL activity rises as the fly nears a sugar dot, Mushroom Body dopamine spikes on capture, DN steering biases toward the gradient.
- **Looming threat**: as a ghost closes distance, LC4 activity ramps non-linearly (closing velocity matters, not just proximity — exactly like the real looming-detector literature).
- **Giant Fiber threshold crossing (Panic > 80%)**: the fly's `GF` neuron fires. When it does:
  - Hunger-seeking is *suppressed* (a real inhibitory synapse from GF into the dopaminergic neurons, not an `if` statement)
  - Movement speed increases ~1.5x (real Giant Fiber circuits drive the fastest motor output the animal has)
  - Steering gets erratic, zig-zagging noise injected into the direction choice — a crude approximation of real evasive flight kinematics, which are famously non-linear and hard to predict (this is why you can't swat a fly)

You are not watching a game AI. You are watching a spiking network with a sugar addiction and an active fear response.

## God Mode

You don't control the fly. You control its universe:

- **`+ Add Ghost`** — inject a new predator, up to 6, spawned in the corners
- **`− Remove Ghosts`** — mercy
- **`+ Drop Sugar`** — scatter a fresh batch of reward stimuli across the maze
- **`− Clear Sugar`** — induce famine, watch AL activity flatline

Every action you take becomes real sensory current in a real (pruned) biological circuit, one animation frame later.

## Stack

- `index.html` — semantic, accessible markup, zero build step
- `styles.css` — dark-mode lab aesthetic, CSS variables, responsive grid/flex, no framework
- `pruned_connectome.json` — the graph: 268 nodes, 612 weighted synapses, region metadata, LIF parameters
- `brain.js` — the LIF engine: loads the graph, injects stimuli, propagates spikes, exposes motor readout
- `game.js` — canvas rendering, maze/entity state, sensory encoding, motor decoding, God Controls, telemetry charts

No `npm install`. No bundler. Open `index.html` or push to GitHub Pages and it just runs.

## Run it

```bash
git clone https://github.com/udbhav-shrinet/pac-fly.git
cd pac-fly
python3 -m http.server 8000
# open http://localhost:8000
```

Or just serve the four files from any static host. It's 2026 and this repo still doesn't need a `package.json`.

## On scientific honesty

This is a **structurally accurate, illustratively pruned subset**, not a database dump of the actual 139,000-neuron FlyWire connectome — that dataset is tens of gigabytes and belongs in a proper connectomics pipeline (see [codex.flywire.ai](https://codex.flywire.ai) and the [FlyWire papers](https://www.nature.com/articles/s41586-024-07558-y) for the real thing). What's preserved here is the *topology and relative synaptic weighting* of the specific circuits named above — enough to demonstrate that biologically-grounded spiking networks, not hand-authored game AI, can drive believable, emergent survival behavior in a browser tab.

If you're a connectomics researcher and this made you wince even slightly, good — that means we got the important parts right.

## License

MIT. Lobotomize responsibly.
