/*
 * render3d.js — a small WebGL renderer, written from scratch.
 *
 * There is no Three.js here, for the same reason there is no ML library: the
 * point of this project is that you can open every file and read what it does.
 *
 * The whole scene is boxes — floor tiles, walls, lava, agents, hazards — so it
 * is drawn as ONE instanced cube. Every frame we rebuild a flat array of
 * "here is a box: position, size, colour, glow" and hand it to the GPU in a
 * single draw call. Around 800 boxes for the biggest level, which is nothing.
 *
 * Axes: the grid lies on X/Z (world x → X, world y → Z) and height is Y, which
 * is the usual convention for 3D and keeps the shader maths boring.
 */

// ---------------------------------------------------------------- matrices --
// Column-major, same as OpenGL. Only the three we actually need.

const M4 = {
  perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    const nf = 1 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0,
    ]);
  },

  lookAt(eye, target, up) {
    let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
    let l = Math.hypot(zx, zy, zz) || 1;
    zx /= l; zy /= l; zz /= l;

    let xx = up[1] * zz - up[2] * zy;
    let xy = up[2] * zx - up[0] * zz;
    let xz = up[0] * zy - up[1] * zx;
    l = Math.hypot(xx, xy, xz) || 1;
    xx /= l; xy /= l; xz /= l;

    const yx = zy * xz - zz * xy;
    const yy = zz * xx - zx * xz;
    const yz = zx * xy - zy * xx;

    return new Float32Array([
      xx, yx, zx, 0,
      xy, yy, zy, 0,
      xz, yz, zz, 0,
      -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
      -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
      -(zx * eye[0] + zy * eye[1] + zz * eye[2]),
      1,
    ]);
  },

  multiply(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1]
                     + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
    }
    return o;
  },
};

// ----------------------------------------------------------------- shaders --

const VERT = `#version 300 es
in vec3 aPos;
in vec3 aNormal;
in vec3 iOffset;
in vec3 iScale;
in vec3 iColor;
in float iGlow;
in float iYaw;

uniform mat4 uViewProj;

out vec3 vNormal;
out vec3 vColor;
out float vGlow;
out vec3 vWorld;

// Spin a point about the Y axis. Everything in this scene is a box, so a
// single yaw is all the rotation anyone needs — Albert has to face where he is
// going, and the shards need to tumble.
vec3 spinY(vec3 p, float a) {
  float c = cos(a), s = sin(a);
  return vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
}

void main() {
  vec3 local = spinY(aPos * iScale, iYaw);
  vec3 world = local + iOffset;
  vWorld  = world;
  vNormal = spinY(aNormal, iYaw);
  vColor  = iColor;
  vGlow   = iGlow;
  gl_Position = uViewProj * vec4(world, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;

in vec3 vNormal;
in vec3 vColor;
in float vGlow;
in vec3 vWorld;

uniform float uTime;
uniform vec3  uCamera;
uniform vec3  uFogColor;
uniform vec2  uFogRange;   // where fog starts, where it is total

out vec4 fragColor;

void main() {
  vec3 n = normalize(vNormal);

  // A warm key from one side and a cool fill from the other. Two coloured
  // lights instead of one white one is most of the difference between "3D
  // shapes" and "a scene" — the shaded sides pick up the fill's blue rather
  // than just going dark.
  vec3 key  = normalize(vec3(0.45, 0.80, 0.30));
  vec3 fill = normalize(vec3(-0.55, 0.35, -0.45));

  float kd = max(dot(n, key), 0.0);
  float fd = max(dot(n, fill), 0.0);
  float sky = 0.5 + 0.5 * n.y;

  // A bright, evenly lit room. Most of the light is ambient so the white
  // walls stay white and readable, with just enough directional shaping to
  // keep the boxes from looking like flat stickers.
  vec3 lit = vColor * (0.62 + 0.10 * sky)
           + vColor * vec3(1.00, 0.98, 0.94) * 0.26 * kd
           + vColor * vec3(0.72, 0.80, 1.00) * 0.14 * fd;

  if (vGlow > 0.01) {
    // Two sine waves at different rates, so the lava churns instead of
    // pulsing in unison like a Christmas light.
    float ripple = 0.6 + 0.4
      * sin(uTime * 1.9 + vWorld.x * 3.1 + vWorld.z * 2.3)
      * sin(uTime * 1.1 + vWorld.z * 1.7 - vWorld.x * 0.9);
    lit = mix(lit, vColor * (1.05 + 0.85 * ripple), vGlow);
  }

  // Fade the far side of the arena into the background. Without this a big
  // maze reads as a flat pattern; with it you can see which end is near.
  float d = distance(vWorld, uCamera);
  float fog = smoothstep(uFogRange.x, uFogRange.y, d);
  fragColor = vec4(mix(lit, uFogColor, fog * 0.85), 1.0);
}`;

// -------------------------------------------------------------- cube mesh --

/** 24 vertices so each face gets its own normal, 36 indices. */
function cubeGeometry() {
  const faces = [
    { n: [0, 0, 1],  v: [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]] },
    { n: [0, 0, -1], v: [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]] },
    { n: [1, 0, 0],  v: [[0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5]] },
    { n: [-1, 0, 0], v: [[-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5]] },
    { n: [0, 1, 0],  v: [[-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5]] },
    { n: [0, -1, 0], v: [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5]] },
  ];
  const pos = [], nor = [], idx = [];
  faces.forEach((f, fi) => {
    for (const v of f.v) { pos.push(...v); nor.push(...f.n); }
    const b = fi * 4;
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  return {
    pos: new Float32Array(pos),
    nor: new Float32Array(nor),
    idx: new Uint16Array(idx),
  };
}

// ----------------------------------------------------------------- palette --

const COLOUR = {
  // Bright room, dark floor. Clean white walls against charcoal tiles with
  // light grout between them — the floor grid does the work of showing scale
  // and speed that a checkerboard was doing badly.
  floor:     [0.255, 0.262, 0.278],
  floorAlt:  [0.230, 0.237, 0.252],
  grout:     [0.760, 0.775, 0.800],
  wall:      [0.940, 0.945, 0.955],
  wallTop:   [0.995, 0.995, 1.000],
  // Pushed well to the red side. Albert is orange, and at the same hue the
  // agents standing next to a lava pool disappeared into it.
  lava:      [0.94, 0.16, 0.05],
  goal:      [0.20, 0.85, 0.32],
  agent:     [1.00, 0.52, 0.10],   // Albert orange
  leader:    [0.15, 0.42, 1.00],   // one vivid blue, so you can find him
  escaped:   [0.16, 0.78, 0.38],
  dead:      [0.55, 0.57, 0.60],
  plate:     [1.00, 0.82, 0.25],
  plateDone: [0.42, 0.50, 0.38],
  door:      [0.85, 0.60, 0.22],
  crusher:   [0.90, 0.18, 0.22],
  spinner:   [0.90, 0.18, 0.22],
  spinnerB:  [0.16, 0.30, 0.88],   // arms alternate, as in the real thing
  pivot:     [0.98, 0.98, 1.00],
  chaser:    [1.00, 0.16, 0.42],
  trail:     [0.30, 0.62, 1.00],   // the leader's blue, so his route reads
  shadow:    [0.10, 0.11, 0.13],
  eye:       [1.00, 1.00, 1.00],
  pupil:     [0.08, 0.08, 0.10],
  foot:      [0.80, 0.36, 0.05],
};

/** Clear colour and fog colour, kept identical so the fade has nothing to
 *  fade towards but the background itself. */
const BACKDROP = new Float32Array([0.878, 0.890, 0.906]);

const FLOATS_PER_INSTANCE = 11;

class Renderer3D {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) {
      this.failed = 'This needs WebGL2, which this browser is not offering.';
      return;
    }
    this.gl = gl;

    this.program = this._buildProgram(VERT, FRAG);
    this.uViewProj = gl.getUniformLocation(this.program, 'uViewProj');
    this.uTime = gl.getUniformLocation(this.program, 'uTime');
    this.uCamera = gl.getUniformLocation(this.program, 'uCamera');
    this.uFogColor = gl.getUniformLocation(this.program, 'uFogColor');
    this.uFogRange = gl.getUniformLocation(this.program, 'uFogRange');

    const geo = cubeGeometry();
    this.indexCount = geo.idx.length;

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);

    const bind = (data, loc, size) => {
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    };
    bind(geo.pos, gl.getAttribLocation(this.program, 'aPos'), 3);
    bind(geo.nor, gl.getAttribLocation(this.program, 'aNormal'), 3);

    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.idx, gl.STATIC_DRAW);

    // One interleaved buffer for the per-box data, rewritten every frame.
    this.instanceBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    const stride = FLOATS_PER_INSTANCE * 4;
    const attrib = (name, size, byteOffset) => {
      const loc = gl.getAttribLocation(this.program, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, byteOffset);
      gl.vertexAttribDivisor(loc, 1);
    };
    attrib('iOffset', 3, 0);
    attrib('iScale', 3, 12);
    attrib('iColor', 3, 24);
    attrib('iGlow', 1, 36);
    attrib('iYaw', 1, 40);

    gl.bindVertexArray(null);

    this.data = new Float32Array(8192 * FLOATS_PER_INSTANCE);
    this.count = 0;

    // Debris from agents that have died. Purely cosmetic — the simulation
    // neither knows nor cares that these exist.
    this.shards = [];
    this.maxShards = 900;
    this._lastTime = 0;

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);

    // --- camera ---
    this.azimuth = -Math.PI / 2 - 0.55;
    // Fairly steep by default. The walls are a full unit tall (they have to
    // be — the jump arc peaks at 0.81), so from a low angle the far half of a
    // big maze is just wall tops.
    this.elevation = 1.15;
    this.distance = 26;
    this.target = [0, 0, 0];
    this.follow = false;

    this._installControls();
  }

  _buildProgram(vsrc, fsrc) {
    const gl = this.gl;
    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new Error('shader: ' + gl.getShaderInfoLog(sh));
      }
      return sh;
    };
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vsrc));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error('link: ' + gl.getProgramInfoLog(p));
    }
    return p;
  }

  _installControls() {
    const c = this.canvas;
    let dragging = false, lastX = 0, lastY = 0;

    c.addEventListener('pointerdown', e => {
      dragging = true; lastX = e.clientX; lastY = e.clientY;
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointerup', e => {
      dragging = false;
      c.releasePointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', e => {
      if (!dragging) return;
      this.azimuth += (e.clientX - lastX) * 0.008;
      // Clamped short of straight down: at exactly vertical the up-vector and
      // the view direction line up and lookAt has nothing to cross-product.
      this.elevation = Math.max(0.08, Math.min(1.5, this.elevation + (e.clientY - lastY) * 0.006));
      lastX = e.clientX; lastY = e.clientY;
    });
    c.addEventListener('wheel', e => {
      e.preventDefault();
      this.distance = Math.max(4, Math.min(90, this.distance * (1 + Math.sign(e.deltaY) * 0.11)));
    }, { passive: false });
  }

  /** Frame the whole arena — called when the level changes. */
  frameLevel(world) {
    this.target = [world.w / 2, 0, world.h / 2];
    this.distance = Math.max(world.w, world.h) * 1.35;
  }

  resize() {
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(this.canvas.clientWidth * dpr);
    const h = Math.round(this.canvas.clientHeight * dpr);
    if (w && h && (this.canvas.width !== w || this.canvas.height !== h)) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  _box(x, y, z, sx, sy, sz, colour, glow, yaw) {
    const need = (this.count + 1) * FLOATS_PER_INSTANCE;
    if (need > this.data.length) {
      const bigger = new Float32Array(this.data.length * 2);
      bigger.set(this.data);
      this.data = bigger;
    }
    const d = this.data;
    let i = this.count * FLOATS_PER_INSTANCE;
    d[i++] = x; d[i++] = y; d[i++] = z;
    d[i++] = sx; d[i++] = sy; d[i++] = sz;
    d[i++] = colour[0]; d[i++] = colour[1]; d[i++] = colour[2];
    d[i++] = glow || 0;
    d[i++] = yaw || 0;
    this.count++;
  }

  /**
   * A box positioned in an agent's local frame: +X is the way it is facing,
   * +Y is up, +Z is its left. Saves doing the trigonometry at every call site.
   */
  _part(ax, ay, az, yaw, lx, ly, lz, sx, sy, sz, colour, glow) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    this._box(
      ax + lx * c + lz * s,
      ay + ly,
      az - lx * s + lz * c,
      sx, sy, sz, colour, glow, yaw
    );
  }

  /**
   * Albert: a body, a head, two eyes that face the way he is going, and two
   * feet. Seven boxes each — with 120 of him that is under a thousand extra
   * instances, which costs nothing when they all go in one draw call.
   */
  _drawAlbert(a, colour, glow, scale) {
    const yaw = -a.angle;
    const x = a.x, y = a.z, z = a.y;
    const S = scale;

    // A little squash-and-stretch while airborne, so a jump reads as a jump
    // even in a crowd of a hundred others.
    const air = Math.max(-1, Math.min(1, a.vz * 8));
    const stretch = 1 + air * 0.18;
    const squash = 1 - air * 0.10;

    // Body slightly wider than the head, so there is a shoulder line and he
    // does not read as one undifferentiated brick.
    this._part(x, y, z, yaw, 0, 0.12 * S * stretch, 0,
      0.29 * S * squash, 0.22 * S * stretch, 0.31 * S * squash, colour, glow);
    this._part(x, y, z, yaw, 0.01, 0.33 * S * stretch, 0,
      0.22 * S * squash, 0.20 * S, 0.24 * S * squash, colour, glow);

    const eyeY = 0.35 * S * stretch;
    for (const side of [-1, 1]) {
      this._part(x, y, z, yaw, 0.10 * S, eyeY, side * 0.07 * S,
        0.07 * S, 0.09 * S, 0.06 * S, COLOUR.eye, 0.25);
      this._part(x, y, z, yaw, 0.13 * S, eyeY, side * 0.075 * S,
        0.035 * S, 0.045 * S, 0.035 * S, COLOUR.pupil, 0);
      this._part(x, y, z, yaw, 0.02 * S, 0.025 * S, side * 0.085 * S,
        0.11 * S, 0.05 * S, 0.09 * S, COLOUR.foot, 0);
    }
  }

  /**
   * Blow an agent into pieces. Called once, the moment it dies — there is no
   * quiet fading away and no standing around looking defeated.
   */
  shatter(a, colour) {
    const pieces = 11;
    for (let i = 0; i < pieces; i++) {
      if (this.shards.length >= this.maxShards) break;
      const ang = Math.random() * Math.PI * 2;
      const speed = 0.35 + Math.random() * 1.5;
      this.shards.push({
        x: a.x, y: a.z + 0.18 + Math.random() * 0.2, z: a.y,
        vx: Math.cos(ang) * speed,
        vy: 1.1 + Math.random() * 2.4,
        vz: Math.sin(ang) * speed,
        yaw: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 12,
        size: 0.05 + Math.random() * 0.07,
        life: 1,
        colour: colour || COLOUR.agent,
      });
    }
  }

  _drawShards(time) {
    const dt = Math.min(0.05, this._lastTime ? time - this._lastTime : 0.016);
    this._lastTime = time;

    for (let i = this.shards.length - 1; i >= 0; i--) {
      const p = this.shards[i];
      p.vy -= 9.0 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.yaw += p.spin * dt;
      p.life -= dt * 0.85;
      if (p.life <= 0 || p.y < -4) { this.shards.splice(i, 1); continue; }
      const s = p.size * Math.max(0.2, p.life);
      this._box(p.x, p.y, p.z, s, s, s, p.colour, 0.3, p.yaw);
    }
  }

  /**
   * @param world   the World being run
   * @param agents  every agent
   * @param leader  the one to highlight (and follow, if follow is on)
   * @param show    { trail: bool }
   * @param time    seconds, for the lava animation and the shards
   */
  render(world, agents, leader, show, time) {
    const gl = this.gl;
    this.resize();
    this.count = 0;

    // Doors are a per-agent idea, so the scene shows the leader's version of
    // events: if he has found a plate, his doors are the ones drawn open.
    const doorsOpen = leader ? leader.doorsOpen : false;

    // The slab everything sits on. Visible only in the seams between floor
    // tiles, where it reads as grout.
    this._box(world.w / 2, -0.075, world.h / 2, world.w, 0.13, world.h, COLOUR.grout, 0);

    // --- level geometry ---
    for (let cy = 0; cy < world.h; cy++) {
      for (let cx = 0; cx < world.w; cx++) {
        const t = world.tileAt(cx, cy);
        const x = cx + 0.5, z = cy + 0.5;
        if (t === TILE.VOID) continue;                       // the hole is the point
        if (t === TILE.PLATE) {
          // Sinks and goes dull once it has been stepped on.
          this._box(x, doorsOpen ? -0.09 : -0.03, z, 0.82, doorsOpen ? 0.06 : 0.18, 0.82,
            doorsOpen ? COLOUR.plateDone : COLOUR.plate, doorsOpen ? 0 : 1);
          this._box(x, -0.06, z, 1, 0.12, 1, COLOUR.floorAlt, 0);
        } else if (t === TILE.DOOR) {
          if (doorsOpen) {
            // Retracted into the floor, so you can see where it used to be.
            this._box(x, -0.02, z, 1, 0.14, 1, COLOUR.door, 0.35);
          } else {
            this._box(x, 0.5, z, 1, 1, 1, COLOUR.door, 0.25);
            this._box(x, 1.02, z, 1.0, 0.06, 1.0, COLOUR.plate, 0.4);
          }
        } else if (t === TILE.WALL) {
          this._box(x, 0.5, z, 1, 1, 1, COLOUR.wall, 0);
          // A slightly brighter cap, so a wall reads as a wall from above.
          this._box(x, 1.02, z, 1.0, 0.05, 1.0, COLOUR.wallTop, 0);
        } else if (t === TILE.LAVA) {
          this._box(x, -0.055, z, 1, 0.12, 1, COLOUR.lava, 1);
        } else {
          // Slightly undersized, so the pale slab underneath shows through as
          // grout. That grid is what makes movement legible — without it a
          // flat floor gives the eye nothing to measure speed against.
          const shade = (cx + cy) % 2 === 0 ? COLOUR.floor : COLOUR.floorAlt;
          this._box(x, -0.06, z, 0.94, 0.12, 0.94, shade, 0);
        }
      }
    }

    // goal pad plus a beacon you can find from across the arena
    for (const g of world.goals) {
      this._box(g.cx + 0.5, -0.02, g.cy + 0.5, 0.94, 0.14, 0.94, COLOUR.goal, 1);
      this._box(g.cx + 0.5, 1.4, g.cy + 0.5, 0.16, 2.6, 0.16, COLOUR.goal, 1);
    }

    // --- the leader's route ---
    if (show.trail && leader) {
      const t = leader.trail;
      for (let i = 0; i < t.length; i += 6) {   // every other recorded point
        this._box(t[i], t[i + 2] + 0.08, t[i + 1], 0.09, 0.09, 0.09, COLOUR.trail, 0.35);
      }
    }

    // --- hazards ---
    for (const m of world.movers) {
      const c = m.kind === 'chaser' ? COLOUR.chaser
        : m.kind === 'spinner' ? (m.tint ? COLOUR.spinnerB : COLOUR.spinner)
        : COLOUR.crusher;
      // Spinner blocks are turned to lie along their arm, so a pair of them
      // reads as one sweeping bar instead of two unrelated cubes.
      const yaw = m.kind === 'spinner' ? -m.angle : 0;
      const long = m.kind === 'spinner' ? m.radius * 3.0 : m.radius * 2;
      this._box(m.x, m.height / 2, m.y, long, m.height, m.radius * 2, c, 0.15, yaw);
    }
    // One white hub at the centre of each spinner, so the arms read as a
    // machine bolted to the floor rather than free-floating bars.
    const hubs = new Set();
    for (const m of world.movers) {
      if (m.kind !== 'spinner') continue;
      const key = `${m.cx},${m.cy}`;
      if (hubs.has(key)) continue;
      hubs.add(key);
      this._box(m.cx, m.height * 0.55, m.cy, 0.42, m.height * 1.1, 0.42, COLOUR.pivot, 0);
    }

    // --- contact shadows ---
    // A dark patch under each agent, shrinking as he rises. Without it you
    // cannot tell a jumping agent from one further away, and the whole scene
    // reads as cutouts floating over a floor.
    for (const a of agents) {
      if (!a.alive && !a.reachedGoal) continue;
      if (world.tileAt(Math.floor(a.x), Math.floor(a.y)) === TILE.VOID) continue;
      const lift = Math.max(0, Math.min(1, a.z));
      const size = (a === leader ? 0.40 : 0.34) * (1 - lift * 0.45);
      this._box(a.x, 0.012, a.y, size, 0.02, size, COLOUR.shadow, 0);
    }

    // --- Albert, one hundred and twenty times over ---
    for (const a of agents) {
      if (a === leader) continue;
      if (!a.alive && !a.reachedGoal) continue;   // the dead are shards now
      this._drawAlbert(a, a.reachedGoal ? COLOUR.escaped : COLOUR.agent,
        a.reachedGoal ? 0.5 : 0, 1);
    }
    if (leader) {
      this._drawAlbert(leader, COLOUR.leader, 0.2, 1.18);
      // a little marker floating above, so you can pick him out of the crowd
      this._box(leader.x, leader.z + 1.0, leader.y, 0.1, 0.1, 0.1, COLOUR.leader, 0.9,
        time * 2);
    }

    this._drawShards(time);

    // --- camera ---
    if (this.follow && leader) {
      // Ease toward the leader rather than snapping, or the view judders every
      // time the lead changes hands.
      this.target[0] += (leader.x - this.target[0]) * 0.08;
      this.target[1] += (leader.z + 0.5 - this.target[1]) * 0.08;
      this.target[2] += (leader.y - this.target[2]) * 0.08;
    }

    const ce = Math.cos(this.elevation), se = Math.sin(this.elevation);
    const eye = [
      this.target[0] + this.distance * ce * Math.cos(this.azimuth),
      this.target[1] + this.distance * se,
      this.target[2] + this.distance * ce * Math.sin(this.azimuth),
    ];
    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    const proj = M4.perspective(Math.PI / 4.2, aspect, 0.1, 400);
    const viewProj = M4.multiply(proj, M4.lookAt(eye, this.target, [0, 1, 0]));

    // --- draw ---
    gl.clearColor(BACKDROP[0], BACKDROP[1], BACKDROP[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uViewProj, false, viewProj);
    gl.uniform1f(this.uTime, time);
    gl.uniform3fv(this.uCamera, eye);
    gl.uniform3fv(this.uFogColor, BACKDROP);
    // Tied to the zoom, so the fog stays a depth cue instead of swallowing
    // the maze when you pull back to look at a big one.
    gl.uniform2f(this.uFogRange, this.distance * 0.85, this.distance * 2.5);

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.subarray(0, this.count * FLOATS_PER_INSTANCE), gl.DYNAMIC_DRAW);
    gl.drawElementsInstanced(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0, this.count);
    gl.bindVertexArray(null);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Renderer3D, M4, COLOUR };
}
