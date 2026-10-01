// The Models tab: real 3D models for blocks and items, through the BlockGraph
// Models mod (client side, Fabric 1.21.11). Import OBJ, glTF or GLB, fit the
// model into Minecraft's block space, give its materials textures from the
// Textures tab, see it in the live preview under the Blocks shader, and export
// it into the resource pack.

import * as M from './meshes.js';
import * as TX from './textures.js';
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
};

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
const BLOCKS = ['flower_pot', 'lantern', 'soul_lantern', 'end_rod', 'lightning_rod', 'anvil', 'cauldron', 'grindstone',
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

function addModel(mesh, { name, use = 'custom', target = '', base = 'minecraft:stick', hold = 'item', texFor = [], glowFor = [] }) {
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
    mats: mesh.materials.map((m, i) => ({ name: m.name, tex: texFor[i] || '', glow: !!(glowFor[i] ?? m.glow) })),
  };
  model.fit = poseFit(model, mesh);
  ctx.state.models.push(model);
  ctx.state.modelSel = model.id;
  return model;
}

function poseFit(model, mesh = meshes.get(model.mesh)) {
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
    addModel(s.mesh, { name: 'Crystal', use: 'block', target: 'minecraft:flower_pot', hold: 'block', texFor: [tex[0], tex[0]] });
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
  let missing = 0;
  const noUv = !mesh.uv;
  if (noUv) {
    const p = withPaletteUVs(mesh);
    mesh = p.mesh;
    const t = TX.addImageTexture(p.palette, `${name} colours`);
    mesh.materials.forEach((_, i) => { texFor[i] = t.id; });
  } else {
    for (const [i, m] of mesh.materials.entries()) {
      let t = null;
      if (m.image >= 0 && imageSources[m.image]) {
        if (!texOfImage.has(m.image)) {
          try {
            const img = await imageSources[m.image]();
            texOfImage.set(m.image, TX.addImageTexture(img, `${name} ${m.name}`.slice(0, 40)).id);
          } catch {
            texOfImage.set(m.image, null);
          }
        }
        t = texOfImage.get(m.image);
      } else if (m.image >= 0 || m.file) {
        missing++;
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
  ctx.toast(msg);
  return model;
}

// Samples that ship as files next to the app (app/samples).
const FILE_SAMPLES = {
  sting: { url: 'samples/sting.glb', file: 'Sting.glb', use: 'item', target: 'minecraft:netherite_sword', hold: 'sword' },
};

export async function addFileSample(kind) {
  const s = FILE_SAMPLES[kind];
  const res = await fetch(s.url);
  if (!res.ok) throw new Error(`Could not load the ${s.file} sample.`);
  const blob = await res.blob();
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
  view.setOptions({ guide: HOLDS[m.hold]?.guide || 'block' });
  view.setModel(placedMesh(m), materialViews(m));
  $('#model-title').textContent = m.name;
  const mesh = meshes.get(m.mesh);
  $('#model-sub').textContent = `${mesh.mat.length.toLocaleString('en')} triangles · ${quadCount(m.mesh).toLocaleString('en')} quads in game`;
  const g = HOLDS[m.hold]?.guide;
  $('#model-legend').textContent = g === 'sword' || g === 'item'
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
    for (const t of shownTiles) preview.setTileOverride(t, null);
    shownTiles.clear();
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

  const held = m.use !== 'block' && !!preview.setHeldModel;
  const at = held ? [-0.5, -0.5, -0.5] : MODEL_SPOT;
  const centre = [MODEL_SPOT[0] + 0.5, MODEL_SPOT[1] + 0.5, MODEL_SPOT[2] + 0.5];
  const [blockLight, sky] = held ? [0, 1] : sceneLight(...centre);
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
        mat.glow ? 1 : blockLight, sky, held ? 0 : 4, 0,
      ], o);
      o += 16;
    }
  }
  if (held) {
    preview.setModel(null);
    preview.setHeldModel(data, m.hold === 'shield' ? 'off' : 'main');
  } else {
    preview.setHeldModel?.(null);
    preview.setModel(data);
  }
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
    notes.push(m.use === 'block' ? 'Type a block id, like flower_pot.' : 'Type an item id, like diamond_sword.');
    bad = true;
  } else if (m.use === 'item') {
    notes.push(`Every ${path.replace(/_/g, ' ')} looks like this model, for everyone who has the mod and your resource pack.`);
    if (ITEM_NOTES[path]) notes.push(ITEM_NOTES[path]);
  } else if (m.use === 'block') {
    notes.push(`Every ${path.replace(/_/g, ' ')} in the world draws this model instead. Its hitbox stays the same.`);
    if (ENTITY_BLOCKS.test(path)) {
      notes.push('This block is drawn by a block entity renderer, which a model cannot replace. Pick another block.');
      bad = true;
    } else if (FULL_BLOCKS.test(path)) {
      notes.push('This is a full cube, so neighbouring blocks hide their faces against it and you will see holes around the model. Pick a block that is not a full cube, like flower_pot or lantern.');
      bad = true;
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
        if (m.hold !== 'block') { m.hold = 'block'; if (mesh) m.fit = poseFit(m); }
      } else {
        if (was === 'block' || !fullId(m.target)) m.target = 'minecraft:diamond_sword';
        if (m.hold === 'block') { m.hold = 'item'; if (mesh) m.fit = poseFit(m); }
      }
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
    t.placeholder = m.use === 'block' ? 'flower_pot' : 'diamond_sword';
    t.spellcheck = false;
    t.setAttribute('list', m.use === 'block' ? 'model-blocks' : 'model-items');
    datalist('model-items', ITEMS);
    datalist('model-blocks', BLOCKS);
    t.addEventListener('change', () => {
      const v = fullId(t.value);
      if (!v) { ctx.toast('Use lowercase letters, numbers and _ like diamond_sword.'); t.value = m.target.replace(/^minecraft:/, ''); return; }
      m.target = v;
      if (m.use === 'item' && v === 'minecraft:shield' && m.hold !== 'shield') m.hold = 'shield';
      commit(true);
    });
    box.append(field(m.use === 'block' ? 'Block' : 'Item', t, targetNotes(m)));
    if (m.use === 'block') {
      const sw = el('label', 'ctl-switch');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = m.facing;
      cb.addEventListener('change', () => { m.facing = cb.checked; commit(); });
      sw.append(cb, el('span', 'switch'), el('span', null, 'Turn with the block’s facing'));
      sw.title = 'Only for blocks that have a facing property (north, east, south, west), like a furnace or a lectern';
      box.append(sw);
    }
  }

  // hold
  if (m.use !== 'block') {
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
    const holdName = (HOLDS[m.hold]?.label || 'item').split(' (')[0].toLowerCase();
    btn(`Pose as ${holdName}`, 'Size and turn the model for this hold, with its longest side along the pose', () => set(poseFit(m)));
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
    box.append(field(`Materials (${m.mats.length})`, mats, 'Textures come from the Textures tab, so you can paint them there. They go into the resource pack with the model.'));

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
  const itemDefs = new Map(); // item id -> model, to spot two models on one item
  const blockDefs = new Map();
  for (const m of ctx.state.models) {
    const mesh = meshes.get(m.mesh);
    if (!mesh) {
      problems.push(`“${m.name}” has no 3D data in this browser, so it was left out.`);
      continue;
    }
    const key = keys.get(m.id);
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
      textures[slots[i]] = `${ns}:block/${texKeys.get(mat.tex)}`;
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
      const variants = m.facing
        ? { 'facing=north': { model: ref }, 'facing=east': { model: ref, y: 90 }, 'facing=south': { model: ref, y: 180 }, 'facing=west': { model: ref, y: 270 } }
        : { '': { model: ref } };
      files[`assets/${tns}/blockstates/${tpath}.json`] = json({ variants });
    }
  }
  return { files, problems, count: modelCount() };
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
