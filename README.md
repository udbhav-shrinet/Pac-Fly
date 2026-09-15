# 🟡 Pac-Fly: Arcade Engine × Drosophila Connectome

**A pixel-accurate recreation of the 1980 arcade Pac-Man maze, wired directly into a real-time 3D visualization of the functional Drosophila melanogaster brain circuits that would, in theory, be doing the driving.**

Zero build step. Two files of gameplay logic, one file of biochemistry, one file of Three.js. Open `index.html` and it runs.

---

## What this actually is

Two things, cleanly separated, bridged by one small file:

1. **`PacmanGame.js`** — the arcade. The real 28×31 tile maze from the original ROM, double-stroke neon-blue walls, the ghost house, the horizontal warp tunnel, tile-snapped movement (no wall-clipping, no free steering — Pac-Man can only turn when centered on a tile intersection, exactly like 1980), a chomping mouth-wedge animation oriented to heading, and four ghosts running the *actual* classic targeting algorithm (Blinky chases directly, Pinky ambushes 4 tiles ahead, Inky reflects Blinky's position through a point ahead of Pac-Man, Clyde chases-then-flees on a distance threshold) — no pathfinding, just "pick the open non-reverse direction closest to the target tile," the same trick the original ROM used.

2. **`FlyNeuralEngine.js` + `BrainVisualizer.js`** — a biologically-grounded (if deliberately simplified) model of what a fly's brain circuits would be doing if a fly were the one playing. Gameplay events map onto named functional circuits from the FlyWire/neuPrint literature, and a Three.js viewport renders four of them as glowing, GCaMP-calcium-style 3D structures that react live.

`main.js` is the only file that knows both halves exist. `PacmanGame` fires plain callbacks; `FlyNeuralEngine` never imports the game or the renderer; `BrainVisualizer` only ever reads a state snapshot it's handed. **If the Three.js CDN fails to load, the arcade game is completely unaffected** — that decoupling isn't a nice-to-have, it's the actual architecture.

## The circuit mapping

| Game event | Circuit | Effect |
|---|---|---|
| Pac-Man changes heading | **Ellipsoid Body (E-PG neurons)** | The active phase bump moves to the new angle around the toroidal ring — a literal heading compass |
| Pellet eaten | **Mushroom Body Kenyon cells / PAM cluster (dopaminergic)** | Calcium-style gold flash, dopamine transient spike, NPF (hunger) drops — energizers hit harder |
| No food for a while | **Neuropeptide F (NPF)** | Slowly accumulates while wandering — a starvation drive |
| A ghost closes in | **LC4/LPLC2 looming detectors → Giant Fiber (GF)** | Below a critical tile-radius, GF fires: cyan/white calcium burst, Pac-Man gets an emergency sprint (drains a stamina meter) |
| A user-placed bitter trap is eaten | **Gr66a gustatory neurons → PPL1 (aversive)** | Purple negative-reinforcement flash, brief stun |

None of this is a spiking network simulation — `FlyNeuralEngine` is a small set of decaying/accumulating scalars (`npfLevel`, `dopamineTransient`, `octopamineLevel`, `ppl1Transient`, `giantFiberFiring`, `headingAngle`), typed and documented as a `FlyNeuralState`. It's a *functional* mapping onto real circuit names, not a claim that this is what those 2,000+ real neurons are literally computing.

## The 3D viewport

`BrainVisualizer.js` renders five regions with `MeshStandardMaterial` and dynamic `emissive` values, composited through `UnrealBloomPass` for the soft calcium-fluorescence-microscopy look:

- **Ellipsoid Body** — a torus + one bright orbiting sphere tracking `headingAngle`
- **Mushroom Body** — bilateral lobes flashing gold on `dopamineTransient`
- **PAM cluster** — a ring of small spheres blending hunger (dim baseline) and reward (bright flash)
- **Giant Fiber System** — a ganglion + descending axon tubes that snap to a white/cyan burst when `giantFiberFiring` is true
- **PPL1 cluster** *(bonus)* — small purple spheres for the aversive circuit

Drag to orbit (`OrbitControls`, with slow auto-rotate when idle). All of it is driven by polling `engine.state` once per frame — no events flow *into* the game from here.

## Controls

Pac-Man is **not player-controlled.** He has his own brain — the whole point of Pac-Fly is watching it drive him. At every tile intersection he weighs two pressures: flee the nearest ghost if it's close (with the same erratic zig-zag noise the Giant Fiber escape reflex produces), otherwise greedily close in on the nearest pellet as sugar. You don't move him; you only act on his environment:

- **`+ Place Bitter Trap`** — arms hazard-placement mode; click any open floor tile in the maze to drop one. Pac-Man mostly routes around known traps, but a fresh one can still catch him off guard.
- **Drag** on the 3D viewport — orbit the camera

Ghosts, meanwhile, run the real classic arcade AI (see below) — nothing in this project takes keyboard input for movement.

## Stack

- `index.html` / `styles.css` — arcade-cabinet-black layout, HUD sidebar, zero build step
- `PacmanGame.js` — maze, tile-snapped movement, ghost AI, rendering, self-contained render loop
- `FlyNeuralEngine.js` — the `FlyNeuralState` biochemical state machine
- `BrainVisualizer.js` — the Three.js 3D viewport, self-contained render loop
- `main.js` — the only file that wires the two halves together

Three.js (r128) and its `OrbitControls` / `EffectComposer` / `UnrealBloomPass` examples load from a pinned CDN version in `index.html`. No `npm install`, no bundler.

## Run it

```bash
git clone https://github.com/udbhav-shrinet/pac-fly.git
cd pac-fly
python3 -m http.server 8000
# open http://localhost:8000
```

## On scientific honesty

The maze is genuinely pixel-accurate to the original arcade ROM's tile data. The ghost AI genuinely runs the real targeting algorithm. The neural side is *not* a literal FlyWire connectome graph — it's a small, clearly-documented, functionally-named state machine that maps gameplay onto real circuits (Ellipsoid Body, Mushroom Body, Giant Fiber, PAM, PPL1) by *role*, not by simulating their actual synaptic wiring. If you want the real 139,000-neuron dataset, it's free at [codex.flywire.ai](https://codex.flywire.ai).

## License

MIT.
