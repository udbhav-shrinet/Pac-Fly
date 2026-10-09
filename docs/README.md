<div align="center">

# ☕ Drosophila Synaptic Cafe
### *Whole-Brain Connectome & Neural Piano Simulator*

[![HTML5](https://img.shields.io/badge/HTML5-Canvas%20%26%20AudioContext-E34F26?style=for-the-badge&logo=html5&logoColor=white)](#)
[![WebAudio API](https://img.shields.io/badge/WebAudio-Multi--Timbral%20Synth-00557f?style=for-the-badge&logo=webassembly&logoColor=white)](#)
[![Spiking Neural Network](https://img.shields.io/badge/SNN-Leaky%20Integrate--and--Fire-4CAF50?style=for-the-badge)](#)
[![Connectome](https://img.shields.io/badge/Connectome-FlyWire%20FAFB%20v783%20%7C%2066--Neuron%20LIF-9C27B0?style=for-the-badge)](#)
[![License](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](#)
[![Status](https://img.shields.io/badge/Status-Live%20Simulation-brightgreen?style=for-the-badge)](#)

<p align="center">
  <strong>An autonomous biophysical neural piano simulator powered by Drosophila melanogaster connectomics, leaky integrate-and-fire spiking networks, and dopaminergic reinforcement learning.</strong>
</p>

```
  ┌────────────────────────────────────────────────────────────────────────────────────────┐
  │  [Sensory Ingestion] ──► [Central Complex & MB] ──► [Dopaminergic RPE] ──► [24-Key Piano] │
  │    ORN / LC4 / LPLC2        EPG Compass / KC / MBON     PAM / PPL1 DANs         48-71 MIDI     │
  └────────────────────────────────────────────────────────────────────────────────────────┘
```

</div>

---

## 📑 Table of Contents

- [1. Executive Summary](#1-executive-summary)
- [2. Biological Foundations & Neurocomputational Framework](#2-biological-foundations--neurocomputational-framework)
- [3. System Architecture](#3-system-architecture)
  - [3.1 High-Level Architecture](#31-high-level-architecture)
  - [3.2 Compact Pruned Connectome Circuit (66 Neurons)](#32-compact-pruned-connectome-circuit-66-neurons)
  - [3.3 FlyWire Full-Brain Worker Bridge (139,255 Neurons)](#33-flywire-full-brain-worker-bridge-139255-neurons)
  - [3.4 Neuromodulatory Dynamics & Synaptic Plasticity](#34-neuromodulatory-dynamics--synaptic-plasticity)
  - [3.5 Multi-Timbral WebAudio Synthesis Engine](#35-multi-timbral-webaudio-synthesis-engine)
- [4. Mathematical Formulations](#4-mathematical-formulations)
  - [4.1 Leaky Integrate-and-Fire (LIF) Dynamics](#41-leaky-integrate-and-fire-lif-dynamics)
  - [4.2 Calcium Kinetic Integration ($Ca^{2+}$ / GCaMP Tracer)](#42-calcium-kinetic-integration-ca2--gcamp-tracer)
  - [4.3 Three-Factor STDP & Dopaminergic Reward Prediction Error (RPE)](#43-three-factor-stdp--dopaminergic-reward-prediction-error-rpe)
  - [4.4 Central Complex Compass (E-PG Heading Vector Integration)](#44-central-complex-compass-e-pg-heading-vector-integration)
  - [4.5 Behavioral Arbitration & State Machine Transitions](#45-behavioral-arbitration--state-machine-transitions)
- [5. Classical Repertoire & Musical Arrangement Mapping](#5-classical-repertoire--musical-arrangement-mapping)
- [6. User Guide & Runtime Operations](#6-user-guide--runtime-operations)
  - [6.1 Installation & Quickstart](#61-installation--quickstart)
  - [6.2 Telemetry Dashboard Interpretation](#62-telemetry-dashboard-interpretation)
  - [6.3 Sensory Stimulation & Environmental Perturbation](#63-sensory-stimulation--environmental-perturbation)
- [7. Benchmark Specifications & Biological Accuracy Disclaimer](#7-benchmark-specifications--biological-accuracy-disclaimer)
- [8. References & Citations](#8-references--citations)

---

## 1. Executive Summary

**Drosophila Synaptic Cafe** is an interactive, browser-native neurocomputational laboratory and lofi piano sanctuary. It bridges empirical *Drosophila melanogaster* connectomics with bio-inspired reinforcement learning to drive real-time musical performance.

Rather than relying on abstract artificial neural networks or hard-coded lookup tables, the virtual fly's actions, emotional proxies, and motor decisions emerge from an interconnected **Leaky Integrate-and-Fire (LIF) spiking network**. Sensory streams—representing target note frequencies, looming predator cues, appetitive reward odors, and metabolic drives—are injected directly into identified neural populations. Action selection occurs via descending motor commands ($DNa$, $DNp09$, $MDN$) conditioned by **PAM/PPL1 dopaminergic clusters**, the **Mushroom Body (MB)**, and the **Central Complex (CX)**.

```
       ┌─────────────────┐
       │ Olfactory (ORN) │
       │ Visual (LC4)    ├──────────┐
       │ Mechanosensory  │          ▼
       └─────────────────┘   ┌──────────────┐      Reward (PAM_DAN)      ┌──────────────────┐
                             │ Mushroom Body├───────────────────────────►│ 24-Key Acoustic  │
       ┌─────────────────┐   │  (KC ──► MBON)│◄───────────────────────────┤ Additive Synthesizer
       │ Starvation (NPF)├──►│              │    Punishment (PPL1_DAN)   └──────────────────┘
       │ Stress (OA_VPM) │   └──────┬───────┘
       └─────────────────┘          │
                                    ▼
                             ┌──────────────┐
                             │ Giant Fiber  │ (Inhibitory Shunt & Escape Reflex)
                             │  (GF / MDN)  │
                             └──────────────┘
```

---

## 2. Biological Foundations & Neurocomputational Framework

The simulation implements biological connectivity patterns derived from whole-brain electron microscopy datasets (FlyWire FAFB v783 and Janelia hemibrain):

1. **Antennal Lobe & Lateral Horn ($ORN \to PN \to LH$)**:
   - Preserves innate odor valence and bilateral spatial localization.
   - Sugar odor stimulation splits contralaterally to balance approach locomotion.
2. **Mushroom Body Associative Learning ($PN \to KC \to MBON$)**:
   - Sparse, high-dimensional expansion into Kenyon Cells ($KC$) creates distinct temporal-sensory representations.
   - Protocerebral Anterior Medial dopaminergic neurons ($PAM\text{-}DAN$) potentiate appetitive approach ($MBON_{\text{app}}$), while Protocerebral Posterior Lateral 1 neurons ($PPL1\text{-}DAN$) drive aversive depression.
3. **Central Complex Heading Compass ($E\text{-}PG \to PFN \to DNa$)**:
   - Ellipsoid body ring neurons ($E\text{-}PG$) maintain a localized bump of activity representing angular heading, guiding continuous motor steering.
4. **Giant Fiber Escape Reflex ($LC4 / LPLC2 \to GF \to MDN$)**:
   - Fast-looming visual detectors ($LC4$) and mechanosensory vibration channels ($LPLC2$) converge on the Giant Fiber ($GF$).
   - When stimulated, $GF$ fires an unconditioned escape cascade, shunting feeding and piano performance to trigger emergency backward saccades ($MDN$) and flight take-off ($DNp09$).

---

## 3. System Architecture

### 3.1 High-Level Architecture

The simulator utilizes a dual-tier neural runtime engineered for zero-latency execution in client browsers:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                   BROWSER CLIENT                                       │
│                                                                                        │
│  ┌────────────────────────┐    DOM / WebAudio    ┌──────────────────────────────────┐  │
│  │   main.js (UI Thread)  │ ◄──────────────────► │  Canvas Waveform & Raster Plots  │  │
│  │  - Closed-Loop RL Loop │                      │  - GCaMP Activity Field (30-pop) │  │
│  │  - 24-Key Piano Engine │                      │  - Dopamine Waveform (600x130)   │  │
│  └───────────┬────────────┘                      └──────────────────────────────────┘  │
│              │                                                                         │
│     ┌────────┴───────────────────────────────────────────┐                             │
│     ▼                                                    ▼                             │
│  ┌──────────────────────────────┐             ┌─────────────────────────────────────┐  │
│  │ FullBrainBridge.js           │             │ FlyNeuralEngine.js                  │  │
│  │ (FlyWire Web Worker Runtime) │             │ (Compact 66-Neuron LIF Simulation)  │  │
│  │  - 139,255 Neurons           │  [Fallback] │  - 66 Identified Neurons            │  │
│  │  - 2,698,236 Synapses        │ ──────────► │  - 270 Calibrated Synaptic Edges    │  │
│  │  - Neuropil Gating & CSR     │             │  - 100 ms Fixed Timestep Stepping   │  │
│  │  - data/connectome.bin.gz    │             │  - connectome.json Definition       │  │
│  └──────────────────────────────┘             └─────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

### 3.2 Compact Pruned Connectome Circuit (66 Neurons)

The compact connectome (`connectome.json`, generated deterministically by `tools/build-connectome.js`) preserves the essential functional sub-circuits across 22 populations:

| Population Name | Count ($N$) | Membrane $\tau$ | Threshold ($\theta$) | Refractory | Biological Functional Role |
|:---|:---:|:---:|:---:|:---:|:---|
| `ORN_sugar_L` / `_R` | 6 | 0.80 | 1.00 | 1 | Gustatory / Olfactory receptor inputs (left/right) |
| `PN_L` / `_R` | 6 | 0.84 | 1.00 | 1 | Antennal lobe projection neurons |
| `LH_L` / `_R` | 4 | 0.84 | 1.00 | 1 | Lateral horn innate attraction interneurons |
| `KC` | 8 | 0.85 | 1.15 | 2 | Mushroom body Kenyon cells (sparse expansion) |
| `MBON_approach` | 3 | 0.86 | 1.00 | 1 | Mushroom body output neuron (drives approach) |
| `PAM_DAN` | 4 | 0.88 | 1.00 | 1 | Appetitive dopamine cluster (sugar reward) |
| `PPL1_DAN` | 3 | 0.90 | 1.00 | 1 | Aversive dopamine cluster (bitter punishment) |
| `NPF` | 2 | 0.995 | 1.00 | 1 | Neuropeptide F hunger integrator (long time constant) |
| `LC4_L` / `_R` | 6 | 0.75 | 0.90 | 1 | Lobula columnar looming visual detectors |
| `LPLC2_L` / `_R` | 4 | 0.78 | 0.95 | 1 | Lobula plate substrate vibration detectors |
| `GF` | 2 | 0.70 | 1.05 | 2 | Giant Fiber command interneurons |
| `OA_VPM` | 3 | 0.985 | 1.00 | 1 | Octopaminergic ventral paired medial stress neurons |
| `EPG` | 4 | 0.86 | 1.00 | 1 | Compass heading ring neurons ($0^\circ, 90^\circ, 180^\circ, 270^\circ$) |
| `DNa_left` / `_right` | 6 | 0.80 | 1.00 | 1 | Descending steering motor neurons |
| `DNp09_fwd` | 3 | 0.80 | 1.00 | 1 | Descending forward walking/sprint motor neurons |
| `MDN_escape` | 2 | 0.78 | 1.05 | 1 | Moonwalker descending neurons (backward retreat) |

```
                       [COMPACT CONNECTOME CIRCUIT TOPOLOGY]

        [ORN_sugar_L/R] ────────► [PN_L/R] ────────► [LH_L/R] ────────► [DNa_L/R]
               │                      │                                     ▲
               │                      ▼                                     │
               │               [KC (8 cells)]                               │
               │                      │                                     │
               ▼                      ▼                                     │
        [PAM_DAN (+)] ───────► [MBON_approach] ────► [DNp09_fwd]            │
               ▲                      ▲                  ▲                  │
               │                      │                  │                  │
        [NPF (Hunger)] ───────────────┘                  │                  │
                                                         │                  │
        [PPL1_DAN (-)] ──────────────────────────────────┼──────────────────┘
                                                         │
        [LC4 / LPLC2] ───────► [GF (Giant Fiber)] ───────┴──────► [MDN_escape]
                                      │                                 ▲
                                      └─────► [Inhibitory Shunt to MBON]│
```

---

### 3.3 FlyWire Full-Brain Worker Bridge (139,255 Neurons)

When running on modern hardware, `FullBrainBridge.js` initializes a dedicated Web Worker (`FullBrainWorker.js`) streaming a compressed binary connectome (`data/connectome.bin.gz`).

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        FLYWIRE FULL-BRAIN WORKER PIPELINE                       │
│                                                                                 │
│   data/connectome.bin.gz  ──►  DecompressionStream  ──►  ArrayBuffer Header     │
│   (139,255 Neurons / 2.69M Synapses)                      (N=139255, E=2698236) │
│                                                                                 │
│   ┌──────────────────────────────────────────────────────────────────────────┐  │
│   │ Group-Sorted Memory Layout (Struct-of-Arrays):                           │  │
│   │   • V: Float32Array[N]                 • rowPtr: Uint32Array[N+1]        │  │
│   │   • fired: Uint8Array[N]               • colIdx: Uint32Array[E]          │  │
│   │   • refractory: Uint8Array[N]          • values: Float32Array[E]         │  │
│   └──────────────────────────────────────────────────────────────────────────┘  │
│                                      │                                          │
│                                      ▼                                          │
│   ┌──────────────────────────────────────────────────────────────────────────┐  │
│   │ Neuropil-Gated Tick Loop (10 Hz Cadence):                                │  │
│   │   1. Only compute active & stimulated neuropils (lazy activation).       │  │
│   │   2. Synaptic propagation with biological 1-tick delay queue.            │  │
│   │   3. Dynamic three-factor STDP weight modulation.                        │  │
│   │   4. Transfer group spike counts via postMessage to Bridge adapter.      │  │
│   └──────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

<details>
<summary><strong>🔍 Click to inspect FlyWire Neuropil Functional Groups (63 Identified Clusters)</strong></summary>

```json
[
  { "id": 0, "name": "VIS_R1R6", "region": "sensory", "neuron_count": 11487 },
  { "id": 2, "name": "VIS_ME", "region": "sensory", "neuron_count": 82318 },
  { "id": 3, "name": "VIS_LO", "region": "sensory", "neuron_count": 1793 },
  { "id": 5, "name": "OLF_AL", "region": "sensory", "neuron_count": 1907 },
  { "id": 6, "name": "OLF_LH", "region": "central", "neuron_count": 1851 },
  { "id": 10, "name": "MB_KC", "region": "central", "neuron_count": 1927 },
  { "id": 11, "name": "MB_MBON", "region": "central", "neuron_count": 879 },
  { "id": 17, "name": "CX_PB", "region": "central", "neuron_count": 5177 },
  { "id": 21, "name": "CX_EB", "region": "central", "neuron_count": 335 },
  { "id": 23, "name": "CX_FB", "region": "central", "neuron_count": 559 },
  { "id": 25, "name": "MB_DAN_REW", "region": "drives", "neuron_count": 428 },
  { "id": 26, "name": "MB_DAN_PUN", "region": "drives", "neuron_count": 1244 },
  { "id": 27, "name": "GNG_DESC", "region": "motor", "neuron_count": 822 },
  { "id": 28, "name": "VNC_CPG", "region": "motor", "neuron_count": 611 },
  { "id": 61, "name": "DN_STARTLE", "region": "motor", "neuron_count": 21955 }
]
```
</details>

---

### 3.4 Neuromodulatory Dynamics & Synaptic Plasticity

The behavioral state machine modulates synaptic weights and firing rates across four primary neurochemicals:

```
                  ┌──────────────────────────────────────────────┐
                  │          NEUROMODULATORY PROFILE             │
                  ├──────────────────────┬───────────────────────┤
                  │ Dopamine (DA)        │ PAM_DAN / MB_DAN_REW  │
                  │ Serotonin (5-HT)     │ Sustained Equilibrium │
                  │ Octopamine (OA)      │ OA_VPM / Threat/Stress│
                  │ Neuropeptide F (NPF) │ Hunger / Metabolic    │
                  └──────────────────────┴───────────────────────┘
```

- **Dopamine Transient ($\Delta \text{DA}$)**: Injected upon target note hit ($+12\%$ per note), decaying through natural membrane leak ($\tau = 0.88$).
- **Aversive Punitive Signal ($\text{PPL1}$)**: Injected upon off-key note selection ($-6\%$ dopamine, $+12\%$ punishment), triggering emotional frustration and exploring alternate synaptic paths.
- **Octopamine ($\text{OA}$)**: Elevates sensory sensitivity in looming detectors ($LC4$) during high-tempo classical phrases.
- **Neuropeptide F ($\text{NPF}$)**: Integrates continuously ($\tau = 0.995$), increasing exploratory motor noise when reward intervals exceed baseline expectations.

---

### 3.5 Multi-Timbral WebAudio Synthesis Engine

The audio engine synthesizes acoustic piano notes via additive multi-harmonic oscillator trees:

```
 ┌────────────────────────────────────────────────────────────────────────┐
 │                      WEBAUDIO NOTE SYNTHESIS PIPELINE                  │
 │                                                                        │
 │   [Triangle Osc] (Fundamental f₀) ──┐                                  │
 │                                     ├──► [Mix Gain: 0.7] ──► [GainEnv] │
 │   [Sine Osc]     (2nd Harmonic 2f₀) ─┤                         │       │
 │                                     │                          ▼       │
 │   [Sine Osc]     (3rd Harmonic 3f₀) ─┘                  [Master Gain]  │
 │                                                                │       │
 │                                                                ▼       │
 │                                                         [AudioContext] │
 └────────────────────────────────────────────────────────────────────────┘
```

- **Fundamental Frequency Calculation**:
  $$f(\text{MIDI}) = 440 \times 2^{\frac{\text{MIDI} - 69}{12}}$$
- **Dynamic Exponential Gain Envelope**:
  - *Attack*: $0.0001 \to 0.22$ over $12\text{ ms}$.
  - *Decay / Sustain*: Exponential release to $0.0001$ over duration $t_{\text{note}}$.

---

## 4. Mathematical Formulations

### 4.1 Leaky Integrate-and-Fire (LIF) Dynamics

For neuron $i \in \{1, \dots, N\}$ at simulation step $t$:

$$V_i[t+1] = V_i[t] \cdot \tau_i + I_i^{\text{ext}}[t] + I_i^{\text{syn}}[t]$$

$$\text{Spike Condition: } S_i[t] = \begin{cases} 1 & \text{if } V_i[t] \ge \theta_i \text{ and } R_i[t] = 0 \\ 0 & \text{otherwise} \end{cases}$$

$$\text{Post-Spike Reset: } \text{if } S_i[t] = 1 \implies \begin{cases} V_i[t] = \theta_i \\ R_i[t+1] = r_i^{\text{limit}} \end{cases}$$

$$\text{Synaptic Current Propagation (1-Tick Delay): } I_{\text{post}}^{\text{syn}}[t+1] = \sum_{j \in \text{pre}(\text{post})} W_{j, \text{post}} \cdot S_j[t]$$

---

### 4.2 Calcium Kinetic Integration ($Ca^{2+}$ / GCaMP Tracer)

To mirror biological GCaMP fluorescent calcium indicators, each neuron maintains an integrated calcium trace $Ca_i$:

$$Ca_i[t+1] = Ca_i[t] \cdot \gamma_{\text{decay}} + S_i[t], \quad \gamma_{\text{decay}} = 0.78$$

Population-level readouts are computed as:

$$\text{PopActivity}(P) = \frac{1}{|P|} \sum_{i \in P} Ca_i[t]$$

$$\text{PopVoltage}(P) = \frac{1}{|P|} \sum_{i \in P} \frac{V_i[t]}{\theta_i}$$

$$\text{PopSpikeRate}(P) = \frac{1}{|P|} \sum_{i \in P} S_i[t]$$

---

### 4.3 Three-Factor STDP & Dopaminergic Reward Prediction Error (RPE)

Synaptic eligibility traces and reward prediction updates follow three-factor plasticity:

$$\text{Trace}_{\text{pre}, i}[t+1] = \text{Trace}_{\text{pre}, i}[t] \cdot \lambda_{\text{trace}} + S_i[t], \quad \lambda_{\text{trace}} = 0.92$$

$$\text{Trace}_{\text{post}, j}[t+1] = \text{Trace}_{\text{post}, j}[t] \cdot \lambda_{\text{trace}} + S_j[t]$$

$$\Delta W_{i,j} = \eta \cdot \delta_{\text{RPE}} \cdot \left( \text{Trace}_{\text{pre}, i} \cdot \text{Trace}_{\text{post}, j} - \alpha \cdot \text{Trace}_{\text{post}, i} \cdot \text{Trace}_{\text{pre}, j} \right)$$

where $\eta = 8 \times 10^{-4}$, $\alpha = 0.4$, and $\delta_{\text{RPE}} \in [-1.0, 1.0]$.

The behavioral policy at note position $k$ within song track $m$ updates according to:

$$Q_m(k, a) \leftarrow Q_m(k, a) + \begin{cases} +1.0 & \text{if } a = a^* \text{ (Target Hit)} \\ -0.45 & \text{if } a \ne a^* \text{ (Error / Penalty)} \end{cases}$$

$$\pi(a \mid s) = (1 - \epsilon) \cdot \mathbb{I}\left(a = \arg\max_{a'} Q(s, a')\right) + \frac{\epsilon}{|A|}, \quad \epsilon \to 0$$

---

### 4.4 Central Complex Compass (E-PG Heading Vector Integration)

The circular mean heading $\Theta_{\text{EPG}}$ is integrated over 4 cardinal E-PG wedge neurons ($\phi_k \in \{0, \frac{\pi}{2}, \pi, \frac{3\pi}{2}\}$):

$$\Theta_{\text{EPG}} = \operatorname{atan2}\left( \sum_{k=0}^3 Ca_{\text{EPG}_k} \sin \phi_k, \sum_{k=0}^3 Ca_{\text{EPG}_k} \cos \phi_k \right) \pmod{2\pi}$$

---

### 4.5 Behavioral Arbitration & State Machine Transitions

```
                                  ┌───────────────────────────┐
                                  │      Sensory Streams      │
                                  └─────────────┬─────────────┘
                                                │
                          ┌─────────────────────┴─────────────────────┐
                          ▼                                           ▼
                 [PPL1_DAN > 0.30]                           [GF Spike || Panic > 0.55]
                          │                                           │
                          ▼                                           ▼
                 ┌─────────────────┐                         ┌─────────────────┐
                 │  STATE: DISGUST │                         │  STATE: ESCAPE  │
                 └─────────────────┘                         └─────────────────┘
                          │                                           │
                          └─────────────────────┬─────────────────────┘
                                                │ (Normal Conditions)
                                                ▼
                                    ┌───────────────────────┐
                                    │    NPF_level > 0.55   │
                                    └───────────┬───────────┘
                                                │
                                ┌───────────────┴───────────────┐
                                ▼                               ▼
                       ┌─────────────────┐             ┌─────────────────┐
                       │ STATE: FORAGING │             │ STATE: GROOMING │
                       │ (Piano Playing) │             │    / ALERT      │
                       └─────────────────┘             └─────────────────┘
```

---

## 5. Classical Repertoire & Musical Arrangement Mapping

The virtual piano comprises **24 chromatic keys** spanning MIDI $48$ ($C_3$) to MIDI $71$ ($B_4$). Ten public-domain classical masterpieces are arranged into discrete temporal beat frames ($\text{Beat Period} = 180\text{ ms}$):

| # | Track Title | Composer | Key Signature | Tempo / Beat Scaling | Signature Theme Excerpt (MIDI Key Indices) |
|:---:|:---|:---|:---:|:---:|:---|
| 1 | **Ode to Joy** | L. v. Beethoven | D Major / C | $1.0\times$ ($180\text{ ms}$) | `E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 E4 D4 D4` |
| 2 | **Für Elise** | L. v. Beethoven | A Minor | $0.75\times$ ($135\text{ ms}$) | `E5 D#5 E5 D#5 E5 B4 D5 C5 A4 A2 E3 A3 C4 E4 A4 B4` |
| 3 | **Moonlight Sonata** | L. v. Beethoven | C# Minor | $0.75\times$ ($135\text{ ms}$) | `A3 E4 A4 A3 E4 A4 A3 E4 A4 G3 E4 A4 G3 E4 A4 F3` |
| 4 | **Canon in D** | J. Pachelbel | D Major | $0.75\times$ ($135\text{ ms}$) | `D4 C#4 D4 E4 F#4 G4 A4 F#4 G4 A4 B4 C5 B4 A4 G4 F#4` |
| 5 | **Greensleeves** | Traditional | F Minor / Dor. | $1.0\times$ ($180\text{ ms}$) | `E4 G4 A4 A4 B4 A4 G4 F4 E4 D4 C4 D4 E4 E4` |
| 6 | **Amazing Grace** | Traditional | G Major | $1.0\times$ ($180\text{ ms}$) | `C4 F4 A4 F4 A4 G4 F4 D4 C4 F4 A4 F4 A4 C5 A4` |
| 7 | **Jingle Bells** | J. Pierpont | G Major | $0.5\times$ ($90\text{ ms}$) | `E4 E4 E4 E4 E4 E4 E4 G4 C4 D4 E4 F4 F4 F4 F4 F4` |
| 8 | **Happy Birthday** | Traditional | F Major | $0.75\times$ ($135\text{ ms}$) | `C4 C4 D4 C4 F4 E4 C4 C4 D4 C4 G4 F4 C4 C4 C5 A4` |
| 9 | **Scarborough Fair** | Traditional | D Dorian | $1.0\times$ ($180\text{ ms}$) | `A4 A4 C5 D5 E5 D5 C5 A4 G4 A4 C5 D5 C5 A4 G4` |
| 10 | **Beethoven Fifth** | L. v. Beethoven | C Minor | $0.5\times$ ($90\text{ ms}$) | `E4 E4 E4 C4 E4 E4 E4 A3 E4 E4 E4 C4 E4 E4 E4 A3` |

*Note: Out-of-bounds notes are automatically mapped into the active 24-key span using octave wrapping: $\text{MIDI}_{\text{fit}} = ((\text{MIDI} - 48) \pmod{24}) + 48$.*

---

## 6. User Guide & Runtime Operations

### 6.1 Installation & Quickstart

Because the simulation uses Web Workers and WebAudio APIs, it must be served over an HTTP/HTTPS protocol.

```bash
# Clone repository
git clone https://github.com/udish/Pac-Fly.git
cd Pac-Fly

# Launch local HTTP server (Python 3)
python3 -m http.server 8000

# Or using Node.js http-server
npx http-server . -p 8000
```

Open your browser at `http://localhost:8000`. Click the **▶ (Play)** button to initialize the `AudioContext` and start the fly's learning loop.

---

### 6.2 Telemetry Dashboard Interpretation

```
┌────────────────────────────────────────────────────────────────────────┐
│                        TELEMETRY DASHBOARD STRIP                       │
├───────────────────┬───────────────────┬────────────────────────────────┤
│ Readout Element   │ Metric Range      │ Neurobiological Significance   │
├───────────────────┼───────────────────┼────────────────────────────────┤
│ DOPAMINE / REWARD │ 0% – 100%         │ PAM_DAN transient / RPE gain   │
│ NEURAL ACTIVITY   │ LIVE / REINFORCED │ Synaptic plasticity status     │
│ EMOTION           │ CURIOUS / JOYFUL  │ State machine behavioral mode  │
│ HORMONES          │ DA · 5-HT · OA    │ Neuromodulator balance         │
│ NEURONS           │ X / N ACTIVE      │ Whole-Brain GCaMP firing count │
│ STATUS BAR        │ ENGINE BACKEND    │ FlyWire / Compact LIF backend  │
└───────────────────┴───────────────────┴────────────────────────────────┘
```

---

### 6.3 Sensory Stimulation & Environmental Perturbation

The neural engine continuously ingests real-time sensory objects:

```javascript
const sense = {
  sugarBearing: 0,      // Angular position of appetitive reward (-π to +π)
  sugarDist: 1.0,       // Distance to food odor source
  ghostBearing: 0,      // Angular position of looming predator
  ghostDist: null,      // Distance to hazard (null = clear)
  headingIndex: 0,      // E-PG compass heading (0=0°, 1=90°, 2=180°, 3=270°)
  foodOdor: 1.0,        // Antennal lobe ORN sugar current
  dangerOdor: 0.0,      // Aversive olfactory current
  temperature: 0.50     // Ambient temperature (0.0=cold, 0.5=optimal, 1.0=heat shock)
};

// Step the network at fixed 100ms cadence
brain.update(0.1, sense);
```

---

## 7. Benchmark Specifications & Biological Accuracy Disclaimer

- **Execution Cadence**: Fixed $100\text{ ms}$ ($\Delta t = 0.1\text{ s}$) neural stepping loop independent of screen refresh rate.
- **Worker Concurrency**: FlyWire graph processes inside a dedicated Web Worker using zero-copy transfer of typed arrays.
- **Memory Footprint**: $\approx 42\text{ MB}$ uncompressed RAM for full FlyWire graph; $< 2\text{ MB}$ for compact LIF.
- **Scientific Disclaimer**: *Drosophila Synaptic Cafe* is a neurocomputational simulation and artistic exploration designed for education, research visualization, and bio-inspired artificial intelligence. While topological connectivity and polarity reflect real *Drosophila* connectome datasets (FlyWire FAFB v783 / Janelia hemibrain), individual synaptic weights in the compact model are calibrated for computational stability and musical learning rather than exact patch-clamp biophysical measurements.

---

## 8. References & Citations

1. **Dorkenwald, S. et al. (2024)**. *Neuronal wiring diagram of an adult brain.* **Nature**, 634, 124–138. [doi:10.1038/s41586-024-07558-y](https://doi.org/10.1038/s41586-024-07558-y)
2. **Scheffer, L. K. et al. (2020)**. *A connectome and analysis of the adult Drosophila central brain.* **eLife**, 9, e57443. [doi:10.7554/eLife.57443](https://doi.org/10.7554/eLife.57443)
3. **Aso, Y. et al. (2014)**. *The neuronal architecture of the mushroom body provides a logic for associative learning.* **eLife**, 3, e04577. [doi:10.7554/eLife.04577](https://doi.org/10.7554/eLife.04577)
4. **Seelig, J. D., & Jayaraman, V. (2015)**. *Neural dynamics for landmark orientation and angular path integration.* **Nature**, 521(7551), 186–191. [doi:10.1038/nature14446](https://doi.org/10.1038/nature14446)
5. **Card, G., & Dickinson, M. H. (2008)**. *Visually mediated motor planning in the escape response of Drosophila.* **Current Biology**, 18(17), 1300–1307. [doi:10.1016/j.cub.2008.07.094](https://doi.org/10.1016/j.cub.2008.07.094)
6. **Hige, T. et al. (2015)**. *Heterosynaptic plasticity underlies aversive olfactory learning in Drosophila.* **Neuron**, 88(5), 985–998. [doi:10.1016/j.neuron.2015.11.003](https://doi.org/10.1016/j.neuron.2015.11.003)

---

<div align="center">
  <sub>Engineered with 🧠 and ☕ for the Computational Neuroscience & WebAudio Community.</sub>
</div>
