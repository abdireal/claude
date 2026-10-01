// The 3D view in the middle of the Models tab: the model with its textures,
// the one-block box it is fitted into, a floor grid and pose guides.

import { mat4 } from './meshes.js';

const MESH_VS = `#version 300 es
precision highp float;
in vec3 a_pos;
in vec3 a_nrm;
in vec2 a_uv;
in vec3 a_bary;
uniform mat4 u_vp;
out vec3 v_n;
out vec2 v_uv;
out vec3 v_bary;
void main() {
  v_n = a_nrm;
  v_uv = a_uv;
  v_bary = a_bary;
  gl_Position = u_vp * vec4(a_pos, 1.0);
}`;

const MESH_FS = `#version 300 es
precision highp float;
in vec3 v_n;
in vec2 v_uv;
in vec3 v_bary;
uniform sampler2D u_tex;
uniform float u_hasTex;
uniform vec3 u_color;
uniform float u_glow;
uniform float u_wire;
uniform float u_selected;
out vec4 o;
void main() {
  vec4 t = u_hasTex > 0.5 ? texture(u_tex, v_uv) : vec4(1.0);
  if (t.a < 0.1) discard;
  vec3 n = normalize(v_n) * (gl_FrontFacing ? 1.0 : -1.0);
  // Minecraft's per-face shading, smoothed for any direction.
  float shade = min(n.x * n.x * 0.6 + n.y * n.y * (n.y > 0.0 ? 1.0 : 0.5) + n.z * n.z * 0.8, 1.0);
  float key = max(dot(n, normalize(vec3(0.35, 0.8, 0.5))), 0.0);
  float light = mix(shade * 0.82 + key * 0.18, 1.0, u_glow);
  vec3 c = t.rgb * u_color * light;
  // Faces seen from behind are inside-out. Minecraft hides them, so tint them.
  if (!gl_FrontFacing) c = mix(c, vec3(0.9, 0.2, 0.35), 0.55);
  c = mix(c, c * 0.7 + vec3(0.25, 0.4, 0.75) * 0.3, u_selected);
  if (u_wire > 0.5) {
    vec3 d = fwidth(v_bary);
    vec3 a = smoothstep(vec3(0.0), d * 1.2, v_bary);
    float edge = 1.0 - min(min(a.x, a.y), a.z);
    c = mix(c, vec3(0.08, 0.1, 0.14), edge * 0.75);
  }
  o = vec4(c, 1.0);
}`;

const LINE_VS = `#version 300 es
precision highp float;
in vec3 a_pos;
uniform mat4 u_vp;
void main() { gl_Position = u_vp * vec4(a_pos, 1.0); }`;

const LINE_FS = `#version 300 es
precision highp float;
uniform vec4 u_color;
out vec4 o;
void main() { o = u_color; }`;

function program(gl, vs, fs, attribs) {
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  attribs.forEach((a, i) => gl.bindAttribLocation(p, i, a));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    u[info.name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
}

function lookAt(e, t, up) {
  let z = [e[0] - t[0], e[1] - t[1], e[2] - t[2]];
  let l = Math.hypot(...z);
  z = z.map((v) => v / l);
  let x = [up[1] * z[2] - up[2] * z[1], up[2] * z[0] - up[0] * z[2], up[0] * z[1] - up[1] * z[0]];
  l = Math.hypot(...x);
  x = x.map((v) => v / l);
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
    -(x[0] * e[0] + x[1] * e[1] + x[2] * e[2]), -(y[0] * e[0] + y[1] * e[1] + y[2] * e[2]), -(z[0] * e[0] + z[1] * e[1] + z[2] * e[2]), 1];
}

const HOME = { yaw: -0.6, pitch: 0.38, dist: 2.9 };

export class ModelView {
  constructor(canvas) {
    this.canvas = canvas;
    this.cam = { ...HOME, target: [0.5, 0.5, 0.5] };
    this.opts = { wire: false, guide: 'block' };
    this.groups = [];
    this.textures = [];
    this.dirty = true;
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true });
    if (!gl) {
      this.error = 'WebGL2 is not available, so the 3D model view is off. Import and export still work.';
      return;
    }
    this.gl = gl;
    this.mesh = program(gl, MESH_VS, MESH_FS, ['a_pos', 'a_nrm', 'a_uv', 'a_bary']);
    this.line = program(gl, LINE_VS, LINE_FS, ['a_pos']);
    this.vao = gl.createVertexArray();
    this.buf = gl.createBuffer();
    this.lineVao = gl.createVertexArray();
    this.lineBuf = gl.createBuffer();
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    gl.bindVertexArray(null);
    this.white = this.makeTexture(new ImageData(new Uint8ClampedArray([255, 255, 255, 255]), 1, 1));
    this.buildLines();
    this.bindControls();
    new ResizeObserver(() => { this.dirty = true; }).observe(canvas);
    const loop = () => {
      if (this.dirty && canvas.offsetParent !== null) this.render();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  get ok() { return !!this.gl; }

  bindControls() {
    const c = this.canvas;
    let drag = null;
    c.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, yaw: this.cam.yaw, pitch: this.cam.pitch, pan: e.button === 2 || e.shiftKey, target: this.cam.target.slice() };
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (drag.pan) {
        const s = this.cam.dist * 0.0016;
        const right = [Math.sin(this.cam.yaw), 0, -Math.cos(this.cam.yaw)];
        this.cam.target = [drag.target[0] - right[0] * dx * s, drag.target[1] + dy * s, drag.target[2] - right[2] * dx * s];
      } else {
        this.cam.yaw = drag.yaw - dx * 0.009;
        this.cam.pitch = Math.max(-1.45, Math.min(1.45, drag.pitch + dy * 0.007));
      }
      this.dirty = true;
    });
    const end = () => { drag = null; };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.cam.dist = Math.max(0.6, Math.min(12, this.cam.dist * Math.exp(e.deltaY * 0.0012)));
      this.dirty = true;
    }, { passive: false });
    c.addEventListener('dblclick', () => this.home());
  }

  home() {
    Object.assign(this.cam, HOME, { target: [0.5, 0.5, 0.5] });
    this.dirty = true;
  }

  setOptions(o) {
    Object.assign(this.opts, o);
    this.buildLines();
    this.dirty = true;
  }

  makeTexture(img) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  // mesh: { pos, nrm, uv, idx, mat } with positions already in block space.
  // mats: [{ img: ImageData | null, color: [r, g, b], glow }]
  setModel(mesh, mats) {
    if (!this.ok) return;
    const gl = this.gl;
    for (const t of this.textures) if (t && t !== this.white) gl.deleteTexture(t);
    this.textures = [];
    this.groups = [];
    this.mats = mats || [];
    if (!mesh) {
      this.dirty = true;
      return;
    }
    const tris = mesh.mat.length;
    const order = Array.from({ length: tris }, (_, i) => i).sort((a, b) => mesh.mat[a] - mesh.mat[b]);
    const data = new Float32Array(tris * 3 * 11);
    let o = 0;
    const bary = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    for (const t of order) {
      const ia = mesh.idx[t * 3], ib = mesh.idx[t * 3 + 1], ic = mesh.idx[t * 3 + 2];
      let fn = null;
      if (!mesh.nrm) {
        const P = (i) => [mesh.pos[i * 3], mesh.pos[i * 3 + 1], mesh.pos[i * 3 + 2]];
        const a = P(ia), b = P(ib), c = P(ic);
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        fn = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      }
      [ia, ib, ic].forEach((i, k) => {
        data[o++] = mesh.pos[i * 3]; data[o++] = mesh.pos[i * 3 + 1]; data[o++] = mesh.pos[i * 3 + 2];
        if (fn) { data[o++] = fn[0]; data[o++] = fn[1]; data[o++] = fn[2]; }
        else { data[o++] = mesh.nrm[i * 3]; data[o++] = mesh.nrm[i * 3 + 1]; data[o++] = mesh.nrm[i * 3 + 2]; }
        data[o++] = mesh.uv ? mesh.uv[i * 2] : 0.5; data[o++] = mesh.uv ? mesh.uv[i * 2 + 1] : 0.5;
        data[o++] = bary[k][0]; data[o++] = bary[k][1]; data[o++] = bary[k][2];
      });
    }
    let start = 0;
    for (let i = 0; i < order.length; i++) {
      const m = mesh.mat[order[i]];
      if (i === order.length - 1 || mesh.mat[order[i + 1]] !== m) {
        this.groups.push({ mat: m, first: start * 3, count: (i - start + 1) * 3 });
        start = i + 1;
      }
    }
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    [3, 3, 2, 3].reduce((off, size, i) => {
      gl.enableVertexAttribArray(i);
      gl.vertexAttribPointer(i, size, gl.FLOAT, false, 44, off);
      return off + size * 4;
    }, 0);
    gl.bindVertexArray(null);
    this.textures = this.mats.map((m) => (m.img ? this.makeTexture(m.img) : this.white));
    this.dirty = true;
  }

  // Swaps one material's texture, e.g. while painting in the Textures tab.
  setTexture(i, img) {
    if (!this.ok || !this.mats[i]) return;
    const gl = this.gl;
    if (this.textures[i] && this.textures[i] !== this.white) gl.deleteTexture(this.textures[i]);
    this.mats[i].img = img;
    this.textures[i] = img ? this.makeTexture(img) : this.white;
    this.dirty = true;
  }

  setHighlight(i) {
    this.highlight = i;
    this.dirty = true;
  }

  buildLines() {
    if (!this.ok) return;
    const L = [];
    const seg = (a, b) => L.push(...a, ...b);
    // floor grid, one block per line, around the model
    for (let i = -2; i <= 3; i++) {
      seg([i, 0, -2], [i, 0, 3]);
      seg([-2, 0, i], [3, 0, i]);
    }
    this.gridCount = L.length / 3;
    // the block: 0..1 on every axis
    const c = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
    for (const [a, b] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) seg(c[a], c[b]);
    this.boxCount = L.length / 3 - this.gridCount;
    // pose guide
    const g = this.opts.guide;
    if (g === 'sword' || g === 'item') {
      // where a vanilla 16x16 item sprite sits: the z = 0.5 square
      seg([0, 0, 0.5], [1, 0, 0.5]); seg([1, 0, 0.5], [1, 1, 0.5]); seg([1, 1, 0.5], [0, 1, 0.5]); seg([0, 1, 0.5], [0, 0, 0.5]);
      if (g === 'sword') seg([0.06, 0.06, 0.5], [0.94, 0.94, 0.5]);
    } else if (g === 'shield') {
      const x0 = 0.5 - 6 / 16, x1 = 0.5 + 6 / 16, y0 = 0.5 - 11 / 16, y1 = 0.5 + 11 / 16, z = 0.5 + 1.5 / 16;
      seg([x0, y0, z], [x1, y0, z]); seg([x1, y0, z], [x1, y1, z]); seg([x1, y1, z], [x0, y1, z]); seg([x0, y1, z], [x0, y0, z]);
    }
    this.guideCount = L.length / 3 - this.gridCount - this.boxCount;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(L), gl.STATIC_DRAW);
  }

  render() {
    this.dirty = false;
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(2, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(2, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const { yaw, pitch, dist, target } = this.cam;
    const eye = [
      target[0] + Math.cos(pitch) * Math.cos(yaw) * dist,
      target[1] + Math.sin(pitch) * dist,
      target[2] + Math.cos(pitch) * Math.sin(yaw) * dist,
    ];
    const vp = mat4.mul(perspective((38 * Math.PI) / 180, w / h, 0.02, 60), lookAt(eye, target, [0, 1, 0]));

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    if (this.groups.length) {
      const p = this.mesh;
      gl.useProgram(p.p);
      gl.uniformMatrix4fv(p.u.u_vp, false, vp);
      gl.uniform1i(p.u.u_tex, 0);
      gl.uniform1f(p.u.u_wire, this.opts.wire ? 1 : 0);
      gl.bindVertexArray(this.vao);
      gl.activeTexture(gl.TEXTURE0);
      for (const g of this.groups) {
        const m = this.mats[g.mat] || {};
        gl.bindTexture(gl.TEXTURE_2D, this.textures[g.mat] || this.white);
        gl.uniform1f(p.u.u_hasTex, m.img ? 1 : 0);
        gl.uniform3fv(p.u.u_color, m.img ? [1, 1, 1] : (m.color || [0.8, 0.8, 0.8]));
        gl.uniform1f(p.u.u_glow, m.glow ? 1 : 0);
        gl.uniform1f(p.u.u_selected, this.highlight === g.mat ? 1 : 0);
        gl.drawArrays(gl.TRIANGLES, g.first, g.count);
      }
    }

    const lp = this.line;
    gl.useProgram(lp.p);
    gl.uniformMatrix4fv(lp.u.u_vp, false, vp);
    gl.bindVertexArray(this.lineVao);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.uniform4fv(lp.u.u_color, [0.55, 0.62, 0.75, 0.22]);
    gl.drawArrays(gl.LINES, 0, this.gridCount);
    // the block box is drawn twice: faint through the model, solid in front
    gl.disable(gl.DEPTH_TEST);
    gl.uniform4fv(lp.u.u_color, [0.45, 0.75, 1.0, 0.18]);
    gl.drawArrays(gl.LINES, this.gridCount, this.boxCount);
    gl.uniform4fv(lp.u.u_color, [1.0, 0.78, 0.35, 0.35]);
    if (this.guideCount) gl.drawArrays(gl.LINES, this.gridCount + this.boxCount, this.guideCount);
    gl.enable(gl.DEPTH_TEST);
    gl.uniform4fv(lp.u.u_color, [0.45, 0.75, 1.0, 0.7]);
    gl.drawArrays(gl.LINES, this.gridCount, this.boxCount);
    gl.uniform4fv(lp.u.u_color, [1.0, 0.78, 0.35, 0.95]);
    if (this.guideCount) gl.drawArrays(gl.LINES, this.gridCount + this.boxCount, this.guideCount);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }
}
