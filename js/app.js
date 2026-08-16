/*
 * app.js — wiring, the clock, and the 2D panels.
 *
 * The arena itself is drawn by js/render3d.js. Everything interesting happens
 * in the other files; this one decides when to step the simulation and keeps
 * the side panel honest.
 */

(function () {
  'use strict';

  // ---------------------------------------------------------------- state --

  const state = {
    cfg: { ...CONFIG },
    mode: 'endless',      // 'endless' | 'campaign'
    levelIndex: 0,        // which hand-made level, in campaign mode
    world: null,
    pop: null,
    running: true,
    speed: 4,             // simulation ticks per animation frame
    turbo: 0,             // generations still queued for fast-forward
    solvedStreak: 0,      // consecutive generations meeting the advance bar
    levelChanges: [],     // generation numbers where the level changed
    show: { trail: true },

    // Endless mode: a brand new maze every single generation.
    endless: {
      tier: 0,
      recent: [],         // escape rate of the last few generations
      mazesSeen: 0,
    },
  };

  const $ = id => document.getElementById(id);

  const shattered = new WeakSet();
  const DEATH_COLOUR = {
    [DEATH.LAVA]:    [1.00, 0.45, 0.12],
    [DEATH.FELL]:    [0.60, 0.45, 1.00],
    [DEATH.CRUSHED]: [1.00, 0.30, 0.36],
    [DEATH.TIMEOUT]: [0.55, 0.60, 0.72],
    default:         [0.45, 0.62, 0.95],
  };
  const chart = $('chart'), cctx = chart.getContext('2d');
  const brainview = $('brainview'), bctx = brainview.getContext('2d');

  const renderer = new Renderer3D($('view'));
  if (renderer.failed) {
    $('gl-error').textContent = renderer.failed;
    $('gl-error').hidden = false;
    return;
  }

  // ------------------------------------------------------------- lifecycle --

  /**
   * Swap in a world. `sel` is either a level index or the string 'endless'.
   * `keepBrains` carries the population across instead of starting from
   * random weights.
   */
  function loadLevel(sel, keepBrains) {
    if (sel === 'endless') {
      state.mode = 'endless';
    } else {
      state.mode = 'campaign';
      state.levelIndex = sel;
    }
    state.solvedStreak = 0;

    const level = buildLevel();
    installWorld(level, keepBrains, true);

    $('level-select').value = state.mode === 'endless' ? 'endless' : String(sel);
  }

  /** The level definition for whatever mode we are in. */
  function buildLevel() {
    if (state.mode === 'endless') {
      state.endless.mazesSeen++;
      // A fresh seed every time. This is the whole point of the mode: the
      // population never sees the same maze twice, so nothing it inherits can
      // be a memorised route.
      return proceduralLevel(state.endless.tier, (Math.random() * 2 ** 31) | 0);
    }
    return LEVELS[state.levelIndex];
  }

  function installWorld(level, keepBrains, reframe) {
    const previous = state.world;
    state.world = new World(level);
    state.cfg.maxTicks = tickBudget(state.world, state.cfg);

    if (!keepBrains || !state.pop) {
      state.pop = new Population(state.cfg);
      state.levelChanges = [];
    }
    state.pop.reset(state.world);

    $('level-note').textContent = level.note;
    $('brain-note').textContent =
      `${brainLayers(state.cfg).join(' → ')}  ·  ` +
      `${state.pop.agents[0].brain.weights.length} weights  ·  ` +
      `${state.cfg.memory} outputs loop back as inputs`;

    updateEndlessNote();

    // Only re-frame when the arena actually changed shape. In Endless mode the
    // maze is replaced every generation, and snapping the camera back every
    // few seconds would make it unwatchable.
    const resized = !previous || previous.w !== state.world.w || previous.h !== state.world.h;
    if (reframe || resized) renderer.frameLevel(state.world);
    resizePanels();
  }

  function updateEndlessNote() {
    const el = $('endless-note');
    if (state.mode !== 'endless') { el.hidden = true; return; }
    el.hidden = false;
    const e = state.endless;
    const recent = e.recent.length
      ? `${Math.round(e.recent.reduce((a, b) => a + b, 0) / e.recent.length * 100)}%`
      : '—';
    el.innerHTML =
      `<b>Tier ${e.tier + 1} of ${TIERS.length}</b> — ${describeTier(e.tier)}<br>` +
      `${e.mazesSeen} mazes generated · escape rate on unseen mazes, last ` +
      `${e.recent.length || 0} generations: <b>${recent}</b>`;
  }

  /** Finish the current generation, breed, and set up the next run. */
  function endGeneration() {
    const stats = state.pop.evolve();

    if (state.mode === 'endless') {
      const e = state.endless;
      e.recent.push(stats.solveRate);
      if (e.recent.length > 8) e.recent.shift();

      // Move up only on a sustained average. A single lucky maze proves
      // nothing — the whole point is performance across mazes, not on one.
      const avg = e.recent.reduce((a, b) => a + b, 0) / e.recent.length;
      if (state.cfg.autoAdvance && e.recent.length >= 6
          && avg >= state.cfg.advanceSolveRate && e.tier < TIERS.length - 1) {
        e.tier++;
        e.recent = [];
        state.levelChanges.push(state.pop.generation);
        toast(`Tier ${e.tier + 1} — ${describeTier(e.tier)}`);
      }

      installWorld(buildLevel(), true, false);
      return;
    }

    if (stats.solveRate >= state.cfg.advanceSolveRate) state.solvedStreak++;
    else state.solvedStreak = 0;

    const canAdvance = state.cfg.autoAdvance
      && state.solvedStreak >= state.cfg.advanceStableGens
      && state.levelIndex < LEVELS.length - 1;

    if (canAdvance) {
      toast(`Level cleared → ${LEVELS[state.levelIndex + 1].name}`);
      loadLevel(state.levelIndex + 1, true);
    } else {
      state.pop.reset(state.world);
    }
  }

  // ------------------------------------------------------------- main loop --

  function frame(now) {
    if (state.running && !state.turbo) {
      for (let i = 0; i < state.speed; i++) {
        if (!state.pop.step()) { endGeneration(); break; }
      }
    }

    // Blow up anyone who died since the last frame. Agent objects are rebuilt
    // every generation, so a WeakSet is enough to remember who has already
    // gone off without any bookkeeping of its own.
    if (!state.turbo) {
      for (const a of state.pop.agents) {
        if (a.alive || a.reachedGoal || shattered.has(a)) continue;
        shattered.add(a);
        renderer.shatter(a, DEATH_COLOUR[a.death] || DEATH_COLOUR.default);
      }
    }

    const leader = state.pop.leader();
    renderer.render(state.world, state.pop.agents, leader, state.show, now / 1000);

    drawStats();
    drawChart();
    drawBrain(leader);

    requestAnimationFrame(frame);
  }

  /**
   * Fast-forward without drawing the arena. One generation per timeout rather
   * than a single blocking loop, so the page stays responsive and you can
   * watch the counter climb.
   */
  function runTurbo() {
    if (state.turbo <= 0) {
      $('btn-turbo').textContent = 'Turbo 25';
      return;
    }
    state.pop.runToEnd();
    endGeneration();
    state.turbo--;
    $('btn-turbo').textContent = `${state.turbo} left`;
    setTimeout(runTurbo, 0);
  }

  // ----------------------------------------------------------- 2D panels --

  function resizePanels() {
    for (const c of [chart, brainview]) {
      const dpr = window.devicePixelRatio || 1;
      const rect = c.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      c.width = Math.round(rect.width * dpr);
      c.height = Math.round(rect.height * dpr);
      c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  function drawStats() {
    const { pop } = state;
    const last = pop.history[pop.history.length - 1];
    const alive = pop.agents.reduce((n, a) => n + (a.alive ? 1 : 0), 0);
    const solvedNow = pop.agents.reduce((n, a) => n + (a.reachedGoal ? 1 : 0), 0);

    $('s-gen').textContent = pop.generation;
    $('s-alive').textContent = `${alive} / ${pop.agents.length}`;

    // Two numbers, because one is not enough. The live count is the satisfying
    // one to watch climb, but it resets to zero at every generation boundary —
    // on its own it keeps looking like the run just collapsed. The last
    // finished generation is the number that actually means something.
    const nowEl = $('s-solved-now');
    nowEl.textContent = String(solvedNow);
    nowEl.classList.toggle('good', solvedNow > 0);

    const pct = Math.round((last ? last.solveRate : 0) * 100);
    const solvedEl = $('s-solved');
    solvedEl.textContent = `${pct}%`;
    solvedEl.classList.toggle('good', pct > 0);

    $('s-best').textContent = last ? last.best.toFixed(2) : '—';

    const closestEver = pop.history.length
      ? Math.min(...pop.history.map(h => h.closest))
      : Math.min(...pop.agents.map(a => a.bestDist));
    $('s-closest').textContent = closestEver === 0 ? 'the exit' : `${closestEver} cells`;

    const nPlates = state.world.plates.length;
    const switchRow = $('stat-switches');
    switchRow.hidden = nPlates === 0;
    if (nPlates) {
      const down = last ? last.switchesDown : 0;
      const el = $('s-switches');
      el.textContent = `${down} / ${nPlates}`;
      el.classList.toggle('good', down === nPlates);
    }

    const times = pop.history.map(h => h.bestTicks).filter(v => v != null);
    $('s-fastest').textContent = times.length ? `${Math.min(...times)} ticks` : '—';

    if (state.mode === 'endless') updateEndlessNote();

    // How the last generation ended, worst-first. On the hazard levels this is
    // the most informative thing on the page — you can watch "lava" fall and
    // "ran out of time" rise as they learn to stop walking into it.
    const deathsEl = $('deaths');
    if (last) {
      const rows = Object.entries(last.deaths).sort((a, b) => b[1] - a[1]);
      deathsEl.innerHTML = rows.map(([k, v]) =>
        `<li class="death death-${k.replace(/\s+/g, '-')}">` +
        `<span>${k}</span><b>${v}</b></li>`).join('');
    }
  }

  function drawChart() {
    const h = chartHistory();
    const w = chart.clientWidth, ht = chart.clientHeight;
    cctx.clearRect(0, 0, w, ht);
    if (h.length < 2) return;

    const pad = 4;
    const maxY = Math.max(1, ...h.map(s => s.best));
    const xOf = i => pad + (i / (h.length - 1)) * (w - pad * 2);
    const yOf = v => ht - pad - (v / maxY) * (ht - pad * 2);

    // vertical markers where the curriculum moved up a level
    cctx.strokeStyle = 'rgba(23,27,34,0.14)';
    cctx.lineWidth = 1;
    for (const g of state.levelChanges) {
      const i = h.findIndex(s => s.generation === g);
      if (i < 0) continue;
      cctx.beginPath();
      cctx.moveTo(xOf(i), pad);
      cctx.lineTo(xOf(i), ht - pad);
      cctx.stroke();
    }

    const line = (get, colour, width) => {
      cctx.strokeStyle = colour;
      cctx.lineWidth = width;
      cctx.lineJoin = 'round';
      cctx.beginPath();
      h.forEach((s, i) => (i ? cctx.lineTo(xOf(i), yOf(get(s))) : cctx.moveTo(xOf(i), yOf(get(s)))));
      cctx.stroke();
    };

    line(s => s.solveRate * maxY, 'rgba(249,115,22,0.75)', 1.5);
    line(s => s.avg, '#2563eb', 1.5);
    line(s => s.best, '#12a150', 2);
  }

  /** Only the most recent slice, so the graph keeps some resolution. */
  function chartHistory() {
    const h = state.pop.history;
    return h.length > 300 ? h.slice(h.length - 300) : h;
  }

  /**
   * The brain, live. Each column is a layer and each dot a neuron, lit by
   * whatever it is outputting this tick — so you can watch the signal fall
   * through all five layers on its way from the eyes to the wheels.
   */
  function drawBrain(agent) {
    const w = brainview.clientWidth, h = brainview.clientHeight;
    bctx.clearRect(0, 0, w, h);
    if (!agent) return;

    const act = agent.brain._act;
    const layers = agent.brain.layers;
    const padX = 16, padY = 10;
    const colGap = layers.length > 1 ? (w - padX * 2) / (layers.length - 1) : 0;

    const posOf = (L, i) => {
      const n = layers[L];
      const usable = h - padY * 2;
      const y = n > 1 ? padY + (i / (n - 1)) * usable : h / 2;
      return [padX + L * colGap, y];
    };

    // connections, faint — just enough to read it as a network
    bctx.strokeStyle = 'rgba(23,27,34,0.05)';
    bctx.lineWidth = 0.5;
    for (let L = 1; L < layers.length; L++) {
      for (let j = 0; j < layers[L]; j++) {
        const [x2, y2] = posOf(L, j);
        for (let i = 0; i < layers[L - 1]; i++) {
          const [x1, y1] = posOf(L - 1, i);
          bctx.beginPath();
          bctx.moveTo(x1, y1);
          bctx.lineTo(x2, y2);
          bctx.stroke();
        }
      }
    }

    for (let L = 0; L < layers.length; L++) {
      for (let i = 0; i < layers[L]; i++) {
        const [x, y] = posOf(L, i);
        const v = act[L] ? act[L][i] : 0;
        const m = Math.min(1, Math.abs(v));
        // positive = green, negative = blue, dim = near zero
        bctx.fillStyle = v >= 0
          ? `rgba(18,161,80,${0.14 + m * 0.86})`
          : `rgba(37,99,235,${0.14 + m * 0.86})`;
        bctx.beginPath();
        bctx.arc(x, y, 2.4 + m * 1.5, 0, Math.PI * 2);
        bctx.fill();
      }
    }
  }

  // ------------------------------------------------------------------- ui --

  let toastTimer = null;
  function toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
  }

  function wire() {
    const sel = $('level-select');
    const endless = document.createElement('option');
    endless.value = 'endless';
    endless.textContent = '∞ · Endless — a new maze every generation';
    sel.appendChild(endless);
    LEVELS.forEach((l, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = l.name;
      sel.appendChild(o);
    });
    sel.addEventListener('change', () => {
      loadLevel(sel.value === 'endless' ? 'endless' : parseInt(sel.value, 10), true);
    });

    $('btn-play').addEventListener('click', e => {
      state.running = !state.running;
      e.target.textContent = state.running ? 'Pause' : 'Play';
    });

    $('btn-skip').addEventListener('click', () => {
      state.pop.runToEnd();
      endGeneration();
    });

    $('btn-turbo').addEventListener('click', () => {
      if (state.turbo > 0) { state.turbo = 0; return; }  // click again to stop
      state.turbo = 25;
      runTurbo();
    });

    $('btn-reset').addEventListener('click', () => {
      state.turbo = 0;
      state.levelChanges = [];
      state.endless = { tier: 0, recent: [], mazesSeen: 0 };
      loadLevel(currentSelection(), false);
    });

    const depth = $('opt-depth');
    depth.value = CONFIG.hiddenLayers.join(',');
    depth.addEventListener('change', () => {
      // A different shape means differently-shaped weight vectors, so the
      // existing brains cannot come along.
      state.cfg.hiddenLayers = depth.value.split(',').map(n => parseInt(n, 10));
      state.turbo = 0;
      state.levelChanges = [];
      state.endless = { tier: 0, recent: [], mazesSeen: 0 };
      loadLevel(currentSelection(), false);
    });

    const slider = (id, label, format, apply) => {
      const el = $(id);
      const out = $(label);
      const update = () => {
        const v = parseInt(el.value, 10);
        out.textContent = format(v);
        apply(v);
      };
      el.addEventListener('input', update);
      update();
    };

    slider('opt-speed', 'v-speed', v => `${v}×`, v => { state.speed = v; });
    slider('opt-mutrate', 'v-mutrate', v => `${(v / 10).toFixed(1)}%`,
      v => { state.cfg.mutationRate = v / 1000; });
    slider('opt-mutsize', 'v-mutsize', v => (v / 100).toFixed(2),
      v => { state.cfg.mutationStrength = v / 100; });

    const check = (id, apply) => {
      const el = $(id);
      el.addEventListener('change', () => apply(el.checked));
      apply(el.checked);
    };
    check('opt-trail', v => { state.show.trail = v; });
    check('opt-follow', v => {
      renderer.follow = v;
      // wire() runs before the first level is loaded, so there may be no world
      // to frame yet.
      if (!v && state.world) renderer.frameLevel(state.world);
    });
    check('opt-curriculum', v => { state.cfg.autoAdvance = v; });

    $('btn-recentre').addEventListener('click', () => {
      $('opt-follow').checked = false;
      renderer.follow = false;
      renderer.azimuth = -Math.PI / 2 - 0.55;
      renderer.elevation = 1.15;
      renderer.frameLevel(state.world);
    });

    window.addEventListener('resize', resizePanels);

    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if (e.code === 'Space') { e.preventDefault(); $('btn-play').click(); }
      if (e.key === 'n') $('btn-skip').click();
      if (e.key === 't') $('btn-turbo').click();
      if (e.key === 'f') $('opt-follow').click();
      if (e.key === 'r') $('btn-recentre').click();
    });
  }

  // Set the sliders from CONFIG so the page and the file never disagree.
  function syncSlidersFromConfig() {
    $('opt-mutrate').value = String(Math.round(CONFIG.mutationRate * 1000));
    $('opt-mutsize').value = String(Math.round(CONFIG.mutationStrength * 100));
    $('opt-curriculum').checked = CONFIG.autoAdvance;
  }

  /** Whatever the level picker is pointing at right now. */
  function currentSelection() {
    return state.mode === 'endless' ? 'endless' : state.levelIndex;
  }

  syncSlidersFromConfig();
  wire();
  loadLevel('endless', false);
  requestAnimationFrame(frame);

  // Handle for the browser console — `maze.state.cfg`, `maze.state.pop.history`,
  // `maze.state.pop.leader().brain.weights` and so on. Handy for poking at a
  // run without editing files.
  window.maze = { state, renderer, LEVELS, CONFIG };
})();
