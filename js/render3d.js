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

uniform mat4 uViewProj;

out vec3 vNormal;
out vec3 vColor;
out float vGlow;
out vec3 vWorld;

void main() {
  vec3 world = aPos * iScale + iOffset;
  vWorld  = world;
  vNormal = aNormal;
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

out vec4 fragColor;

void main() {
  vec3 n = normalize(vNormal);
  vec3 lightDir = normalize(vec3(0.42, 0.86, 0.28));

  // One key light plus a hemisphere fill, so the tops of things read bright
  // and the sides still have shape instead of going flat black.
  float diff = max(dot(n, lightDir), 0.0);
  float sky  = 0.5 + 0.5 * n.y;
  vec3 base  = vColor * (0.24 + 0.28 * sky + 0.58 * diff);

  if (vGlow > 0.01) {
    // Two sine waves at different rates, so the lava churns instead of
    // pulsing in unison like a Christmas light.
    float ripple = 0.6 + 0.4
      * sin(uTime * 1.9 + vWorld.x * 3.1 + vWorld.z * 2.3)
      * sin(uTime * 1.1 + vWorld.z * 1.7 - vWorld.x * 0.9);
    base = mix(base, vColor * (1.05 + 0.85 * ripple), vGlow);
  }

  fragColor = vec4(base, 1.0);
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
  floor:     [0.20, 0.23, 0.30],
  floorAlt:  [0.17, 0.20, 0.26],   // checker, so scale is readable
  wall:      [0.30, 0.34, 0.44],
  wallTop:   [0.38, 0.43, 0.55],
  lava:      [1.00, 0.38, 0.10],
  goal:      [0.27, 0.88, 0.66],
  agent:     [0.39, 0.64, 1.00],
  leader:    [1.00, 1.00, 1.00],
  escaped:   [0.27, 0.88, 0.66],
  dead:      [0.28, 0.31, 0.38],
  crusher:   [0.95, 0.30, 0.36],
  chaser:    [1.00, 0.16, 0.42],
  trail:     [0.70, 0.78, 0.95],
};

const FLOATS_PER_INSTANCE = 10;

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

    gl.bindVertexArray(null);

    this.data = new Float32Array(4096 * FLOATS_PER_INSTANCE);
    this.count = 0;

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

  _box(x, y, z, sx, sy, sz, colour, glow) {
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
    this.count++;
  }

  /**
   * @param world   the World being run
   * @param agents  every agent, drawn as a cube
   * @param leader  the one to highlight (and follow, if follow is on)
   * @param show    { trail: bool }
   * @param time    seconds, for the lava animation
   */
  render(world, agents, leader, show, time) {
    const gl = this.gl;
    this.resize();
    this.count = 0;

    // --- level geometry ---
    for (let cy = 0; cy < world.h; cy++) {
      for (let cx = 0; cx < world.w; cx++) {
        const t = world.tileAt(cx, cy);
        const x = cx + 0.5, z = cy + 0.5;
        if (t === TILE.VOID) continue;                       // the hole is the point
        if (t === TILE.WALL) {
          this._box(x, 0.5, z, 1, 1, 1, COLOUR.wall, 0);
          // A slightly brighter cap, so a wall reads as a wall from above.
          this._box(x, 1.02, z, 1.0, 0.05, 1.0, COLOUR.wallTop, 0);
        } else if (t === TILE.LAVA) {
          this._box(x, -0.06, z, 1, 0.12, 1, COLOUR.lava, 1);
        } else {
          const checker = (cx + cy) % 2 === 0 ? COLOUR.floor : COLOUR.floorAlt;
          this._box(x, -0.06, z, 1, 0.12, 1, checker, 0);
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
      const c = m.kind === 'chaser' ? COLOUR.chaser : COLOUR.crusher;
      this._box(m.x, m.height / 2, m.y, m.radius * 2, m.height, m.radius * 2, c, 0.5);
    }

    // --- agents ---
    for (const a of agents) {
      if (a === leader) continue;
      let c = COLOUR.agent, s = 0.32, glow = 0;
      if (a.reachedGoal) { c = COLOUR.escaped; glow = 0.6; }
      else if (!a.alive) { c = COLOUR.dead; s = 0.20; }
      this._box(a.x, a.z + s / 2, a.y, s, s, s, c, glow);
    }
    if (leader) {
      this._box(leader.x, leader.z + 0.21, leader.y, 0.42, 0.42, 0.42, COLOUR.leader, 0.25);
      // a little marker floating above, so you can pick it out of the crowd
      this._box(leader.x, leader.z + 0.85, leader.y, 0.12, 0.12, 0.12, COLOUR.leader, 0.8);
    }

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
    gl.clearColor(0.035, 0.045, 0.065, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uViewProj, false, viewProj);
    gl.uniform1f(this.uTime, time);

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
