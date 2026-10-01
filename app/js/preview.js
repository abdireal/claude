// Live WebGL2 preview: a tiny Minecraft-style scene drawn with the shaders the
// graph produces. Pass order mirrors Iris: shadow map → sky → opaque blocks →
// mobs and chests → water → hand → post.

import { SHADOW_DEFAULTS } from './targets.js';
import { FLAT_NORMAL, NO_SPECULAR, boxDownscale } from './pbr.js';

// ------------------------------------------------------------------ math

const m4 = {
  translate(x, y, z) {
    return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
  },
  scale(k) {
    return new Float32Array([k, 0, 0, 0, 0, k, 0, 0, 0, 0, k, 0, 0, 0, 0, 1]);
  },
  rotX(a) {
    const c = Math.cos(a), s = Math.sin(a);
    return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
  },
  rotY(a) {
    const c = Math.cos(a), s = Math.sin(a);
    return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
  },
  rotZ(a) {
    const c = Math.cos(a), s = Math.sin(a);
    return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  },
  chain(...ms) {
    return ms.reduce((a, b) => m4.mul(a, b));
  },
  perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    const m = new Float32Array(16);
    m[0] = f / aspect;
    m[5] = f;
    m[10] = (far + near) / (near - far);
    m[11] = -1;
    m[14] = (2 * far * near) / (near - far);
    return m;
  },
  ortho(l, r, b, t, n, f) {
    return new Float32Array([
      2 / (r - l), 0, 0, 0, 0, 2 / (t - b), 0, 0, 0, 0, -2 / (f - n), 0,
      -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1,
    ]);
  },
  lookAt(e, t, u) {
    let zx = e[0] - t[0], zy = e[1] - t[1], zz = e[2] - t[2];
    let l = Math.hypot(zx, zy, zz);
    zx /= l; zy /= l; zz /= l;
    let xx = u[1] * zz - u[2] * zy, xy = u[2] * zx - u[0] * zz, xz = u[0] * zy - u[1] * zx;
    l = Math.hypot(xx, xy, xz);
    xx /= l; xy /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return new Float32Array([
      xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
      -(xx * e[0] + xy * e[1] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1,
    ]);
  },
  mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++)
      for (let r = 0; r < 4; r++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
        o[c * 4 + r] = s;
      }
    return o;
  },
  invert(m) {
    const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return new Float32Array(16);
    det = 1 / det;
    return new Float32Array([
      (a11 * b11 - a12 * b10 + a13 * b09) * det, (a02 * b10 - a01 * b11 - a03 * b09) * det,
      (a31 * b05 - a32 * b04 + a33 * b03) * det, (a22 * b04 - a21 * b05 - a23 * b03) * det,
      (a12 * b08 - a10 * b11 - a13 * b07) * det, (a00 * b11 - a02 * b08 + a03 * b07) * det,
      (a32 * b02 - a30 * b05 - a33 * b01) * det, (a20 * b05 - a22 * b02 + a23 * b01) * det,
      (a10 * b10 - a11 * b08 + a13 * b06) * det, (a01 * b08 - a00 * b10 - a03 * b06) * det,
      (a30 * b04 - a31 * b02 + a33 * b00) * det, (a21 * b02 - a20 * b04 - a23 * b00) * det,
      (a11 * b07 - a10 * b09 - a12 * b06) * det, (a00 * b09 - a01 * b07 + a02 * b06) * det,
      (a31 * b01 - a30 * b03 - a32 * b00) * det, (a20 * b03 - a21 * b01 + a22 * b00) * det,
    ]);
  },
};

// ------------------------------------------------------------- textures

function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TILE = {
  grassTop: 0, grassSide: 1, dirt: 2, stone: 3, logSide: 4, logTop: 5, leaves: 6, shortGrass: 7, poppy: 8, water: 9, sand: 10,
  glowstone: 11, diamond: 12, sword: 13, shield: 14, chestSide: 15, chestFront: 16, chestTop: 17,
  zSkin: 18, zFace: 19, zShirt: 20, zPants: 21,
};
const ATLAS_TILES = 8;
const TILE_PX = 64;

// Which preview tile a resource-pack texture path replaces.
export const TARGET_TILES = {
  'block/grass_block_top': TILE.grassTop,
  'block/grass_block_side': TILE.grassSide,
  'block/dirt': TILE.dirt,
  'block/stone': TILE.stone,
  'block/oak_log': TILE.logSide,
  'block/oak_log_top': TILE.logTop,
  'block/oak_leaves': TILE.leaves,
  'block/short_grass': TILE.shortGrass,
  'block/poppy': TILE.poppy,
  'block/water_still': TILE.water,
  'block/sand': TILE.sand,
  'block/glowstone': TILE.glowstone,
  'block/diamond_ore': TILE.diamond,
};

// Free atlas tiles the Models tab uses for model textures (the last row), and
// where a block model stands in the scene (on the grass, in front of the tree).
// Item models are held in the hand instead (see setHeldModel).
export const MODEL_TILES = [61, 62, 63];
export const MODEL_SPOT = [0, 1, 0];
const UV_EPS = 0.0008;

// Atlas coordinates of (u, v) inside a tile, v = 0 at the top of the tile.
export function atlasUV(tile, u, v) {
  const s = 1 / ATLAS_TILES;
  const u0 = (tile % ATLAS_TILES) / ATLAS_TILES, v0 = Math.floor(tile / ATLAS_TILES) / ATLAS_TILES;
  const c = (x) => Math.max(0, Math.min(1, x));
  return [u0 + UV_EPS + c(u) * (s - 2 * UV_EPS), v0 + UV_EPS + c(v) * (s - 2 * UV_EPS)];
}

// Block light from the glowstone and sky light, the same as the scene's blocks.
const GLOW_AT = [2.5, 1.5, -2.5];
export function sceneLight(x, y, z) {
  const d = Math.hypot(x - GLOW_AT[0], y - GLOW_AT[1], z - GLOW_AT[2]);
  return [Math.max(0, Math.min(1, 1 - (d - 0.5) / 7)), 1];
}

// Accepts ImageData, an image or a canvas and returns something drawable.
function toCanvas(img) {
  if (img instanceof ImageData) {
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    c.getContext('2d').putImageData(img, 0, 0);
    return c;
  }
  return img;
}

function hex(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function buildAtlas() {
  const size = 16 * ATLAS_TILES;
  const data = new Uint8ClampedArray(size * size * 4);
  const put = (tile, x, y, rgb, a = 255) => {
    const tx = (tile % ATLAS_TILES) * 16 + x;
    const ty = Math.floor(tile / ATLAS_TILES) * 16 + y;
    const i = (ty * size + tx) * 4;
    data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = a;
  };
  const pick = (r, list) => hex(list[Math.floor(r() * list.length)]);
  const gray = (v) => [v, v, v];

  let r = rng(11);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) put(TILE.grassTop, x, y, gray(150 + Math.floor(r() * 70)));

  r = rng(12);
  const dirt = ['#866043', '#79553a', '#9b7653', '#5f4330', '#8c6a4a'];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) put(TILE.dirt, x, y, pick(r, dirt));

  r = rng(13);
  const greens = ['#5f9e35', '#6aaa3c', '#55912f', '#78b544'];
  for (let x = 0; x < 16; x++) {
    const edge = 3 + Math.floor(r() * 3);
    for (let y = 0; y < 16; y++) put(TILE.grassSide, x, y, y < edge ? pick(r, greens) : pick(r, dirt));
  }

  r = rng(14);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) put(TILE.stone, x, y, gray(108 + Math.floor(r() * 40) - (r() < 0.12 ? 28 : 0)));

  r = rng(15);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const stripe = (x % 4 === 0 || x % 7 === 3) ? 0.75 : 1;
    const c = pick(r, ['#6b5130', '#5d4528', '#735834']).map((v) => v * stripe);
    put(TILE.logSide, x, y, c);
  }
  r = rng(16);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    const c = d > 6.5 ? pick(r, ['#5d4528', '#6b5130']) : Math.floor(d) % 2 ? hex('#a7814d') : hex('#b8925b');
    put(TILE.logTop, x, y, c);
  }

  r = rng(17);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const hole = r() < 0.18;
    put(TILE.leaves, x, y, gray(95 + Math.floor(r() * 110)), hole ? 0 : 255);
  }

  r = rng(18);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) put(TILE.shortGrass, x, y, [0, 0, 0], 0);
  for (let x = 1; x < 15; x += 1 + Math.floor(r() * 2)) {
    const h = 6 + Math.floor(r() * 9);
    let cx = x;
    for (let y = 15; y > 15 - h; y--) {
      if (r() < 0.25) cx += r() < 0.5 ? -1 : 1;
      cx = Math.max(0, Math.min(15, cx));
      put(TILE.shortGrass, cx, y, gray(130 + Math.floor(r() * 90)));
    }
  }

  r = rng(19);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) put(TILE.poppy, x, y, [0, 0, 0], 0);
  for (let y = 7; y < 16; y++) put(TILE.poppy, 7 + (y > 11 ? 1 : 0), y, hex('#3f7f2a'));
  put(TILE.poppy, 6, 11, hex('#4d9433')); put(TILE.poppy, 5, 10, hex('#4d9433'));
  for (let y = 3; y < 8; y++) for (let x = 5; x < 11; x++) {
    if ((x === 5 || x === 10) && (y === 3 || y === 7)) continue;
    put(TILE.poppy, x, y, pick(r, ['#d0262a', '#e8393d', '#a51a1e']));
  }
  put(TILE.poppy, 7, 5, hex('#2b1a0e')); put(TILE.poppy, 8, 5, hex('#3a2412'));

  r = rng(20);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const wave = Math.sin((x + y * 0.6) * 0.9) * 10;
    put(TILE.water, x, y, gray(175 + Math.floor(wave + r() * 20)), 185);
  }

  r = rng(21);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) put(TILE.sand, x, y, pick(r, ['#dbd3a0', '#d1c58f', '#e3dcae', '#c9bd86']));

  r = rng(22);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const line = (x + Math.floor(y / 4) * 2) % 5 === 0 || (y + Math.floor(x / 5)) % 6 === 0;
    put(TILE.glowstone, x, y, line ? hex('#7a5526') : pick(r, ['#ffd27a', '#f6bb4f', '#ffe7a3', '#e9a83c']));
  }

  r = rng(23);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) put(TILE.diamond, x, y, gray(108 + Math.floor(r() * 40)));
  for (const [cx, cy] of [[4, 4], [11, 5], [6, 11], [12, 12]]) {
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1]]) {
      if (r() < 0.85) put(TILE.diamond, cx + dx, cy + dy, pick(r, ['#5decf5', '#2bc4cf', '#a8f7fb', '#1a8e96']));
    }
  }
  // --- items and entities for the Items & Entities preview ---
  for (const tile of [TILE.sword]) for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) put(tile, x, y, [0, 0, 0], 0);
  for (let i = 0; i <= 8; i++) {
    put(TILE.sword, 5 + i, 10 - i, hex('#eef1f3'));
    put(TILE.sword, 6 + i, 10 - i, hex('#b9c0c6'));
    put(TILE.sword, 5 + i, 11 - i, hex('#59616a'));
  }
  put(TILE.sword, 14, 1, hex('#eef1f3'));
  for (const [x, y] of [[3, 9], [4, 10], [5, 11], [6, 12], [2, 8], [7, 13]]) put(TILE.sword, x, y, hex('#3d3f44'));
  for (const [x, y] of [[4, 11], [3, 12], [2, 13]]) put(TILE.sword, x, y, hex('#6b4a2a'));
  for (const [x, y] of [[1, 14], [2, 14], [1, 13]]) put(TILE.sword, x, y, hex('#3d3f44'));

  r = rng(31);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const rim = x === 0 || y === 0 || x === 15 || y === 15;
    const boss = x >= 6 && x <= 9 && y >= 6 && y <= 9;
    const plank = x % 4 === 0 ? 0.8 : 1;
    const c = rim || boss ? pick(r, ['#9aa1a8', '#c3c9ce', '#7c838a']) : pick(r, ['#8b6234', '#7a552c', '#946a3a']).map((v) => v * plank);
    put(TILE.shield, x, y, c);
  }

  const chestWood = ['#a46e2c', '#93622a', '#b07935', '#8a5a24'];
  for (const tile of [TILE.chestSide, TILE.chestFront, TILE.chestTop]) {
    r = rng(40 + tile);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const border = x === 0 || x === 15 || y === 0 || y === 15;
      const seam = tile !== TILE.chestTop && (y === 5 || y === 6);
      put(tile, x, y, border || seam ? hex('#4a2c10') : pick(r, chestWood));
    }
  }
  for (let y = 4; y <= 8; y++) for (let x = 7; x <= 8; x++) put(TILE.chestFront, x, y, y === 4 || y === 8 ? hex('#3a3a3a') : hex('#cfd3d6'));

  r = rng(51);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) put(TILE.zSkin, x, y, pick(r, ['#5b8d3e', '#4f7f35', '#66994a']));
  r = rng(52);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) put(TILE.zFace, x, y, pick(r, ['#5b8d3e', '#4f7f35', '#66994a']));
  for (const [x, y] of [[3, 7], [4, 7], [3, 8], [4, 8], [11, 7], [12, 7], [11, 8], [12, 8]]) put(TILE.zFace, x, y, hex('#13200c'));
  for (let x = 6; x <= 9; x++) put(TILE.zFace, x, 11, hex('#2f4a22'));
  r = rng(53);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) put(TILE.zShirt, x, y, pick(r, ['#2f8f93', '#2a8084', '#36a0a4']));
  r = rng(54);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) put(TILE.zPants, x, y, pick(r, ['#3b3f99', '#34388a', '#4347a8']));

  return { data, size };
}

// ----------------------------------------------------------------- scene

const B = { GRASS: 1, DIRT: 2, STONE: 3, LOG: 4, LEAVES: 5, WATER: 6, SAND: 7, GLOW: 8, DIAMOND: 9 };
const SOLID = new Set([B.GRASS, B.DIRT, B.STONE, B.LOG, B.SAND, B.GLOW, B.DIAMOND]);
const TINT = { grass: [0.57, 0.74, 0.35], leaves: [0.47, 0.67, 0.18], water: [0.25, 0.46, 0.89] };

function buildScene() {
  const world = new Map();
  const key = (x, y, z) => `${x},${y},${z}`;
  const set = (x, y, z, b) => world.set(key(x, y, z), b);
  const get = (x, y, z) => world.get(key(x, y, z)) || 0;

  for (let x = -4; x <= 3; x++)
    for (let z = -4; z <= 3; z++) {
      set(x, -1, z, B.DIRT);
      set(x, 0, z, B.GRASS);
    }
  for (const [x, z] of [[1, 0], [2, 0], [1, 1], [2, 1], [0, 1]]) {
    set(x, 0, z, B.WATER);
    set(x, -1, z, B.SAND);
  }
  for (let y = 1; y <= 3; y++) set(-2, y, -2, B.LOG);
  for (let dx = -2; dx <= 2; dx++)
    for (let dz = -2; dz <= 2; dz++) {
      const corner = Math.abs(dx) === 2 && Math.abs(dz) === 2;
      if (corner) continue;
      if (!(dx === 0 && dz === 0)) set(-2 + dx, 3, -2 + dz, B.LEAVES);
      if (Math.abs(dx) <= 1 && Math.abs(dz) <= 1) set(-2 + dx, 4, -2 + dz, B.LEAVES);
    }
  for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) set(-2 + dx, 5, -2 + dz, B.LEAVES);
  set(2, 1, -3, B.GLOW);
  set(-4, 1, 3, B.STONE);
  set(-3, 1, 3, B.STONE);
  set(-4, 1, 2, B.DIAMOND);
  set(-4, 2, 3, B.STONE);

  const plants = [
    [0, -1, TILE.shortGrass], [-1, 1, TILE.shortGrass], [1, -2, TILE.shortGrass], [3, 2, TILE.shortGrass],
    [-3, -1, TILE.shortGrass], [0, 3, TILE.shortGrass], [3, -1, TILE.shortGrass], [-1, -4, TILE.shortGrass],
    [-3, 0, TILE.poppy], [2, 3, TILE.poppy], [1, -3, TILE.poppy],
  ];

  const lightAt = (cx, cy, cz, under) => {
    const [block] = sceneLight(cx, cy, cz);
    return [block, under ? 0.72 : 1];
  };
  const underTree = (x, y, z) => x >= -4 && x <= 0 && z >= -4 && z <= 0 && y < 3.5;

  const opaque = [];
  const water = [];
  const grassTops = []; // [x, y, z, block light, sky light] of every grass block top, for 3D grass

  // face: normal, 4 corners (CCW from outside), shade
  const FACES = [
    { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 1.0, side: 'top' },
    { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.5, side: 'bottom' },
    { n: [0, 0, 1], c: [[0, 1, 1], [0, 0, 1], [1, 0, 1], [1, 1, 1]], shade: 0.8, side: 'side' },
    { n: [0, 0, -1], c: [[1, 1, 0], [1, 0, 0], [0, 0, 0], [0, 1, 0]], shade: 0.8, side: 'side' },
    { n: [1, 0, 0], c: [[1, 1, 1], [1, 0, 1], [1, 0, 0], [1, 1, 0]], shade: 0.6, side: 'side' },
    { n: [-1, 0, 0], c: [[0, 1, 0], [0, 0, 0], [0, 0, 1], [0, 1, 1]], shade: 0.6, side: 'side' },
  ];
  const tileUV = (t) => [(t % ATLAS_TILES) / ATLAS_TILES, Math.floor(t / ATLAS_TILES) / ATLAS_TILES];
  const eps = UV_EPS;

  function pushQuad(arr, corners, normal, tile, color, lm, blockId, uvs, tops) {
    const [u0, v0] = tileUV(tile);
    const s = 1 / ATLAS_TILES;
    const idx = [0, 1, 2, 0, 2, 3];
    for (const i of idx) {
      const p = corners[i];
      const uv = uvs[i];
      arr.push(p[0], p[1], p[2], normal[0], normal[1], normal[2],
        u0 + eps + uv[0] * (s - 2 * eps), v0 + eps + uv[1] * (s - 2 * eps),
        color[0], color[1], color[2], color[3], lm[0], lm[1], blockId, tops ? tops[i] : 0);
    }
  }
  const FACE_UV = [[0, 0], [0, 1], [1, 1], [1, 0]];
  const TOP_UV = [[0, 0], [0, 1], [1, 1], [1, 0]];

  for (const [k, b] of world) {
    const [x, y, z] = k.split(',').map(Number);
    if (b === B.WATER) {
      if (get(x, y + 1, z) !== B.WATER) {
        const h = 0.875;
        const corners = [[x, y + h, z + 1], [x + 1, y + h, z + 1], [x + 1, y + h, z], [x, y + h, z]];
        const lm = lightAt(x + 0.5, y + 1, z + 0.5, false);
        pushQuad(water, corners, [0, 1, 0], TILE.water, [...TINT.water, 1], lm, 3, TOP_UV);
      }
      continue;
    }
    for (const f of FACES) {
      const nx = x + f.n[0], ny = y + f.n[1], nz = z + f.n[2];
      const nb = get(nx, ny, nz);
      if (SOLID.has(nb)) continue;
      if (b === B.LEAVES && nb === B.LEAVES && f.side !== 'top') continue;
      let tile, tint = [1, 1, 1], id = 0;
      switch (b) {
        case B.GRASS:
          tile = f.side === 'top' ? TILE.grassTop : f.side === 'bottom' ? TILE.dirt : TILE.grassSide;
          if (f.side === 'top') tint = TINT.grass;
          id = 5;
          break;
        case B.DIRT: tile = TILE.dirt; break;
        case B.STONE: tile = TILE.stone; break;
        case B.LOG: tile = f.side === 'side' ? TILE.logSide : TILE.logTop; break;
        case B.LEAVES: tile = TILE.leaves; tint = TINT.leaves; id = 1; break;
        case B.SAND: tile = TILE.sand; break;
        case B.GLOW: tile = TILE.glowstone; break;
        case B.DIAMOND: tile = TILE.diamond; break;
        default: tile = TILE.stone;
      }
      const corners = f.c.map((c) => [x + c[0], y + c[1], z + c[2]]);
      const shade = f.shade;
      const color = [tint[0] * shade, tint[1] * shade, tint[2] * shade, 1];
      let lm = lightAt(x + 0.5 + f.n[0] * 0.5, y + 0.5 + f.n[1] * 0.5, z + 0.5 + f.n[2] * 0.5, underTree(x, y + 0.5, z));
      if (b === B.GLOW) lm = [1, lm[1]];
      pushQuad(opaque, corners, f.n, tile, color, lm, id, f.side === 'top' ? TOP_UV : FACE_UV);
      if (b === B.GRASS && f.side === 'top') grassTops.push([x, y + 1, z, lm[0], lm[1]]);
    }
  }

  for (const [x, z, tile] of plants) {
    const y = 1;
    const tint = tile === TILE.shortGrass ? TINT.grass : [1, 1, 1];
    const id = 2;
    const lm = lightAt(x + 0.5, y + 0.5, z + 0.5, underTree(x, y, z));
    const a = 0.15, b = 0.85;
    const quads = [
      [[x + a, y + 1, z + a], [x + a, y, z + a], [x + b, y, z + b], [x + b, y + 1, z + b]],
      [[x + a, y + 1, z + b], [x + a, y, z + b], [x + b, y, z + a], [x + b, y + 1, z + a]],
    ];
    const tops = [1, 0, 0, 1, 0, 1];
    for (const q of quads) pushQuad(opaque, q, [0, 1, 0], tile, [...tint, 1], lm, id, FACE_UV, tops);
  }
  return { opaque: new Float32Array(opaque), water: new Float32Array(water), grassTops };
}

// Same blades as the 3D grass geometry shader (gbuffers_terrain.gsh): one
// triangle each, on grass block tops, swaying with the same wind. Rebuilt
// every frame, since the wind moves them.
const hash = (a, b, c) => {
  const v = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
  return v - Math.floor(v);
};
function buildGrassBlades(tops, cfg, time, rain) {
  const out = new Float32Array(tops.length * cfg.density * 3 * 16);
  const [u0, v0] = [(TILE.grassTop % ATLAS_TILES) / ATLAS_TILES, Math.floor(TILE.grassTop / ATLAS_TILES) / ATLAS_TILES];
  const s = 1 / ATLAS_TILES;
  let o = 0;
  for (const [x, y, z, bl, sky] of tops) {
    // patchy, like the game: some blocks full, some thin
    const patch = 0.3 + 0.7 * Math.min(1, Math.max(0, (hash(Math.floor(x / 3), Math.floor(z / 3), 9) - 0.2) / 0.55));
    const count = Math.round(cfg.density * patch);
    for (let k = 0; k < count; k++) {
      const r1 = hash(x, z, k), r2 = hash(z, x, k + 7), r3 = hash(x + k, z, 3), r4 = hash(x, z + k, 5), r5 = hash(k, x, z), r6 = hash(z + k, k, x);
      const bx = x + 0.05 + r1 * 0.9, bz = z + 0.05 + r2 * 0.9;
      const h = cfg.height * (0.45 + 1.1 * r3 * r3) * (0.75 + 0.4 * patch);
      const half = 0.02 + 0.025 * r4;
      // the grass tint pushed towards fresh green, each blade a little different
      const g = TINT.grass.map((c, i) => c * (0.35 + 0.65 * [0.8, 1.15, 0.55][i]));
      const green = [g[0] * (0.82 + 0.28 * r6), g[1] * (0.95 + 0.13 * r6), g[2] * (0.75 - 0.05 * r6)];
      const yaw = r5 * Math.PI;
      const sx = Math.cos(yaw) * half, sz = Math.sin(yaw) * half;
      const amp = (0.15 + 0.2 * rain) * cfg.wind * h;
      const wx = Math.sin(time * 1.9 + bx * 0.7 + bz * 0.3) * amp;
      const wz = Math.sin(time * 1.4 + bz * 0.8 - bx * 0.2) * 0.6 * amp;
      const tip = [bx + (r4 - 0.5) * h * 0.5 + wx, y + h, bz + (r3 - 0.5) * h * 0.5 + wz];
      const u = u0 + UV_EPS + r1 * (s - 2 * UV_EPS), v = v0 + UV_EPS + r2 * (s - 2 * UV_EPS);
      for (const [p, shade] of [[[bx - sx, y, bz - sz], 0.62], [[bx + sx, y, bz + sz], 0.62], [tip, 1.2]]) {
        out.set([p[0], p[1], p[2], 0, 1, 0, u, v, green[0] * shade, green[1] * shade, green[2] * shade, 1, bl, sky, 5, 1], o);
        o += 16;
      }
    }
  }
  return out.subarray(0, o);
}

// --------------------------------------------------------------- shaders

// --------------------------------------------------------------- entities
// Box models for the Items & Entities preview: a chest (block entity), a
// zombie (hostile mob), and a sword and shield held in first person. They use
// the same vertex layout as blocks.

function buildEntityMeshes() {
  const tileUV = (t) => [(t % ATLAS_TILES) / ATLAS_TILES, Math.floor(t / ATLAS_TILES) / ATLAS_TILES];
  const eps = 0.0008;
  const S = 1 / ATLAS_TILES;
  function quad(arr, corners, n, tile, shade, lm, flip = false) {
    const [u0, v0] = tileUV(tile);
    const uvs = flip ? [[1, 0], [1, 1], [0, 1], [0, 0]] : [[0, 0], [0, 1], [1, 1], [1, 0]];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const p = corners[i];
      arr.push(p[0], p[1], p[2], n[0], n[1], n[2],
        u0 + eps + uvs[i][0] * (S - 2 * eps), v0 + eps + uvs[i][1] * (S - 2 * eps),
        shade, shade, shade, 1, lm[0], lm[1], 0, 0);
    }
  }
  // tiles: { top, bottom, side, front } ; front faces +z
  function box(arr, a, b, tiles, lm) {
    const [x0, y0, z0] = a, [x1, y1, z1] = b;
    const t = (k) => tiles[k] ?? tiles.side;
    quad(arr, [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], t('top'), 1.0, lm);
    quad(arr, [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], t('bottom'), 0.5, lm);
    quad(arr, [[x0, y1, z1], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1]], [0, 0, 1], t('front'), 0.8, lm);
    quad(arr, [[x1, y1, z0], [x1, y0, z0], [x0, y0, z0], [x0, y1, z0]], [0, 0, -1], t('back'), 0.8, lm);
    quad(arr, [[x1, y1, z1], [x1, y0, z1], [x1, y0, z0], [x1, y1, z0]], [1, 0, 0], t('side'), 0.6, lm);
    quad(arr, [[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]], [-1, 0, 0], t('side'), 0.6, lm);
  }
  const px = (v) => v / 16;

  const chest = [];
  box(chest, [px(1), 0, px(1)], [px(15), px(14), px(15)], { top: TILE.chestTop, bottom: TILE.chestTop, side: TILE.chestSide, back: TILE.chestSide, front: TILE.chestFront }, [0.8, 1]);

  const zombie = [];
  const lm = [0, 1];
  box(zombie, [px(-4), 0, px(-2)], [0, px(12), px(2)], { side: TILE.zPants }, lm);
  box(zombie, [0, 0, px(-2)], [px(4), px(12), px(2)], { side: TILE.zPants }, lm);
  box(zombie, [px(-4), px(12), px(-2)], [px(4), px(24), px(2)], { side: TILE.zShirt }, lm);
  box(zombie, [px(-8), px(20), px(-2)], [px(-4), px(24), px(10)], { side: TILE.zSkin }, lm);
  box(zombie, [px(4), px(20), px(-2)], [px(8), px(24), px(10)], { side: TILE.zSkin }, lm);
  box(zombie, [px(-4), px(24), px(-4)], [px(4), px(32), px(4)], { side: TILE.zSkin, front: TILE.zFace }, lm);

  // A flat item sprite with a front and a back, like Minecraft's item models.
  const sword = [];
  quad(sword, [[-0.5, 0.5, 0.02], [-0.5, -0.5, 0.02], [0.5, -0.5, 0.02], [0.5, 0.5, 0.02]], [0, 0, 1], TILE.sword, 1.0, [0, 1]);
  quad(sword, [[0.5, 0.5, -0.02], [0.5, -0.5, -0.02], [-0.5, -0.5, -0.02], [-0.5, 0.5, -0.02]], [0, 0, -1], TILE.sword, 0.75, [0, 1], true);

  const shield = [];
  box(shield, [px(-6), px(-11), px(-0.6)], [px(6), px(11), px(0.6)], { side: TILE.shield, front: TILE.shield, back: TILE.chestSide }, [0, 1]);

  return {
    chest: new Float32Array(chest),
    zombie: new Float32Array(zombie),
    sword: new Float32Array(sword),
    shield: new Float32Array(shield),
  };
}

const FULLSCREEN_VS = `#version 300 es
out vec2 v_uv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const SKY_FS = `#version 300 es
precision highp float;
uniform mat4 u_viewProjInv;
uniform vec3 u_cam;
uniform vec3 u_skyColor;
uniform vec3 u_fogColor;
uniform vec3 u_sunDir;
in vec2 v_uv;
out vec4 fragColor;
void main() {
  vec4 p = u_viewProjInv * vec4(v_uv * 2.0 - 1.0, 1.0, 1.0);
  vec3 dir = normalize(p.xyz / p.w - u_cam);
  float up = max(dir.y, 0.0);
  vec3 col = mix(u_skyColor, u_fogColor, 0.25 / (up * up + 0.25));
  vec3 s = u_sunDir;
  // square sun and moon, like Minecraft
  vec3 ds = abs(dir - s);
  vec3 dm = abs(dir + s);
  if (max(ds.x, max(ds.y, ds.z)) < 0.06) col = mix(col, vec3(1.0, 0.95, 0.75), 0.9);
  if (max(dm.x, max(dm.y, dm.z)) < 0.045) col = mix(col, vec3(0.85, 0.88, 0.95), 0.85);
  fragColor = vec4(col, 1.0);
}`;

const COPY_FS = `#version 300 es
precision highp float;
uniform sampler2D u_scene;
in vec2 v_uv;
out vec4 fragColor;
void main() { fragColor = vec4(texture(u_scene, v_uv).rgb, 1.0); }`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) || 'unknown error';
    gl.deleteShader(sh);
    throw new Error(log);
  }
  return sh;
}

function link(gl, vsSrc, fsSrc, attribs) {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  if (attribs) attribs.forEach((a, i) => gl.bindAttribLocation(p, i, a));
  gl.linkProgram(p);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p) || 'link failed';
    gl.deleteProgram(p);
    throw new Error(log);
  }
  const uniforms = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    uniforms[info.name] = gl.getUniformLocation(p, info.name);
  }
  const texUniforms = Object.keys(uniforms).filter((n) => n.startsWith('bg_tex_'));
  return { p, u: uniforms, tex: texUniforms };
}

const ATTRIBS = ['a_pos', 'a_normal', 'a_uv', 'a_color', 'a_lm', 'a_block', 'a_top'];
const ATTR_SIZES = [3, 3, 2, 4, 2, 1, 1];

function mixc(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
const smooth = (e0, e1, x) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// ------------------------------------------------------------- renderer

export class Preview {
  constructor(canvas) {
    this.canvas = canvas;
    this.ok = false;
    this.settings = new Map();
    this.dayTime = 0.15;
    this.rain = 0;
    this.autoRotate = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.postEnabled = true;
    this.cam = { yaw: 0.85, pitch: 0.42, dist: 11.5, target: [-0.3, 1.2, -0.3] };
    this.start = performance.now();
    this.visible = true;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: false });
    if (!gl) {
      this.error = 'WebGL2 is not available in this browser, so the live preview is off. Export still works.';
      return;
    }
    this.gl = gl;
    this.init();
    this.ok = true;
    this.bindControls();
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(canvas);
    const io = new IntersectionObserver((e) => { this.visible = e[0]?.isIntersecting ?? true; });
    io.observe(canvas);
    this.resize();
    const loop = () => {
      if (this.visible && !document.hidden) this.frame();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  init() {
    const gl = this.gl;
    // The procedural 16px tiles are kept so a custom texture can be removed again.
    const atlas = buildAtlas();
    this.baseAtlas = document.createElement('canvas');
    this.baseAtlas.width = this.baseAtlas.height = atlas.size;
    this.baseAtlas.getContext('2d').putImageData(new ImageData(atlas.data, atlas.size, atlas.size), 0, 0);
    this.atlasCanvas = document.createElement('canvas');
    this.atlasCanvas.width = this.atlasCanvas.height = TILE_PX * ATLAS_TILES;
    const actx = this.atlasCanvas.getContext('2d');
    actx.imageSmoothingEnabled = false;
    actx.drawImage(this.baseAtlas, 0, 0, this.atlasCanvas.width, this.atlasCanvas.height);
    this.atlas = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.atlasCanvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Material maps (LabPBR _n and _s) laid out like the colour atlas. Kept as
    // raw bytes: a canvas would premultiply the specular alpha (emission).
    const side = TILE_PX * ATLAS_TILES;
    this.normalData = new Uint8Array(side * side * 4);
    for (let i = 0; i < this.normalData.length; i += 4) this.normalData.set(FLAT_NORMAL, i);
    this.specData = new Uint8Array(side * side * 4);
    this.normalAtlas = this.dataTexture(this.normalData, side);
    this.specAtlas = this.dataTexture(this.specData, side);

    const scene = buildScene();
    const em = buildEntityMeshes();
    this.entityMeshes = {
      chest: this.makeMesh(em.chest),
      zombie: this.makeMesh(em.zombie),
      sword: this.makeMesh(em.sword),
      shield: this.makeMesh(em.shield),
    };
    this.meshes = {
      opaque: this.makeMesh(scene.opaque),
      water: this.makeMesh(scene.water),
    };
    this.grassTops = scene.grassTops;
    this.grassCfg = null;
    this.emptyVao = gl.createVertexArray();
    this.sky = link(gl, FULLSCREEN_VS, SKY_FS);
    this.copy = link(gl, FULLSCREEN_VS, COPY_FS);
    this.fbo = gl.createFramebuffer();
    this.colorTex = gl.createTexture();
    this.depthTex = gl.createTexture();

    // Sun shadow map: depth only, seen from the sun, like Iris's shadowtex.
    this.shadow = { ...SHADOW_DEFAULTS };
    this.shadowSize = 1024;
    this.shadowTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, this.shadowSize, this.shadowSize, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.shadowFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTex, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  dataTexture(data, side) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, side, side, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return t;
  }

  makeMesh(data) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const stride = 16 * 4;
    let off = 0;
    ATTR_SIZES.forEach((size, i) => {
      gl.enableVertexAttribArray(i);
      gl.vertexAttribPointer(i, size, gl.FLOAT, false, stride, off);
      off += size * 4;
    });
    gl.bindVertexArray(null);
    return { vao, buf, count: data.length / 16 };
  }

  // The selected model from the Models tab, in the scene's vertex layout
  // (16 floats per vertex, triangles). It is drawn with the Blocks shader.
  setModel(data) {
    if (!this.ok) return;
    const gl = this.gl;
    const old = this.meshes.model;
    if (old) {
      gl.deleteVertexArray(old.vao);
      gl.deleteBuffer(old.buf);
    }
    this.meshes.model = data && data.length ? this.makeMesh(data) : null;
  }

  // An item model from the Models tab, held instead of the sample sword
  // (hand 'main') or shield (hand 'off'), drawn with the Items & Entities
  // shader. Positions are centred on 0 like the sample sword.
  setHeldModel(data, hand = 'main') {
    if (!this.ok) return;
    const gl = this.gl;
    if (this.heldModel) {
      gl.deleteVertexArray(this.heldModel.mesh.vao);
      gl.deleteBuffer(this.heldModel.mesh.buf);
    }
    this.heldModel = data && data.length ? { mesh: this.makeMesh(data), hand } : null;
  }

  // 3D grass (the pack-wide setting): blades on the grass blocks.
  setGrass(cfg) {
    this.grassCfg = cfg && cfg.on ? { ...cfg } : null;
    if (!this.grassCfg) this.swapMesh('grassMesh', null);
  }

  updateGrass(time) {
    if (!this.grassCfg) return;
    const data = buildGrassBlades(this.grassTops, this.grassCfg, time, this.rain || 0);
    const gl = this.gl;
    if (!this.grassMesh || this.grassMesh.count !== data.length / 16) {
      this.swapMesh('grassMesh', data);
    } else {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.grassMesh.buf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
    }
  }

  // A mob model from the Models tab, drawn in place of the preview zombie,
  // and an armour model, worn by it. Feet space, like the zombie.
  setMobModel(data) {
    this.swapMesh('mobModel', data);
  }

  setArmorModel(data) {
    this.swapMesh('armorModel', data);
  }

  swapMesh(key, data) {
    if (!this.ok) return;
    const gl = this.gl;
    if (this[key]) {
      gl.deleteVertexArray(this[key].vao);
      gl.deleteBuffer(this[key].buf);
    }
    this[key] = data && data.length ? this.makeMesh(data) : null;
  }

  // Compiles new graph shaders. Keeps the last working ones if this fails.
  setShaders({ terrainVS, terrainFS, postFS, entityVS, entityFS, shadowFS }) {
    if (!this.ok) return { ok: false, error: this.error };
    const gl = this.gl;
    const result = { ok: true };
    // Shadow casters reuse each graph's vertex shader, so they swap in together.
    const swap = (key, vs, fs, errKey) => {
      try {
        const main = link(gl, vs, fs, ATTRIBS);
        const caster = shadowFS ? link(gl, vs, shadowFS, ATTRIBS) : null;
        for (const old of [this[key], this[key + 'Shadow']]) if (old) gl.deleteProgram(old.p);
        this[key] = main;
        this[key + 'Shadow'] = caster;
      } catch (err) {
        result.ok = false;
        result[errKey] = String(err.message || err);
      }
    };
    if (entityVS) swap('entity', entityVS, entityFS, 'entityError');
    swap('terrain', terrainVS, terrainFS, 'terrainError');
    try {
      const p = link(gl, FULLSCREEN_VS, postFS);
      if (this.post) gl.deleteProgram(this.post.p);
      this.post = p;
    } catch (e) {
      result.ok = false;
      result.postError = String(e.message || e);
    }
    return result;
  }

  setShadows(cfg) {
    this.shadow = { ...SHADOW_DEFAULTS, ...(cfg || {}) };
    if (this.np) this.np.dirty = true;
  }

  setSettings(map) {
    this.settings = map;
    if (this.np) this.np.dirty = true;
  }

  resize() {
    if (!this.ok) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(2, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(2, Math.round(this.canvas.clientHeight * dpr));
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.canvas.width = w;
    this.canvas.height = h;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.colorTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, this.depthTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, w, h, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.colorTex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.depthTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  bindControls() {
    const c = this.canvas;
    let drag = null;
    c.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, yaw: this.cam.yaw, pitch: this.cam.pitch };
      c.setPointerCapture(e.pointerId);
      this.userTouched = true;
    });
    c.addEventListener('pointermove', (e) => {
      if (!drag) return;
      this.cam.yaw = drag.yaw - (e.clientX - drag.x) * 0.008;
      this.cam.pitch = Math.max(-0.1, Math.min(1.45, drag.pitch + (e.clientY - drag.y) * 0.006));
    });
    const end = () => { drag = null; };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.cam.dist = Math.max(5, Math.min(30, this.cam.dist * Math.exp(e.deltaY * 0.0012)));
    }, { passive: false });
    c.addEventListener('dblclick', () => this.resetCamera());
  }

  resetCamera() {
    this.cam.yaw = 0.85;
    this.cam.pitch = 0.42;
    this.cam.dist = 11.5;
  }

  environment() {
    const t = this.dayTime;
    const s = Math.sin(t * Math.PI * 2);
    const daylight = smooth(-0.1, 0.25, s);
    const twilight = Math.max(0, 1 - Math.abs(s) * 3.5);
    let sky = mixc([0.03, 0.04, 0.1], [0.47, 0.65, 1.0], daylight);
    let fog = mixc([0.05, 0.07, 0.14], [0.75, 0.85, 1.0], daylight);
    fog = mixc(fog, [0.98, 0.62, 0.38], twilight * 0.65);
    sky = mixc(sky, [0.42, 0.45, 0.72], twilight * 0.35);
    const rainy = this.rain;
    sky = mixc(sky, [0.35, 0.38, 0.43].map((v) => v * (0.25 + daylight * 0.75)), rainy * 0.7);
    fog = mixc(fog, [0.42, 0.45, 0.5].map((v) => v * (0.25 + daylight * 0.75)), rainy * 0.7);
    // The sun crosses the sky east to west; Sun Angle (sunPathRotation) tilts its path.
    const a = t * Math.PI * 2;
    const tilt = ((this.shadow?.sunAngle ?? SHADOW_DEFAULTS.sunAngle) * Math.PI) / 180;
    const sun = [Math.cos(a), Math.sin(a) * Math.cos(tilt), Math.sin(a) * Math.sin(tilt)];
    // Shadows come from the sun by day and the moon by night, like Iris.
    const light = sun[1] > -0.1 ? sun : sun.map((v) => -v);
    return { sky, fog, sun, light };
  }

  // Renders the shadow map from the sun. An orthographic box fits the island.
  renderShadowMap(f) {
    const gl = this.gl;
    const L = f.env.light;
    const center = [-0.3, 1.5, -0.3];
    const R = 8.5;
    const eye = [center[0] + L[0] * 30, center[1] + L[1] * 30, center[2] + L[2] * 30];
    const up = Math.abs(L[1]) > 0.95 ? [0, 0, 1] : [0, 1, 0];
    this.shadowMat = m4.mul(m4.ortho(-R, R, -R, R, 1, 60), m4.lookAt(eye, center, up));
    this.shadowTexel = (2 * R) / this.shadowSize;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.viewport(0, 0, this.shadowSize, this.shadowSize);
    gl.clearDepth(1);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    if (this.terrainShadow) {
      const u = this.terrainShadow.u;
      gl.useProgram(this.terrainShadow.p);
      if (u.u_atlas) gl.uniform1i(u.u_atlas, 0);
      if (u.u_viewProj) gl.uniformMatrix4fv(u.u_viewProj, false, this.shadowMat);
      this.setCommon(u, f);
      gl.bindVertexArray(this.meshes.opaque.vao);
      gl.drawArrays(gl.TRIANGLES, 0, this.meshes.opaque.count);
      // a block model from the Models tab casts a shadow like any block (it is terrain in Iris too)
      if (this.meshes.model) {
        gl.bindVertexArray(this.meshes.model.vao);
        gl.drawArrays(gl.TRIANGLES, 0, this.meshes.model.count);
      }
    }
    if (this.entityShadow) this.drawEntities(this.shadowMat, f, false, null, this.entityShadow);
  }

  frame() {
    const gl = this.gl;
    if (!this.terrain || !this.post) return;
    if (this.autoRotate) this.cam.yaw += 0.0016;
    const time = (performance.now() - this.start) / 1000;
    const { yaw, pitch, dist, target } = this.cam;
    const eye = [
      target[0] + Math.cos(pitch) * Math.cos(yaw) * dist,
      target[1] + Math.sin(pitch) * dist,
      target[2] + Math.cos(pitch) * Math.sin(yaw) * dist,
    ];
    const proj = m4.perspective((50 * Math.PI) / 180, this.w / this.h, 0.1, 120);
    const view = m4.lookAt(eye, target, [0, 1, 0]);
    const viewProj = m4.mul(proj, view);
    const env = this.environment();
    const fl = Math.hypot(target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]);
    const f = {
      eye, env, time, projInv: m4.invert(proj),
      fwd: [(target[0] - eye[0]) / fl, (target[1] - eye[1]) / fl, (target[2] - eye[2]) / fl],
    };
    this.lastFrame = f;

    this.shadowLive = !!(this.shadow.on && this.terrainShadow);
    if (this.shadowLive) this.renderShadowMap(f);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.w, this.h);
    gl.clearColor(0, 0, 0, 1);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.CULL_FACE);

    // sky
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.useProgram(this.sky.p);
    gl.uniformMatrix4fv(this.sky.u.u_viewProjInv, false, m4.invert(viewProj));
    gl.uniform3fv(this.sky.u.u_cam, eye);
    gl.uniform3fv(this.sky.u.u_skyColor, env.sky);
    gl.uniform3fv(this.sky.u.u_fogColor, env.fog);
    gl.uniform3fv(this.sky.u.u_sunDir, env.sun);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // blocks
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    const tp = this.terrain;
    gl.useProgram(tp.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    const u = tp.u;
    if (u.u_atlas) gl.uniform1i(u.u_atlas, 0);
    if (u.u_viewProj) gl.uniformMatrix4fv(u.u_viewProj, false, viewProj);
    if (u.u_far) gl.uniform1f(u.u_far, 28);
    this.setCommon(u, f);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.meshes.opaque.vao);
    gl.drawArrays(gl.TRIANGLES, 0, this.meshes.opaque.count);
    if (this.meshes.model) {
      gl.bindVertexArray(this.meshes.model.vao);
      gl.drawArrays(gl.TRIANGLES, 0, this.meshes.model.count);
    }
    if (this.grassCfg) {
      this.updateGrass(time);
      if (this.grassMesh) {
        gl.bindVertexArray(this.grassMesh.vao);
        gl.drawArrays(gl.TRIANGLES, 0, this.grassMesh.count);
      }
    }

    // block entities and mobs (Items & Entities graph)
    if (this.entity) this.drawEntities(viewProj, f, false, view);

    // water: back to the Blocks program (the entity pass switched programs and textures)
    gl.useProgram(tp.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    this.setCommon(u, f);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.bindVertexArray(this.meshes.water.vao);
    gl.drawArrays(gl.TRIANGLES, 0, this.meshes.water.count);
    gl.disable(gl.BLEND);
    gl.depthMask(true);

    // first-person items, squeezed into the front of the depth range like Minecraft's hand
    if (this.entity) {
      gl.depthRange(0, 0.05);
      this.drawEntities(viewProj, f, true, view);
      gl.depthRange(0, 1);
    }

    // post
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.w, this.h);
    gl.disable(gl.DEPTH_TEST);
    const pp = this.postEnabled ? this.post : this.copy;
    gl.useProgram(pp.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.colorTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.depthTex);
    const pu = pp.u;
    if (pu.u_scene) gl.uniform1i(pu.u_scene, 0);
    if (pu.u_depth) gl.uniform1i(pu.u_depth, 1);
    this.setCommon(pu, f);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);

    if (this.np && this.onNodePreviews) {
      const now = performance.now();
      const envKey = `${this.dayTime}|${this.rain}`;
      if (envKey !== this.npEnvKey) {
        this.npEnvKey = envKey;
        this.np.dirty = true;
      }
      if (this.np.dirty || (this.np.animated && now - this.np.last > 110)) {
        this.np.dirty = false;
        this.np.last = now;
        this.renderNodePreviews(f);
      }
    }
  }

  // ----------------------------------------------------------- node previews
  // Every node gets its own thumbnail, like Unity Shader Graph. All of them are
  // drawn into one offscreen grid, read back once, and handed to the editor.

  setNodePreviews(items, tile, texSize = 16) {
    if (!this.ok) return;
    const gl = this.gl;
    this.npCache = this.npCache || new Map();
    const keep = new Set();
    const list = [];
    for (const it of items || []) {
      keep.add(it.src);
      let entry = this.npCache.get(it.src);
      if (!entry) {
        try {
          entry = { prog: link(gl, FULLSCREEN_VS, it.src) };
        } catch (e) {
          entry = { error: String(e.message || e) };
        }
        this.npCache.set(it.src, entry);
      }
      list.push({ id: it.id, animated: it.animated, ...entry });
    }
    for (const [src, entry] of this.npCache) {
      if (!keep.has(src)) {
        if (entry.prog) gl.deleteProgram(entry.prog.p);
        this.npCache.delete(src);
      }
    }
    this.np = list.length ? { items: list, tile, texSize, dirty: true, last: 0, animated: list.some((x) => x.animated) } : null;
  }

  invalidateNodePreviews() {
    if (this.np) this.np.dirty = true;
  }

  renderNodePreviews(f) {
    const gl = this.gl;
    const W = 160, H = 96, cols = 6;
    const items = this.np.items;
    const rows = Math.ceil(items.length / cols);
    const gw = cols * W, gh = rows * H;
    if (!this.npFbo || this.npW !== gw || this.npH !== gh) {
      this.npFbo = this.npFbo || gl.createFramebuffer();
      this.npTex = this.npTex || gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.npTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gw, gh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.npFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.npTex, 0);
      this.npW = gw;
      this.npH = gh;
      this.npBuf = new Uint8Array(gw * gh * 4);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.npFbo);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.clearColor(0.08, 0.09, 0.11, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindVertexArray(this.emptyVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.colorTex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.depthTex);
    const tile = this.np.tile;
    items.forEach((it, i) => {
      if (!it.prog) return;
      gl.viewport((i % cols) * W, Math.floor(i / cols) * H, W, H);
      gl.useProgram(it.prog.p);
      const u = it.prog.u;
      if (u.u_atlas) gl.uniform1i(u.u_atlas, 0);
      if (u.u_scene) gl.uniform1i(u.u_scene, 1);
      if (u.u_depth) gl.uniform1i(u.u_depth, 2);
      if (u.u_tileOrigin) gl.uniform2fv(u.u_tileOrigin, tile.origin);
      if (u.u_tileSize) gl.uniform1f(u.u_tileSize, tile.size);
      if (u.u_tileRes) gl.uniform2f(u.u_tileRes, W, H);
      if (u.u_texSize) gl.uniform2f(u.u_texSize, this.np.texSize || 16, this.np.texSize || 16);
      this.setCommon(u, f);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    });
    gl.readPixels(0, 0, gw, gh, gl.RGBA, gl.UNSIGNED_BYTE, this.npBuf);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    const out = new Map();
    items.forEach((it, i) => {
      if (!it.prog) {
        out.set(it.id, { error: it.error });
        return;
      }
      const tx = (i % cols) * W, ty = Math.floor(i / cols) * H;
      const img = new ImageData(W, H);
      for (let y = 0; y < H; y++) {
        const src = ((ty + (H - 1 - y)) * gw + tx) * 4;
        img.data.set(this.npBuf.subarray(src, src + W * 4), y * W * 4);
      }
      out.set(it.id, { img });
    });
    this.onNodePreviews(out);
  }


  defaultFrame() {
    return { eye: [8, 6, 8], fwd: [-0.6, -0.4, -0.6], env: this.environment(), time: (performance.now() - this.start) / 1000, projInv: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) };
  }

  // ------------------------------------------------- custom textures & tiles

  // Swaps one preview tile for a texture from the Textures tab (or puts the
  // built-in one back when img is null).
  setTileOverride(tile, img) {
    if (!this.ok || tile == null) return;
    const ctx = this.atlasCanvas.getContext('2d');
    const x = (tile % ATLAS_TILES) * TILE_PX, y = Math.floor(tile / ATLAS_TILES) * TILE_PX;
    ctx.clearRect(x, y, TILE_PX, TILE_PX);
    if (img) {
      const src = toCanvas(img);
      ctx.imageSmoothingEnabled = src.width > TILE_PX;
      ctx.drawImage(src, x, y, TILE_PX, TILE_PX);
    } else {
      ctx.imageSmoothingEnabled = false;
      const s = 16;
      ctx.drawImage(this.baseAtlas, (tile % ATLAS_TILES) * s, Math.floor(tile / ATLAS_TILES) * s, s, s, x, y, TILE_PX, TILE_PX);
    }
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.atlasCanvas);
    this.invalidateNodePreviews();
  }

  // Puts a normal map and a specular map ({ data, width, height } in LabPBR
  // format, or null for flat and matte) on one tile of the material atlases.
  setTilePbr(tile, normal, spec) {
    if (!this.ok || tile == null) return;
    const gl = this.gl;
    const side = TILE_PX * ATLAS_TILES;
    const x0 = (tile % ATLAS_TILES) * TILE_PX, y0 = Math.floor(tile / ATLAS_TILES) * TILE_PX;
    for (const [img, data, tex, def, isNormal] of [
      [normal, this.normalData, this.normalAtlas, FLAT_NORMAL, true],
      [spec, this.specData, this.specAtlas, NO_SPECULAR, false],
    ]) {
      const px = img ? boxDownscale(img.data, img.width, img.height, TILE_PX, TILE_PX, isNormal) : null;
      for (let y = 0; y < TILE_PX; y++) {
        for (let x = 0; x < TILE_PX; x++) {
          const o = ((y0 + y) * side + x0 + x) * 4;
          if (px) data.set(px.subarray((y * TILE_PX + x) * 4, (y * TILE_PX + x) * 4 + 4), o);
          else data.set(def, o);
        }
      }
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, side, side, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.invalidateNodePreviews();
  }

  // Textures that Image Texture nodes sample (bg_tex_<id>).
  setCustomTexture(id, img, { blur = true } = {}) {
    if (!this.ok) return;
    const gl = this.gl;
    this.customTex = this.customTex || new Map();
    let t = this.customTex.get(id);
    if (!t) {
      t = gl.createTexture();
      this.customTex.set(id, t);
    }
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, toCanvas(img));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, blur ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, blur ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    this.invalidateNodePreviews();
  }

  removeCustomTexture(id) {
    const t = this.customTex?.get(id);
    if (t) {
      this.gl.deleteTexture(t);
      this.customTex.delete(id);
    }
  }

  bindCustomTextures(u) {
    const names = Object.keys(u).filter((n) => n.startsWith('bg_tex_'));
    if (!names.length) return;
    const gl = this.gl;
    if (!this.missingTex) {
      this.missingTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.missingTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 0, 255, 255]));
    }
    names.forEach((name, i) => {
      const unit = 4 + i;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, this.customTex?.get(name.slice(7)) || this.missingTex);
      gl.uniform1i(u[name], unit);
    });
    gl.activeTexture(gl.TEXTURE0);
  }

  // Renders a texture graph into pixels (see buildTextureShader).
  bakeTexture(src, size, seamless) {
    if (!this.ok) return { error: this.error };
    const gl = this.gl;
    this.bakeCache = this.bakeCache || new Map();
    let entry = this.bakeCache.get(src);
    if (!entry) {
      try {
        entry = { prog: link(gl, FULLSCREEN_VS, src) };
      } catch (e) {
        entry = { error: String(e.message || e) };
      }
      if (this.bakeCache.size > 40) {
        for (const [k, v] of this.bakeCache) {
          if (v.prog) gl.deleteProgram(v.prog.p);
          this.bakeCache.delete(k);
          break;
        }
      }
      this.bakeCache.set(src, entry);
    }
    if (entry.error) return { error: entry.error };
    size = Math.max(1, Math.min(512, size | 0));
    if (!this.bakeFbo) {
      this.bakeFbo = gl.createFramebuffer();
      this.bakeTex = gl.createTexture();
    }
    if (this.bakeSize !== size) {
      gl.bindTexture(gl.TEXTURE_2D, this.bakeTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.bakeFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.bakeTex, 0);
      this.bakeSize = size;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bakeFbo);
    gl.viewport(0, 0, size, size);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(entry.prog.p);
    const u = entry.prog.u;
    if (u.u_texSize) gl.uniform2f(u.u_texSize, size, size);
    if (u.u_seamless) gl.uniform1f(u.u_seamless, seamless ? 1 : 0);
    this.bindCustomTextures(u);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const buf = new Uint8Array(size * size * 4);
    gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const img = new ImageData(size, size);
    for (let y = 0; y < size; y++) img.data.set(buf.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
    return { img };
  }

  // Draws the chest and zombie (world) or the held sword and shield (hand).
  drawEntities(viewProj, f, hand, view, ep = this.entity) {
    const gl = this.gl;
    const u = ep.u;
    gl.useProgram(ep.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    if (u.u_atlas) gl.uniform1i(u.u_atlas, 0);
    if (u.u_viewProj) gl.uniformMatrix4fv(u.u_viewProj, false, viewProj);
    if (u.u_far) gl.uniform1f(u.u_far, 28);
    this.setCommon(u, f);
    const set = (o) => {
      if (u.u_model) gl.uniformMatrix4fv(u.u_model, false, o.model);
      if (u.u_itemId) gl.uniform1i(u.u_itemId, o.itemId || -1);
      if (u.u_entityId) gl.uniform1i(u.u_entityId, o.entityId || -1);
      if (u.u_blockEntityId) gl.uniform1i(u.u_blockEntityId, o.blockEntityId || -1);
      if (u.u_isHeld) gl.uniform1f(u.u_isHeld, o.held ? 1 : 0);
      if (u.u_isEntity) gl.uniform1f(u.u_isEntity, o.isEntity ? 1 : 0);
      if (u.u_isBlockEntity) gl.uniform1f(u.u_isBlockEntity, o.isBlock ? 1 : 0);
      if (u.u_entityColor) gl.uniform4fv(u.u_entityColor, o.flash || [0, 0, 0, 0]);
      gl.bindVertexArray(o.mesh.vao);
      gl.drawArrays(gl.TRIANGLES, 0, o.mesh.count);
    };
    const t = f.time;
    if (!hand) {
      set({ mesh: this.entityMeshes.chest, model: m4.translate(0, 1, -3), isBlock: true, blockEntityId: 10101 });
      const hurt = t % 4 < 0.3;
      const zombie = {
        mesh: this.mobModel || this.entityMeshes.zombie, isEntity: true, entityId: 30002,
        model: m4.chain(m4.translate(1.5, 1, 2.5), m4.rotY(0.6 + Math.sin(t * 0.7) * 0.15)),
        flash: hurt ? [1, 0, 0, 0.5] : [0, 0, 0, 0],
      };
      set(zombie);
      if (this.armorModel) set({ ...zombie, mesh: this.armorModel });
      return;
    }
    const camToWorld = m4.invert(view);
    const bob = Math.sin(t * 1.6) * 0.012;
    const own = (h, fallback) => (this.heldModel?.hand === h ? this.heldModel.mesh : fallback);
    set({
      mesh: own('main', this.entityMeshes.sword), held: true, itemId: 20001,
      model: m4.chain(camToWorld, m4.translate(0.5, -0.33 + bob, -1.4), m4.rotY(-0.5), m4.rotZ(0.08), m4.scale(0.56)),
    });
    set({
      mesh: own('off', this.entityMeshes.shield), held: true, itemId: 20003,
      model: m4.chain(camToWorld, m4.translate(-0.6, -0.4 - bob, -1.4), m4.rotY(0.4), m4.rotX(-0.06), m4.scale(0.46)),
    });
  }

  // Uniforms every generated shader can read (the bg_* builtins).
  setCommon(u, f = this.lastFrame || this.defaultFrame()) {
    const gl = this.gl;
    this.bindCustomTextures(u);
    if (u.u_cam) gl.uniform3fv(u.u_cam, f.eye);
    if (u.u_camFwd) gl.uniform3fv(u.u_camFwd, f.fwd);
    if (u.u_sunDir) gl.uniform3fv(u.u_sunDir, f.env.sun);
    if (u.u_skyColor) gl.uniform3fv(u.u_skyColor, f.env.sky);
    if (u.u_fogColor) gl.uniform3fv(u.u_fogColor, f.env.fog);
    if (u.u_res) gl.uniform2f(u.u_res, this.w, this.h);
    if (u.u_time) gl.uniform1f(u.u_time, f.time);
    if (u.u_dayTime) gl.uniform1f(u.u_dayTime, this.dayTime);
    if (u.u_rain) gl.uniform1f(u.u_rain, this.rain);
    // The preview player holds a sword (main hand) and a shield (off hand).
    if (u.u_heldItem) gl.uniform1i(u.u_heldItem, 20001);
    if (u.u_heldItem2) gl.uniform1i(u.u_heldItem2, 20003);
    if (u.u_shadowStrength) gl.uniform1f(u.u_shadowStrength, this.shadow.strength);
    if (u.u_shadowMap) {
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, this.shadowLive ? this.shadowTex : null);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(u.u_shadowMap, 3);
      gl.uniform1f(u.u_shadowOn, this.shadowLive ? 1 : 0);
      if (this.shadowMat) gl.uniformMatrix4fv(u.u_shadowMat, false, this.shadowMat);
      gl.uniform3fv(u.u_shadowLight, f.env.light);
      gl.uniform1f(u.u_shadowTexel, this.shadowTexel || 0.02);
      gl.uniform1f(u.u_shadowSoft, this.shadow.softness);
    }
    if (u.u_projInv) gl.uniformMatrix4fv(u.u_projInv, false, f.projInv);
    // Material atlases sit on the last two units, clear of custom textures (4+).
    if (u.u_normalAtlas || u.u_specAtlas) {
      gl.activeTexture(gl.TEXTURE14);
      gl.bindTexture(gl.TEXTURE_2D, this.normalAtlas);
      gl.activeTexture(gl.TEXTURE15);
      gl.bindTexture(gl.TEXTURE_2D, this.specAtlas);
      gl.activeTexture(gl.TEXTURE0);
      if (u.u_normalAtlas) gl.uniform1i(u.u_normalAtlas, 14);
      if (u.u_specAtlas) gl.uniform1i(u.u_specAtlas, 15);
    }
    this.applySettings(u);
  }

  applySettings(u) {
    const gl = this.gl;
    for (const [name, s] of this.settings) {
      if (s.kind === 'toggle') {
        const loc = u['TG_' + name];
        if (loc) gl.uniform1f(loc, s.value ? 1 : 0);
      } else {
        const loc = u[name];
        if (loc) gl.uniform1f(loc, Number(s.value) || 0);
      }
    }
  }
}
