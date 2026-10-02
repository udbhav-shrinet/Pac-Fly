/**
 * ConnectomeVisualizer.js — Interactive 2D/3D Whole-Brain Drosophila Connectome Engine
 *
 * Renders biological neuropils, synaptic graph connections, GCaMP6f calcium fluorescence,
 * action potential particle pulses, and real-time population hover inspection.
 */

class ConnectomeVisualizer {
  constructor(canvas, tooltipEl) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.tooltipEl = tooltipEl;
    this.viewMode = '2d'; // '2d' | '3d'
    this.filter = 'all'; // 'all' | 'sensory' | 'mb' | 'cx' | 'motor' | 'dan'
    this.showParticles = true;
    this.showHeatmap = true;

    // Viewport transform
    this.zoom = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.rotX = 0.35;
    this.rotY = 0.25;
    this.isDragging = false;
    this.lastMouse = { x: 0, y: 0 };
    this.hoveredNode = null;

    // Connectome data references
    this.brain = null;
    this.particles = [];
    this.maxParticles = 120;

    // Population anatomical metadata & coordinates
    this.nodeMap = new Map();
    this.edgeList = [];
    this._initAnatomicalGraph();
    this._initEvents();
  }

  setBrain(brainInstance) {
    this.brain = brainInstance;
  }

  _initAnatomicalGraph() {
    // 2D Normalized coordinates [x (-1..1), y (-1..1), z (-1..1)] for Drosophila brain regions
    const POP_METADATA = [
      // Sensory Olfactory
      { id: 'ORN_sugar_L', name: 'Sweet ORN (Left)', region: 'Sensory (Antenna)', count: 3, transmitter: 'Acetylcholine', role: 'Detection of sucrose and appetitive sugars', x: -0.75, y: -0.68, z: 0.2, category: 'sensory', color: '#72c49c' },
      { id: 'ORN_sugar_R', name: 'Sweet ORN (Right)', region: 'Sensory (Antenna)', count: 3, transmitter: 'Acetylcholine', role: 'Detection of sucrose and appetitive sugars', x: 0.75, y: -0.68, z: 0.2, category: 'sensory', color: '#72c49c' },
      { id: 'PN_L', name: 'Projection Neurons (Left)', region: 'Antennal Lobe (AL)', count: 3, transmitter: 'Acetylcholine', role: 'Relays olfactory signals from AL to MB & LH', x: -0.48, y: -0.42, z: 0.1, category: 'sensory', color: '#38bdf8' },
      { id: 'PN_R', name: 'Projection Neurons (Right)', region: 'Antennal Lobe (AL)', count: 3, transmitter: 'Acetylcholine', role: 'Relays olfactory signals from AL to MB & LH', x: 0.48, y: -0.42, z: 0.1, category: 'sensory', color: '#38bdf8' },
      { id: 'LH_L', name: 'Lateral Horn (Left)', region: 'Lateral Horn (LH)', count: 2, transmitter: 'GABA / Glu', role: 'Innate olfactory attraction and aversion behaviors', x: -0.65, y: -0.15, z: 0.3, category: 'sensory', color: '#94a3b8' },
      { id: 'LH_R', name: 'Lateral Horn (Right)', region: 'Lateral Horn (LH)', count: 2, transmitter: 'GABA / Glu', role: 'Innate olfactory attraction and aversion behaviors', x: 0.65, y: -0.15, z: 0.3, category: 'sensory', color: '#94a3b8' },

      // Sensory Visual & Threat Looming
      { id: 'LC4_L', name: 'LC4 Looming Visual (Left)', region: 'Lobula Complex (Optic Lobe)', count: 3, transmitter: 'Acetylcholine', role: 'High-speed looming predator detection', x: -0.85, y: 0.05, z: -0.1, category: 'sensory', color: '#ff4560' },
      { id: 'LC4_R', name: 'LC4 Looming Visual (Right)', region: 'Lobula Complex (Optic Lobe)', count: 3, transmitter: 'Acetylcholine', role: 'High-speed looming predator detection', x: 0.85, y: 0.05, z: -0.1, category: 'sensory', color: '#ff4560' },
      { id: 'LPLC2_L', name: 'LPLC2 Threat Visual (Left)', region: 'Lobula Plate', count: 2, transmitter: 'Acetylcholine', role: 'Approaching object trajectory & looming tracking', x: -0.80, y: 0.30, z: -0.2, category: 'sensory', color: '#fb7185' },
      { id: 'LPLC2_R', name: 'LPLC2 Threat Visual (Right)', region: 'Lobula Plate', count: 2, transmitter: 'Acetylcholine', role: 'Approaching object trajectory & looming tracking', x: 0.80, y: 0.30, z: -0.2, category: 'sensory', color: '#fb7185' },

      // Mushroom Body (Learning & Memory)
      { id: 'KC', name: 'Kenyon Cells (MB Calyx)', region: 'Mushroom Body (MB)', count: 8, transmitter: 'Acetylcholine', role: 'Sparse associative sparse coding of sensory patterns & melodies', x: 0.0, y: -0.38, z: 0.4, category: 'mb', color: '#a6e3c5' },
      { id: 'MBON_approach', name: 'MBON Approach (MBON-γ5β\'2)', region: 'Mushroom Body Lobes', count: 3, transmitter: 'Glutamate', role: 'Drives learned appetitive approach and key execution', x: 0.0, y: -0.10, z: 0.25, category: 'mb', color: '#e5b967' },
      { id: 'PAM_DAN', name: 'PAM Dopaminergic Cluster', region: 'Protocerebral Anterior Medial', count: 4, transmitter: 'Dopamine (DA)', role: 'Encodes positive reward prediction & target key hits', x: -0.22, y: -0.22, z: 0.35, category: 'dan', color: '#00f0ff' },
      { id: 'PPL1_DAN', name: 'PPL1 Dopaminergic Cluster', region: 'Protocerebral Posterior Lateral', count: 3, transmitter: 'Dopamine (DA)', role: 'Encodes aversive punishment & bitter/hazard collision', x: 0.22, y: -0.22, z: 0.35, category: 'dan', color: '#f43f5e' },
      { id: 'NPF', name: 'Neuropeptide F (NPF)', region: 'Dorsomedial Protocerebrum', count: 2, transmitter: 'Neuropeptide F', role: 'Starvation & hunger drive, modulates olfactory sensitivity', x: -0.32, y: -0.55, z: 0.0, category: 'dan', color: '#34d399' },
      { id: 'OA_VPM', name: 'Octopamine VPM (OA)', region: 'Ventral Paired Medial', count: 3, transmitter: 'Octopamine (OA)', role: 'Global arousal, stress vigilance and motor priming', x: 0.32, y: -0.55, z: 0.0, category: 'dan', color: '#fb923c' },

      // Central Complex (Compass & Navigation)
      { id: 'EPG_0', name: 'EPG Compass Wedge 0°', region: 'Ellipsoid Body (EB)', count: 1, transmitter: 'Acetylcholine', role: 'Internal compass representation of facing angle', x: 0.0, y: 0.12, z: 0.0, category: 'cx', color: '#f7d070' },
      { id: 'EPG_1', name: 'EPG Compass Wedge 90°', region: 'Ellipsoid Body (EB)', count: 1, transmitter: 'Acetylcholine', role: 'Internal compass representation of facing angle', x: 0.16, y: 0.22, z: 0.0, category: 'cx', color: '#f7d070' },
      { id: 'EPG_2', name: 'EPG Compass Wedge 180°', region: 'Ellipsoid Body (EB)', count: 1, transmitter: 'Acetylcholine', role: 'Internal compass representation of facing angle', x: 0.0, y: 0.32, z: 0.0, category: 'cx', color: '#f7d070' },
      { id: 'EPG_3', name: 'EPG Compass Wedge 270°', region: 'Ellipsoid Body (EB)', count: 1, transmitter: 'Acetylcholine', role: 'Internal compass representation of facing angle', x: -0.16, y: 0.22, z: 0.0, category: 'cx', color: '#f7d070' },
      { id: 'EPG', name: 'EPG Heading Ring', region: 'Central Complex (CX)', count: 4, transmitter: 'Acetylcholine', role: 'Compass activity bump integrating turning cues', x: 0.0, y: 0.22, z: 0.0, category: 'cx', color: '#f7d070' },

      // Motor Descending Outputs
      { id: 'DNa_left', name: 'DNa Descending Steering (Left)', region: 'VNC Descending Pathway', count: 3, transmitter: 'Acetylcholine', role: 'Directs leftward steering & key targeting', x: -0.42, y: 0.65, z: -0.3, category: 'motor', color: '#38bdf8' },
      { id: 'DNa_right', name: 'DNa Descending Steering (Right)', region: 'VNC Descending Pathway', count: 3, transmitter: 'Acetylcholine', role: 'Directs rightward steering & key targeting', x: 0.42, y: 0.65, z: -0.3, category: 'motor', color: '#38bdf8' },
      { id: 'DNp09_fwd', name: 'DNp09 Forward Locomotion', region: 'VNC Descending Pathway', count: 3, transmitter: 'Acetylcholine', role: 'Drives forward walking velocity & key depression force', x: 0.0, y: 0.68, z: -0.3, category: 'motor', color: '#72c49c' },
      { id: 'MDN_escape', name: 'MDN Moonwalker Reverse', region: 'Subesophageal Zone', count: 2, transmitter: 'GABA', role: 'Triggers backward walking retreat during conflict', x: -0.18, y: 0.85, z: -0.4, category: 'motor', color: '#a855f7' },
      { id: 'GF', name: 'Giant Fiber (GF Escape)', region: 'Cervical Connective Command', count: 2, transmitter: 'Acetylcholine / Electrical', role: 'Ultra-fast emergency escape jump & take-off', x: 0.18, y: 0.85, z: -0.4, category: 'motor', color: '#ef4444' }
    ];

    POP_METADATA.forEach(node => {
      this.nodeMap.set(node.id, {
        ...node,
        calcium: 0,
        voltage: 0,
        spiked: false,
        pulseAnim: 0,
        screenX: 0,
        screenY: 0,
        screenRadius: 8
      });
    });

    // Anatomical synaptic pathways (pre -> post)
    this.edgeList = [
      { pre: 'ORN_sugar_L', post: 'PN_L', weight: 0.90, type: 'excitatory' },
      { pre: 'ORN_sugar_R', post: 'PN_R', weight: 0.90, type: 'excitatory' },
      { pre: 'PN_L', post: 'LH_L', weight: 0.70, type: 'excitatory' },
      { pre: 'PN_R', post: 'LH_R', weight: 0.70, type: 'excitatory' },
      { pre: 'LH_L', post: 'DNa_left', weight: 0.55, type: 'excitatory' },
      { pre: 'LH_R', post: 'DNa_right', weight: 0.55, type: 'excitatory' },
      { pre: 'PN_L', post: 'KC', weight: 0.45, type: 'excitatory' },
      { pre: 'PN_R', post: 'KC', weight: 0.45, type: 'excitatory' },
      { pre: 'KC', post: 'MBON_approach', weight: 0.55, type: 'plastic' },
      { pre: 'PAM_DAN', post: 'MBON_approach', weight: 0.65, type: 'modulatory' },
      { pre: 'PAM_DAN', post: 'NPF', weight: -0.90, type: 'inhibitory' },
      { pre: 'PPL1_DAN', post: 'MBON_approach', weight: -1.20, type: 'inhibitory' },
      { pre: 'PPL1_DAN', post: 'DNp09_fwd', weight: -0.80, type: 'inhibitory' },
      { pre: 'NPF', post: 'PN_L', weight: 0.50, type: 'modulatory' },
      { pre: 'NPF', post: 'PN_R', weight: 0.50, type: 'modulatory' },
      { pre: 'NPF', post: 'DNp09_fwd', weight: 0.40, type: 'excitatory' },
      { pre: 'MBON_approach', post: 'DNp09_fwd', weight: 0.60, type: 'excitatory' },
      { pre: 'LC4_L', post: 'GF', weight: 0.85, type: 'excitatory' },
      { pre: 'LC4_R', post: 'GF', weight: 0.85, type: 'excitatory' },
      { pre: 'LC4_L', post: 'DNa_right', weight: 1.40, type: 'contralateral' },
      { pre: 'LC4_R', post: 'DNa_left', weight: 1.40, type: 'contralateral' },
      { pre: 'LPLC2_L', post: 'GF', weight: 0.70, type: 'excitatory' },
      { pre: 'LPLC2_R', post: 'GF', weight: 0.70, type: 'excitatory' },
      { pre: 'GF', post: 'MBON_approach', weight: -1.50, type: 'inhibitory' },
      { pre: 'GF', post: 'DNp09_fwd', weight: 1.10, type: 'excitatory' },
      { pre: 'GF', post: 'MDN_escape', weight: 1.30, type: 'excitatory' },
      { pre: 'GF', post: 'OA_VPM', weight: 0.50, type: 'modulatory' },
      { pre: 'OA_VPM', post: 'DNp09_fwd', weight: 0.35, type: 'modulatory' },
      { pre: 'EPG', post: 'DNa_left', weight: 0.25, type: 'excitatory' },
      { pre: 'EPG', post: 'DNa_right', weight: 0.25, type: 'excitatory' }
    ];
  }

  _initEvents() {
    const canvas = this.canvas;
    canvas.addEventListener('mousedown', e => {
      this.isDragging = true;
      this.lastMouse = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener('mousemove', e => {
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      if (this.isDragging) {
        const dx = e.clientX - this.lastMouse.x;
        const dy = e.clientY - this.lastMouse.y;
        this.lastMouse = { x: e.clientX, y: e.clientY };

        if (this.viewMode === '3d') {
          this.rotY += dx * 0.008;
          this.rotX += dy * 0.008;
          this.rotX = Math.max(-1.4, Math.min(1.4, this.rotX));
        } else {
          this.panX += dx;
          this.panY += dy;
        }
      } else {
        this._checkHover(mouseX, mouseY);
      }
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.12 : 0.89;
      this.zoom = Math.max(0.4, Math.min(3.5, this.zoom * zoomFactor));
    }, { passive: false });

    // Touch events for mobile/tablet
    let touchStartDist = 0;
    canvas.addEventListener('touchstart', e => {
      if (e.touches.length === 1) {
        this.isDragging = true;
        this.lastMouse = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      } else if (e.touches.length === 2) {
        touchStartDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
      }
    });

    canvas.addEventListener('touchmove', e => {
      if (e.touches.length === 1 && this.isDragging) {
        const dx = e.touches[0].clientX - this.lastMouse.x;
        const dy = e.touches[0].clientY - this.lastMouse.y;
        this.lastMouse = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        if (this.viewMode === '3d') {
          this.rotY += dx * 0.008;
          this.rotX += dy * 0.008;
        } else {
          this.panX += dx;
          this.panY += dy;
        }
      } else if (e.touches.length === 2) {
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        if (touchStartDist > 0) {
          const factor = dist / touchStartDist;
          this.zoom = Math.max(0.4, Math.min(3.5, this.zoom * factor));
          touchStartDist = dist;
        }
      }
    });

    canvas.addEventListener('touchend', () => {
      this.isDragging = false;
      touchStartDist = 0;
    });
  }

  _checkHover(mouseX, mouseY) {
    let found = null;
    let minDistance = 24;

    for (const [id, node] of this.nodeMap) {
      if (this.filter !== 'all' && node.category !== this.filter) continue;
      const d = Math.hypot(mouseX - node.screenX, mouseY - node.screenY);
      if (d < node.screenRadius + 8 && d < minDistance) {
        minDistance = d;
        found = node;
      }
    }

    this.hoveredNode = found;
    this._updateTooltip(mouseX, mouseY);
  }

  _updateTooltip(mouseX, mouseY) {
    if (!this.tooltipEl) return;
    if (!this.hoveredNode) {
      this.tooltipEl.style.opacity = '0';
      this.tooltipEl.style.pointerEvents = 'none';
      return;
    }

    const n = this.hoveredNode;
    const calciumFmt = (n.calcium * 100).toFixed(1);
    const voltageFmt = (n.voltage * 70 - 70).toFixed(1); // Scaled to realistic -70mV to 0mV

    this.tooltipEl.innerHTML = `
      <div class="tip-header">
        <span class="tip-title">${n.name}</span>
        <span class="tip-badge" style="background:${n.color}22; color:${n.color}; border:1px solid ${n.color}44;">${n.region}</span>
      </div>
      <div class="tip-desc">${n.role}</div>
      <div class="tip-metrics">
        <div><span>NEURONS</span><b>${n.count} cells</b></div>
        <div><span>TRANSMITTER</span><b>${n.transmitter}</b></div>
        <div><span>MEMBRANE</span><b>${voltageFmt} mV</b></div>
        <div><span>GCaMP6f ΔF/F</span><b>${calciumFmt}%</b></div>
      </div>
    `;

    const pad = 15;
    const canvasRect = this.canvas.getBoundingClientRect();
    let x = mouseX + pad;
    let y = mouseY + pad;

    if (x + 240 > canvasRect.width) x = mouseX - 250;
    if (y + 160 > canvasRect.height) y = mouseY - 170;

    this.tooltipEl.style.left = `${Math.max(10, x)}px`;
    this.tooltipEl.style.top = `${Math.max(10, y)}px`;
    this.tooltipEl.style.opacity = '1';
  }

  setViewMode(mode) {
    this.viewMode = mode;
    this.panX = 0;
    this.panY = 0;
    this.rotX = 0.35;
    this.rotY = 0.25;
    this.zoom = 1.0;
  }

  setFilter(category) {
    this.filter = category;
  }

  toggleParticles() {
    this.showParticles = !this.showParticles;
    return this.showParticles;
  }

  toggleHeatmap() {
    this.showHeatmap = !this.showHeatmap;
    return this.showHeatmap;
  }

  resetView() {
    this.zoom = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.rotX = 0.35;
    this.rotY = 0.25;
  }

  /**
   * Update live neuron states from the brain instance
   */
  updateFromBrain() {
    if (!this.brain) return;

    // Check if we are using Compact Connectome (LIF) or Whole-Brain Bridge
    const conn = this.brain.connectome;
    const state = this.brain.state;

    for (const [id, node] of this.nodeMap) {
      if (conn && conn._popIndex) {
        node.calcium = conn.populationActivity(id) || 0;
        node.voltage = conn.populationVoltage(id) || 0;
        node.spiked = conn.populationSpikeRate(id) > 0;
      } else if (state) {
        // Map from state variables
        if (id === 'PAM_DAN') node.calcium = state.dopamineTransient || 0;
        else if (id === 'PPL1_DAN') node.calcium = state.ppl1Transient || 0;
        else if (id === 'GF') node.calcium = state.panicLevel || 0;
        else if (id === 'OA_VPM') node.calcium = state.octopamineLevel || 0;
        else if (id === 'NPF') node.calcium = state.npfLevel || 0;
        else if (id.startsWith('EPG')) node.calcium = 0.6;
        else node.calcium = state.arousalLevel || 0.2;
      }

      if (node.spiked) {
        node.pulseAnim = 1.0;
        // Spawn synaptic action potential particles
        if (this.showParticles && this.particles.length < this.maxParticles) {
          const outgoingEdges = this.edgeList.filter(e => e.pre === id);
          outgoingEdges.forEach(edge => {
            this.particles.push({
              pre: id,
              post: edge.post,
              progress: 0,
              speed: 0.035 + Math.random() * 0.025,
              color: node.color,
              size: 2.5 + Math.random() * 1.5
            });
          });
        }
      } else {
        node.pulseAnim *= 0.90;
      }
    }

    // Update particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.progress += p.speed;
      if (p.progress >= 1.0) {
        this.particles.splice(i, 1);
      }
    }
  }

  /**
   * Render frame
   */
  render() {
    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;

    // Clear background
    ctx.clearRect(0, 0, width, height);

    // Compute screen positions of nodes
    const centerX = width / 2 + this.panX;
    const centerY = height / 2 + this.panY;
    const scale = Math.min(width, height) * 0.42 * this.zoom;

    // Project nodes
    for (const [id, node] of this.nodeMap) {
      if (this.viewMode === '3d') {
        // 3D rotation
        let x = node.x;
        let y = node.y;
        let z = node.z;

        // Rotate Y
        const cosY = Math.cos(this.rotY);
        const sinY = Math.sin(this.rotY);
        const x1 = x * cosY + z * sinY;
        const z1 = -x * sinY + z * cosY;

        // Rotate X
        const cosX = Math.cos(this.rotX);
        const sinX = Math.sin(this.rotX);
        const y2 = y * cosX - z1 * sinX;
        const z2 = y * sinX + z1 * cosX;

        // Perspective projection
        const fov = 2.2;
        const persp = fov / (fov + z2 * 0.7);

        node.screenX = centerX + x1 * scale * persp;
        node.screenY = centerY + y2 * scale * persp;
        node.screenRadius = Math.max(4, (7 + node.count * 0.8) * this.zoom * persp);
        node.depth = z2;
      } else {
        // 2D Anatomical Layout
        node.screenX = centerX + node.x * scale;
        node.screenY = centerY + node.y * scale;
        node.screenRadius = Math.max(5, (8 + node.count * 0.8) * this.zoom);
        node.depth = 0;
      }
    }

    // 1. Draw Brain Mesh Silhouette / Neuropil Boundary Halos
    this._drawNeuropilBoundaries(ctx, centerX, centerY, scale);

    // 2. Draw Synaptic Edges
    this._drawSynapticEdges(ctx);

    // 3. Draw Action Potential Particles
    if (this.showParticles) {
      this._drawParticles(ctx);
    }

    // 4. Draw Neuron Nodes with GCaMP Calcium Glow
    this._drawNeuronNodes(ctx);

    // 5. Draw EPG Heading Compass Overlay in CX region
    this._drawCompassOverlay(ctx, centerX, centerY, scale);
  }

  _drawNeuropilBoundaries(ctx, cx, cy, scale) {
    ctx.save();
    // Subtle anatomical Drosophila brain boundary
    const grad = ctx.createRadialGradient(cx, cy, 10, cx, cy, scale * 1.3);
    grad.addColorStop(0, 'rgba(40, 32, 27, 0.45)');
    grad.addColorStop(0.7, 'rgba(25, 20, 16, 0.25)');
    grad.addColorStop(1, 'rgba(15, 12, 10, 0)');

    ctx.fillStyle = grad;
    ctx.beginPath();
    // Heart/Butterfly shaped brain lobe contour
    ctx.ellipse(cx - scale * 0.35, cy - scale * 0.15, scale * 0.55, scale * 0.65, -0.2, 0, Math.PI * 2);
    ctx.ellipse(cx + scale * 0.35, cy - scale * 0.15, scale * 0.55, scale * 0.65, 0.2, 0, Math.PI * 2);
    ctx.fill();

    // Central Complex ring guide
    ctx.strokeStyle = 'rgba(247, 208, 112, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy + scale * 0.22, scale * 0.16, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }

  _drawSynapticEdges(ctx) {
    ctx.save();
    this.edgeList.forEach(edge => {
      const preNode = this.nodeMap.get(edge.pre);
      const postNode = this.nodeMap.get(edge.post);
      if (!preNode || !postNode) return;

      if (this.filter !== 'all') {
        if (preNode.category !== this.filter && postNode.category !== this.filter) return;
      }

      const x1 = preNode.screenX;
      const y1 = preNode.screenY;
      const x2 = postNode.screenX;
      const y2 = postNode.screenY;

      // Color and stroke based on synaptic type & active calcium
      const activity = Math.max(preNode.calcium, postNode.calcium);
      let strokeColor = 'rgba(120, 100, 85, 0.22)';
      let width = 1.0;

      if (edge.type === 'inhibitory') {
        strokeColor = `rgba(239, 68, 68, ${0.25 + activity * 0.6})`;
      } else if (edge.type === 'plastic') {
        strokeColor = `rgba(229, 185, 103, ${0.35 + activity * 0.65})`;
        width = 1.5 + activity * 1.5;
      } else if (edge.type === 'modulatory') {
        strokeColor = `rgba(56, 189, 248, ${0.3 + activity * 0.6})`;
      } else {
        strokeColor = `rgba(114, 196, 156, ${0.2 + activity * 0.5})`;
        width = 1.0 + activity;
      }

      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = width * this.zoom;
      ctx.beginPath();
      ctx.moveTo(x1, y1);

      // Subtle bezier curvature for organic axon look
      const mx = (x1 + x2) / 2 + (y2 - y1) * 0.08;
      const my = (y1 + y2) / 2 - (x2 - x1) * 0.08;
      ctx.quadraticCurveTo(mx, my, x2, y2);
      ctx.stroke();
    });
    ctx.restore();
  }

  _drawParticles(ctx) {
    ctx.save();
    this.particles.forEach(p => {
      const pre = this.nodeMap.get(p.pre);
      const post = this.nodeMap.get(p.post);
      if (!pre || !post) return;

      const t = p.progress;
      const x1 = pre.screenX;
      const y1 = pre.screenY;
      const x2 = post.screenX;
      const y2 = post.screenY;

      // Quadratic bezier path
      const mx = (x1 + x2) / 2 + (y2 - y1) * 0.08;
      const my = (y1 + y2) / 2 - (x2 - x1) * 0.08;

      const px = (1 - t) * (1 - t) * x1 + 2 * (1 - t) * t * mx + t * t * x2;
      const py = (1 - t) * (1 - t) * y1 + 2 * (1 - t) * t * my + t * t * y2;

      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(px, py, p.size * this.zoom, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  _drawNeuronNodes(ctx) {
    ctx.save();
    // Sort nodes by depth if 3D
    const nodes = Array.from(this.nodeMap.values());
    if (this.viewMode === '3d') {
      nodes.sort((a, b) => a.depth - b.depth);
    }

    nodes.forEach(node => {
      if (this.filter !== 'all' && node.category !== this.filter) return;

      const x = node.screenX;
      const y = node.screenY;
      const r = node.screenRadius;
      const calcium = Math.min(1.0, node.calcium || 0);
      const isHovered = this.hoveredNode === node;

      // 1. GCaMP Calcium Halo
      if (calcium > 0.08 || isHovered) {
        const glowRadius = r * (1.8 + calcium * 1.4);
        const glowGrad = ctx.createRadialGradient(x, y, r * 0.4, x, y, glowRadius);
        glowGrad.addColorStop(0, `${node.color}cc`);
        glowGrad.addColorStop(0.5, `${node.color}44`);
        glowGrad.addColorStop(1, `${node.color}00`);

        ctx.fillStyle = glowGrad;
        ctx.beginPath();
        ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
        ctx.fill();
      }

      // 2. Main Neuron Soma Body
      ctx.fillStyle = isHovered ? '#ffffff' : node.color;
      ctx.shadowColor = node.color;
      ctx.shadowBlur = (calcium * 15) + (isHovered ? 12 : 4);

      ctx.beginPath();
      ctx.arc(x, y, r + (node.pulseAnim * 3), 0, Math.PI * 2);
      ctx.fill();

      // 3. Inner Core Highlight
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x - r * 0.25, y - r * 0.25, r * 0.35, 0, Math.PI * 2);
      ctx.fill();

      // 4. Label (if zoomed in or hovered)
      if (isHovered || this.zoom > 1.3 || ['KC', 'PAM_DAN', 'GF', 'EPG'].includes(node.id)) {
        ctx.font = '10px "DM Mono", monospace';
        ctx.fillStyle = isHovered ? '#ffffff' : '#d8cfc4';
        ctx.textAlign = 'center';
        ctx.shadowBlur = 0;
        ctx.fillText(node.id, x, y + r + 12);
      }
    });
    ctx.restore();
  }

  _drawCompassOverlay(ctx, cx, cy, scale) {
    if (!this.brain) return;
    const heading = this.brain.state?.headingAngle || 0;
    const compassX = cx;
    const compassY = cy + scale * 0.22;
    const radius = scale * 0.15;

    ctx.save();
    // Draw heading compass vector indicator
    const arrowX = compassX + Math.cos(heading) * radius;
    const arrowY = compassY + Math.sin(heading) * radius;

    ctx.strokeStyle = '#f7d070';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(compassX, compassY);
    ctx.lineTo(arrowX, arrowY);
    ctx.stroke();

    // Bump indicator dot
    ctx.fillStyle = '#00f0ff';
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(arrowX, arrowY, 5 * this.zoom, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}

window.ConnectomeVisualizer = ConnectomeVisualizer;
