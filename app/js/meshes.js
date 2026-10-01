// Meshes for the Models tab: import (OBJ + MTL, glTF, GLB), sample models,
// fitting into Minecraft's block space, and OBJ export for the BlockGraph
// Models mod. No DOM in here, so it also runs in Node.
//
// A mesh is a list of triangles, each with one material:
//   pos  Float32Array  xyz per vertex
//   uv   Float32Array  uv per vertex in image space (v = 0 is the top row), or null
//   nrm  Float32Array  xyz per vertex, or null (flat shading)
//   idx  Uint32Array   three vertex indices per triangle, counter-clockwise from outside
//   mat  Uint16Array   material index per triangle
//   materials  [{ name, color: [r, g, b], image: index into the import's images or -1 }]

export const MAX_TRIANGLES = 200000;

// ------------------------------------------------------------------ build

export function meshBuilder() {
  const pos = [], uv = [], nrm = [], idx = [], mat = [];
  let anyUv = false, anyNrm = false;
  return {
    vertex(p, t, n) {
      pos.push(p[0], p[1], p[2]);
      uv.push(t ? t[0] : 0, t ? t[1] : 0);
      nrm.push(n ? n[0] : 0, n ? n[1] : 0, n ? n[2] : 0);
      if (t) anyUv = true;
      if (n) anyNrm = true;
      return pos.length / 3 - 1;
    },
    tri(a, b, c, m) {
      idx.push(a, b, c);
      mat.push(m);
    },
    get triangles() { return mat.length; },
    build(materials) {
      return {
        pos: new Float32Array(pos),
        uv: anyUv ? new Float32Array(uv) : null,
        nrm: anyNrm ? new Float32Array(nrm) : null,
        idx: new Uint32Array(idx),
        mat: new Uint16Array(mat),
        materials,
      };
    },
  };
}

// --------------------------------------------------------------------- OBJ

// Reads a Wavefront OBJ. `mtl` is the parsed .mtl (see parseMtl), if any.
export function meshFromObj(text, mtl = {}) {
  const P = [], T = [], N = [];
  const b = meshBuilder();
  const materials = [];
  const matIndex = new Map();
  let current = -1;
  const useMaterial = (name) => {
    if (!matIndex.has(name)) {
      const m = mtl[name];
      matIndex.set(name, materials.length);
      materials.push({ name, color: m?.color || defaultColor(materials.length), image: -1, file: m?.map || null });
    }
    current = matIndex.get(name);
  };
  const cache = new Map();
  const resolve = (s, len) => {
    const i = parseInt(s, 10);
    const r = i < 0 ? len + i : i - 1;
    if (!(r >= 0 && r < len)) throw new Error(`The OBJ file points at a vertex that does not exist (${s}).`);
    return r;
  };
  const lines = text.split(/\r?\n/);
  for (let ln = 0; ln < lines.length; ln++) {
    let line = lines[ln];
    const hash = line.indexOf('#');
    if (hash >= 0) line = line.slice(0, hash);
    line = line.trim();
    if (!line) continue;
    const p = line.split(/\s+/);
    switch (p[0]) {
      case 'v': P.push([+p[1], +p[2], +p[3]]); break;
      case 'vt': T.push([+p[1], 1 - +(p[2] ?? 0)]); break; // OBJ v goes up, images go down
      case 'vn': N.push([+p[1], +p[2], +p[3]]); break;
      case 'usemtl': useMaterial(line.slice(6).trim() || 'default'); break;
      case 'f': {
        if (current < 0) useMaterial('default');
        const corners = [];
        for (let i = 1; i < p.length; i++) {
          const key = p[i];
          if (!cache.has(key)) {
            const [vi, ti, ni] = key.split('/');
            const v = P[resolve(vi, P.length)];
            const t = ti ? T[resolve(ti, T.length)] : null;
            const n = ni ? N[resolve(ni, N.length)] : null;
            cache.set(key, b.vertex(v, t, n));
          }
          corners.push(cache.get(key));
        }
        for (let i = 1; i < corners.length - 1; i++) b.tri(corners[0], corners[i], corners[i + 1], current);
        if (b.triangles > MAX_TRIANGLES) throw new Error(`This model has more than ${MAX_TRIANGLES.toLocaleString('en')} triangles. Reduce it first (in Blender: Decimate modifier).`);
        break;
      }
      default: break;
    }
  }
  if (!b.triangles) throw new Error('No faces found in that OBJ file.');
  return b.build(materials);
}

// Reads the materials of a .mtl file: base colour and colour texture name.
export function parseMtl(text) {
  const out = {};
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const p = line.split(/\s+/);
    const k = p[0].toLowerCase();
    if (k === 'newmtl') {
      cur = { color: null, map: null };
      out[line.slice(6).trim()] = cur;
    } else if (!cur) {
      continue;
    } else if (k === 'kd') {
      cur.color = [+p[1], +p[2], +p[3]].map((v) => (Number.isFinite(v) ? v : 0.8));
    } else if (k === 'map_kd') {
      cur.map = p[p.length - 1].replace(/\\/g, '/').split('/').pop();
    }
  }
  return out;
}

// -------------------------------------------------------------------- glTF

const GLTF_TYPES = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const GLTF_COMPS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

// Splits a .glb file into its JSON and binary chunk.
export function parseGlb(buf) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('That .glb file is not a glTF binary.');
  if (dv.getUint32(4, true) !== 2) throw new Error('Only glTF 2.0 files are supported.');
  let off = 12;
  let json = null, bin = null;
  while (off + 8 <= buf.byteLength) {
    const len = dv.getUint32(off, true);
    const type = dv.getUint32(off + 4, true);
    const body = buf.slice(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(body));
    else if (type === 0x004e4942) bin = body;
    off += 8 + len;
  }
  if (!json) throw new Error('That .glb file has no JSON part.');
  return { json, bin };
}

function decodeDataUri(uri) {
  const comma = uri.indexOf(',');
  const meta = uri.slice(5, comma);
  const data = uri.slice(comma + 1);
  if (/;base64$/.test(meta)) {
    const s = typeof atob === 'function' ? atob(data) : Buffer.from(data, 'base64').toString('binary');
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return { bytes: out, mime: meta.replace(/;base64$/, '') };
  }
  return { bytes: new TextEncoder().encode(decodeURIComponent(data)), mime: meta };
}

function readAccessor(gltf, buffers, index) {
  const a = gltf.accessors[index];
  const comps = GLTF_COMPS[a.type];
  const Ctor = GLTF_TYPES[a.componentType];
  const out = new Float32Array(a.count * comps);
  if (a.bufferView === undefined) return out;
  if (a.sparse) throw new Error('Sparse glTF accessors are not supported. Re-export the model.');
  const view = gltf.bufferViews[a.bufferView];
  const buf = buffers[view.buffer];
  if (!buf) throw new Error('A buffer of this glTF is missing. Pick the .bin file together with the .gltf.');
  const bpe = Ctor.BYTES_PER_ELEMENT;
  const stride = view.byteStride || comps * bpe;
  const base = (view.byteOffset || 0) + (a.byteOffset || 0);
  const dv = new DataView(buf);
  const get = {
    5120: (o) => dv.getInt8(o), 5121: (o) => dv.getUint8(o), 5122: (o) => dv.getInt16(o, true),
    5123: (o) => dv.getUint16(o, true), 5125: (o) => dv.getUint32(o, true), 5126: (o) => dv.getFloat32(o, true),
  }[a.componentType];
  const norm = a.normalized ? { 5120: (v) => Math.max(v / 127, -1), 5121: (v) => v / 255, 5122: (v) => Math.max(v / 32767, -1), 5123: (v) => v / 65535 }[a.componentType] : null;
  for (let i = 0; i < a.count; i++) {
    for (let c = 0; c < comps; c++) {
      const v = get(base + i * stride + c * bpe);
      out[i * comps + c] = norm ? norm(v) : v;
    }
  }
  return out;
}

// Column-major 4x4 helpers.
export const mat4 = {
  identity: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  mul(a, b) {
    const o = new Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
    return o;
  },
  translate: (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1],
  scale: (x, y, z) => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1],
  quat([x, y, z, w]) {
    return [
      1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
      2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
      2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
      0, 0, 0, 1,
    ];
  },
  rotX(d) { const r = (d * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r); return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]; },
  rotY(d) { const r = (d * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; },
  rotZ(d) { const r = (d * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r); return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; },
  point(m, x, y, z) {
    return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
  },
  // Inverse transpose of the upper 3x3, for normals (row-major 3x3).
  normal(m) {
    const a = m[0], b = m[4], c = m[8], d = m[1], e = m[5], f = m[9], g = m[2], h = m[6], i = m[10];
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
    const D = -(b * i - c * h), E = a * i - c * g, F = -(a * h - b * g);
    const G = b * f - c * e, H = -(a * f - c * d), I = a * e - b * d;
    const det = a * A + b * B + c * C || 1;
    return { m: [A / det, B / det, C / det, D / det, E / det, F / det, G / det, H / det, I / det], det };
  },
};

function applyNormal(nm, x, y, z) {
  const m = nm.m;
  const o = [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z];
  const l = Math.hypot(o[0], o[1], o[2]) || 1;
  return [o[0] / l, o[1] / l, o[2] / l];
}

// Reads a glTF 2.0 scene. `buffers` are the ArrayBuffers of gltf.buffers, in
// order. Returns the mesh and the colour textures of its materials, as
// { name, bytes, mime } for embedded images or { name, uri } for external files.
export function meshFromGltf(gltf, buffers) {
  const req = gltf.extensionsRequired || [];
  if (req.includes('KHR_draco_mesh_compression') || req.includes('EXT_meshopt_compression')) {
    throw new Error('This glTF is compressed (Draco or meshopt), which BlockGraph cannot read. Export it again without compression (Blender: untick Compression).');
  }
  buffers = buffers.slice();
  (gltf.buffers || []).forEach((bf, i) => {
    if (!buffers[i] && bf.uri && bf.uri.startsWith('data:')) buffers[i] = decodeDataUri(bf.uri).bytes.buffer;
  });

  const images = [];
  const imageFor = new Map(); // gltf image index -> our images index
  const getImage = (i) => {
    if (imageFor.has(i)) return imageFor.get(i);
    const im = gltf.images?.[i];
    let entry = null;
    if (im) {
      const name = im.name || `image_${i}`;
      if (im.bufferView !== undefined) {
        const v = gltf.bufferViews[im.bufferView];
        const buf = buffers[v.buffer];
        if (buf) entry = { name, bytes: new Uint8Array(buf, v.byteOffset || 0, v.byteLength), mime: im.mimeType || 'image/png' };
      } else if (im.uri?.startsWith('data:')) {
        const d = decodeDataUri(im.uri);
        entry = { name, bytes: d.bytes, mime: d.mime };
      } else if (im.uri) {
        entry = { name, uri: decodeURIComponent(im.uri).split('/').pop() };
      }
    }
    const k = entry ? images.push(entry) - 1 : -1;
    imageFor.set(i, k);
    return k;
  };

  const materials = [];
  const matFor = new Map();
  const getMaterial = (i) => {
    const key = i ?? -1;
    if (matFor.has(key)) return matFor.get(key);
    const g = i === undefined ? null : gltf.materials?.[i];
    const pbr = g?.pbrMetallicRoughness || {};
    const tex = pbr.baseColorTexture ? gltf.textures?.[pbr.baseColorTexture.index] : null;
    const src = tex?.source ?? tex?.extensions?.KHR_texture_basisu?.source ?? tex?.extensions?.EXT_texture_webp?.source;
    const f = pbr.baseColorFactor || [1, 1, 1, 1];
    const glow = (g?.emissiveFactor || [0, 0, 0]).some((v) => v > 0.5) && !g?.emissiveTexture;
    materials.push({
      name: g?.name || (i === undefined ? 'default' : `material_${i}`),
      color: pbr.baseColorTexture ? [1, 1, 1] : srgbFromLinear(f.slice(0, 3)),
      image: src !== undefined ? getImage(src) : -1,
      glow,
    });
    matFor.set(key, materials.length - 1);
    return materials.length - 1;
  };

  const b = meshBuilder();
  const visit = (nodeIndex, parent) => {
    const n = gltf.nodes[nodeIndex];
    let local = mat4.identity();
    if (n.matrix) local = n.matrix.slice();
    else {
      const t = n.translation || [0, 0, 0], r = n.rotation || [0, 0, 0, 1], s = n.scale || [1, 1, 1];
      local = mat4.mul(mat4.translate(...t), mat4.mul(mat4.quat(r), mat4.scale(...s)));
    }
    const world = mat4.mul(parent, local);
    if (n.mesh !== undefined) addMesh(gltf.meshes[n.mesh], world);
    for (const c of n.children || []) visit(c, world);
  };
  const addMesh = (mesh, world) => {
    const nm = mat4.normal(world);
    const flip = nm.det < 0;
    for (const prim of mesh.primitives) {
      if (prim.mode !== undefined && prim.mode !== 4) continue; // triangles only
      const a = prim.attributes;
      if (a.POSITION === undefined) continue;
      const P = readAccessor(gltf, buffers, a.POSITION);
      const N = a.NORMAL !== undefined ? readAccessor(gltf, buffers, a.NORMAL) : null;
      const T = a.TEXCOORD_0 !== undefined ? readAccessor(gltf, buffers, a.TEXCOORD_0) : null;
      const count = P.length / 3;
      const base = [];
      for (let i = 0; i < count; i++) {
        const p = mat4.point(world, P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
        const n = N ? applyNormal(nm, N[i * 3], N[i * 3 + 1], N[i * 3 + 2]) : null;
        base.push(b.vertex(p, T ? [T[i * 2], T[i * 2 + 1]] : null, n));
      }
      const I = prim.indices !== undefined ? readAccessor(gltf, buffers, prim.indices) : Float32Array.from({ length: count }, (_, i) => i);
      const m = getMaterial(prim.material);
      for (let i = 0; i + 2 < I.length; i += 3) {
        const [x, y, z] = [base[I[i]], base[I[i + 1]], base[I[i + 2]]];
        if (flip) b.tri(x, z, y, m);
        else b.tri(x, y, z, m);
      }
      if (b.triangles > MAX_TRIANGLES) throw new Error(`This model has more than ${MAX_TRIANGLES.toLocaleString('en')} triangles. Reduce it first (in Blender: Decimate modifier).`);
    }
  };
  const scene = gltf.scenes?.[gltf.scene ?? 0];
  const roots = scene ? scene.nodes : (gltf.nodes || []).map((_, i) => i);
  for (const r of roots || []) visit(r, mat4.identity());
  if (!b.triangles) throw new Error('No triangles found in that glTF file.');
  return { mesh: b.build(materials), images };
}

function srgbFromLinear(c) {
  return c.map((v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
}

const PALETTE = [[0.78, 0.36, 0.3], [0.36, 0.6, 0.85], [0.45, 0.72, 0.38], [0.88, 0.74, 0.32], [0.62, 0.45, 0.8], [0.4, 0.75, 0.75], [0.86, 0.52, 0.27], [0.7, 0.7, 0.7]];
function defaultColor(i) {
  return PALETTE[i % PALETTE.length].slice();
}

// ----------------------------------------------------------------- fitting

export function bounds(pos) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (pos[i + k] < min[k]) min[k] = pos[i + k];
      if (pos[i + k] > max[k]) max[k] = pos[i + k];
    }
  }
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

// Centre and size that bring a freshly imported mesh to one block.
export function normalizer(mesh) {
  const b = bounds(mesh.pos);
  const ext = Math.max(...b.size) || 1;
  return { c: [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2], k: 1 / ext };
}

export const DEFAULT_FIT = { s: 1, r: [0, 0, 0], t: [0, 0, 0] };

// Mesh space to block space (0..1 is one block):
//   centre the mesh, scale it to one block times fit.s, turn it (X, then Y,
//   then Z, in degrees) and move its centre to the block centre plus fit.t.
export function fitMatrix(norm, fit) {
  const k = norm.k * fit.s;
  let m = mat4.translate(-norm.c[0], -norm.c[1], -norm.c[2]);
  m = mat4.mul(mat4.scale(k, k, k), m);
  m = mat4.mul(mat4.rotX(fit.r[0]), m);
  m = mat4.mul(mat4.rotY(fit.r[1]), m);
  m = mat4.mul(mat4.rotZ(fit.r[2]), m);
  return mat4.mul(mat4.translate(0.5 + fit.t[0], 0.5 + fit.t[1], 0.5 + fit.t[2]), m);
}

// Positions and normals in block space.
export function placed(mesh, m) {
  const nm = mat4.normal(m);
  const n = mesh.pos.length / 3;
  const pos = new Float32Array(n * 3);
  const nrm = mesh.nrm ? new Float32Array(n * 3) : null;
  for (let i = 0; i < n; i++) {
    pos.set(mat4.point(m, mesh.pos[i * 3], mesh.pos[i * 3 + 1], mesh.pos[i * 3 + 2]), i * 3);
    if (nrm) nrm.set(applyNormal(nm, mesh.nrm[i * 3], mesh.nrm[i * 3 + 1], mesh.nrm[i * 3 + 2]), i * 3);
  }
  return { pos, nrm, flip: nm.det < 0 };
}

// Turns the mesh so its longest side points along +Y (handy before laying it
// out like a sword or standing it up).
export function longAxisRotation(mesh) {
  const s = bounds(mesh.pos).size;
  const i = s.indexOf(Math.max(...s));
  if (i === 0) return [0, 0, 90];
  if (i === 2) return [-90, 0, 0];
  return [0, 0, 0];
}

// Presets for how the mesh sits in the 0..1 block space.
export function presetFit(kind, mesh) {
  const long = longAxisRotation(mesh);
  switch (kind) {
    // Handle bottom-left, tip top-right, flat in the z = 0.5 plane: where a
    // vanilla 16x16 sword sprite sits, so Minecraft's handheld poses fit.
    case 'sword': return { s: 1.25, r: [long[0], long[1], long[2] - 45], t: [0, 0, 0] };
    // Upright and centred, the shape of a normal item.
    case 'item': return { s: 0.95, r: long, t: [0, 0, 0] };
    // As tall as the vanilla shield (22 pixels), plate a little in front of centre.
    case 'shield': return { s: 1.375, r: long, t: [0, 0, 0.09] };
    default: return { s: 1, r: [0, 0, 0], t: [0, 0, 0] };
  }
}

// Moves the model so it stands on the floor of the block.
export function sitOnFloor(mesh, norm, fit) {
  const p = placed(mesh, fitMatrix(norm, fit)).pos;
  const b = bounds(p);
  return { ...fit, t: [fit.t[0], fit.t[1] - b.min[1], fit.t[2]] };
}

// --------------------------------------------------------------- triangles

// Pairs triangles (a, b, c) + (a, c, d) that are flat and convex into one quad,
// since Minecraft draws quads: half the quads for most models.
export function quadsAndTriangles(mesh, pos) {
  const out = [];
  const tri = mesh.idx;
  const count = mesh.mat.length;
  const P = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const unit = (v) => { const l = Math.hypot(...v); return l > 1e-12 ? v.map((x) => x / l) : null; };
  for (let t = 0; t < count; t++) {
    const a = tri[t * 3], b = tri[t * 3 + 1], c = tri[t * 3 + 2];
    if (t + 1 < count && mesh.mat[t + 1] === mesh.mat[t]) {
      const a2 = tri[t * 3 + 3], c2 = tri[t * 3 + 4], d = tri[t * 3 + 5];
      if (a2 === a && c2 === c) {
        const pa = P(a), pb = P(b), pc = P(c), pd = P(d);
        const n1 = unit(cross(sub(pb, pa), sub(pc, pa)));
        const n2 = unit(cross(sub(pc, pa), sub(pd, pa)));
        if (n1 && n2 && dot(n1, n2) > 0.9995) {
          const s1 = dot(cross(sub(pc, pa), sub(pb, pa)), n1);
          const s2 = dot(cross(sub(pc, pa), sub(pd, pa)), n1);
          const s3 = dot(cross(sub(pd, pb), sub(pa, pb)), n1);
          const s4 = dot(cross(sub(pd, pb), sub(pc, pb)), n1);
          if (s1 * s2 < 0 && s3 * s4 < 0) {
            out.push({ v: [a, b, c, d], m: mesh.mat[t] });
            t++;
            continue;
          }
        }
      }
    }
    out.push({ v: [a, b, c], m: mesh.mat[t] });
  }
  return out;
}

// ------------------------------------------------------------------ export

const f5 = (v) => {
  const s = (Math.abs(v) < 5e-6 ? 0 : v).toFixed(5);
  return s.replace(/\.?0+$/, '') || '0';
};

// Writes the mesh as an OBJ in block space, ready for the BlockGraph Models mod.
// `slots` gives each material's texture slot name (used for usemtl).
export function meshToObj(mesh, m, slots, title = 'model') {
  const { pos, nrm, flip } = placed(mesh, m);
  const lines = [`# ${title}, made with BlockGraph. One block is 0 to 1.`, `# ${mesh.mat.length} triangles. Needs the BlockGraph Models mod (Fabric 1.21.11).`];
  const n = pos.length / 3;
  for (let i = 0; i < n; i++) lines.push(`v ${f5(pos[i * 3])} ${f5(pos[i * 3 + 1])} ${f5(pos[i * 3 + 2])}`);
  if (mesh.uv) for (let i = 0; i < n; i++) lines.push(`vt ${f5(mesh.uv[i * 2])} ${f5(1 - mesh.uv[i * 2 + 1])}`);
  if (nrm) for (let i = 0; i < n; i++) lines.push(`vn ${f5(nrm[i * 3])} ${f5(nrm[i * 3 + 1])} ${f5(nrm[i * 3 + 2])}`);
  const faces = quadsAndTriangles(mesh, pos);
  const corner = (i) => {
    const k = i + 1;
    if (mesh.uv && nrm) return `${k}/${k}/${k}`;
    if (mesh.uv) return `${k}/${k}`;
    if (nrm) return `${k}//${k}`;
    return `${k}`;
  };
  const byMat = new Map();
  for (const f of faces) {
    if (!byMat.has(f.m)) byMat.set(f.m, []);
    byMat.get(f.m).push(f.v);
  }
  let quads = 0;
  for (const [mi, list] of byMat) {
    lines.push(`usemtl ${slots[mi] || 'texture'}`);
    for (const v of list) {
      const order = flip ? v.slice().reverse() : v;
      lines.push('f ' + order.map(corner).join(' '));
      quads++;
    }
  }
  return { text: lines.join('\n') + '\n', quads };
}

// ------------------------------------------------------------------ samples

// Small textures for the samples, as RGBA bytes.
function canvasBytes(size, paint) {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const c = paint(x, y);
    data.set([c[0], c[1], c[2], c[3] ?? 255], (y * size + x) * 4);
  }
  return { size, data };
}

function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// A low-poly sword along +Y: pommel, grip, guard and a diamond-section blade.
// One 32x32 texture: blade in the left half, guard, grip and pommel on the right.
export function sampleSword() {
  const b = meshBuilder();
  const U = (x, y) => [x / 32, y / 32];
  const quad = (p, uv) => {
    const n = faceNormal(p[0], p[1], p[2]);
    const i = p.map((q, k) => b.vertex(q, uv[k], n));
    b.tri(i[0], i[1], i[2], 0);
    b.tri(i[0], i[2], i[3], 0);
  };
  const tri = (p, uv) => {
    const n = faceNormal(p[0], p[1], p[2]);
    const i = p.map((q, k) => b.vertex(q, uv[k], n));
    b.tri(i[0], i[1], i[2], 0);
  };
  const box = (x0, y0, z0, x1, y1, z1, [u0, v0, u1, v1]) => {
    const uv = [U(u0, v1), U(u1, v1), U(u1, v0), U(u0, v0)];
    quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], uv); // +z
    quad([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], uv); // -z
    quad([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], uv); // +x
    quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], uv); // -x
    quad([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], uv); // +y
    quad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], uv); // -y
  };
  box(-1.1, 0, -1.1, 1.1, 2, 1.1, [18, 25, 30, 31]); // pommel
  box(-0.7, 2, -0.7, 0.7, 8, 0.7, [18, 10, 30, 22]); // grip
  box(-4.5, 8, -1.2, 4.5, 9.6, 1.2, [17, 1, 31, 7]); // guard
  // Blade: a diamond cross-section (edges at x = ±1.6, spine at z = ±0.45)
  // from y = 9.6 to 27, then a tip to y = 32.
  const y0 = 9.6, y1 = 27, yt = 32;
  const ring = [[1.6, 0], [0, 0.45], [-1.6, 0], [0, -0.45]];
  for (let k = 0; k < 4; k++) {
    const [ax, az] = ring[k], [bx, bz] = ring[(k + 1) % 4];
    // edges use the bright texture column (u 15), the spine the fuller (u 8)
    const ua = k % 2 ? 8 : 15, ub = k % 2 ? 15 : 8;
    quad([[bx, y0, bz], [ax, y0, az], [ax, y1, az], [bx, y1, bz]], [U(ub, 31), U(ua, 31), U(ua, 5), U(ub, 5)]);
    tri([[bx, y1, bz], [ax, y1, az], [0, yt, 0]], [U(ub, 5), U(ua, 5), U(11.5, 0)]);
  }
  const texture = canvasBytes(32, (x, y) => {
    const n = hash2(x, y);
    if (x < 16) {
      // steel: bright edges, darker fuller down the middle
      const edge = Math.abs(x - 8) / 8;
      const v = 150 + edge * 90 + n * 14 - (y < 5 ? 0 : 0);
      const fuller = Math.abs(x - 8) < 1.5 && y > 6 ? -40 : 0;
      return [v + fuller - 6, v + fuller, v + fuller + 12];
    }
    if (y < 8) { const v = 0.85 + n * 0.2; return [222 * v, 168 * v, 48 * v]; } // gold guard
    if (y < 24) { const wrap = (x + y) % 4 < 2 ? 1 : 0.78; return [104 * wrap + n * 10, 62 * wrap + n * 6, 36 * wrap]; } // leather grip
    const v = 0.8 + n * 0.25; return [210 * v, 160 * v, 44 * v]; // gold pommel
  });
  const mesh = b.build([{ name: 'sword', color: [0.8, 0.8, 0.85], image: 0 }]);
  return { mesh, textures: [{ name: 'Sword', ...texture }] };
}

// A cluster of glowing crystals standing on the floor, for replacing a block.
export function sampleCrystal() {
  const b = meshBuilder();
  const crystals = [
    { x: 0, z: 0, r: 2.6, h: 9, tip: 4, tx: 0, tz: 0 },
    { x: -3.4, z: 1.6, r: 1.7, h: 5.5, tip: 2.6, tx: -22, tz: 10 },
    { x: 3, z: -1.8, r: 1.9, h: 6.5, tip: 3, tx: 18, tz: -12 },
    { x: 1.8, z: 3.2, r: 1.3, h: 4, tip: 2, tx: 12, tz: 24 },
    { x: -2, z: -3, r: 1.2, h: 3.6, tip: 1.8, tx: -14, tz: -26 },
  ];
  for (const c of crystals) {
    const m = mat4.mul(mat4.translate(c.x, 0, c.z), mat4.mul(mat4.rotZ(c.tx), mat4.rotX(c.tz)));
    const ring = (y, r) => Array.from({ length: 6 }, (_, k) => {
      const a = (k / 6) * Math.PI * 2;
      return mat4.point(m, Math.cos(a) * r, y, Math.sin(a) * r);
    });
    const low = ring(0, c.r * 0.85), high = ring(c.h, c.r), top = mat4.point(m, 0, c.h + c.tip, 0);
    for (let k = 0; k < 6; k++) {
      const j = (k + 1) % 6;
      const u0 = (k / 6) * 0.5 + 0.02, u1 = ((k + 1) / 6) * 0.5 - 0.02;
      const side = [low[j], low[k], high[k], high[j]];
      const n = faceNormal(side[0], side[1], side[2]);
      const ids = side.map((p, i) => b.vertex(p, [[u1, 0.95], [u0, 0.95], [u0, 0.3], [u1, 0.3]][i], n));
      b.tri(ids[0], ids[1], ids[2], 0);
      b.tri(ids[0], ids[2], ids[3], 0);
      const tp = [high[j], high[k], top];
      const tn = faceNormal(tp[0], tp[1], tp[2]);
      const t = tp.map((p, i) => b.vertex(p, [[u1, 0.28], [u0, 0.28], [(u0 + u1) / 2, 0.02]][i], tn));
      b.tri(t[0], t[1], t[2], 0);
    }
  }
  // a rocky base
  const base = [[-5, 0, -5], [5, 0, -5], [5, 0, 5], [-5, 0, 5]];
  const n = [0, 1, 0];
  const ids = base.map((p, i) => b.vertex([p[0], 0.05, p[2]], [[0.55, 0.55], [0.95, 0.55], [0.95, 0.95], [0.55, 0.95]][i], n));
  b.tri(ids[0], ids[3], ids[2], 1);
  b.tri(ids[0], ids[2], ids[1], 1);
  const texture = canvasBytes(16, (x, y) => {
    const n2 = hash2(x * 3, y * 5);
    if (x < 8) {
      const g = 1 - y / 16;
      return [150 + g * 90 + n2 * 20, 90 + g * 70 + n2 * 20, 210 + g * 45];
    }
    if (y >= 8) { const v = 70 + n2 * 40; return [v, v * 0.92, v * 0.86]; }
    return [0, 0, 0, 0];
  });
  const mesh = b.build([
    { name: 'crystal', color: [0.75, 0.5, 0.95], image: 0, glow: true },
    { name: 'base', color: [0.4, 0.38, 0.35], image: 0 },
  ]);
  return { mesh, textures: [{ name: 'Crystal', ...texture }] };
}

function faceNormal(a, b, c) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const l = Math.hypot(...n) || 1;
  return n.map((x) => x / l);
}

// -------------------------------------------------------------- storage

const b64 = {
  enc(arr) {
    const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    if (typeof btoa !== 'function') return Buffer.from(bytes).toString('base64');
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  },
  dec(str, Ctor) {
    let bytes;
    if (typeof atob !== 'function') bytes = new Uint8Array(Buffer.from(str, 'base64'));
    else {
      const s = atob(str);
      bytes = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    }
    return new Ctor(bytes.buffer);
  },
};

// Plain JSON form of a mesh, for graph files.
export function meshToJSON(mesh) {
  return {
    pos: b64.enc(mesh.pos), uv: mesh.uv ? b64.enc(mesh.uv) : null, nrm: mesh.nrm ? b64.enc(mesh.nrm) : null,
    idx: b64.enc(mesh.idx), mat: b64.enc(mesh.mat), materials: mesh.materials,
  };
}

export function meshFromJSON(j) {
  return {
    pos: b64.dec(j.pos, Float32Array), uv: j.uv ? b64.dec(j.uv, Float32Array) : null, nrm: j.nrm ? b64.dec(j.nrm, Float32Array) : null,
    idx: b64.dec(j.idx, Uint32Array), mat: b64.dec(j.mat, Uint16Array), materials: j.materials || [],
  };
}
