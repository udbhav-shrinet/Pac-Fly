# Drosophila Synaptic Cafe — Biological Connectome Neural Simulation

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen.svg)]()
[![Interactive Demo](https://img.shields.io/badge/demo-GitHub%20Pages-purple.svg)](https://udbhav-shrinet.github.io/Pac-Fly/)
[![JavaScript](https://img.shields.io/badge/javascript-WebGL%20%7C%20WebAudio-yellow.svg)]()
[![Neuroscience](https://img.shields.io/badge/domain-computational--neuroscience-blue.svg)]()
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

> Interactive computational neuroscience sandbox featuring an authentic Drosophila melanogaster (fruit fly) synaptic connectome network, Leaky Integrate-and-Fire (LIF) neural simulation, real-time auditory sonification, and 3D visualizer.

---

## 🚀 Live Interactive Simulation

Step into the Drosophila Synaptic Cafe and observe connectome neural firing in real time:  
👉 **[Launch Drosophila Neural Simulation](https://udbhav-shrinet.github.io/Pac-Fly/)**

---

## ✨ Scientific & Engineering Features

- **Authentic Connectome Architecture**: Models realistic synaptic connectivity matrices derived from full adult fruit fly brain datasets (130,000+ neurons and 50M+ synaptic connections).
- **Leaky Integrate-and-Fire (LIF) Dynamics**: Simulates membrane potential decay, synaptic current integration, absolute refractory periods, and threshold spike propagation.
- **Auditory Sonification (`NeuroAudio.js`)**: Real-time auditory synthesis translating neural spike trains and oscillatory rhythms into musical harmony.
- **Hardware-Accelerated WebGL Visualizer**: 3D spatial neuron mapping with dynamic synaptic fire illumination and telemetry oscilloscopes.

---

## 🛠️ Simulation Pipeline

```text
┌─────────────────────────┐       ┌────────────────────────┐       ┌──────────────────────┐
│  Biological Connectome  │ ───>  │ Leaky Integrate-&-Fire │ ───>  │  Motor Actions &     │
│  Synaptic Weight Matrix │       │  Spike Engine (Worker) │       │  Sensory Feedback    │
└─────────────────────────┘       └────────────────────────┘       └──────────┬───────────┘
                                                                              │
                                                   ┌──────────────────────────┴──────────────────────────┐
                                                   ▼                                                     ▼
                                       ┌─────────────────────────┐                           ┌───────────────────────┐
                                       │   Real-Time Sonification│                           │  WebGL 3D Connectome  │
                                       │   WebAudio Synthesizer  │                           │  Neural Oscilloscope  │
                                       └─────────────────────────┘                           └───────────────────────┘
```

---

## 📦 Project Architecture

- `Connectome.js`: Core neural graph adjacency list and synaptic connection topology.
- `FlyNeuralEngine.js`: LIF membrane potential solver and neural plasticity coordinator.
- `FullBrainWorker.js`: Offscreen multithreaded Web Worker executing continuous neural step integration at 60 FPS.
- `ConnectomeVisualizer.js`: 3D WebGL renderer displaying real-time synaptic pulse propagations.
- `NeuroAudio.js`: Low-latency WebAudio engine translating spike train frequencies into musical acoustics.

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.
