// The Textures tab: a small resource pack creator.
// Each texture is either a node graph (baked to pixels on the GPU) or an
// uploaded image, with an optional pixel-paint layer on top. Textures can
// replace Minecraft block textures (resource pack export), show up in the
// live preview, and feed shaders through the Image Texture node.

import { TEXTURE_REGISTRY, texSampler, NODE_DEFS } from './nodes.js';
import { buildTextureShader } from './targets.js';
import { TARGET_TILES } from './preview.js';
import { TEXTURE_PRESETS } from './presets.js';

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

export const PACK_FORMAT = 75; // Minecraft Java 1.21.11
export const SIZES = [16, 32, 64, 128, 256, 512];

// Common block textures to replace. Animated ones get a static .mcmeta on export.
export const COMMON_TARGETS = [
  'block/stone', 'block/cobblestone', 'block/dirt', 'block/grass_block_top', 'block/grass_block_side', 'block/sand',
  'block/gravel', 'block/oak_planks', 'block/oak_log', 'block/oak_log_top', 'block/oak_leaves', 'block/bricks',
  'block/stone_bricks', 'block/glowstone', 'block/diamond_ore', 'block/iron_ore', 'block/gold_ore', 'block/coal_ore',
  'block/emerald_ore', 'block/deepslate', 'block/netherrack', 'block/obsidian', 'block/glass', 'block/short_grass',
  'block/poppy', 'block/dandelion', 'block/snow', 'block/ice', 'block/terracotta', 'block/water_still', 'block/lava_still',
];
const TINTED = new Set(['block/grass_block_top', 'block/oak_leaves', 'block/short_grass', 'block/water_still', 'block/grass_block_side_overlay', 'block/vine']);
const ANIMATED = new Set(['block/water_still', 'block/water_flow', 'block/lava_still', 'block/lava_flow', 'block/magma', 'block/magma_block', 'block/prismarine', 'block/sea_lantern', 'block/fire_0', 'block/fire_1', 'block/soul_fire_0', 'block/soul_fire_1', 'block/nether_portal', 'block/kelp', 'block/seagrass', 'block/tall_seagrass_top', 'block/tall_seagrass_bottom']);

let ctx;
const baked = new Map(); // id -> ImageData (node or image result with paint on top)
const bases = new Map(); // id -> ImageData (node or image result alone)
const paints = new Map(); // id -> ImageData paint layer
const images = new Map(); // id -> ImageData of an uploaded image
export const bakeErrors = new Map();
const tileShown = new Map(); // preview tile -> ImageData currently shown
let tool = 'pencil';
let showUVs = true;

export function texById(id) {
  return ctx.state.textures.find((t) => t.id === id) || null;
}

export function selectedTexture() {
  return texById(ctx.state.texSel) || ctx.state.textures[0] || null;
}

export function syncRegistry() {
  TEXTURE_REGISTRY.list = ctx.state.textures.map((t) => ({ id: t.id, name: t.name, kind: t.kind }));
}

// Textures an Image Texture node may pick in a graph of this kind. Texture
// graphs can only read uploaded images (a texture graph can't read another graph).
export function textureList(kind) {
  return ctx.state.textures.filter((t) => kind !== 'texture' || t.kind === 'image').map((t) => ({ id: t.id, name: t.name }));
}

export function defaultTexture(kind) {
  const sel = selectedTexture();
  const list = textureList(kind);
  if (sel && list.some((t) => t.id === sel.id) && kind !== 'texture') return sel.id;
  return list[0]?.id || '';
}

function uniqueName(base) {
  const names = new Set(ctx.state.textures.map((t) => t.name));
  if (!names.has(base)) return base;
  let i = 2;
  while (names.has(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}

export function newTexture(presetId = 'stone', select = true) {
  const p = TEXTURE_PRESETS.find((x) => x.id === presetId) || TEXTURE_PRESETS[0];
  const taken = new Set(ctx.state.textures.map((t) => t.target).filter(Boolean));
  const t = {
    id: `t${ctx.state.texNext++}`,
    name: uniqueName(p.name),
    kind: 'graph',
    target: taken.has(p.target) ? '' : p.target,
    size: p.size,
    seamless: true,
    blur: false,
    graph: p.build(),
    paint: null,
  };
  t.graph.needsLayout = true;
  ctx.state.textures.push(t);
  if (select) ctx.state.texSel = t.id;
  syncRegistry();
  bake(t);
  return t;
}

// ------------------------------------------------------------- decoding

function dataUrlToImageData(url, size) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = size || img.naturalWidth;
      const h = size || img.naturalHeight;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.drawImage(img, 0, 0, w, h);
      resolve(g.getImageData(0, 0, w, h));
    };
    img.onerror = () => reject(new Error('Could not read that image.'));
    img.src = url;
  });
}

function imageDataToDataUrl(img) {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d').putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

export function imageDataToPng(img) {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d').putImageData(img, 0, 0);
  return new Promise((resolve) => c.toBlob(async (b) => resolve(new Uint8Array(await b.arrayBuffer())), 'image/png'));
}

function resizeNearest(img, size) {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d').putImageData(img, 0, 0);
  const d = document.createElement('canvas');
  d.width = d.height = size;
  const g = d.getContext('2d');
  g.imageSmoothingEnabled = size < img.width;
  g.drawImage(c, 0, 0, size, size);
  return g.getImageData(0, 0, size, size);
}

// Loads every uploaded image and paint layer, then bakes all textures.
export async function loadAll() {
  baked.clear();
  bases.clear();
  paints.clear();
  images.clear();
  for (const t of ctx.state.textures) {
    try {
      if (t.kind === 'image' && t.image) images.set(t.id, await dataUrlToImageData(t.image, t.size));
      if (t.paint) paints.set(t.id, await dataUrlToImageData(t.paint, t.size));
    } catch { /* a broken image just shows as empty */ }
  }
  syncRegistry();
  for (const t of ctx.state.textures) bake(t, false);
  applyTiles();
  renderPanel();
}

// --------------------------------------------------------------- baking

function composite(base, paint) {
  const out = new ImageData(new Uint8ClampedArray(base.data), base.width, base.height);
  if (!paint || paint.width !== base.width) return out;
  const o = out.data, p = paint.data;
  for (let i = 0; i < o.length; i += 4) {
    const a = p[i + 3] / 255;
    if (!a) continue;
    const ba = o[i + 3] / 255;
    const ra = a + ba * (1 - a);
    for (let k = 0; k < 3; k++) o[i + k] = Math.round((p[i + k] * a + o[i + k] * ba * (1 - a)) / Math.max(ra, 1e-6));
    o[i + 3] = Math.round(ra * 255);
  }
  return out;
}

function emptyImage(size) {
  const img = new ImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const x = (i / 4) % size, y = Math.floor(i / 4 / size);
    const on = (Math.floor(x / Math.max(1, size / 8)) + Math.floor(y / Math.max(1, size / 8))) % 2;
    img.data.set(on ? [255, 0, 255, 255] : [20, 20, 20, 255], i);
  }
  return img;
}

// Bakes one texture and pushes it everywhere it is used.
export function bake(t, push = true) {
  if (!t) return;
  let base;
  if (t.kind === 'image') {
    base = images.get(t.id) || emptyImage(t.size);
    bakeErrors.delete(t.id);
  } else {
    const { src } = buildTextureShader(t.graph);
    const r = ctx.preview.bakeTexture(src, t.size, t.seamless);
    if (r.error) {
      bakeErrors.set(t.id, r.error);
      base = emptyImage(t.size);
    } else {
      bakeErrors.delete(t.id);
      base = r.img;
    }
  }
  bases.set(t.id, base);
  const final = composite(base, paints.get(t.id));
  baked.set(t.id, final);
  ctx.preview.setCustomTexture(t.id, final, { blur: t.blur });
  if (push) {
    applyTiles();
    if (ctx.state.texSel === t.id || selectedTexture() === t) drawCanvases();
    renderList();
  }
}

// Shows textures that replace one of the preview's blocks in the 3D preview.
export function applyTiles() {
  const want = new Map();
  for (const t of ctx.state.textures) {
    const tile = TARGET_TILES[t.target];
    if (tile !== undefined && baked.has(t.id)) want.set(tile, baked.get(t.id));
  }
  const tiles = new Set([...tileShown.keys(), ...want.keys()]);
  for (const tile of tiles) {
    const img = want.get(tile) || null;
    if (tileShown.get(tile) === img) continue;
    ctx.preview.setTileOverride(tile, img);
    if (img) tileShown.set(tile, img);
    else tileShown.delete(tile);
  }
}

export function removeTexture(id) {
  ctx.state.textures = ctx.state.textures.filter((t) => t.id !== id);
  baked.delete(id);
  bases.delete(id);
  paints.delete(id);
  images.delete(id);
  ctx.preview.removeCustomTexture(id);
  if (ctx.state.texSel === id) ctx.state.texSel = ctx.state.textures[0]?.id || null;
  syncRegistry();
  applyTiles();
}

// -------------------------------------------------------------- uploads

export async function uploadImage(file) {
  const url = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Could not read the file.'));
    r.readAsDataURL(file);
  });
  const raw = await dataUrlToImageData(url);
  // Square it (centre crop) and snap to a Minecraft-friendly size.
  const side = Math.min(raw.width, raw.height);
  const size = SIZES.reduce((best, s) => (Math.abs(s - side) < Math.abs(best - side) ? s : best), 16);
  const c = document.createElement('canvas');
  c.width = raw.width;
  c.height = raw.height;
  c.getContext('2d').putImageData(raw, 0, 0);
  const d = document.createElement('canvas');
  d.width = d.height = size;
  const g = d.getContext('2d');
  g.imageSmoothingEnabled = size < side;
  g.drawImage(c, (raw.width - side) / 2, (raw.height - side) / 2, side, side, 0, 0, size, size);
  const img = g.getImageData(0, 0, size, size);
  const t = {
    id: `t${ctx.state.texNext++}`,
    name: uniqueName(file.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 40) || 'Image'),
    kind: 'image',
    target: '',
    size,
    seamless: false,
    blur: true,
    image: imageDataToDataUrl(img),
    paint: null,
  };
  ctx.state.textures.push(t);
  ctx.state.texSel = t.id;
  images.set(t.id, img);
  syncRegistry();
  bake(t);
  return t;
}

// Adds an image as a texture without cropping it: model UVs cover the whole
// image, so it is stretched to the nearest Minecraft-friendly square instead.
export function addImageTexture(img, name, { select = false } = {}) {
  const side = Math.max(img.width, img.height);
  const size = SIZES.reduce((best, s) => (Math.abs(s - side) < Math.abs(best - side) ? s : best), 16);
  let out = img;
  if (img.width !== size || img.height !== size) {
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    c.getContext('2d').putImageData(img, 0, 0);
    const d = document.createElement('canvas');
    d.width = d.height = size;
    const g = d.getContext('2d');
    g.imageSmoothingEnabled = size < side;
    g.drawImage(c, 0, 0, img.width, img.height, 0, 0, size, size);
    out = g.getImageData(0, 0, size, size);
  }
  const t = {
    id: `t${ctx.state.texNext++}`,
    name: uniqueName(String(name || 'Image').slice(0, 40)),
    kind: 'image',
    target: '',
    size,
    seamless: false,
    blur: false,
    image: imageDataToDataUrl(out),
    paint: null,
  };
  ctx.state.textures.push(t);
  if (select) ctx.state.texSel = t.id;
  images.set(t.id, out);
  syncRegistry();
  bake(t);
  return t;
}

// The finished pixels of a texture (node or image result with paint on top).
export function bakedImage(id) {
  return baked.get(id) || null;
}

// ----------------------------------------------------------------- panel

export function renderPanel() {
  const card = $('#tex-card');
  if (!card) return;
  card.hidden = ctx.state.kind !== 'texture';
  if (card.hidden) return;
  renderList();
  renderProps();
  drawCanvases();
}

function renderList() {
  const list = $('#tex-list');
  if (!list || ctx.state.kind !== 'texture') return;
  list.textContent = '';
  for (const t of ctx.state.textures) {
    const b = el('button', 'tex-item');
    b.type = 'button';
    b.setAttribute('role', 'option');
    const on = selectedTexture()?.id === t.id;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
    const thumb = el('canvas', 'tex-thumb');
    thumb.width = thumb.height = 32;
    const img = baked.get(t.id);
    if (img) drawScaled(thumb, img, false);
    const meta = el('span', 'tex-meta');
    const usedBy = ctx.modelUsage?.(t.id) || [];
    const label = t.target ? t.target.replace('block/', '') : usedBy.length ? `model · ${usedBy.join(', ')}` : t.kind === 'image' ? 'image · shader' : 'shader only';
    meta.append(el('span', 'tex-name', t.name), el('span', 'tex-target', label));
    b.append(thumb, meta);
    b.addEventListener('click', () => ctx.selectTexture(t.id));
    list.append(b);
  }
}

function renderProps() {
  const box = $('#tex-props');
  box.textContent = '';
  const t = selectedTexture();
  if (!t) {
    box.append(el('p', 'field-hint', 'No textures yet. Use New to start from a preset, or upload an image.'));
    return;
  }
  const commit = (rebake = true) => {
    syncRegistry();
    if (rebake) bake(t);
    ctx.pushHistory();
    renderList();
    ctx.onTexturesChanged();
  };

  const row1 = el('div', 'tex-row');
  const name = el('input', 'in-text');
  name.value = t.name;
  name.setAttribute('aria-label', 'Texture name');
  name.addEventListener('change', () => {
    t.name = name.value.trim().slice(0, 40) || t.name;
    commit(false);
  });
  const size = el('select', 'in-select');
  size.setAttribute('aria-label', 'Texture size in pixels');
  for (const s of SIZES) {
    const o = el('option', null, `${s}×${s}`);
    o.value = String(s);
    size.append(o);
  }
  size.value = String(t.size);
  size.disabled = t.kind === 'image';
  size.title = t.kind === 'image' ? 'Uploaded images keep their size' : 'Pixels per side. Minecraft blocks are 16×16.';
  size.addEventListener('change', () => {
    const n = Number(size.value);
    if (paints.has(t.id)) {
      const p = resizeNearest(paints.get(t.id), n);
      paints.set(t.id, p);
      t.paint = imageDataToDataUrl(p);
    }
    t.size = n;
    commit();
  });
  row1.append(name, size);
  box.append(row1);

  const tgt = el('input', 'in-text mono');
  tgt.id = 'tex-target';
  tgt.value = t.target;
  tgt.placeholder = 'block/stone — empty = shader only';
  tgt.setAttribute('list', 'tex-targets');
  tgt.spellcheck = false;
  let dl = $('#tex-targets');
  if (!dl) {
    dl = el('datalist');
    dl.id = 'tex-targets';
    for (const c of COMMON_TARGETS) {
      const o = el('option');
      o.value = c;
      dl.append(o);
    }
    document.body.append(dl);
  }
  tgt.addEventListener('change', () => {
    const v = tgt.value.trim().toLowerCase().replace(/\.png$/, '').replace(/^minecraft:/, '').replace(/^textures\//, '');
    if (v && !/^[a-z0-9_\/.-]+$/.test(v)) {
      ctx.toast('Use lowercase letters, numbers, _ and / like block/stone.');
      tgt.value = t.target;
      return;
    }
    t.target = v;
    tgt.value = v;
    commit(false);
    applyTiles();
    renderProps();
  });
  const lbl = el('label', 'field');
  lbl.append(el('span', 'field-label', 'Replaces Minecraft texture'), tgt);
  const notes = [];
  const usedBy = ctx.modelUsage?.(t.id) || [];
  if (usedBy.length) notes.push(`Used by the model${usedBy.length > 1 ? 's' : ''} ${usedBy.map((n) => `“${n}”`).join(', ')}, so it goes into the resource pack with ${usedBy.length > 1 ? 'them' : 'it'}.`);
  if (!t.target) { if (!usedBy.length) notes.push('Not in the resource pack. Use it in a shader with Image Texture.'); }
  else notes.push(`Goes to assets/minecraft/textures/${t.target}.png in the resource pack.`);
  if (TINTED.has(t.target)) notes.push('Minecraft tints this one by biome, so keep it grey.');
  if (ANIMATED.has(t.target)) notes.push('This texture is animated in vanilla. Yours will be still.');
  if (TARGET_TILES[t.target] !== undefined) notes.push('Shown on the matching block in the live preview.');
  const clash = t.target && ctx.state.textures.find((o) => o !== t && o.target === t.target);
  if (clash) notes.push(`“${clash.name}” replaces the same texture. The one lower in the list wins.`);
  lbl.append(el('span', 'field-hint', notes.join(' ')));
  box.append(lbl);

  const switches = el('div', 'tex-switches');
  if (t.kind === 'graph') {
    const sw = el('label', 'ctl-switch');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = t.seamless;
    cb.addEventListener('change', () => { t.seamless = cb.checked; commit(); });
    sw.append(cb, el('span', 'switch'), el('span', null, 'Seamless tiling'));
    switches.append(sw);
  }
  const sw2 = el('label', 'ctl-switch');
  const cb2 = el('input');
  cb2.type = 'checkbox';
  cb2.checked = t.blur;
  cb2.addEventListener('change', () => { t.blur = cb2.checked; commit(); });
  sw2.append(cb2, el('span', 'switch'), el('span', null, 'Smooth in shaders'));
  sw2.title = 'Off keeps hard pixels when an Image Texture node samples it';
  switches.append(sw2);
  if (usedBy.length) {
    const sw3 = el('label', 'ctl-switch');
    const cb3 = el('input');
    cb3.type = 'checkbox';
    cb3.checked = showUVs;
    cb3.addEventListener('change', () => { showUVs = cb3.checked; drawCanvases(); });
    sw3.append(cb3, el('span', 'switch'), el('span', null, 'Show model UVs'));
    sw3.title = 'Draws the model\u2019s faces over the texture, so you know where to paint';
    switches.append(sw3);
  }
  box.append(switches);

  const err = bakeErrors.get(t.id);
  if (err) box.append(el('pre', 'insp-error mono', err.split('\n').filter((l) => /ERROR/i.test(l)).slice(0, 3).join('\n') || err));

  const acts = el('div', 'tex-row');
  const dup = el('button', 'btn ghost small', 'Duplicate');
  dup.type = 'button';
  dup.addEventListener('click', () => {
    const copy = JSON.parse(JSON.stringify(t));
    copy.id = `t${ctx.state.texNext++}`;
    copy.name = uniqueName(t.name);
    copy.target = '';
    ctx.state.textures.push(copy);
    if (paints.has(t.id)) paints.set(copy.id, paints.get(t.id));
    if (images.has(t.id)) images.set(copy.id, images.get(t.id));
    syncRegistry();
    bake(copy, false);
    ctx.selectTexture(copy.id);
    ctx.pushHistory();
  });
  const del = el('button', 'btn danger small', 'Delete texture');
  del.type = 'button';
  del.addEventListener('click', () => {
    removeTexture(t.id);
    ctx.pushHistory();
    ctx.selectTexture(ctx.state.texSel);
    ctx.toast(`Deleted “${t.name}”. Undo brings it back.`);
  });
  acts.append(dup, del);
  box.append(acts);

  $('#tex-hint').textContent = 'Paint goes on top of the node result. The eraser brings the node result back.';
}

function drawScaled(canvas, img, grid) {
  const g = canvas.getContext('2d');
  const tmp = document.createElement('canvas');
  tmp.width = img.width;
  tmp.height = img.height;
  tmp.getContext('2d').putImageData(img, 0, 0);
  g.clearRect(0, 0, canvas.width, canvas.height);
  // checkerboard so transparent pixels are visible
  const ck = Math.max(4, canvas.width / 32);
  for (let y = 0; y < canvas.height; y += ck) for (let x = 0; x < canvas.width; x += ck) {
    g.fillStyle = ((x + y) / ck) % 2 ? '#2a2d34' : '#1f2228';
    g.fillRect(x, y, ck, ck);
  }
  g.imageSmoothingEnabled = false;
  g.drawImage(tmp, 0, 0, canvas.width, canvas.height);
  if (grid && img.width <= 32) {
    g.strokeStyle = 'rgba(0,0,0,0.18)';
    g.lineWidth = 1;
    const step = canvas.width / img.width;
    g.beginPath();
    for (let i = 1; i < img.width; i++) {
      g.moveTo(Math.round(i * step) + 0.5, 0);
      g.lineTo(Math.round(i * step) + 0.5, canvas.height);
      g.moveTo(0, Math.round(i * step) + 0.5);
      g.lineTo(canvas.width, Math.round(i * step) + 0.5);
    }
    g.stroke();
  }
}

export function drawCanvases() {
  if (ctx.state.kind !== 'texture') return;
  const t = selectedTexture();
  const main = $('#tex-canvas');
  const tile = $('#tex-tile');
  if (!t || !baked.has(t.id)) {
    main.getContext('2d').clearRect(0, 0, main.width, main.height);
    tile.getContext('2d').clearRect(0, 0, tile.width, tile.height);
    return;
  }
  const img = baked.get(t.id);
  drawScaled(main, img, true);
  const segs = showUVs ? ctx.uvSegments?.(t.id) : null;
  if (segs) {
    const mg = main.getContext('2d');
    const W = main.width, H = main.height;
    mg.save();
    mg.beginPath();
    for (let i = 0; i < segs.length; i += 4) {
      mg.moveTo(segs[i] * W, segs[i + 1] * H);
      mg.lineTo(segs[i + 2] * W, segs[i + 3] * H);
    }
    // a dark edge under a light line, so the UVs show on any texture
    mg.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    mg.lineWidth = 3;
    mg.stroke();
    mg.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    mg.lineWidth = 1;
    mg.stroke();
    mg.restore();
  }
  const g = tile.getContext('2d');
  const tmp = document.createElement('canvas');
  tmp.width = img.width;
  tmp.height = img.height;
  tmp.getContext('2d').putImageData(img, 0, 0);
  g.imageSmoothingEnabled = false;
  g.fillStyle = '#1f2228';
  g.fillRect(0, 0, tile.width, tile.height);
  const s = tile.width / 3;
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) g.drawImage(tmp, x * s, y * s, s, s);
}

// ---------------------------------------------------------------- paint

function pixelAt(e, t) {
  const c = $('#tex-canvas');
  const r = c.getBoundingClientRect();
  const x = Math.floor(((e.clientX - r.left) / r.width) * t.size);
  const y = Math.floor(((e.clientY - r.top) / r.height) * t.size);
  if (x < 0 || y < 0 || x >= t.size || y >= t.size) return null;
  return [x, y];
}

function paintLayer(t) {
  let p = paints.get(t.id);
  if (!p || p.width !== t.size) {
    p = new ImageData(t.size, t.size);
    paints.set(t.id, p);
  }
  return p;
}

function hexRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function refreshComposite(t) {
  const base = bases.get(t.id);
  if (!base) return;
  baked.set(t.id, composite(base, paints.get(t.id)));
  drawCanvases();
}

function applyTool(t, x, y) {
  const p = paintLayer(t);
  const i = (y * t.size + x) * 4;
  if (tool === 'pencil') {
    p.data.set([...hexRgb($('#paint-color').value), 255], i);
  } else if (tool === 'eraser') {
    p.data.set([0, 0, 0, 0], i);
  } else if (tool === 'picker') {
    const c = baked.get(t.id).data;
    $('#paint-color').value = '#' + [c[i], c[i + 1], c[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('');
    return;
  } else if (tool === 'fill') {
    const src = baked.get(t.id).data;
    const target = src.slice(i, i + 4).join(',');
    const col = [...hexRgb($('#paint-color').value), 255];
    const seen = new Uint8Array(t.size * t.size);
    const stack = [[x, y]];
    while (stack.length) {
      const [cx, cy] = stack.pop();
      if (cx < 0 || cy < 0 || cx >= t.size || cy >= t.size) continue;
      const k = cy * t.size + cx;
      if (seen[k]) continue;
      seen[k] = 1;
      if (src.slice(k * 4, k * 4 + 4).join(',') !== target) continue;
      p.data.set(col, k * 4);
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
  }
  refreshComposite(t);
}

function commitPaint(t) {
  const p = paints.get(t.id);
  const empty = !p || !p.data.some((v, i) => i % 4 === 3 && v > 0);
  t.paint = empty ? null : imageDataToDataUrl(p);
  if (empty) paints.delete(t.id);
  bake(t);
  ctx.pushHistory();
  ctx.onTexturesChanged();
}

function setTool(name) {
  tool = name;
  for (const b of document.querySelectorAll('.paint-bar .tool')) {
    const on = b.dataset.tool === name;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
}

// ----------------------------------------------------------------- export

// The resource pack: pack.mcmeta, a pack icon and every texture with a target.
// Models add their own files (see models.js).
export async function buildResourcePackFiles(name) {
  const files = {};
  files['pack.mcmeta'] = JSON.stringify({
    pack: { description: `${name} · made with BlockGraph`, pack_format: PACK_FORMAT, min_format: PACK_FORMAT, max_format: PACK_FORMAT },
  }, null, 2) + '\n';
  const withTarget = ctx.state.textures.filter((t) => t.target && baked.has(t.id));
  for (const t of withTarget) {
    files[`assets/minecraft/textures/${t.target}.png`] = await imageDataToPng(baked.get(t.id));
    if (ANIMATED.has(t.target)) files[`assets/minecraft/textures/${t.target}.png.mcmeta`] = '{}\n';
  }
  const iconSrc = withTarget[0] || ctx.state.textures.find((t) => baked.has(t.id));
  if (iconSrc) files['pack.png'] = await imageDataToPng(resizeNearest(baked.get(iconSrc.id), 64));
  return { files, count: withTarget.length };
}

// Textures used by Image Texture nodes in the shader graphs, for the shader pack.
export async function shaderTextureFiles(graphs) {
  const ids = new Set();
  for (const g of [graphs.terrain, graphs.entity, graphs.post].filter(Boolean)) {
    for (const n of g.nodes) if (NODE_DEFS[n.type]?.texturePicker && n.params?.tex) ids.add(n.params.tex);
  }
  const list = [];
  const files = {};
  for (const id of ids) {
    const t = texById(id);
    if (!t || !baked.has(id)) continue;
    list.push({ id, blur: t.blur });
    const name = texSampler(id);
    files[`shaders/textures/${name}.png`] = await imageDataToPng(baked.get(id));
    files[`shaders/textures/${name}.png.mcmeta`] = JSON.stringify({ texture: { blur: !!t.blur, clamp: false } }) + '\n';
  }
  return { list, files };
}

export function texturesWithTarget() {
  return ctx.state.textures.filter((t) => t.target);
}

// ------------------------------------------------------------------ init

export function initTextures(context) {
  ctx = context;
  const canvas = $('#tex-canvas');
  let painting = null;
  canvas.addEventListener('pointerdown', (e) => {
    const t = selectedTexture();
    if (!t || !bases.has(t.id)) return;
    const px = pixelAt(e, t);
    if (!px) return;
    canvas.setPointerCapture(e.pointerId);
    painting = { t, last: px.join(',') };
    applyTool(t, px[0], px[1]);
    if (tool === 'fill' || tool === 'picker') {
      if (tool === 'fill') commitPaint(t);
      painting = null;
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!painting) return;
    const px = pixelAt(e, painting.t);
    if (!px || px.join(',') === painting.last) return;
    painting.last = px.join(',');
    applyTool(painting.t, px[0], px[1]);
  });
  const end = () => {
    if (!painting) return;
    const t = painting.t;
    painting = null;
    commitPaint(t);
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  for (const b of document.querySelectorAll('.paint-bar .tool')) b.addEventListener('click', () => setTool(b.dataset.tool));
  $('#paint-clear').addEventListener('click', () => {
    const t = selectedTexture();
    if (!t || !paints.has(t.id)) return;
    paints.delete(t.id);
    t.paint = null;
    bake(t);
    ctx.pushHistory();
    ctx.toast('Paint cleared. Undo brings it back.');
  });
  document.addEventListener('keydown', (e) => {
    if (ctx.state.kind !== 'texture' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    const map = { b: 'pencil', e: 'eraser', g: 'fill', i: 'picker' };
    const k = e.key.toLowerCase();
    if (map[k] && $('#modal').hidden) setTool(map[k]);
  });

  const menu = $('#menu-tex');
  for (const p of TEXTURE_PRESETS) {
    const b = el('button', 'menu-item');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.append(el('strong', null, p.name), el('span', null, p.blurb));
    b.addEventListener('click', () => {
      menu.hidden = true;
      const t = newTexture(p.id);
      ctx.selectTexture(t.id);
      ctx.pushHistory();
      ctx.onTexturesChanged();
    });
    menu.append(b);
  }
  $('#tex-new').addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    $('#tex-new').setAttribute('aria-expanded', menu.hidden ? 'false' : 'true');
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#tex-card .menu-wrap')) {
      menu.hidden = true;
      $('#tex-new').setAttribute('aria-expanded', 'false');
    }
  });
  $('#tex-upload').addEventListener('click', () => $('#image-input').click());
  $('#image-input').addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const t = await uploadImage(f);
      ctx.selectTexture(t.id);
      ctx.pushHistory();
      ctx.onTexturesChanged();
      ctx.toast(`Added “${t.name}” (${t.size}×${t.size}). Use it with an Image Texture node.`);
    } catch (err) {
      ctx.toast(err.message || 'Could not read that image.');
    }
  });
}
