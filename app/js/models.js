// The Models tab: real 3D models for blocks and items, through the BlockGraph
// Models mod (client side, Fabric 1.21.11). Import OBJ, glTF or GLB, fit the
// model into Minecraft's block space, give its materials textures from the
// Textures tab, see it in the live preview under the Blocks shader, and export
// it into the resource pack.

import * as M from './meshes.js';
import * as TX from './textures.js';
import * as PBR from './pbr.js';
import { encodePng, decodePng } from './png.js';
import { MODEL_TILES, MODEL_SPOT, atlasUV, sceneLight } from './preview.js';
import { ModelView } from './modelview.js';

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

// Where people get the mod: the GitHub Actions build of mod/ in this repository.
export const MOD_PAGE = 'https://github.com/abdireal/claude/actions/workflows/mod.yml';
export const MOD_NAME = 'BlockGraph Models';

// How a model is held and posed. The parent model gives Minecraft's display
// transforms (first person, third person, GUI, ground, item frame).
export const HOLDS = {
  sword: { label: 'Sword or tool', parent: 'minecraft:item/handheld', guide: 'sword', fit: 'sword', gui: 'front',
    hint: 'Handle bottom-left, tip top-right, flat in the gold square: where a vanilla sword sprite sits.' },
  item: { label: 'Normal item', parent: 'minecraft:item/generated', guide: 'item', fit: 'item', gui: 'front',
    hint: 'Centred on the gold square, like a flat item sprite. Held lower than tools.' },
  rod: { label: 'Rod (like a fishing rod)', parent: 'minecraft:item/handheld_rod', guide: 'sword', fit: 'sword', gui: 'front',
    hint: 'Held further out than a sword. Same layout as a sword.' },
  shield: { label: 'Shield (raises when you block)', parent: 'minecraft:item/shield', blocking: 'minecraft:item/shield_blocking', guide: 'shield', fit: 'shield', gui: 'front',
    hint: 'Face the front towards +Z and keep the plate inside the gold outline, the size of the vanilla shield. Check it in game: the pose is the vanilla shield’s.' },
  block: { label: 'Block', parent: 'minecraft:block/block', guide: 'block', fit: 'block', gui: 'side',
    hint: 'Keep it inside the blue box and stand it on the floor.' },
};

export const USES = {
  item: 'Replace an item',
  custom: 'New item id',
  block: 'Replace a block',
  mob: 'Replace a mob',
  armor: 'Replace armour',
};

// Mobs and armour pieces to pick from (any id works).
const MOBS = ['zombie', 'player', 'skeleton', 'husk', 'drowned', 'stray', 'wither_skeleton', 'piglin', 'zombified_piglin',
  'creeper', 'pig', 'cow', 'sheep', 'mooshroom', 'villager', 'enderman', 'spider', 'chicken', 'wolf', 'cat', 'fox', 'iron_golem'];
const ARMORS = ['leather', 'chainmail', 'iron', 'golden', 'diamond', 'netherite'].flatMap((m) => ['helmet', 'chestplate', 'leggings', 'boots'].map((p) => `${m}_${p}`)).concat('turtle_helmet');
// Where each armour piece sits on a humanoid (feet space, blocks): [centre, size].
const ARMOR_SLOTS = {
  head: [[0, 1.75, 0], 0.62],
  chest: [[0, 1.12, 0], 1.05],
  legs: [[0, 0.55, 0], 0.85],
  feet: [[0, 0.18, 0], 0.62],
};
const armorSlot = (id) => {
  const p = String(id || '');
  if (/(helmet|_cap|_head)$/.test(p)) return 'head';
  if (/(leggings|_pants)$/.test(p)) return 'legs';
  if (/boots$/.test(p)) return 'feet';
  return 'chest';
};
// How a block model turns with its block: by facing (chests, wall signs,
// furnaces), by the 16 rotations of standing signs, banners and heads, or a
// bed's two halves.
const TURNS = { none: 'Does not turn', facing: 'With its facing (north, east, south, west)', rotation: 'With its rotation (standing signs, banners, heads)', bed: 'As a bed (two blocks, head and foot)' };
function autoTurn(id) {
  const p = String(id || '').replace(/^minecraft:/, '');
  if (/_bed$/.test(p)) return 'bed';
  if (/wall_|chest$|shulker_box$|furnace$|smoker$|lectern$|stonecutter$|grindstone$|anvil$|campfire$/.test(p)) return 'facing';
  if (/(_sign|_banner|_head|_skull)$/.test(p) && !/hanging/.test(p)) return 'rotation';
  return 'none';
}
const turnOf = (m) => m.turn || (m.facing ? 'facing' : 'none');

const ITEMS = ['diamond_sword', 'netherite_sword', 'iron_sword', 'golden_sword', 'stone_sword', 'wooden_sword', 'mace',
  'diamond_axe', 'diamond_pickaxe', 'diamond_shovel', 'diamond_hoe', 'netherite_axe', 'netherite_pickaxe', 'shield', 'stick',
  'blaze_rod', 'totem_of_undying', 'apple', 'golden_apple', 'carrot_on_a_stick', 'spyglass', 'nether_star', 'heart_of_the_sea',
  'ender_eye', 'emerald', 'diamond', 'bone', 'feather', 'brush', 'goat_horn'];
const ITEM_NOTES = {
  bow: 'Bows switch models while you pull them. A replacement shows one model the whole time.',
  crossbow: 'Crossbows switch models while loading. A replacement shows one model the whole time.',
  compass: 'Compasses point by switching between many models. A replacement does not turn.',
  recovery_compass: 'Recovery compasses point by switching models. A replacement does not turn.',
  clock: 'Clocks switch between many models. A replacement does not move.',
  fishing_rod: 'The cast rod has its own model in vanilla. A replacement looks the same cast or not.',
  trident: 'Only the trident in hand and in the inventory changes. A thrown trident keeps its vanilla look.',
  elytra: 'Only the item changes. Elytra on a player’s back are drawn separately.',
  shield: 'Pick “Shield” under Hold like, so it raises when you block.',
};
const BLOCKS = ['chest', 'trapped_chest', 'ender_chest', 'oak_sign', 'oak_wall_sign', 'red_bed', 'white_banner', 'player_head', 'skeleton_skull',
  'stone', 'dirt', 'grass_block', 'oak_planks', 'cobblestone', 'flower_pot', 'lantern', 'soul_lantern', 'end_rod', 'lightning_rod', 'anvil', 'cauldron', 'grindstone',
  'stonecutter', 'brewing_stand', 'hopper', 'composter', 'dead_bush', 'cobweb', 'candle', 'amethyst_cluster', 'sea_pickle',
  'iron_bars', 'campfire', 'lectern', 'scaffolding', 'pointed_dripstone', 'small_amethyst_bud', 'fern', 'poppy'];
const ENTITY_BLOCKS = /^(chest|trapped_chest|ender_chest|.*shulker_box|.*_bed|.*sign|.*banner|.*_head|.*_skull|bell|decorated_pot|conduit|beacon|enchanting_table)$/;
const FULL_BLOCKS = /^(stone|dirt|grass_block|cobblestone|.*_planks|.*_log|.*_wood|sand|gravel|.*_ore|.*_block|glass|bricks|.*_bricks|deepslate|netherrack|obsidian|.*_wool|.*_concrete|.*terracotta|glowstone|sandstone|.*leaves)$/;

let ctx;
let view = null;
const meshes = new Map(); // mesh id -> mesh (immutable, so undo can point back at old ones)
const norms = new Map();
const quadCounts = new Map();
const shownTiles = new Set();
const shownPbr = new Map(); // preview tile -> what its material maps show
const decodedMaps = new Map(); // "meshId:material" -> { n, s } pixels, or 'pending'

// ------------------------------------------------------------- storage
// Meshes are too big for localStorage, so they live in IndexedDB. The models
// themselves (small) go in the normal state, history and graph files.

let dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const r = indexedDB.open('blockgraph-models', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('meshes');
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => resolve(null);
        r.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

async function dbRun(mode, fn) {
  const d = await db();
  if (!d) return null;
  return new Promise((resolve) => {
    try {
      const tx = d.transaction('meshes', mode);
      const req = fn(tx.objectStore('meshes'));
      tx.oncomplete = () => resolve(req?.result ?? true);
      tx.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function storeMesh(id, mesh) {
  meshes.set(id, mesh);
  dbRun('readwrite', (s) => s.put({ pos: mesh.pos, uv: mesh.uv, nrm: mesh.nrm, idx: mesh.idx, mat: mesh.mat, materials: mesh.materials }, id))
    .then((ok) => { if (!ok && !storeMesh.warned) { storeMesh.warned = true; ctx.toast('This browser cannot keep models after a reload. Save a graph file from Export to keep them.'); } });
}

async function loadStoredMeshes() {
  const wanted = new Set(ctx.state.models.map((m) => m.mesh));
  const d = await db();
  if (!d) return;
  const keys = (await dbRun('readonly', (s) => s.getAllKeys())) || [];
  for (const k of keys) {
    if (meshes.has(k)) continue;
    if (!wanted.has(k)) {
      dbRun('readwrite', (s) => s.delete(k)); // a model deleted in an earlier session
      continue;
    }
    const m = await dbRun('readonly', (s) => s.get(k));
    if (m && m.pos) meshes.set(k, m);
  }
}

const newMeshId = () => `mesh_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

// ------------------------------------------------------------- helpers

export function packNamespace(name) {
  const s = String(name || '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32);
  return s || 'blockgraph';
}

function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'model';
}

// File names for every model, unique, from their names.
export function modelKeys() {
  const used = new Set();
  const out = new Map();
  for (const m of ctx.state.models) {
    let k = slug(m.name);
    if (used.has(k)) {
      let i = 2;
      while (used.has(`${k}_${i}`)) i++;
      k = `${k}_${i}`;
    }
    used.add(k);
    out.set(m.id, k);
  }
  return out;
}

// "diamond_sword" -> "minecraft:diamond_sword". Returns null if invalid.
export function fullId(v) {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return null;
  const id = s.includes(':') ? s : `minecraft:${s}`;
  return /^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(id) ? id : null;
}

function uniqueName(base) {
  const names = new Set(ctx.state.models.map((m) => m.name));
  if (!names.has(base)) return base;
  let i = 2;
  while (names.has(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}

export function modelById(id) {
  return ctx.state.models.find((m) => m.id === id) || null;
}

export function selectedModel() {
  return modelById(ctx.state.modelSel) || ctx.state.models[0] || null;
}

function normOf(meshId) {
  if (!norms.has(meshId)) norms.set(meshId, M.normalizer(meshes.get(meshId)));
  return norms.get(meshId);
}

function matrixOf(model) {
  return M.fitMatrix(normOf(model.mesh), model.fit);
}

function quadCount(meshId) {
  if (!quadCounts.has(meshId)) {
    const mesh = meshes.get(meshId);
    quadCounts.set(meshId, M.quadsAndTriangles(mesh, mesh.pos).length);
  }
  return quadCounts.get(meshId);
}

// The mesh in block space, with the winding fixed if the fit mirrors it.
function placedMesh(model) {
  const mesh = meshes.get(model.mesh);
  if (!mesh) return null;
  const p = M.placed(mesh, matrixOf(model));
  let idx = mesh.idx;
  if (p.flip) {
    idx = new Uint32Array(mesh.idx);
    for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  }
  return { pos: p.pos, nrm: p.nrm, uv: mesh.uv, idx, mat: mesh.mat };
}

function solidImage(color, size = 16) {
  const img = new ImageData(size, size);
  const c = color.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255));
  for (let i = 0; i < img.data.length; i += 4) img.data.set([c[0], c[1], c[2], 255], i);
  return img;
}

function resizeImage(img, w, h) {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d').putImageData(img instanceof ImageData ? img : new ImageData(img.data, img.width, img.height), 0, 0);
  const d = document.createElement('canvas');
  d.width = w;
  d.height = h;
  const g = d.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(c, 0, 0, w, h);
  return g.getImageData(0, 0, w, h);
}

// How shiny a material is with a Lit shader (see pbr.js SURFACES). Models
// saved before material maps existed have no surface: maps if the file had
// them, matte otherwise.
export function surfaceOf(model, i) {
  const mesh = meshes.get(model.mesh);
  const s = model.mats[i]?.surface;
  if (s === 'file') return mesh?.materials[i]?.maps ? 'file' : 'matte';
  if (s && PBR.SURFACES[s]) return s;
  return mesh?.materials[i]?.maps ? 'file' : 'matte';
}

// Normal and specular maps (LabPBR) for one material, from the model file:
// PNG bytes made at import from its normal, metal/roughness and emission maps.
// glowTint is the colour texture with glowing pixels tinted to their glow.
async function buildMaps(info, albedo, getImage) {
  const imgs = {};
  for (const k of ['normal', 'occlusion', 'mr', 'rough', 'metal', 'emissive']) imgs[k] = await getImage(info[k]);
  let w, h;
  if (albedo) {
    [w, h] = [albedo.width, albedo.height];
  } else {
    const sides = Object.values(imgs).filter(Boolean).map((im) => Math.max(im.width, im.height));
    w = h = TX.snapSize(Math.max(16, ...sides));
  }
  const fit = (im) => (!im ? null : im.width === w && im.height === h ? im : resizeImage(im, w, h));
  let normal = fit(imgs.normal);
  if (normal && PBR.isGrayscale(normal)) normal = PBR.normalFromHeight(normal); // a bump map, not a normal map
  const r = PBR.toLabPbr({
    w, h, albedo, normal, normalScale: info.normalScale ?? 1,
    occlusion: fit(imgs.occlusion), occlusionStrength: info.occlusionStrength ?? 1,
    mr: fit(imgs.mr), rough: fit(imgs.rough), metal: fit(imgs.metal),
    metallic: info.metallic ?? 1, roughness: info.roughness ?? 1, hasMR: !!info.hasMR,
    emissive: fit(imgs.emissive), emissiveFactor: info.emissiveFactor || [0, 0, 0],
  });
  if (!r.n && !r.s) return null;
  return {
    n: r.n ? await encodePng(r.n, w, h) : null,
    s: r.s ? await encodePng(r.s, w, h) : null,
    glowTint: r.glowTint ? new ImageData(r.glowTint, w, h) : null,
  };
}

const pngSize = (bytes) => {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return [dv.getUint32(16), dv.getUint32(20)];
};

// A map's PNG at the colour texture's size (Iris lines maps up with it).
async function mapAtSize(bytes, w, h, isNormal) {
  const [mw, mh] = pngSize(bytes);
  if (mw === w && mh === h) return bytes;
  const img = await decodePng(bytes);
  return encodePng(PBR.boxDownscale(img.data, img.width, img.height, w, h, isNormal), w, h);
}

function bytesToImage(bytes, mime) {
  return decodeImage(new Blob([bytes], { type: mime || 'image/png' }));
}

async function decodeImage(blob) {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const g = c.getContext('2d');
  g.drawImage(bmp, 0, 0);
  bmp.close?.();
  return g.getImageData(0, 0, c.width, c.height);
}

// Meshes without UVs get one small palette texture: each material reads the
// centre of its own 4x4 cell.
function withPaletteUVs(mesh) {
  const b = M.meshBuilder();
  const seen = new Map();
  const cell = (m) => [((m % 4) * 4 + 2) / 16, (Math.floor(m / 4) % 4 * 4 + 2) / 16];
  for (let t = 0; t < mesh.mat.length; t++) {
    const m = mesh.mat[t];
    const ids = [0, 1, 2].map((k) => {
      const v = mesh.idx[t * 3 + k];
      const key = v * 65536 + m;
      if (!seen.has(key)) {
        const n = mesh.nrm ? [mesh.nrm[v * 3], mesh.nrm[v * 3 + 1], mesh.nrm[v * 3 + 2]] : null;
        seen.set(key, b.vertex([mesh.pos[v * 3], mesh.pos[v * 3 + 1], mesh.pos[v * 3 + 2]], cell(m), n));
      }
      return seen.get(key);
    });
    b.tri(ids[0], ids[1], ids[2], m);
  }
  const out = b.build(mesh.materials);
  const img = new ImageData(16, 16);
  mesh.materials.forEach((mat, i) => {
    if (i >= 16) return;
    const c = (mat.color || [0.8, 0.8, 0.8]).map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255));
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) img.data.set([c[0], c[1], c[2], 255], (((Math.floor(i / 4)) * 4 + y) * 16 + (i % 4) * 4 + x) * 4);
  });
  return { mesh: out, palette: img };
}

// --------------------------------------------------------------- create

function addModel(mesh, { name, use = 'custom', target = '', base = 'minecraft:stick', hold = 'item', texFor = [], glowFor = [], surfaceFor = [] }) {
  const meshId = newMeshId();
  storeMesh(meshId, mesh);
  const model = {
    id: `m${ctx.state.modelNext++}`,
    name: uniqueName(name),
    mesh: meshId,
    use,
    target,
    base,
    hold,
    facing: false,
    fit: { ...M.DEFAULT_FIT, r: [0, 0, 0], t: [0, 0, 0] },
    mats: mesh.materials.map((m, i) => ({ name: m.name, tex: texFor[i] || '', glow: !!(glowFor[i] ?? m.glow), surface: surfaceFor[i] || (m.maps ? 'file' : 'matte') })),
  };
  model.fit = poseFit(model, mesh);
  ctx.state.models.push(model);
  ctx.state.modelSel = model.id;
  return model;
}

function poseFit(model, mesh = meshes.get(model.mesh)) {
  if (model.use === 'mob') {
    // As tall as the mob, standing on the floor, centred on the block.
    const fit = { s: M.mobScale(mesh, M.rigOf(model.target).height), r: [0, 0, 0], t: [0, 0, 0] };
    return M.sitOnFloor(mesh, normOf(model.mesh), fit);
  }
  if (model.use === 'armor') {
    // On the matching part of a humanoid, a little bigger than it.
    const [c, size] = ARMOR_SLOTS[armorSlot(model.target)];
    return { s: size, r: [0, 0, 0], t: [c[0], c[1] - 0.5, c[2]] };
  }
  const kind = HOLDS[model.hold]?.fit || 'item';
  let fit = M.presetFit(kind, mesh);
  if (kind === 'block') fit = M.sitOnFloor(mesh, normOf(model.mesh), fit);
  return fit;
}

function addSampleTextures(textures, modelName) {
  return textures.map((t) => {
    const img = new ImageData(new Uint8ClampedArray(t.data), t.size, t.size);
    return TX.addImageTexture(img, `${modelName} texture`).id;
  });
}

export function addSample(kind) {
  if (kind === 'crystal') {
    const s = M.sampleCrystal();
    const tex = addSampleTextures(s.textures, 'Crystal');
    addModel(s.mesh, { name: 'Crystal', use: 'block', target: 'minecraft:flower_pot', hold: 'block', texFor: [tex[0], tex[0]], surfaceFor: ['gem', 'gem'] });
  } else {
    const s = M.sampleSword();
    const tex = addSampleTextures(s.textures, 'Sword');
    addModel(s.mesh, { name: 'Sword', use: 'item', target: 'minecraft:diamond_sword', hold: 'sword', texFor: [tex[0]] });
  }
  afterChange(true);
}

// Imports a 3D file. `files` may also hold its .mtl, .bin and image files.
// `defaults` sets what the model is for (use, target, hold) right away.
export async function importFiles(fileList, defaults = {}) {
  const files = [...fileList];
  const byName = new Map(files.map((f) => [f.name.toLowerCase(), f]));
  const find = (name) => (name ? byName.get(String(name).toLowerCase().split('/').pop()) : null);
  const main = files.find((f) => /\.(glb|gltf|obj)$/i.test(f.name));
  if (!main) {
    if (files.some((f) => /\.blend\d?$/i.test(f.name))) throw new Error('Blender files cannot be read in the browser. In Blender use File → Export → glTF 2.0 (.glb), then import the .glb here.');
    throw new Error('Pick a .obj, .glb or .gltf file (with its .mtl, .bin and textures if it has them).');
  }
  const name = main.name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim().slice(0, 40) || 'Model';

  let mesh, imageSources = []; // per our image index: () => Promise<ImageData>
  if (/\.obj$/i.test(main.name)) {
    const mtlFile = files.find((f) => /\.mtl$/i.test(f.name));
    const mtl = mtlFile ? M.parseMtl(await mtlFile.text()) : {};
    mesh = M.meshFromObj(await main.text(), mtl);
    mesh.materials.forEach((m) => {
      const f = find(m.file);
      if (f) m.image = imageSources.push(() => decodeImage(f)) - 1;
    });
  } else {
    let json, buffers = [];
    if (/\.glb$/i.test(main.name)) {
      const g = M.parseGlb(await main.arrayBuffer());
      json = g.json;
      buffers = [g.bin];
    } else {
      json = JSON.parse(await main.text());
      for (const [i, bf] of (json.buffers || []).entries()) {
        if (bf.uri && !bf.uri.startsWith('data:')) {
          const f = find(decodeURIComponent(bf.uri));
          if (!f) throw new Error(`This .gltf needs ${bf.uri}. Pick it together with the .gltf file.`);
          buffers[i] = await f.arrayBuffer();
        }
      }
    }
    const r = M.meshFromGltf(json, buffers);
    mesh = r.mesh;
    imageSources = r.images.map((im) => {
      if (im.bytes) return () => bytesToImage(im.bytes, im.mime);
      const f = find(im.uri);
      return f ? () => decodeImage(f) : null;
    });
  }

  // Textures: one per image, shared by the materials using it.
  const texOfImage = new Map();
  const texFor = [];
  let missing = 0, missingMaps = 0, withMaps = 0;
  const noUv = !mesh.uv;
  if (noUv) {
    const p = withPaletteUVs(mesh);
    mesh = p.mesh;
    const t = TX.addImageTexture(p.palette, `${name} colours`);
    mesh.materials.forEach((_, i) => { texFor[i] = t.id; });
  } else {
    // Images by glTF index or OBJ file name, each decoded once.
    const decoded = new Map();
    const getImage = async (ref) => {
      if (ref === undefined || ref === null || ref === -1) return null;
      if (!decoded.has(ref)) {
        const f = typeof ref === 'string' ? find(ref) : null;
        const src = typeof ref === 'number' ? imageSources[ref] : f ? () => decodeImage(f) : null;
        let img = null;
        try {
          img = src ? await src() : null;
        } catch { /* unreadable: treated as missing */ }
        if (!img) missingMaps++;
        decoded.set(ref, img);
      }
      return decoded.get(ref);
    };
    for (const [i, m] of mesh.materials.entries()) {
      const info = m.pbr || m.pbrFiles || null;
      delete m.pbr;
      delete m.pbrFiles;
      let albedo = null;
      if (m.image >= 0 && imageSources[m.image]) {
        try {
          albedo = await imageSources[m.image]();
        } catch { /* falls back to a plain colour */ }
      } else if (m.image >= 0 || m.file) {
        missing++;
      }
      if (albedo) albedo = TX.fitToSize(albedo);
      // Normal, roughness, metal and glow become maps for shaders. A glowing
      // material gets its own copy of the colour texture, tinted to the glow.
      let tint = null;
      if (info) {
        try {
          const maps = await buildMaps(info, albedo, getImage);
          if (maps) {
            m.maps = { n: maps.n, s: maps.s };
            tint = maps.glowTint;
            withMaps++;
          }
        } catch (err) {
          console.warn(`Material maps for ${m.name}:`, err);
        }
      }
      let t = null;
      if (albedo) {
        const key = tint ? `glow:${i}` : m.image;
        if (!texOfImage.has(key)) texOfImage.set(key, TX.addImageTexture(tint || albedo, `${name} ${m.name}`.slice(0, 40)).id);
        t = texOfImage.get(key);
      }
      if (!t) t = TX.addImageTexture(solidImage(m.color || [0.8, 0.8, 0.8]), `${name} ${m.name}`.slice(0, 40)).id;
      texFor[i] = t;
    }
  }
  const model = addModel(mesh, { name, use: 'custom', hold: 'item', texFor, ...defaults });
  afterChange(true);
  const tris = mesh.mat.length.toLocaleString('en');
  let msg = `Imported “${model.name}”: ${tris} triangles, ${mesh.materials.length} material${mesh.materials.length === 1 ? '' : 's'}.`;
  if (missing) msg += ` ${missing} texture file${missing === 1 ? ' was' : 's were'} not picked, so plain colours stand in. Pick the images with the model, or paint them in Textures.`;
  if (noUv) msg += ' It had no UVs, so each material got a flat colour.';
  if (withMaps) msg += ` ${withMaps} material${withMaps === 1 ? ' has' : 's have'} normal and shine maps for Lit shaders (Material Maps node).`;
  if (missingMaps) msg += ` ${missingMaps} normal, roughness, metal or glow map${missingMaps === 1 ? ' was' : 's were'} not picked, so ${missingMaps === 1 ? 'it was' : 'they were'} left out.`;
  ctx.toast(msg);
  return model;
}

// Samples that ship as files next to the app (app/samples).
const FILE_SAMPLES = {
  sting: { url: 'samples/sting.glb', file: 'Sting.glb', use: 'item', target: 'minecraft:netherite_sword', hold: 'sword' },
};

// Some hosts only serve web file types, so the sample may sit next to the
// .glb as base64 text (sting.glb.b64.txt) instead.
async function fetchSample(url) {
  const res = await fetch(url).catch(() => null);
  if (res?.ok && !/text\/html/.test(res.headers.get('content-type') || '')) return res.blob();
  const txt = await fetch(`${url}.b64.txt`).catch(() => null);
  if (!txt?.ok) return null;
  const s = atob((await txt.text()).trim());
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new Blob([bytes], { type: 'model/gltf-binary' });
}

export async function addFileSample(kind) {
  const s = FILE_SAMPLES[kind];
  const blob = await fetchSample(s.url);
  if (!blob) throw new Error(`Could not load the ${s.file} sample.`);
  return importFiles([new File([blob], s.file)], { use: s.use, target: s.target, hold: s.hold });
}

export function removeModel(id) {
  ctx.state.models = ctx.state.models.filter((m) => m.id !== id);
  if (ctx.state.modelSel === id) ctx.state.modelSel = ctx.state.models[0]?.id || null;
}

// --------------------------------------------------------- views + preview

function materialViews(model) {
  const mesh = meshes.get(model.mesh);
  return model.mats.map((mat, i) => ({
    img: (mat.tex && TX.bakedImage(mat.tex)) || null,
    color: mesh?.materials[i]?.color || [0.8, 0.8, 0.8],
    glow: mat.glow,
  }));
}

function updateStage() {
  const stage = $('#model-stage');
  if (!stage) return;
  const m = selectedModel();
  const has = !!(m && meshes.get(m.mesh));
  $('#model-empty').hidden = !!m;
  $('#model-hud').hidden = !m;
  $('#model-missing').hidden = !m || has;
  if (!view) return;
  if (!has) {
    view.setModel(null, []);
    return;
  }
  const entity = m.use === 'mob' || m.use === 'armor';
  view.setOptions(entity
    ? { guide: 'mob', boxes: Object.values((m.use === 'armor' ? M.RIGS.humanoid : M.rigOf(m.target)).parts) }
    : { guide: HOLDS[m.hold]?.guide || 'block', boxes: null });
  view.setModel(placedMesh(m), materialViews(m));
  $('#model-title').textContent = m.name;
  const mesh = meshes.get(m.mesh);
  $('#model-sub').textContent = `${mesh.mat.length.toLocaleString('en')} triangles · ${quadCount(m.mesh).toLocaleString('en')} quads in game`;
  const g = entity ? 'mob' : HOLDS[m.hold]?.guide;
  $('#model-legend').textContent = g === 'mob'
    ? 'Gold boxes: the body parts of the vanilla model. The arrow points to the front. One block is the blue box.'
    : g === 'sword' || g === 'item'
    ? 'Blue box: one block. Gold square: where a vanilla item sprite sits.'
    : g === 'shield' ? 'Blue box: one block. Gold outline: the vanilla shield plate.' : 'Blue box: one block.';
}

// Shows the selected model in the live preview, the way the game draws it: a
// block model stands on the grass under the Blocks shader (Block Type →
// Custom Models is 1 on it); an item model is held in first person under the
// Items & Entities shader, in place of the sample sword (or shield).
function updatePreview() {
  const preview = ctx.preview;
  if (!preview?.ok) return;
  const m = selectedModel();
  const pm = m && placedMesh(m);
  if (!pm) {
    preview.setModel(null);
    preview.setHeldModel?.(null);
    preview.setMobModel?.(null);
    preview.setArmorModel?.(null);
    for (const t of shownTiles) preview.setTileOverride(t, null);
    shownTiles.clear();
    showTileMaps(new Map());
    return;
  }
  const mats = materialViews(m);
  const tileOfTex = new Map();
  const free = [...MODEL_TILES];
  const needWhite = mats.some((x) => !x.img);
  const textured = [...new Set(m.mats.filter((x, i) => mats[i].img).map((x) => x.tex))];
  const room = free.length - (needWhite ? 1 : 0);
  textured.forEach((id, i) => tileOfTex.set(id, free[Math.min(i, room - 1)]));
  const whiteTile = needWhite ? free[free.length - 1] : -1;
  const used = new Set();
  for (const [id, tile] of tileOfTex) {
    if (used.has(tile)) continue;
    used.add(tile);
    preview.setTileOverride(tile, TX.bakedImage(id));
  }
  if (needWhite) {
    used.add(whiteTile);
    preview.setTileOverride(whiteTile, solidImage([1, 1, 1]));
  }
  for (const t of shownTiles) if (!used.has(t)) preview.setTileOverride(t, null);
  shownTiles.clear();
  for (const t of used) shownTiles.add(t);
  // Material maps on the same tiles, for the Material Maps node.
  const mapsOfTile = new Map();
  m.mats.forEach((x, i) => {
    const tile = mats[i].img ? tileOfTex.get(x.tex) : whiteTile;
    if (tile >= 0 && !mapsOfTile.has(tile)) mapsOfTile.set(tile, previewMaps(m, i));
  });
  showTileMaps(mapsOfTile);

  const worn = (m.use === 'mob' || m.use === 'armor') && !!preview.setMobModel;
  const held = !worn && m.use !== 'block' && !!preview.setHeldModel;
  // Mobs and armour are in feet space, on the preview zombie.
  const at = worn ? [-0.5, 0, -0.5] : held ? [-0.5, -0.5, -0.5] : MODEL_SPOT;
  const centre = [MODEL_SPOT[0] + 0.5, MODEL_SPOT[1] + 0.5, MODEL_SPOT[2] + 0.5];
  const [blockLight, sky] = held || worn ? [0, 1] : sceneLight(...centre);
  const tris = pm.mat.length;
  const data = new Float32Array(tris * 3 * 16);
  let o = 0;
  for (let t = 0; t < tris; t++) {
    const mi = pm.mat[t];
    const mat = mats[mi] || {};
    const tile = mat.img ? tileOfTex.get(m.mats[mi].tex) : whiteTile;
    const tint = mat.img ? [1, 1, 1] : mat.color || [0.8, 0.8, 0.8];
    const ids = [pm.idx[t * 3], pm.idx[t * 3 + 1], pm.idx[t * 3 + 2]];
    let fn = null;
    if (!pm.nrm) {
      const P = (i) => [pm.pos[i * 3], pm.pos[i * 3 + 1], pm.pos[i * 3 + 2]];
      const [a, b, c] = ids.map(P);
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      fn = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const l = Math.hypot(...fn) || 1;
      fn = fn.map((x) => x / l);
    }
    for (const i of ids) {
      const n = fn || [pm.nrm[i * 3], pm.nrm[i * 3 + 1], pm.nrm[i * 3 + 2]];
      const shade = Math.min(n[0] * n[0] * 0.6 + n[1] * n[1] * (n[1] > 0 ? 1 : 0.5) + n[2] * n[2] * 0.8, 1);
      const uv = atlasUV(tile, pm.uv ? pm.uv[i * 2] : 0.5, pm.uv ? pm.uv[i * 2 + 1] : 0.5);
      data.set([
        pm.pos[i * 3] + at[0], pm.pos[i * 3 + 1] + at[1], pm.pos[i * 3 + 2] + at[2],
        n[0], n[1], n[2], uv[0], uv[1],
        tint[0] * shade, tint[1] * shade, tint[2] * shade, 1,
        mat.glow ? 1 : blockLight, sky, held || worn ? 0 : 4, 0,
      ], o);
      o += 16;
    }
  }
  preview.setModel(!held && !worn ? data : null);
  preview.setHeldModel?.(held ? data : null, m.hold === 'shield' ? 'off' : 'main');
  preview.setMobModel?.(worn && m.use === 'mob' ? data : null);
  preview.setArmorModel?.(worn && m.use === 'armor' ? data : null);
}

// The maps one material shows in the preview: { key, n, s } with pixels, or
// null while a model file's maps are still being decoded.
function previewMaps(m, i) {
  const surface = surfaceOf(m, i);
  const glow = !!m.mats[i].glow;
  if (surface === 'file') {
    const id = `${m.mesh}:${i}`;
    const got = decodedMaps.get(id);
    if (got && got !== 'pending') return { key: `${id}:file`, ...got };
    if (!got) {
      decodedMaps.set(id, 'pending');
      const maps = meshes.get(m.mesh)?.materials[i]?.maps || {};
      Promise.all([maps.n ? decodePng(maps.n) : null, maps.s ? decodePng(maps.s) : null])
        .then(([n, s]) => decodedMaps.set(id, { n, s }))
        .catch(() => decodedMaps.set(id, { n: null, s: null }))
        .then(() => updatePreview());
    }
    return { key: 'flat', n: null, s: null };
  }
  const px = PBR.flatSpecular(surface, glow);
  return { key: `${surface}:${glow}`, n: null, s: px ? { data: PBR.solidMap(px, 4, 4), width: 4, height: 4 } : null };
}

function showTileMaps(mapsOfTile) {
  const preview = ctx.preview;
  for (const [tile, key] of shownPbr) {
    if (!mapsOfTile.has(tile) && key !== 'flat') preview.setTilePbr?.(tile, null, null);
  }
  for (const [tile, maps] of mapsOfTile) {
    if (shownPbr.get(tile) === maps.key) continue;
    preview.setTilePbr?.(tile, maps.n, maps.s);
  }
  shownPbr.clear();
  for (const [tile, maps] of mapsOfTile) shownPbr.set(tile, maps.key);
}

export function refreshViews() {
  updateStage();
  updatePreview();
}

// Textures changed (painted, rebaked, deleted): redraw both views.
export function texturesChanged() {
  refreshViews();
  if (ctx.state.kind === 'model') renderProps();
}

function afterChange(rerender = false) {
  ctx.pushHistory();
  refreshViews();
  if (rerender) renderPanel();
  else renderList();
  ctx.onModelsChanged();
}

// --------------------------------------------------------------- textures

// Model names that use this texture, for the Textures tab.
export function usageOf(texId) {
  return ctx.state.models.filter((m) => m.mats.some((x) => x.tex === texId)).map((m) => m.name);
}

// UV edges of every face that uses this texture, as x0, y0, x1, y1 in 0..1
// image space. The Textures tab draws them over the canvas while you paint.
export function uvSegments(texId) {
  const out = [];
  for (const m of ctx.state.models) {
    const mesh = meshes.get(m.mesh);
    if (!mesh?.uv) continue;
    const mats = new Set();
    m.mats.forEach((x, i) => { if (x.tex === texId) mats.add(i); });
    if (!mats.size) continue;
    for (let t = 0; t < mesh.mat.length && out.length < 400000; t++) {
      if (!mats.has(mesh.mat[t])) continue;
      for (let k = 0; k < 3; k++) {
        const a = mesh.idx[t * 3 + k], b = mesh.idx[t * 3 + ((k + 1) % 3)];
        out.push(mesh.uv[a * 2], mesh.uv[a * 2 + 1], mesh.uv[b * 2], mesh.uv[b * 2 + 1]);
      }
    }
  }
  return out.length ? out : null;
}

// ------------------------------------------------------------------ panel

export function renderPanel() {
  const card = $('#model-card');
  if (!card) return;
  card.hidden = ctx.state.kind !== 'model';
  if (card.hidden) return;
  renderList();
  renderProps();
  updateStage();
}

function useSummary(m, keys) {
  const ns = packNamespace(ctx.state.packName);
  if (m.use === 'item') return `replaces ${(fullId(m.target) || '?').replace('minecraft:', '')}`;
  if (m.use === 'block') return `block ${(fullId(m.target) || '?').replace('minecraft:', '')}`;
  if (m.use === 'mob') return `mob ${(fullId(m.target) || '?').replace('minecraft:', '')}`;
  if (m.use === 'armor') return `armour ${(fullId(m.target) || '?').replace('minecraft:', '')}`;
  return `${ns}:${keys.get(m.id)}`;
}

function renderList() {
  const list = $('#model-list');
  if (!list || ctx.state.kind !== 'model') return;
  list.textContent = '';
  const keys = modelKeys();
  const sel = selectedModel();
  for (const m of ctx.state.models) {
    const b = el('button', 'tex-item model-item');
    b.type = 'button';
    b.setAttribute('role', 'option');
    const on = sel?.id === m.id;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
    const icon = el('span', 'model-icon');
    icon.innerHTML = m.use === 'block'
      ? '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5 14 4.8v6.4L8 14.5 2 11.2V4.8Z M2 4.8 8 8l6-3.2M8 8v6.5"/></svg>'
      : '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 2.5 6 10M13.5 2.5l-1 3.5M13.5 2.5 10 3.5M4 9l3 3M5.5 10.5 2.5 13.5"/></svg>';
    const meta = el('span', 'tex-meta');
    meta.append(el('span', 'tex-name', m.name), el('span', 'tex-target', useSummary(m, keys)));
    b.append(icon, meta);
    b.addEventListener('click', () => select(m.id));
    list.append(b);
  }
}

export function select(id) {
  ctx.state.modelSel = id;
  renderPanel();
  updatePreview();
  view?.home();
  ctx.save();
}

function field(label, control, hint, cls = '') {
  // A label only around a single input: a label around buttons would click the first one.
  const f = el(control.matches?.('input, select, textarea') ? 'label' : 'div', `field ${cls}`.trim());
  f.append(el('span', 'field-label', label), control);
  if (hint) f.append(typeof hint === 'string' ? el('span', 'field-hint', hint) : hint);
  return f;
}

function num(value, step, onCommit, label) {
  const i = el('input', 'in-num');
  i.type = 'number';
  i.step = step;
  i.value = Math.round(Number(value) * 1000) / 1000;
  i.setAttribute('aria-label', label);
  i.addEventListener('change', () => {
    const v = Number(i.value);
    if (Number.isFinite(v)) onCommit(v);
  });
  return i;
}

function datalist(id, values) {
  let dl = document.getElementById(id);
  if (dl) return dl;
  dl = el('datalist');
  dl.id = id;
  for (const v of values) {
    const o = el('option');
    o.value = v;
    dl.append(o);
  }
  document.body.append(dl);
  return dl;
}

function copyButton(text) {
  const b = el('button', 'btn ghost small', 'Copy');
  b.type = 'button';
  b.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      b.textContent = 'Copied';
      setTimeout(() => { b.textContent = 'Copy'; }, 1200);
    } catch {
      ctx.toast('Copy did not work here. Select the text and copy it by hand.');
    }
  });
  return b;
}

function targetNotes(m) {
  const id = fullId(m.target);
  const path = id ? id.split(':')[1] : '';
  const notes = [];
  let bad = false;
  if (!id) {
    notes.push({ block: 'Type a block id, like flower_pot.', mob: 'Type a mob id, like zombie.', armor: 'Type an armour item id, like diamond_helmet.' }[m.use] || 'Type an item id, like diamond_sword.');
    bad = true;
  } else if (m.use === 'mob') {
    notes.push(`Every ${path.replace(/_/g, ' ')} looks like this model, with the model's texture.`);
    if (Object.keys(M.rigOf(id).parts).length) notes.push('The parts of your model in each gold box move with that body part, so it walks and looks around like the vanilla mob.');
    else notes.push('BlockGraph has no body-part boxes for this mob yet, so the whole model turns and moves with its body, without walking animation.');
  } else if (m.use === 'armor') {
    notes.push(`Players, zombies, skeletons and other humanoids wearing ${path.replace(/_/g, ' ')} show this model. The parts in each gold box move with that body part.`);
  } else if (m.use === 'item') {
    notes.push(`Every ${path.replace(/_/g, ' ')} looks like this model, for everyone who has the mod and your resource pack.`);
    if (ITEM_NOTES[path]) notes.push(ITEM_NOTES[path]);
  } else if (m.use === 'block') {
    notes.push(`Every ${path.replace(/_/g, ' ')} in the world draws this model instead. Its hitbox stays the same.`);
    if (ENTITY_BLOCKS.test(path)) {
      notes.push('The model takes the place of its block entity renderer, so it stays still: no opening lid, sign text or banner pattern.');
    } else if (FULL_BLOCKS.test(path)) {
      notes.push('A full cube: with the model, neighbouring blocks keep drawing the faces that touch it, so there are no holes.');
    }
  }
  const h = el('span', `field-hint${bad ? ' bad' : ''}`, notes.join(' '));
  return h;
}

function renderProps() {
  const box = $('#model-props');
  if (!box) return;
  box.textContent = '';
  const m = selectedModel();
  if (!m) {
    box.append(el('p', 'field-hint', 'No models yet. Import a 3D file (OBJ, GLB or glTF) or start from a sample under New.'));
    return;
  }
  const mesh = meshes.get(m.mesh);
  const commit = (rerender = false) => afterChange(rerender);

  // name
  const name = el('input', 'in-text');
  name.value = m.name;
  name.maxLength = 40;
  name.setAttribute('aria-label', 'Model name');
  name.addEventListener('change', () => {
    m.name = name.value.trim().slice(0, 40) || m.name;
    commit(true);
  });
  box.append(field('Name', name));

  if (!mesh) {
    box.append(el('p', 'insp-error', 'The 3D data of this model is not in this browser any more. Open the graph file you saved it in, or import the model again.'));
  }

  // use
  const seg = el('div', 'seg');
  seg.setAttribute('role', 'radiogroup');
  seg.setAttribute('aria-label', 'Use the model for');
  for (const [k, label] of Object.entries(USES)) {
    const b = el('button', `seg-btn${m.use === k ? ' on' : ''}`, label);
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', m.use === k ? 'true' : 'false');
    b.addEventListener('click', () => {
      if (m.use === k) return;
      const was = m.use;
      m.use = k;
      if (k === 'block') {
        if (!fullId(m.target) || was !== 'block') m.target = 'minecraft:flower_pot';
        if (m.hold !== 'block') m.hold = 'block';
        m.turn = autoTurn(m.target);
      } else if (k === 'mob') {
        m.target = 'minecraft:zombie';
      } else if (k === 'armor') {
        m.target = 'minecraft:diamond_helmet';
      } else {
        if (!['item', 'custom'].includes(was) || !fullId(m.target)) m.target = 'minecraft:diamond_sword';
        if (!HOLDS[m.hold] || m.hold === 'block') m.hold = 'item';
      }
      if (mesh && (k !== was)) m.fit = poseFit(m);
      commit(true);
    });
    seg.append(b);
  }
  box.append(field('Use it for', seg));

  // target
  if (m.use === 'custom') {
    const ns = packNamespace(ctx.state.packName);
    const key = modelKeys().get(m.id);
    const id = `${ns}:${key}`;
    const baseIn = el('input', 'in-text mono');
    baseIn.value = (fullId(m.base) || 'minecraft:stick').replace('minecraft:', '');
    baseIn.setAttribute('list', 'model-items');
    baseIn.spellcheck = false;
    datalist('model-items', ITEMS);
    baseIn.addEventListener('change', () => {
      const v = fullId(baseIn.value);
      if (!v) { ctx.toast('Use an item id like stick or diamond_sword.'); baseIn.value = m.base; return; }
      m.base = v;
      commit(true);
    });
    box.append(field('Item it is given as', baseIn, `New model id: ${id}. Nothing changes until you give an item this model, so other items stay vanilla.`));
    const give = `/give @p ${fullId(m.base) || 'minecraft:stick'}[minecraft:item_model="${id}"]`;
    const show = `/summon minecraft:item_display ~ ~1 ~ {item:{id:"${fullId(m.base) || 'minecraft:stick'}",count:1,components:{"minecraft:item_model":"${id}"}},transformation:{left_rotation:[0f,0f,0f,1f],right_rotation:[0f,0f,0f,1f],translation:[0f,0f,0f],scale:[2f,2f,2f]}}`;
    for (const [label, cmd, hint] of [
      ['Give it', give, 'Works on any server where you can run commands, and in single player.'],
      ['Show it in the world (item display, any size)', show, 'Change scale to make it bigger. Item displays can also be turned with left_rotation.'],
    ]) {
      const row = el('div', 'cmd-row');
      const code = el('code', 'cmd', cmd);
      row.append(code, copyButton(cmd));
      box.append(field(label, row, hint));
    }
  } else {
    const t = el('input', 'in-text mono');
    t.value = (m.target || '').replace(/^minecraft:/, '');
    const kind = { block: ['flower_pot', 'model-blocks', 'Block'], mob: ['zombie', 'model-mobs', 'Mob'], armor: ['diamond_helmet', 'model-armor', 'Armour item'] }[m.use] || ['diamond_sword', 'model-items', 'Item'];
    t.placeholder = kind[0];
    t.spellcheck = false;
    t.setAttribute('list', kind[1]);
    datalist('model-items', ITEMS);
    datalist('model-blocks', BLOCKS);
    datalist('model-mobs', MOBS);
    datalist('model-armor', ARMORS);
    t.addEventListener('change', () => {
      const v = fullId(t.value);
      if (!v) { ctx.toast('Use lowercase letters, numbers and _ like diamond_sword.'); t.value = m.target.replace(/^minecraft:/, ''); return; }
      const was = m.target;
      m.target = v;
      if (m.use === 'item' && v === 'minecraft:shield' && m.hold !== 'shield') m.hold = 'shield';
      if (m.use === 'block') m.turn = autoTurn(v);
      // A different mob or armour slot: refit to its size.
      if (mesh && ((m.use === 'mob' && M.rigOf(was) !== M.rigOf(v)) || (m.use === 'armor' && armorSlot(was) !== armorSlot(v)))) m.fit = poseFit(m);
      commit(true);
    });
    box.append(field(kind[2], t, targetNotes(m)));
    if (m.use === 'block') {
      const turn = el('select', 'in-select');
      turn.setAttribute('aria-label', 'Turn with the block');
      for (const [k, label] of Object.entries(TURNS)) {
        const o = el('option', null, label);
        o.value = k;
        turn.append(o);
      }
      turn.value = turnOf(m);
      turn.addEventListener('change', () => { m.turn = turn.value; m.facing = turn.value === 'facing'; commit(); });
      box.append(field('Turn with the block', turn, turnOf(m) === 'bed'
        ? 'Model the whole bed facing north: the pillow end in the blue block, the foot end one block towards +Z.'
        : 'Model it facing north (towards -Z). The game turns it to match each block.'));
    }
  }

  // hold
  if (m.use === 'item' || m.use === 'custom') {
    const hold = el('select', 'in-select');
    hold.setAttribute('aria-label', 'Hold like');
    for (const [k, h] of Object.entries(HOLDS)) {
      if (k === 'block') continue;
      const o = el('option', null, h.label);
      o.value = k;
      hold.append(o);
    }
    hold.value = m.hold;
    hold.addEventListener('change', () => {
      m.hold = hold.value;
      if (mesh) m.fit = poseFit(m);
      commit(true);
    });
    box.append(field('Hold like', hold, HOLDS[m.hold]?.hint));
  }

  // fit
  if (mesh) {
    const fitBox = el('div', 'fit-box');
    const set = (f) => { m.fit = f; commit(true); };
    const sRow = el('div', 'fit-row');
    sRow.append(el('span', 'fit-label', 'Size'), num(m.fit.s, 0.05, (v) => set({ ...m.fit, s: Math.max(0.01, v) }), 'Size, 1 = one block'));
    const rRow = el('div', 'fit-row');
    rRow.append(el('span', 'fit-label', 'Turn °'));
    const rv = el('div', 'vec-inputs');
    ['X', 'Y', 'Z'].forEach((a, i) => rv.append(num(m.fit.r[i], 15, (v) => { const r = m.fit.r.slice(); r[i] = v; set({ ...m.fit, r }); }, `Turn around ${a} in degrees`)));
    rRow.append(rv);
    const tRow = el('div', 'fit-row');
    tRow.append(el('span', 'fit-label', 'Move'));
    const tv = el('div', 'vec-inputs');
    ['X', 'Y', 'Z'].forEach((a, i) => tv.append(num(m.fit.t[i], 1 / 16, (v) => { const t = m.fit.t.slice(); t[i] = v; set({ ...m.fit, t }); }, `Move along ${a} in blocks`)));
    tRow.append(tv);
    fitBox.append(sRow, rRow, tRow);
    const acts = el('div', 'fit-acts');
    const btn = (label, title, fn) => {
      const b = el('button', 'btn ghost small', label);
      b.type = 'button';
      b.title = title;
      b.addEventListener('click', fn);
      acts.append(b);
    };
    if (m.use === 'mob') {
      btn('Fit to the mob', 'As tall as the mob, standing on the floor in the middle of the block', () => set(poseFit(m)));
      btn('Face front', 'Turn it 90° at a time until its front points along the arrow (+Z)', () => { const r = m.fit.r.slice(); r[1] = ((r[1] + 90 + 180) % 360) - 180; set({ ...m.fit, r }); });
    } else if (m.use === 'armor') {
      btn('Fit to the body part', 'Size and place it on the head, body, legs or feet, from the armour item', () => set(poseFit(m)));
    } else {
      const holdName = (HOLDS[m.hold]?.label || 'item').split(' (')[0].toLowerCase();
      btn(`Pose as ${holdName}`, 'Size and turn the model for this hold, with its longest side along the pose', () => set(poseFit(m)));
    }
    btn('Sit on floor', 'Move it so its lowest point touches the bottom of the block', () => set(M.sitOnFloor(mesh, normOf(m.mesh), m.fit)));
    for (const [i, a] of [[0, 'X'], [1, 'Y'], [2, 'Z']]) {
      btn(`↻ ${a}`, `Turn 90° around ${a}`, () => { const r = m.fit.r.slice(); r[i] = ((r[i] + 90 + 180) % 360) - 180; set({ ...m.fit, r }); });
    }
    btn('Flip ends', 'Turn it 180°, for example when the tip of a sword points the wrong way', () => { const r = m.fit.r.slice(); r[2] = ((r[2] + 180 + 180) % 360) - 180; set({ ...m.fit, r }); });
    fitBox.append(acts);
    box.append(field('Fit into the block', fitBox, 'One block is 0 to 1. The middle view shows the block and where Minecraft expects the model.'));
  }

  // materials
  if (mesh) {
    const mats = el('div', 'mat-list');
    m.mats.forEach((mat, i) => {
      const row = el('div', 'mat-row');
      const thumb = el('canvas', 'tex-thumb');
      thumb.width = thumb.height = 32;
      const img = mat.tex && TX.bakedImage(mat.tex);
      const g = thumb.getContext('2d');
      if (img) {
        const tmp = document.createElement('canvas');
        tmp.width = img.width;
        tmp.height = img.height;
        tmp.getContext('2d').putImageData(img, 0, 0);
        g.imageSmoothingEnabled = false;
        g.drawImage(tmp, 0, 0, 32, 32);
      } else {
        const c = (mesh.materials[i]?.color || [0.8, 0.8, 0.8]).map((v) => Math.round(v * 255));
        g.fillStyle = `rgb(${c.join(',')})`;
        g.fillRect(0, 0, 32, 32);
      }
      const body = el('div', 'mat-body');
      body.append(el('span', 'mat-name', mat.name));
      const sel = el('select', 'in-select');
      sel.setAttribute('aria-label', `Texture for ${mat.name}`);
      const none = el('option', null, 'Plain colour (no texture)');
      none.value = '';
      sel.append(none);
      for (const t of ctx.state.textures) {
        const o = el('option', null, t.name);
        o.value = t.id;
        sel.append(o);
      }
      const fresh = el('option', null, '+ New blank texture');
      fresh.value = '__new';
      sel.append(fresh);
      sel.value = mat.tex && TX.texById(mat.tex) ? mat.tex : '';
      sel.addEventListener('change', () => {
        if (sel.value === '__new') {
          const t = TX.addImageTexture(solidImage(mesh.materials[i]?.color || [0.8, 0.8, 0.8], 32), `${m.name} ${mat.name}`.slice(0, 40));
          mat.tex = t.id;
        } else {
          mat.tex = sel.value;
        }
        commit(true);
      });
      body.append(sel);
      const surf = el('select', 'in-select');
      surf.setAttribute('aria-label', `Surface of ${mat.name}`);
      surf.title = 'How it shines with Lit lighting in your shader: normal map, smoothness, metal and glow (written as LabPBR _n and _s textures)';
      for (const [k, v] of Object.entries(PBR.SURFACES)) {
        if (k === 'file' && !mesh.materials[i]?.maps) continue;
        const o = el('option', null, k === 'file' ? `Surface: ${v.label} (normal + shine maps)` : `Surface: ${v.label}`);
        o.value = k;
        surf.append(o);
      }
      surf.value = surfaceOf(m, i);
      surf.addEventListener('change', () => { mat.surface = surf.value; commit(); });
      body.append(surf);
      const side = el('div', 'mat-side');
      const sw = el('label', 'ctl-switch small');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = mat.glow;
      cb.addEventListener('change', () => { mat.glow = cb.checked; commit(); });
      sw.append(cb, el('span', 'switch'), el('span', null, 'Glow'));
      sw.title = 'Full brightness, even in the dark (lamps, crystals, runes)';
      side.append(sw);
      if (mat.tex && TX.texById(mat.tex)) {
        const paint = el('button', 'btn ghost small', 'Paint');
        paint.type = 'button';
        paint.title = 'Open this texture in the Textures tab, with the model’s UVs drawn on top';
        paint.addEventListener('click', () => ctx.editTexture(mat.tex));
        side.append(paint);
      }
      row.append(thumb, body, side);
      row.addEventListener('pointerenter', () => view?.setHighlight(i));
      row.addEventListener('pointerleave', () => view?.setHighlight(-1));
      mats.append(row);
    });
    box.append(field(`Materials (${m.mats.length})`, mats, 'Textures come from the Textures tab, so you can paint them there. They go into the resource pack with the model. Surface sets how shiny each part is under a Lit shader (the Realistic preset reads it through Material Maps).'));

    const quads = quadCount(m.mesh);
    const stats = el('p', 'field-hint');
    stats.textContent = `${mesh.mat.length.toLocaleString('en')} triangles, ${quads.toLocaleString('en')} quads in game.`;
    if (m.use === 'block' && quads > 3000) {
      stats.classList.add('bad');
      stats.textContent += ' Heavy for a block: every copy in the world draws all of them. Fine for a few, slow for thousands.';
    } else if (quads > 30000) {
      stats.classList.add('bad');
      stats.textContent += ' Very detailed. Expect lower FPS where many are on screen.';
    }
    box.append(stats);
  }

  if (m.use !== 'block') {
    box.append(el('p', 'field-hint', 'In game, items in hand, on the ground and in item displays are drawn with your Items & Entities graph, so the live preview shows this model in your hand with it. Models used as blocks get the Blocks graph instead (Block Type \u2192 Custom Models).'));
  }

  const acts = el('div', 'tex-row');
  const dup = el('button', 'btn ghost small', 'Duplicate');
  dup.type = 'button';
  dup.addEventListener('click', () => {
    const copy = JSON.parse(JSON.stringify(m));
    copy.id = `m${ctx.state.modelNext++}`;
    copy.name = uniqueName(m.name);
    if (copy.use !== 'custom') copy.use = 'custom';
    ctx.state.models.push(copy);
    ctx.state.modelSel = copy.id;
    commit(true);
  });
  const del = el('button', 'btn danger small', 'Delete model');
  del.type = 'button';
  del.addEventListener('click', () => {
    removeModel(m.id);
    commit(true);
    ctx.toast(`Deleted “${m.name}”. Undo brings it back.`);
  });
  acts.append(dup, del);
  box.append(acts);
}

// ----------------------------------------------------------------- export

// Blocks that use a model, for the shader pack's block.properties.
export function modelBlocks() {
  const out = new Set();
  for (const m of ctx.state.models) {
    if (m.use !== 'block' || !meshes.has(m.mesh)) continue;
    const id = fullId(m.target);
    if (id) out.add(id.replace(/^minecraft:/, ''));
  }
  return [...out];
}

export function modelCount() {
  return ctx.state.models.filter((m) => meshes.has(m.mesh)).length;
}

function slotNames(mats) {
  const used = new Set(['particle']);
  return mats.map((mat, i) => {
    let s = String(mat.name || '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || `material_${i}`;
    if (/^\d/.test(s)) s = `m_${s}`;
    let k = s, n = 2;
    while (used.has(k)) k = `${s}_${n++}`;
    used.add(k);
    return k;
  });
}

const json = (o) => JSON.stringify(o, null, 2) + '\n';

// A vanilla box around the model, in 0..16 pixels (vanilla allows -16..32).
function fallbackBox(b) {
  const px = (v) => Math.round(Math.max(-16, Math.min(32, v * 16)) * 100) / 100;
  const from = b.min.map(px), to = b.max.map(px);
  for (let k = 0; k < 3; k++) if (to[k] - from[k] < 0.5) to[k] = Math.min(32, from[k] + 0.5);
  const face = { texture: '#particle' };
  return { from, to, faces: { north: face, east: face, south: face, west: face, up: face, down: face } };
}

// Every file the models add to the resource pack. `ns` is the pack's namespace.
export async function modelPackFiles(ns) {
  const files = {};
  const problems = [];
  const keys = modelKeys();
  const texKeys = new Map();
  const usedTexKeys = new Set();
  const mapsWritten = new Set();
  const itemDefs = new Map(); // item id -> model, to spot two models on one item
  const blockDefs = new Map();
  const entityDefs = new Map();
  for (const m of ctx.state.models) {
    const mesh = meshes.get(m.mesh);
    if (!mesh) {
      problems.push(`“${m.name}” has no 3D data in this browser, so it was left out.`);
      continue;
    }
    const key = keys.get(m.id);
    if (m.use === 'mob' || m.use === 'armor') {
      await entityPackFiles(m, mesh, ns, key, files, problems, entityDefs);
      continue;
    }
    const dir = m.use === 'block' ? 'block' : 'item';
    const hold = HOLDS[m.use === 'block' ? 'block' : m.hold] || HOLDS.item;
    const slots = slotNames(m.mats);
    const textures = {};
    for (const [i, mat] of m.mats.entries()) {
      const img = mat.tex && TX.bakedImage(mat.tex);
      if (!img) {
        textures[slots[i]] = 'minecraft:block/white_concrete';
        continue;
      }
      // Model textures always go to textures/block/, item models too. Since
      // 1.21.11 textures/item/ is a separate item atlas, and Sodium draws
      // mesh items with the block atlas, so item-atlas UVs would show
      // whatever block texture sits at the same spot (grass, leaves, wood).
      if (!texKeys.has(mat.tex)) {
        let k = slug(TX.texById(mat.tex)?.name || key), n = 2;
        const base = k;
        while (usedTexKeys.has(k)) k = `${base}_${n++}`;
        usedTexKeys.add(k);
        texKeys.set(mat.tex, k);
        files[`assets/${ns}/textures/block/${k}.png`] = await TX.imageDataToPng(img);
      }
      const k = texKeys.get(mat.tex);
      textures[slots[i]] = `${ns}:block/${k}`;
      // Material maps go next to the texture as k_n.png and k_s.png (LabPBR),
      // where Iris finds them. A texture shared by two materials gets the first one's.
      if (!mapsWritten.has(k)) {
        mapsWritten.add(k);
        const surface = surfaceOf(m, i);
        const maps = surface === 'file' ? mesh.materials[i]?.maps : null;
        if (maps) {
          if (maps.n) files[`assets/${ns}/textures/block/${k}_n.png`] = await mapAtSize(maps.n, img.width, img.height, true);
          if (maps.s) files[`assets/${ns}/textures/block/${k}_s.png`] = await mapAtSize(maps.s, img.width, img.height, false);
        } else {
          const px = PBR.flatSpecular(surface, mat.glow);
          if (px) files[`assets/${ns}/textures/block/${k}_s.png`] = await encodePng(PBR.solidMap(px, img.width, img.height), img.width, img.height);
        }
      }
    }
    textures.particle = textures[slots[0]] || 'minecraft:block/white_concrete';
    const obj = M.meshToObj(mesh, matrixOf(m), slots, m.name);
    files[`assets/${ns}/models/${dir}/${key}.obj`] = obj.text;
    const glow = slots.filter((_, i) => m.mats[i].glow);
    // Without the mod this file loads as a plain vanilla model ("optional"
    // tells Fabric API to allow that), so it carries a fallback the mod
    // ignores: the item's own sprite for items, a textured box otherwise.
    const model = {
      'fabric:type': { id: 'blockgraph:obj', optional: true },
      obj: `${ns}:models/${dir}/${key}.obj`,
      parent: hold.parent,
      gui_light: hold.gui,
      textures,
    };
    const sprite = m.use === 'item' ? fullId(m.target) : m.use === 'custom' ? fullId(m.base) : null;
    if (sprite && /item\/(generated|handheld|handheld_rod)$/.test(hold.parent)) {
      const [sns, spath] = sprite.split(':');
      textures.layer0 = `${sns}:item/${spath}`;
    } else {
      model.elements = [fallbackBox(obj.bounds)];
    }
    if (glow.length) model.blockgraph = { emissive: glow };
    files[`assets/${ns}/models/${dir}/${key}.json`] = json(model);
    const ref = `${ns}:${dir}/${key}`;
    let itemModel = { type: 'minecraft:model', model: ref };
    if (m.use !== 'block' && m.hold === 'shield') {
      files[`assets/${ns}/models/${dir}/${key}_blocking.json`] = json({ ...model, parent: hold.blocking });
      itemModel = { type: 'minecraft:condition', property: 'minecraft:using_item', on_false: itemModel, on_true: { type: 'minecraft:model', model: `${ref}_blocking` } };
    }
    if (m.use === 'custom') {
      files[`assets/${ns}/items/${key}.json`] = json({ model: itemModel });
      continue;
    }
    const target = fullId(m.target);
    if (!target) {
      problems.push(`“${m.name}” has no ${m.use === 'block' ? 'block' : 'item'} to replace, so only its model files were added.`);
      continue;
    }
    const [tns, tpath] = target.split(':');
    if (itemDefs.has(target)) problems.push(`“${m.name}” and “${itemDefs.get(target)}” both replace ${target}. The one lower in the list wins.`);
    itemDefs.set(target, m.name);
    files[`assets/${tns}/items/${tpath}.json`] = json({ model: itemModel });
    if (m.use === 'block') {
      if (blockDefs.has(target)) problems.push(`Two models replace the block ${target}.`);
      blockDefs.set(target, m.name);
      const turn = turnOf(m);
      const facings = [['north', 0], ['east', 90], ['south', 180], ['west', 270]];
      const turned = (r, y) => (y ? { model: r, y } : { model: r });
      let variants = { '': { model: ref } };
      if (turn === 'facing') {
        variants = Object.fromEntries(facings.map(([f, y]) => [`facing=${f}`, turned(ref, y)]));
      } else if (turn === 'rotation') {
        // 16 rotations, 0 = facing south; block models turn in 90° steps.
        variants = Object.fromEntries(Array.from({ length: 16 }, (_, r) => [`rotation=${r}`, turned(ref, (180 + 90 * (Math.round(r / 4) % 4)) % 360)]));
      } else if (turn === 'bed') {
        // The head half draws the whole bed; the foot half draws an empty
        // model, which still tells the mod to skip the vanilla bed there.
        const empty = `${ns}:block/${key}_empty`;
        files[`assets/${ns}/models/block/${key}_empty.obj`] = '# Empty: the head half of the bed draws the whole model.\n';
        files[`assets/${ns}/models/block/${key}_empty.json`] = json({ 'fabric:type': { id: 'blockgraph:obj', optional: true }, obj: `${ns}:models/block/${key}_empty.obj`, parent: 'minecraft:block/block', textures: { particle: textures.particle } });
        variants = Object.fromEntries(facings.flatMap(([f, y]) => [[`facing=${f},part=head`, turned(ref, y)], [`facing=${f},part=foot`, turned(empty, y)]]));
      }
      files[`assets/${tns}/blockstates/${tpath}.json`] = json({ variants });
    }
  }
  return { files, problems, count: modelCount() };
}

// Mobs and armour: one texture (several materials are packed side by side),
// an OBJ in feet space with one group per body part, and the file the mod
// reads (assets/<ns>/blockgraph/entities/<key>.json).
async function entityPackFiles(m, mesh, ns, key, files, problems, defs) {
  const target = fullId(m.target);
  if (!target) {
    problems.push(`“${m.name}” has no ${m.use === 'mob' ? 'mob' : 'armour item'} to replace, so it was left out.`);
    return;
  }
  if (defs.has(target)) problems.push(`“${m.name}” and “${defs.get(target)}” both replace ${target}. Only one of them shows in game.`);
  defs.set(target, m.name);

  // texture cells: one per texture (or plain colour) the materials use
  const cells = [];
  const cellOf = new Map();
  const matCell = m.mats.map((mat, i) => {
    const img = mat.tex && TX.bakedImage(mat.tex);
    const k = img ? mat.tex : `colour:${i}`;
    if (!cellOf.has(k)) {
      cellOf.set(k, cells.length);
      cells.push({ img: img || solidImage(mesh.materials[i]?.color || [0.8, 0.8, 0.8]), mat: i });
    }
    return cellOf.get(k);
  });
  const n = cells.length;
  const N = Math.ceil(Math.sqrt(n));
  const cell = n === 1 ? cells[0].img.width : Math.min(Math.max(...cells.map((c) => c.img.width)), Math.floor(2048 / N));
  const side = N * cell;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = side;
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = true;
  const tmp = document.createElement('canvas');
  cells.forEach((c, j) => {
    tmp.width = c.img.width;
    tmp.height = c.img.height;
    tmp.getContext('2d').putImageData(c.img, 0, 0);
    g.drawImage(tmp, (j % N) * cell, Math.floor(j / N) * cell, cell, cell);
  });
  files[`assets/${ns}/textures/entity/${key}.png`] = await TX.imageDataToPng(g.getImageData(0, 0, side, side));

  // material maps, packed the same way
  const nAtlas = PBR.solidMap(PBR.FLAT_NORMAL, side, side);
  const sAtlas = PBR.solidMap(PBR.NO_SPECULAR, side, side);
  let anyN = false, anyS = false;
  const put = (atlas, src, j, isNormal) => {
    const px = PBR.boxDownscale(src.data, src.width, src.height, cell, cell, isNormal);
    const x0 = (j % N) * cell, y0 = Math.floor(j / N) * cell;
    for (let y = 0; y < cell; y++) atlas.set(px.subarray(y * cell * 4, (y + 1) * cell * 4), ((y0 + y) * side + x0) * 4);
  };
  for (const [j, c] of cells.entries()) {
    const surface = surfaceOf(m, c.mat);
    const maps = surface === 'file' ? mesh.materials[c.mat]?.maps : null;
    if (maps?.n) { put(nAtlas, await decodePng(maps.n), j, true); anyN = true; }
    if (maps?.s) { put(sAtlas, await decodePng(maps.s), j, false); anyS = true; }
    const px = !maps ? PBR.flatSpecular(surface, m.mats[c.mat].glow) : null;
    if (px) { put(sAtlas, { data: PBR.solidMap(px, 1, 1), width: 1, height: 1 }, j, false); anyS = true; }
  }
  if (anyN) files[`assets/${ns}/textures/entity/${key}_n.png`] = await encodePng(nAtlas, side, side);
  if (anyS) files[`assets/${ns}/textures/entity/${key}_s.png`] = await encodePng(sAtlas, side, side);

  // the mesh in feet space, one vertex per corner so every material keeps its own UVs
  const pm = placedMesh(m);
  const tris = pm.mat.length;
  const pos = new Float32Array(tris * 9);
  const nrm = pm.nrm ? new Float32Array(tris * 9) : null;
  const uv = pm.uv ? new Float32Array(tris * 6) : null;
  const idx = new Uint32Array(tris * 3);
  const clamp = (v) => Math.max(0, Math.min(1, v));
  for (let t = 0; t < tris; t++) {
    const j = matCell[pm.mat[t]] ?? 0;
    const col = j % N, row = Math.floor(j / N);
    for (let k = 0; k < 3; k++) {
      const v = pm.idx[t * 3 + k], o = t * 3 + k;
      idx[o] = o;
      pos.set([pm.pos[v * 3] - 0.5, pm.pos[v * 3 + 1], pm.pos[v * 3 + 2] - 0.5], o * 3);
      if (nrm) nrm.set([pm.nrm[v * 3], pm.nrm[v * 3 + 1], pm.nrm[v * 3 + 2]], o * 3);
      if (uv) uv.set(n === 1 ? [pm.uv[v * 2], pm.uv[v * 2 + 1]] : [(col + clamp(pm.uv[v * 2])) / N, (row + clamp(pm.uv[v * 2 + 1])) / N], o * 2);
    }
  }
  const rig = m.use === 'armor' ? M.RIGS.humanoid : M.rigOf(target);
  const parts = M.rigParts(rig, pos, idx);
  files[`assets/${ns}/models/entity/${key}.obj`] = M.entityToObj({ idx }, pos, nrm, uv, parts, m.name);
  files[`assets/${ns}/blockgraph/entities/${key}.json`] = json({
    [m.use === 'mob' ? 'entity' : 'item']: target,
    model: `${ns}:models/entity/${key}.obj`,
    texture: `${ns}:textures/entity/${key}.png`,
  });
}

// --------------------------------------------------------- graph files

export function meshesForFile() {
  const out = {};
  for (const m of ctx.state.models) {
    const mesh = meshes.get(m.mesh);
    if (mesh && !out[m.mesh]) out[m.mesh] = M.meshToJSON(mesh);
  }
  return out;
}

export function loadMeshesFromFile(obj) {
  for (const [id, j] of Object.entries(obj || {})) {
    try {
      storeMesh(id, M.meshFromJSON(j));
    } catch { /* a broken mesh shows as missing */ }
  }
}

// ------------------------------------------------------------------- init

export async function initModels(context) {
  ctx = context;
  const canvas = $('#model-view');
  if (canvas) {
    view = new ModelView(canvas);
    if (!view.ok) {
      $('#model-msg').hidden = false;
      $('#model-msg').textContent = view.error;
      view = null;
    }
  }
  $('#model-wire')?.addEventListener('change', (e) => view?.setOptions({ wire: e.target.checked }));
  $('#model-home')?.addEventListener('click', () => view?.home());

  const menu = $('#menu-model');
  const items = [
    ['sting', 'Sting', 'Bilbo\u2019s sword with its blue inscription, replacing the netherite sword. About 1,100 triangles.'],
    ['sword', 'Sample: Sword', 'A low-poly sword that replaces the diamond sword.'],
    ['crystal', 'Sample: Crystal cluster', 'Glowing crystals that replace the flower pot block.'],
  ];
  const runSample = async (k) => {
    try {
      if (FILE_SAMPLES[k]) await addFileSample(k);
      else addSample(k);
    } catch (err) {
      ctx.toast(err.message || 'Could not load that sample.');
    }
  };
  for (const [k, title, blurb] of items) {
    const b = el('button', 'menu-item');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.append(el('strong', null, title), el('span', null, blurb));
    b.addEventListener('click', () => {
      menu.hidden = true;
      runSample(k);
    });
    menu.append(b);
  }
  $('#model-new').addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    $('#model-new').setAttribute('aria-expanded', menu.hidden ? 'false' : 'true');
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#model-card .menu-wrap')) {
      menu.hidden = true;
      $('#model-new').setAttribute('aria-expanded', 'false');
    }
  });
  for (const id of ['#model-import', '#model-empty-import']) $(id)?.addEventListener('click', () => $('#model-input').click());
  $('#model-empty-sting')?.addEventListener('click', () => runSample('sting'));
  $('#model-empty-sword')?.addEventListener('click', () => addSample('sword'));
  $('#model-empty-crystal')?.addEventListener('click', () => addSample('crystal'));
  const run = async (files) => {
    if (!files?.length) return;
    try {
      await importFiles(files);
    } catch (err) {
      ctx.toast(err.message || 'Could not read that model.');
    }
  };
  $('#model-input').addEventListener('change', async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    await run(files);
  });
  const stage = $('#model-stage');
  stage.addEventListener('dragover', (e) => { e.preventDefault(); stage.classList.add('drop'); });
  stage.addEventListener('dragleave', () => stage.classList.remove('drop'));
  stage.addEventListener('drop', (e) => {
    e.preventDefault();
    stage.classList.remove('drop');
    run([...(e.dataTransfer?.files || [])]);
  });

  await loadStoredMeshes();
  refreshViews();
  renderPanel();
}
