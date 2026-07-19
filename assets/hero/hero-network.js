(function (root) {
  'use strict';
  const C = root.HeroCore;

  const VERT = `
    attribute float size;
    attribute vec3 color;
    varying vec3 vColor;
    void main() {
      vColor = color;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = size * (55.0 / -mv.z);
      gl_Position = projectionMatrix * mv;
    }`;
  const FRAG = `
    varying vec3 vColor;
    void main() {
      float d = length(gl_PointCoord - vec2(0.5));
      float halo = smoothstep(0.5, 0.0, d);   // wide, diffuse falloff
      float core = smoothstep(0.24, 0.0, d);  // soft inner glow
      float a = halo * 0.5 + core * 0.55;
      if (a <= 0.004) discard;
      gl_FragColor = vec4(vColor, min(a, 1.0) * 0.82);   // translucent + fuzzy
    }`;

  function init(canvas, opts) {
    opts = opts || {};
    const prefersReduced = opts.reducedMotion ||
      (window.matchMedia &&
       window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const isMobile = window.innerWidth < 768;
    const N = opts.nodeCount || (isMobile ? 40 : 64);
    const BASE = C.hexToRgb('#2D6BB5');
    const DEEP = C.hexToRgb('#21558F');

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer(
        { canvas, antialias: true, alpha: true });
    } catch (err) {
      console.error('HERO WebGL init failed, hiding canvas:', err);
      canvas.style.display = 'none';
      return { destroy() {} };
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0xffffff, 0); // transparent; page bg shows through

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xffffff, 9, 20); // fade far nodes to white
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, isMobile ? 10.5 : 13); // closer on mobile → structures read bigger

    // node state: home position + jitter phase
    const nodes = [];
    for (let i = 0; i < N; i++) {
      const r = 4.2 * Math.cbrt(Math.random());
      const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
      const home = { x: r * Math.sin(ph) * Math.cos(th),
                     y: r * Math.sin(ph) * Math.sin(th) * 0.8,
                     z: r * Math.cos(ph) };
      nodes.push({ home, pos: { x: home.x, y: home.y, z: home.z },
                   ph: Math.random() * Math.PI * 2, sp: 0.3 + Math.random() * 0.4 });
    }

    const moleculeRot = ['benzene', 'isocetane', 'rdx', 'oleic_acid',
                         'tmba', 'nanoparticle', 'toluene', 'styrene'];
    const DISPLAY_SCALE = 0.50;     // Angstrom -> world; big molecules fill the hero
    let molIdx = 0;
    const snap = {
      active: false, phase: 'idle',              // phase: idle|in|hold|out
      reserved: [], reservedSet: new Set(), molecule: null, targets: null,
      forced: new Map(), elapsed: 0, firstHold: 0, nextAt: Infinity
    };
    const toneRgb = {};
    for (const key in C.ELEMENT_TONE) toneRgb[key] = C.hexToRgb(C.ELEMENT_TONE[key]);
    const allNodes = new Set();                  // spotlight a held structure:
    for (let i = 0; i < N; i++) allNodes.add(i);  // suppress ALL proximity edges

    function startSnap(force) {
      const name = force || moleculeRot[molIdx++ % moleculeRot.length];
      if (!C.MOLECULES[name]) return false;
      const K = Math.min(C.MOLECULES[name].atoms.length, N);
      const reserved = [];
      for (let i = 0; i < K; i++) reserved.push(i);
      const yaw = (Math.random() * 2 - 1) * 0.3;
      snap.molecule = name;
      snap.reserved = reserved;
      snap.reservedSet = new Set(reserved);
      snap.targets = C.buildSnapTargets(name, { x: 0, y: 0, z: 0 }, DISPLAY_SCALE, yaw);
      snap.forced = C.forcedBondEdges(name, reserved, N);
      snap.active = true; snap.phase = 'in'; snap.elapsed = 0;
      return true;
    }
    function endSnapSchedule() {
      snap.nextAt = t + 1 + Math.random() * 1.5; // ~4-6s structure-to-structure
    }

    const positions = new Float32Array(N * 3);
    const sizes = new Float32Array(N);
    const colors = new Float32Array(N * 3);
    const pGeom = new THREE.BufferGeometry();
    pGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    pGeom.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    pGeom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const pMat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false });
    const points = new THREE.Points(pGeom, pMat);

    // edges
    const edgeMap = new Map();
    const MAX_EDGES = N * 6;
    const ePos = new Float32Array(MAX_EDGES * 2 * 3);
    const eCol = new Float32Array(MAX_EDGES * 2 * 3);
    const eGeom = new THREE.BufferGeometry();
    eGeom.setAttribute('position', new THREE.BufferAttribute(ePos, 3));
    eGeom.setAttribute('color', new THREE.BufferAttribute(eCol, 3));
    const eMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
    const lines = new THREE.LineSegments(eGeom, eMat);

    const PULSE_MAX = 34;
    const PULSE_COL = C.hexToRgb('#AAD4F7');
    const pulses = []; // { a, b, p, speed }
    let pulseTimer = 0;
    const puPos = new Float32Array(PULSE_MAX * 3);
    const puSize = new Float32Array(PULSE_MAX);
    const puCol = new Float32Array(PULSE_MAX * 3);
    const puGeom = new THREE.BufferGeometry();
    puGeom.setAttribute('position', new THREE.BufferAttribute(puPos, 3));
    puGeom.setAttribute('size', new THREE.BufferAttribute(puSize, 1));
    puGeom.setAttribute('color', new THREE.BufferAttribute(puCol, 3));
    const puPoints = new THREE.Points(puGeom, pMat); // reuse glow shader

    const group = new THREE.Group();
    scene.add(group);
    group.add(points); group.add(lines); group.add(puPoints);
    lines.renderOrder = 0;
    points.renderOrder = 1;
    puPoints.renderOrder = 2;

    function disposeGfx() {
      pGeom.dispose(); eGeom.dispose(); puGeom.dispose();
      pMat.dispose(); eMat.dispose();
      renderer.dispose();
    }

    let raf = 0, t = 0, last = performance.now(), running = true;
    let mx = 0, my = 0, paraX = 0, paraY = 0; // cursor parallax targets/current

    function resize() {
      const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    const ro = new ResizeObserver(resize); ro.observe(canvas); resize();

    function stepOnce(dt) {
      t += dt;

      const IN = 0.6, OUT = 0.6;
      const HOLD = 2.0;
      if (snap.active) {
        snap.elapsed += dt;
        if (snap.phase === 'in' && snap.elapsed >= IN) { snap.phase = 'hold'; snap.elapsed = 0; }
        else if (snap.phase === 'hold' && snap.elapsed >= (snap.firstHold || HOLD)) {
          snap.phase = 'out'; snap.elapsed = 0; snap.firstHold = 0;
        } else if (snap.phase === 'out' && snap.elapsed >= OUT) {
          snap.active = false; snap.phase = 'idle'; snap.reserved = [];
          snap.forced = new Map(); endSnapSchedule();
        }
      } else if (t >= snap.nextAt) {
        startSnap();
      }
      const reservedSet = snap.active ? snap.reservedSet : null;
      const holdW = !snap.active ? 0
        : snap.phase === 'in'  ? C.easeInOut(snap.elapsed / IN)
        : snap.phase === 'out' ? 1 - C.easeInOut(snap.elapsed / OUT) : 1;

      for (let i = 0; i < N; i++) {
        const nd = nodes[i];
        nd.pos.x = nd.home.x + Math.sin(t * nd.sp + nd.ph) * 0.5;
        nd.pos.y = nd.home.y + Math.cos(t * nd.sp * 0.9 + nd.ph) * 0.5;
        nd.pos.z = nd.home.z + Math.sin(t * nd.sp * 1.1 + nd.ph * 1.3) * 0.5;
        const f = C.clamp01((nd.pos.z + 5) / 10);
        sizes[i] = (2.4 + f * 2.4) * (1 + 0.12 * Math.sin(t * 1.6 + nd.ph * 2.3));
        colors[i * 3]     = DEEP.r + (BASE.r - DEEP.r) * f;
        colors[i * 3 + 1] = DEEP.g + (BASE.g - DEEP.g) * f;
        colors[i * 3 + 2] = DEEP.b + (BASE.b - DEEP.b) * f;

        const ri = reservedSet && reservedSet.has(i) ? i : -1;
        if (ri >= 0) {
          const w = holdW;
          const tg = snap.targets[ri];
          nd.pos.x += (tg.x - nd.pos.x) * w;
          nd.pos.y += (tg.y - nd.pos.y) * w;
          nd.pos.z += (tg.z - nd.pos.z) * w;
          const el = C.MOLECULES[snap.molecule].atoms[ri].el;
          sizes[i] = sizes[i] * (1 + (0.5 + (C.ELEMENT_RADIUS[el] - 0.5) * 2.0) * w);
          const tn = toneRgb[el];
          colors[i * 3]     += (tn.r - colors[i * 3]) * w;
          colors[i * 3 + 1] += (tn.g - colors[i * 3 + 1]) * w;
          colors[i * 3 + 2] += (tn.b - colors[i * 3 + 2]) * w;
        } else if (holdW > 0) {
          sizes[i] *= (1 - 0.62 * holdW);
        }
        positions[i * 3] = nd.pos.x;
        positions[i * 3 + 1] = nd.pos.y;
        positions[i * 3 + 2] = nd.pos.z;
      }
      pGeom.attributes.position.needsUpdate = true;
      pGeom.attributes.size.needsUpdate = true;
      pGeom.attributes.color.needsUpdate = true;

      C.updateEdges(edgeMap, nodes.map(n => n.pos),
        { threshold: 1.7,
          suppressed: snap.active ? allNodes : new Set(),
          forced: snap.active ? snap.forced : new Map(),
          easeRate: 3.5, dt });
      let k = 0;
      for (const e of edgeMap.values()) {
        if (k >= MAX_EDGES) break;
        const fc = C.fadeColorToWhite(BASE, e.alpha * 0.9);
        const ia = e.a, ib = e.b, o = k * 6;
        ePos[o] = nodes[ia].pos.x; ePos[o+1] = nodes[ia].pos.y; ePos[o+2] = nodes[ia].pos.z;
        ePos[o+3] = nodes[ib].pos.x; ePos[o+4] = nodes[ib].pos.y; ePos[o+5] = nodes[ib].pos.z;
        eCol[o] = fc.r; eCol[o+1] = fc.g; eCol[o+2] = fc.b;
        eCol[o+3] = fc.r; eCol[o+4] = fc.g; eCol[o+5] = fc.b;
        k++;
      }
      eGeom.setDrawRange(0, k * 2);
      eGeom.attributes.position.needsUpdate = true;
      eGeom.attributes.color.needsUpdate = true;

      pulseTimer -= dt;
      if (pulseTimer <= 0) {
        pulseTimer = 0.06 + Math.random() * 0.11;
        if (pulses.length < PULSE_MAX) {
          let pick = null, seen = 0; // reservoir-sample an active edge
          for (const e of edgeMap.values()) {
            if (e.alpha > 0.55) { seen++; if (Math.random() < 1 / seen) pick = e; }
          }
          if (pick) pulses.push({ a: pick.a, b: pick.b, p: 0,
                                  speed: 0.6 + Math.random() * 0.7 });
        }
      }
      let pk = 0;
      for (let pi = pulses.length - 1; pi >= 0; pi--) {
        const pu = pulses[pi];
        pu.p += pu.speed * dt;
        if (pu.p >= 1) { pulses.splice(pi, 1); continue; }
        const na = nodes[pu.a].pos, nb = nodes[pu.b].pos, o = pk * 3;
        puPos[o]     = na.x + (nb.x - na.x) * pu.p;
        puPos[o + 1] = na.y + (nb.y - na.y) * pu.p;
        puPos[o + 2] = na.z + (nb.z - na.z) * pu.p;
        puSize[pk] = 6.8 * Math.sin(pu.p * Math.PI); // fade in/out along the edge
        puCol[o] = PULSE_COL.r; puCol[o + 1] = PULSE_COL.g; puCol[o + 2] = PULSE_COL.b;
        pk++;
      }
      puGeom.setDrawRange(0, pk);
      puGeom.attributes.position.needsUpdate = true;
      puGeom.attributes.size.needsUpdate = true;
      puGeom.attributes.color.needsUpdate = true;

      const ease = Math.min(dt * 3, 1);
      paraY += (mx * 0.33 - paraY) * ease;
      paraX += (my * 0.16 - paraX) * ease;
      group.rotation.y = Math.sin(t * 0.08) * 0.4 + paraY;
      group.rotation.x = Math.sin(t * 0.05) * 0.10 + paraX;
    }

    function frame(now) {
      raf = requestAnimationFrame(frame);
      if (!running) return;
      const dt = Math.min((now - last) / 1000, 0.05); last = now;
      stepOnce(dt);
      renderer.render(scene, camera);
    }

    if (startSnap('benzene')) {
      snap.phase = 'hold'; snap.elapsed = 0; snap.firstHold = 2.5;
    } else { endSnapSchedule(); }

    if (prefersReduced) {
      stepOnce(0.016);
      renderer.render(scene, camera);
      return { destroy() { ro.disconnect(); disposeGfx(); } };
    }

    function onVis() { running = !document.hidden; last = performance.now(); }
    document.addEventListener('visibilitychange', onVis);
    function onMove(e) {
      mx = (e.clientX / window.innerWidth) * 2 - 1;
      my = (e.clientY / window.innerHeight) * 2 - 1;
    }
    window.addEventListener('pointermove', onMove);
    raf = requestAnimationFrame(frame);

    return {
      destroy() { running = false; cancelAnimationFrame(raf); ro.disconnect();
                  document.removeEventListener('visibilitychange', onVis);
                  window.removeEventListener('pointermove', onMove);
                  disposeGfx(); }
    };
  }

  root.HeroNetwork = { init };
}(typeof self !== 'undefined' ? self : this));
