// BlockGraph app shell: wires the node canvas, the live preview, the inspector,
// the library, presets, undo, saving and the Iris pack export together.

import { NODE_DEFS, CATEGORIES, BINDS, rgbToHex, hexToLinear, normStops, allowedIn } from './nodes.js';
import { defaultParams, collectSettings, inferTypes } from './codegen.js';
import { buildPreview, buildIris, sliderValues, buildNodePreview, previewableNode, PREVIEW_TILE, choiceOptions, choiceIndex, defaultEntityGraph, normShadows, SHADOW_CHOICES } from './targets.js';
import { GraphEditor } from './editor.js';
import { Preview } from './preview.js';
import { PRESETS } from './presets.js';
import { makeZip } from './zip.js';
import * as TX from './textures.js';
import * as MD from './models.js';

const STORE_KEY = 'blockgraph:v1:state';
const WELCOME_KEY = 'blockgraph:v1:welcomed';
const PREVIEWS_KEY = 'blockgraph:v1:previews';
const COLLAPSED_KEY = 'blockgraph:v1:collapsed';
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
};

const downloadsReady = window.claude && typeof window.claude.use === 'function'
  ? window.claude.use('downloads').catch(() => null)
  : Promise.resolve(null);

const GRAPH_INFO = {
  terrain: {
    name: 'Blocks',
    caption: 'Runs on every block, for every pixel. Exports to gbuffers_terrain and gbuffers_water.',
  },
  entity: {
    name: 'Items & Entities',
    caption: 'Runs on held items, dropped items, mobs, players and block entities like chests and signs. Exports to gbuffers_hand, gbuffers_entities and gbuffers_block.',
  },
  post: {
    name: 'Post FX',
    caption: 'Runs once on the finished screen image. Exports to composite.',
  },
  texture: {
    name: 'Texture',
    caption: 'Builds a texture pixel by pixel. It can replace a Minecraft texture (resource pack) or feed shaders via Image Texture.',
  },
  model: {
    name: 'Models',
    caption: 'Real 3D models for blocks and items. They need the BlockGraph Models mod (client side, Fabric 1.21.11). Drag to orbit, shift-drag to pan.',
  },
};

// ---------------------------------------------------------------- state

const state = {
  graphs: null,
  kind: 'terrain',
  views: { terrain: null, entity: null, post: null },
  packName: 'My BlockGraph Pack',
  presetId: 'waving',
  textures: [],
  texSel: null,
  texNext: 1,
  models: [],
  modelSel: null,
  modelNext: 1,
  shadows: normShadows(),
};
const EMPTY_GRAPH = { nodes: [], links: [], nextId: 1 };

// The graph the canvas edits: a shader graph, or the selected texture's graph.
function currentGraph() {
  if (state.kind === 'model') return EMPTY_GRAPH;
  if (state.kind !== 'texture') return state.graphs[state.kind];
  const t = TX.selectedTexture();
  return t && t.kind === 'graph' ? t.graph : EMPTY_GRAPH;
}

function viewKey() {
  return state.kind === 'texture' ? `tex:${TX.selectedTexture()?.id || ''}` : state.kind;
}
let history = [];
let historyIndex = -1;
let showPreviews = true;
let previewImages = new Map();
const previewErrors = new Map();
let collapsedCats = new Set();
let clipboard = null;
let lastPointer = null;

function snapshot() {
  return JSON.stringify({ graphs: state.graphs, packName: state.packName, textures: state.textures, texSel: state.texSel, texNext: state.texNext, models: state.models, modelSel: state.modelSel, modelNext: state.modelNext, shadows: state.shadows });
}

function pushHistory() {
  const s = snapshot();
  if (history[historyIndex] === s) return;
  history = history.slice(0, historyIndex + 1);
  history.push(s);
  if (history.length > 120) history.shift();
  historyIndex = history.length - 1;
  updateUndoButtons();
  save();
}

function restore(s) {
  const data = JSON.parse(s);
  state.graphs = withEntityGraph(data.graphs);
  state.packName = data.packName || state.packName;
  state.textures = data.textures || [];
  state.texSel = data.texSel || null;
  state.texNext = Math.max(state.texNext, data.texNext || 1);
  state.models = data.models || [];
  state.modelSel = data.modelSel || null;
  state.modelNext = Math.max(state.modelNext, data.modelNext || 1);
  state.shadows = normShadows(data.shadows);
  TX.syncRegistry();
  editor.load(currentGraph(), state.views[viewKey()]);
  syncTextureView();
  refreshAll();
  TX.loadAll().then(() => MD.refreshViews());
  MD.renderPanel();
}

function undo() {
  if (historyIndex <= 0) return;
  historyIndex--;
  restore(history[historyIndex]);
  updateUndoButtons();
  save();
  toast('Undone');
}

function redo() {
  if (historyIndex >= history.length - 1) return;
  historyIndex++;
  restore(history[historyIndex]);
  updateUndoButtons();
  save();
  toast('Redone');
}

function updateUndoButtons() {
  $('#btn-undo').disabled = historyIndex <= 0;
  $('#btn-redo').disabled = historyIndex >= history.length - 1;
}

let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const ok = store.set(STORE_KEY, JSON.stringify({ graphs: state.graphs, packName: state.packName, kind: state.kind, presetId: state.presetId, textures: state.textures, texSel: state.texSel, texNext: state.texNext, models: state.models, modelSel: state.modelSel, modelNext: state.modelNext, shadows: state.shadows }));
    if (ok === false && !save.warned) {
      save.warned = true;
      toast('Too big to autosave in this browser. Save a graph file from Export to keep your work.');
    }
    const s = $('#save-state');
    if (s) {
      s.textContent = 'Saved in this browser';
      s.classList.add('flash');
      setTimeout(() => s.classList.remove('flash'), 600);
    }
  }, 400);
}

const graphOk = (g) => g && Array.isArray(g.nodes) && Array.isArray(g.links) && g.nodes.some((n) => NODE_DEFS[n.type]?.isOutput);

function validGraphs(g) {
  return g && ['terrain', 'post'].every((k) => graphOk(g[k]));
}

// Files and autosaves from before the Items & Entities graph have no entity
// graph. They get the default one, which looks like vanilla.
function withEntityGraph(g) {
  if (!graphOk(g.entity)) g.entity = { ...defaultEntityGraph(), needsLayout: true };
  return g;
}

function loadInitial() {
  const raw = store.get(STORE_KEY);
  if (raw) {
    try {
      const d = JSON.parse(raw);
      if (validGraphs(d.graphs)) {
        state.graphs = withEntityGraph(d.graphs);
        state.packName = d.packName || state.packName;
        state.kind = ['entity', 'post', 'texture', 'model'].includes(d.kind) ? d.kind : 'terrain';
        state.presetId = d.presetId || null;
        state.textures = Array.isArray(d.textures) ? d.textures : [];
        state.texSel = d.texSel || null;
        state.texNext = d.texNext || state.textures.length + 1;
        state.models = Array.isArray(d.models) ? d.models : [];
        state.modelSel = d.modelSel || null;
        state.modelNext = d.modelNext || state.models.length + 1;
        state.shadows = normShadows(d.shadows);
        return;
      }
    } catch { /* fall through to the default preset */ }
  }
  state.graphs = withEntityGraph(PRESETS[0].build());
  for (const g of Object.values(state.graphs)) g.needsLayout = true;
}

// ------------------------------------------------------------- compile

let compileTimer = 0;
let lastErrors = [];
let glErrors = null;

function scheduleCompile(delay = 120) {
  clearTimeout(compileTimer);
  compileTimer = setTimeout(compileNow, delay);
}

function compileNow() {
  if (state.kind === 'texture') {
    const t = TX.selectedTexture();
    if (t && t.kind === 'graph') {
      TX.bake(t);
      renderTexErrors(t);
    }
  }
  const built = buildPreview(state.graphs);
  lastErrors = built.errors;
  glErrors = null;
  if (preview.ok) {
    const r = preview.setShaders(built);
    if (!r.ok) glErrors = r;
    preview.setSettings(built.settings);
    preview.setShadows(state.shadows);
  }
  editor.setErrors(lastErrors.filter((e) => e.graph === state.kind || e.graph === null));
  renderStatus();
  renderTabsBadges();
  updateNodePreviews();
}

function liveSettings() {
  if (preview.ok) preview.setSettings(collectSettings(state.graphs).settings);
}

// ---------------------------------------------------------- node previews

function updateNodePreviews() {
  if (!preview.ok) return;
  const g = currentGraph();
  if (!showPreviews) {
    preview.setNodePreviews([], PREVIEW_TILE);
    return;
  }
  const items = [];
  for (const n of g.nodes) {
    if (!previewableNode(NODE_DEFS[n.type])) continue;
    try {
      const np = buildNodePreview({ ...state.graphs, texture: g }, state.kind, n.id);
      items.push({ id: n.id, src: np.src, animated: np.animated });
    } catch { /* a broken node simply gets no thumbnail */ }
  }
  const ids = new Set(g.nodes.map((n) => n.id));
  previewImages = new Map([...previewImages].filter(([id]) => ids.has(id)));
  preview.setNodePreviews(items, PREVIEW_TILE, TX.selectedTexture()?.size || 16);
}

function paintPreviews() {
  for (const [id, r] of previewImages) {
    const c = editor.layer.querySelector(`.node[data-id="${id}"] canvas.node-preview`);
    if (!c) continue;
    const ctx = c.getContext('2d');
    if (r.img) {
      ctx.putImageData(r.img, 0, 0);
    } else {
      ctx.fillStyle = '#2a1214';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.fillStyle = '#ff9a9a';
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.fillText('Code error', 12, 24);
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillText('Details in the inspector', 12, 42);
    }
  }
}

// -------------------------------------------------------------- toasts

let toastTimer = 0;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  t.classList.remove('out');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => { t.hidden = true; }, 220);
  }, 2400);
}

// ---------------------------------------------------------------- editor

const editor = new GraphEditor($('#canvas'), {
  onChange(ev) {
    const node = ev.node != null ? editor.node(ev.node) : null;
    const isSetting = node && NODE_DEFS[node.type]?.setting;
    if (ev.param && isSetting) {
      liveSettings();
      if (ev.commit) {
        pushHistory();
        scheduleCompile();
      }
      renderInspector();
      return;
    }
    if (!ev.moved) scheduleCompile();
    if (ev.structural || ev.commit) pushHistory();
    renderInspector();
    renderStatus();
  },
  onSelect() {
    renderInspector();
  },
  onView(v) {
    state.views[viewKey()] = v;
  },
  onRequestSearch(at) {
    openSearch(at);
  },
  allSettingNames() {
    return [...collectSettings(state.graphs).settings.keys()];
  },
  showPreviews: () => showPreviews,
  textureList: (kind) => TX.textureList(kind),
  defaultTexture: (kind) => TX.defaultTexture(kind),
  onRendered: () => paintPreviews(),
  toast,
});

const preview = new Preview($('#preview'));
preview.onNodePreviews = (map) => {
  previewImages = map;
  let changed = false;
  for (const [id, r] of map) {
    const before = previewErrors.get(id);
    if (r.error) previewErrors.set(id, r.error);
    else previewErrors.delete(id);
    if (before !== previewErrors.get(id)) changed = true;
  }
  paintPreviews();
  if (changed && editor.selection.size === 1 && previewErrors.has([...editor.selection][0])) renderInspector();
};
if (!preview.ok) {
  const m = $('#preview-msg');
  m.hidden = false;
  m.textContent = preview.error;
}

// ---------------------------------------------------------------- tabs

// Spreads out a freshly loaded graph once its nodes (and previews) have a size.
function layoutIfNeeded() {
  const g = currentGraph();
  if (!g.needsLayout) return;
  requestAnimationFrame(() => {
    if (editor.graph !== g) return;
    editor.resolveOverlaps();
    delete g.needsLayout;
    editor.frameAll(true);
    save();
  });
}

function switchGraph(kind) {
  if (kind === state.kind && editor.graph === currentGraph()) return;
  state.kind = kind;
  if (kind === 'texture' && !state.textures.length) {
    TX.newTexture('stone');
    pushHistory();
  }
  for (const b of document.querySelectorAll('.graph-tab')) {
    const on = b.dataset.kind === kind;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  }
  const firstTime = !state.views[viewKey()];
  editor.load(currentGraph(), state.views[viewKey()]);
  syncTextureView();
  if (firstTime) requestAnimationFrame(() => editor.frameAll());
  $('#graph-caption').textContent = GRAPH_INFO[kind].caption;
  renderLibrary();
  renderInspector();
  editor.setErrors(lastErrors.filter((e) => e.graph === kind || e.graph === null));
  previewImages = new Map();
  updateNodePreviews();
  layoutIfNeeded();
  renderStatus();
  save();
}

// Shows or hides the Textures panel and the note for uploaded images.
function syncTextureView() {
  const t = TX.selectedTexture();
  const isImage = state.kind === 'texture' && t && t.kind === 'image';
  $('#image-note').hidden = !isImage;
  if (isImage) $('#image-note-title').textContent = t.name;
  document.querySelector('.app').classList.toggle('mode-texture', state.kind === 'texture');
  document.querySelector('.app').classList.toggle('mode-model', state.kind === 'model');
  $('#model-stage').hidden = state.kind !== 'model';
  TX.renderPanel();
  MD.renderPanel();
}

function selectTexture(id) {
  state.texSel = id;
  if (state.kind === 'texture') {
    const firstTime = !state.views[viewKey()];
    editor.load(currentGraph(), state.views[viewKey()]);
    if (firstTime) requestAnimationFrame(() => editor.frameAll());
    layoutIfNeeded();
    previewImages = new Map();
    updateNodePreviews();
    renderInspector();
  }
  syncTextureView();
  save();
}

function onTexturesChanged() {
  TX.syncRegistry();
  editor.render();
  scheduleCompile();
  renderStatus();
  if (state.kind !== 'texture') renderInspector();
  MD.texturesChanged();
}

// Opens a texture in the Textures tab (from a model's material).
function editTexture(id) {
  state.texSel = id;
  if (state.kind === 'texture') selectTexture(id);
  else switchGraph('texture');
}

function renderTexErrors(t) {
  const err = TX.bakeErrors.get(t.id);
  editor.setErrors(err ? [{ node: editor.graph.nodes.find((n) => NODE_DEFS[n.type]?.isOutput)?.id, msg: 'This texture graph does not compile. See the Textures panel.' }] : []);
}

function renderTabsBadges() {
  for (const b of document.querySelectorAll('.graph-tab')) {
    const n = lastErrors.filter((e) => e.graph === b.dataset.kind).length;
    const badge = b.querySelector('.tab-badge');
    badge.hidden = !n;
    badge.textContent = n;
  }
}

// ------------------------------------------------------------- library

function nodeAllowed(def, kind) {
  return allowedIn(def, kind);
}

function matches(def, q) {
  if (!q) return true;
  const hay = `${def.title} ${def.cat} ${def.keywords || ''} ${def.desc}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
}

function renderLibrary() {
  const list = $('#lib-list');
  const q = $('#lib-search').value.trim();
  list.textContent = '';
  let total = 0;
  for (const cat of CATEGORIES) {
    const defs = Object.values(NODE_DEFS).filter((d) => d.cat === cat.id && nodeAllowed(d, state.kind) && matches(d, q));
    if (!defs.length) continue;
    total += defs.length;
    const sec = el('section', 'lib-cat');
    const h = el('h3');
    const open = !!q || !collapsedCats.has(cat.id);
    const tog = el('button', 'lib-cat-toggle');
    tog.type = 'button';
    tog.setAttribute('aria-expanded', open ? 'true' : 'false');
    tog.append(el('span', 'lib-caret'), el('span', null, cat.label), el('span', 'lib-count', String(defs.length)));
    tog.addEventListener('click', () => {
      if (collapsedCats.has(cat.id)) collapsedCats.delete(cat.id);
      else collapsedCats.add(cat.id);
      store.set(COLLAPSED_KEY, JSON.stringify([...collapsedCats]));
      renderLibrary();
    });
    h.append(tog);
    sec.append(h);
    const ul = el('div', 'lib-items');
    ul.hidden = !open;
    for (const d of defs) {
      const b = el('button', `lib-item cat-${d.cat.toLowerCase()}`);
      b.type = 'button';
      b.draggable = true;
      b.title = d.desc;
      b.append(el('span', 'lib-dot'), el('span', 'lib-name', d.title));
      if (d.setting) b.append(el('span', 'lib-tag', 'Iris'));
      b.addEventListener('click', () => addAtCenter(d.type));
      b.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('application/x-blockgraph-node', d.type);
        e.dataTransfer.effectAllowed = 'copy';
      });
      ul.append(b);
    }
    sec.append(ul);
    list.append(sec);
  }
  if (!total) list.append(el('p', 'lib-empty', q ? `No nodes match "${q}" in the ${GRAPH_INFO[state.kind].name} graph.` : 'No nodes.'));
}

let addOffset = 0;
function addAtCenter(type) {
  if (state.kind === 'texture' && TX.selectedTexture()?.kind !== 'graph') {
    toast('Uploaded images have no node graph. Pick or create a node texture first.');
    return;
  }
  const [cx, cy] = editor.center();
  addOffset = (addOffset + 24) % 120;
  const n = editor.addNode(type, cx - 90 + addOffset, cy - 50 + addOffset);
  if (!n) return;
  editor.selection = new Set([n.id]);
  editor.changed(true);
  renderInspector();
  if (document.querySelector('.app').dataset.mobile === 'nodes') setMobile('graph');
}

// --------------------------------------------------------------- search

let searchCtx = null;
function openSearch(at) {
  const pop = $('#search-pop');
  searchCtx = at;
  pop.hidden = false;
  const r = document.body.getBoundingClientRect();
  const w = 300, h = 360;
  const x = Math.min(Math.max(8, at.clientX), r.width - w - 8);
  const y = Math.min(Math.max(8, at.clientY), window.innerHeight - h - 8);
  pop.style.left = x + 'px';
  pop.style.top = y + 'px';
  const input = $('#search-input');
  input.value = '';
  renderSearch();
  input.focus();
}

function closeSearch() {
  $('#search-pop').hidden = true;
  searchCtx = null;
}

let searchIndex = 0;
function renderSearch() {
  const q = $('#search-input').value.trim();
  const list = $('#search-list');
  list.textContent = '';
  const defs = Object.values(NODE_DEFS).filter((d) => nodeAllowed(d, state.kind) && matches(d, q));
  if (searchCtx?.pending?.from) defs.sort((a, b) => (b.inputs.length > 0) - (a.inputs.length > 0));
  searchIndex = 0;
  defs.slice(0, 40).forEach((d, i) => {
    const b = el('button', `search-item cat-${d.cat.toLowerCase()}`);
    b.type = 'button';
    b.setAttribute('role', 'option');
    b.dataset.type = d.type;
    b.append(el('span', 'lib-dot'), el('span', 'search-name', d.title), el('span', 'search-cat', d.cat));
    if (i === 0) b.classList.add('active');
    b.addEventListener('click', () => chooseSearch(d.type));
    list.append(b);
  });
  if (!list.children.length) list.append(el('p', 'lib-empty', 'No matching nodes.'));
}

function moveSearch(delta) {
  const items = [...document.querySelectorAll('.search-item')];
  if (!items.length) return;
  items[searchIndex]?.classList.remove('active');
  searchIndex = (searchIndex + delta + items.length) % items.length;
  items[searchIndex].classList.add('active');
  items[searchIndex].scrollIntoView({ block: 'nearest' });
}

function chooseSearch(type) {
  const at = searchCtx;
  closeSearch();
  if (!at) return;
  const def = NODE_DEFS[type];
  const node = editor.addNode(type, at.x, at.y);
  if (!node) return;
  if (at.pending) {
    const types = inferTypes(editor.graph, state.kind);
    if (at.pending.from) {
      const srcType = types.get(at.pending.from.node)?.out[at.pending.from.port] || 'float';
      const target = def.inputs.find((p) => p.type === srcType) || def.inputs.find((p) => p.type === 'dyn') || def.inputs[0];
      if (target) {
        editor.connect(at.pending.from, { node: node.id, port: target.id });
        const idx = def.inputs.indexOf(target);
        node.x = Math.round(at.x);
        node.y = Math.round(at.y - (34 + 6 + idx * 26 + 13));
      }
    } else if (at.pending.to) {
      const wantType = types.get(at.pending.to.node)?.in[at.pending.to.port] || 'float';
      const src = def.outputs.find((o) => o.type === wantType) || def.outputs[0];
      if (src) {
        editor.connect({ node: node.id, port: src.id }, at.pending.to);
        const idx = def.outputs.indexOf(src);
        node.x = Math.round(at.x - (def.width || 180));
        node.y = Math.round(at.y - (34 + 6 + idx * 26 + 13));
      }
    }
  }
  editor.selection = new Set([node.id]);
  editor.changed(true);
  renderInspector();
}

// ------------------------------------------------------------- inspector

function field(label, control, hint) {
  const wrap = el('label', 'field');
  wrap.append(el('span', 'field-label', label), control);
  if (hint) wrap.append(el('span', 'field-hint', hint));
  return wrap;
}

function numInput(value, onCommit, step = 0.05) {
  const i = el('input', 'in-num');
  i.type = 'number';
  i.step = step;
  i.value = Math.round(Number(value) * 1000) / 1000;
  i.addEventListener('change', () => onCommit(Number(i.value) || 0));
  return i;
}

function renderInspector() {
  const box = $('#inspector');
  box.textContent = '';
  const sel = [...editor.selection].map((id) => editor.node(id)).filter(Boolean);

  if (sel.length > 1) {
    box.append(el('p', 'insp-eyebrow', 'Selection'), el('h2', 'insp-title', `${sel.length} nodes selected`));
    const row = el('div', 'insp-actions');
    const dup = el('button', 'btn ghost', 'Duplicate');
    dup.type = 'button';
    dup.addEventListener('click', () => { editor.paste(editor.copySelection()); });
    const del = el('button', 'btn danger', 'Delete');
    del.type = 'button';
    del.addEventListener('click', () => editor.deleteSelection());
    row.append(dup, del);
    box.append(row);
    return;
  }

  if (sel.length === 1) {
    renderNodeInspector(box, sel[0]);
    return;
  }
  renderGraphInspector(box);
}

function renderNodeInspector(box, node) {
  const def = NODE_DEFS[node.type];
  const head = el('div', 'insp-head');
  head.append(el('span', `insp-cat cat-${def.cat.toLowerCase()}`, CATEGORIES.find((c) => c.id === def.cat)?.label || def.cat));
  box.append(head, el('h2', 'insp-title', def.title), el('p', 'insp-desc', def.desc));

  const errs = lastErrors.filter((e) => e.node === node.id && (e.graph === state.kind || e.graph === null));
  for (const e of errs) box.append(el('p', 'insp-error', e.msg));

  node.params = node.params || {};
  const P = { ...defaultParams(def), ...node.params };
  const commit = (recompile = true) => {
    pushHistory();
    if (recompile) scheduleCompile();
    liveSettings();
    editor.render();
    renderStatus();
  };

  if (def.setting) {
    const sec = el('section', 'insp-sec');
    sec.append(el('h3', null, 'In-game setting'));
    const idIn = el('input', 'in-text');
    idIn.value = P.name;
    idIn.spellcheck = false;
    const idErr = el('span', 'field-hint');
    idIn.addEventListener('change', () => {
      const v = idIn.value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
      if (!/^[A-Z][A-Z0-9_]{0,40}$/.test(v) || /^(GL_|MC_|IRIS_|TG_|BG_)/.test(v)) {
        idErr.textContent = 'Use capital letters, digits and _. Start with a letter. Avoid GL_, MC_, IRIS_, TG_ and BG_.';
        idErr.classList.add('bad');
        return;
      }
      idErr.classList.remove('bad');
      idErr.textContent = 'The name used in the shader code and shaders.properties.';
      node.params.name = v;
      idIn.value = v;
      commit();
    });
    idErr.textContent = 'The name used in the shader code and shaders.properties.';
    const lbl = el('label', 'field');
    lbl.append(el('span', 'field-label', 'Setting ID'), idIn, idErr);
    sec.append(lbl);

    const labelIn = el('input', 'in-text');
    labelIn.value = P.label;
    labelIn.addEventListener('change', () => { node.params.label = labelIn.value.trim() || P.name; commit(false); });
    sec.append(field('Label in Iris menu', labelIn));

    if (def.setting === 'slider') {
      const grid = el('div', 'field-grid');
      for (const k of ['min', 'max', 'step']) {
        grid.append(field(k[0].toUpperCase() + k.slice(1), numInput(P[k], (v) => {
          node.params[k] = k === 'step' ? Math.max(0.001, Math.abs(v)) : v;
          if (k !== 'step') node.params.value = Math.min(Math.max(node.params.value ?? P.value, Math.min(node.params.min ?? P.min, node.params.max ?? P.max)), Math.max(node.params.min ?? P.min, node.params.max ?? P.max));
          commit();
          renderInspector();
        }, 0.1)));
      }
      sec.append(grid);
      const range = el('input', 'in-range');
      range.type = 'range';
      range.min = P.min;
      range.max = P.max;
      range.step = P.step;
      range.value = P.value;
      const out = el('output', 'in-range-val', String(P.value));
      range.addEventListener('input', () => {
        node.params.value = Number(range.value);
        out.textContent = range.value;
        liveSettings();
        editor.render();
      });
      range.addEventListener('change', () => commit());
      const rr = el('div', 'range-row');
      rr.append(range, out);
      sec.append(field('Default value', rr, 'Players start here. The preview uses it too.'));
      const { vals } = sliderValues(P);
      sec.append(el('p', 'field-hint', `Iris will offer ${vals.length} steps from ${vals[0]} to ${vals[vals.length - 1]}.`));
    } else if (def.setting === 'choice') {
      const opts = el('input', 'in-text');
      opts.value = P.options;
      opts.addEventListener('change', () => {
        node.params.options = choiceOptions({ options: opts.value }).join(', ');
        node.params.value = choiceIndex({ ...P, options: node.params.options, value: node.params.value ?? P.value });
        commit();
        renderInspector();
      });
      sec.append(field('Choices', opts, 'Separate them with commas. The node outputs 0 for the first, 1 for the second, and so on.'));
      const sel = el('select', 'in-select');
      choiceOptions(P).forEach((o, i) => {
        const opt = el('option', null, `${i} · ${o}`);
        opt.value = String(i);
        sel.append(opt);
      });
      sel.value = String(choiceIndex(P));
      sel.addEventListener('change', () => { node.params.value = Number(sel.value); liveSettings(); commit(); });
      sec.append(field('Default choice', sel));
    } else {
      const sw = el('label', 'ctl-switch');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = !!P.value;
      cb.addEventListener('change', () => { node.params.value = cb.checked; liveSettings(); commit(); });
      sw.append(cb, el('span', 'switch'), el('span', null, 'On by default'));
      sec.append(sw);
    }
    box.append(sec);
  } else if (def.params.length) {
    const sec = el('section', 'insp-sec');
    sec.append(el('h3', null, 'Options'));
    for (const p of def.params) {
      if (p.kind === 'number') sec.append(field(p.name, numInput(P[p.id], (v) => { node.params[p.id] = v; commit(); }, p.step)));
      else if (p.kind === 'color') {
        const c = el('input', 'in-color');
        c.type = 'color';
        c.value = P[p.id];
        c.addEventListener('input', () => { node.params[p.id] = c.value; scheduleCompile(60); });
        c.addEventListener('change', () => commit());
        sec.append(field(p.name, c));
      } else if (p.kind === 'select') {
        const s = el('select', 'in-select');
        for (const o of p.options) {
          const opt = el('option', null, o);
          opt.value = o;
          s.append(opt);
        }
        s.value = P[p.id];
        s.addEventListener('change', () => { node.params[p.id] = s.value; commit(); });
        sec.append(field(p.name, s));
      } else if (p.kind === 'bool') {
        const sw = el('label', 'ctl-switch');
        const cb = el('input');
        cb.type = 'checkbox';
        cb.checked = !!P[p.id];
        cb.addEventListener('change', () => { node.params[p.id] = cb.checked; commit(); });
        sw.append(cb, el('span', 'switch'), el('span', null, p.name));
        sec.append(sw);
      } else if (p.kind === 'swizzle') {
        const t = el('input', 'in-text mono');
        t.value = P[p.id];
        t.maxLength = 4;
        t.spellcheck = false;
        t.addEventListener('change', () => { node.params[p.id] = t.value; commit(); renderInspector(); });
        sec.append(field(p.name, t, 'Up to four of x y z w (or r g b a). The output size follows the length.'));
      } else if (p.kind === 'note') {
        const ta = el('textarea', 'in-code');
        ta.value = P[p.id];
        ta.rows = 6;
        ta.addEventListener('change', () => { node.params[p.id] = ta.value; pushHistory(); editor.render(); });
        sec.append(field(p.name, ta));
      } else if (p.kind === 'code') {
        const ta = el('textarea', 'in-code mono');
        ta.value = P[p.id];
        ta.rows = 9;
        ta.spellcheck = false;
        ta.addEventListener('keydown', (e) => {
          if (e.key === 'Tab') {
            e.preventDefault();
            const a = ta.selectionStart;
            ta.setRangeText('  ', a, ta.selectionEnd, 'end');
          }
        });
        const apply = el('button', 'btn ghost small', 'Apply code');
        apply.type = 'button';
        apply.addEventListener('click', () => { node.params[p.id] = ta.value; commit(); });
        ta.addEventListener('change', () => { node.params[p.id] = ta.value; commit(); });
        const outT = P.outType || 'vec3';
        sec.append(field(p.name, ta, `Becomes: ${outT} bg_custom_${node.id}(vec4 a, vec4 b, vec4 c, vec4 d, float time) { … }`), apply);
        const log = previewErrors.get(node.id) || (glErrors && [glErrors.terrainError, glErrors.entityError, glErrors.postError].filter(Boolean).join('\n'));
        if (log) {
          const lines = log.split('\n').filter((l) => /ERROR/i.test(l)).slice(0, 4);
          if (lines.length) box.append(el('pre', 'insp-error mono', lines.join('\n')));
        }
      } else if (p.kind === 'gradient') {
        sec.append(gradientEditor(normStops(P[p.id]), (stops) => { node.params[p.id] = stops; commit(); renderInspector(); }));
      } else if (p.kind === 'texture') {
        const sel = el('select', 'in-select');
        const none = el('option', null, 'Choose a texture…');
        none.value = '';
        sel.append(none);
        for (const t of TX.textureList(state.kind)) {
          const o = el('option', null, t.name);
          o.value = t.id;
          sel.append(o);
        }
        sel.value = P[p.id] || '';
        sel.addEventListener('change', () => { node.params[p.id] = sel.value; commit(); });
        const hint = state.kind === 'texture'
          ? 'Texture graphs can read uploaded images. Upload one in the Textures panel.'
          : 'Build or upload textures in the Textures tab. Magenta means no texture is picked.';
        sec.append(field(p.name, sel, hint));
        const open = el('button', 'btn ghost small', 'Open Textures tab');
        open.type = 'button';
        open.addEventListener('click', () => {
          if (P[p.id] && TX.texById(P[p.id])) state.texSel = P[p.id];
          switchGraph('texture');
        });
        sec.append(open);
      }
    }
    box.append(sec);
  }

  // Inputs
  const types = inferTypes(editor.graph, state.kind).get(node.id) || { in: {} };
  if (def.inputs.length) {
    const sec = el('section', 'insp-sec');
    sec.append(el('h3', null, 'Inputs'));
    const tbl = el('div', 'insp-ports');
    for (const ip of def.inputs) {
      const row = el('div', 'insp-port');
      const name = el('span', `insp-port-name t-${types.in[ip.id] || ip.type}`);
      name.append(el('span', 'dot'), document.createTextNode(ip.name));
      row.append(name);
      const link = editor.linkInto(node.id, ip.id);
      if (link) {
        const src = editor.node(link.from.node);
        const sd = NODE_DEFS[src?.type];
        const out = sd?.outputs.find((o) => o.id === link.from.port);
        row.append(el('span', 'insp-port-val', `← ${sd?.title || '?'} · ${out?.name || link.from.port}`));
      } else if (ip.bind) {
        row.append(el('span', 'insp-port-val muted', `Uses ${BINDS[state.kind]?.[ip.bind]?.label || ip.bind}`));
      } else {
        const v = node.defaults?.[ip.id] ?? ip.def ?? 0;
        if (Array.isArray(v)) {
          if (ip.color) {
            const c = el('input', 'in-color');
            c.type = 'color';
            c.value = rgbToHex(v);
            c.addEventListener('input', () => { node.defaults = node.defaults || {}; node.defaults[ip.id] = hexToLinear(c.value); scheduleCompile(60); });
            c.addEventListener('change', () => commit());
            row.append(c);
          } else {
            const g = el('div', 'vec-inputs');
            v.forEach((x, i) => {
              const ni = numInput(x, (nv) => {
                node.defaults = node.defaults || {};
                const arr = [...(node.defaults[ip.id] || v)];
                arr[i] = nv;
                node.defaults[ip.id] = arr;
                commit();
              });
              ni.setAttribute('aria-label', `${ip.name} ${'xyzw'[i]}`);
              g.append(ni);
            });
            row.append(g);
          }
        } else {
          const ni = numInput(v, (nv) => { node.defaults = node.defaults || {}; node.defaults[ip.id] = nv; commit(); });
          ni.setAttribute('aria-label', ip.name);
          row.append(ni);
        }
      }
      if (ip.stage === 'vertex') row.append(el('span', 'insp-note', 'Moves vertices. Runs before pixels are drawn.'));
      tbl.append(row);
    }
    sec.append(tbl);
    box.append(sec);
  }

  if (!def.isOutput) {
    const row = el('div', 'insp-actions');
    const dup = el('button', 'btn ghost', 'Duplicate');
    dup.type = 'button';
    dup.addEventListener('click', () => editor.paste(editor.copySelection()));
    const del = el('button', 'btn danger', 'Delete node');
    del.type = 'button';
    del.addEventListener('click', () => editor.deleteSelection());
    row.append(dup, del);
    box.append(row);
  }
}

function gradientEditor(stops, onCommit) {
  const wrap = el('div', 'grad-editor');
  const strip = el('div', 'ctl-gradient big');
  strip.style.background = `linear-gradient(90deg, ${stops.map((s) => `${s.c} ${s.t * 100}%`).join(', ')})`;
  wrap.append(strip);
  stops.forEach((s, i) => {
    const row = el('div', 'grad-row');
    const c = el('input', 'in-color');
    c.type = 'color';
    c.value = s.c;
    c.setAttribute('aria-label', `Stop ${i + 1} colour`);
    c.addEventListener('change', () => { stops[i].c = c.value; onCommit(stops); });
    const pos = numInput(s.t, (v) => { stops[i].t = Math.max(0, Math.min(1, v)); onCommit(stops); }, 0.05);
    pos.setAttribute('aria-label', `Stop ${i + 1} position`);
    const del = el('button', 'btn icon small', '×');
    del.type = 'button';
    del.setAttribute('aria-label', `Remove stop ${i + 1}`);
    del.disabled = stops.length <= 2;
    del.addEventListener('click', () => { stops.splice(i, 1); onCommit(stops); });
    row.append(c, pos, del);
    wrap.append(row);
  });
  const add = el('button', 'btn ghost small', 'Add stop');
  add.type = 'button';
  add.disabled = stops.length >= 8;
  add.addEventListener('click', () => {
    const last = stops[stops.length - 1];
    const prev = stops[stops.length - 2] || last;
    stops.push({ c: last.c, t: Math.min(1, (prev.t + last.t) / 2 + 0.25) });
    onCommit(stops);
  });
  wrap.append(add);
  return wrap;
}

function renderGraphInspector(box) {
  const kind = state.kind;
  if (kind === 'texture') {
    const t = TX.selectedTexture();
    box.append(el('p', 'insp-eyebrow', 'Texture graph'), el('h2', 'insp-title', t ? t.name : 'Textures'), el('p', 'insp-desc', GRAPH_INFO.texture.caption));
    const sec = el('section', 'insp-sec');
    sec.append(el('h3', null, 'How it works'));
    const ul = el('ul', 'tips');
    for (const [a, b] of [
      ['Pixels', 'Every pixel runs the graph once. Texture Coordinate gives its UV and pixel position.'],
      ['Blender nodes', 'Brick, Wave, Magic, Musgrave, Voronoi and Noise work like their Blender versions.'],
      ['Paint', 'Paint over the result in the panel above. The eraser shows the nodes again.'],
      ['Use it', 'Set “Replaces” to put it in the resource pack, or pick it in an Image Texture node.'],
    ]) {
      const li = el('li');
      li.append(el('strong', null, a), el('span', null, b));
      ul.append(li);
    }
    sec.append(ul);
    box.append(sec);
    return;
  }
  box.append(el('p', 'insp-eyebrow', 'Graph'), el('h2', 'insp-title', `${GRAPH_INFO[kind].name} graph`), el('p', 'insp-desc', GRAPH_INFO[kind].caption));

  const { settings } = collectSettings(state.graphs);
  const sec = el('section', 'insp-sec');
  sec.append(el('h3', null, 'Iris settings menu'));
  {
    const mock = el('div', 'iris-menu');
    mock.append(el('div', 'iris-menu-title', state.packName));
    const page = el('button', 'iris-option');
    page.type = 'button';
    page.append(el('span', null, 'Shadows...'));
    page.title = 'Open the Shadows settings below';
    page.addEventListener('click', () => {
      const t = document.getElementById('shadow-sec');
      if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    mock.append(page);
    for (const [name, s] of settings) {
      const b = el('button', 'iris-option');
      b.type = 'button';
      const sv = sliderValues(s);
      const val = s.kind === 'toggle' ? (s.value ? 'ON' : 'OFF') : s.kind === 'choice' ? choiceOptions(s)[choiceIndex(s)] : sv.value.toFixed(sv.dec);
      b.append(el('span', null, `${s.label || name}: `), el('span', `iris-val ${s.kind === 'toggle' ? (s.value ? 'on' : 'off') : ''}`, val));
      if (s.kind === 'slider') {
        const pct = (sv.value - s.min) / ((s.max - s.min) || 1);
        const bar = el('span', 'iris-slider');
        bar.style.setProperty('--pct', `${Math.max(0, Math.min(1, pct)) * 100}%`);
        b.prepend(bar);
      }
      b.title = 'Select the node that owns this setting';
      b.addEventListener('click', () => {
        if (s.graph !== state.kind) switchGraph(s.graph);
        editor.select([s.node]);
      });
      mock.append(b);
    }
    sec.append(mock, el('p', 'field-hint', settings.size
      ? 'This is how your settings will look in Iris → Shader Settings. Click one to jump to its node.'
      : 'Add a Slider Setting or On/Off Setting node, and it appears here and in Iris → Shader Settings.'));
  }
  box.append(sec);
  box.append(shadowSection());

  const tips = el('section', 'insp-sec');
  tips.append(el('h3', null, 'Quick moves'));
  const ul = el('ul', 'tips');
  for (const t of [
    ['Add a node', 'Right-click or double-click the canvas, or press Space'],
    ['Connect', 'Drag from an output dot to an input dot'],
    ['Move a wire', 'Drag it off the input it plugs into'],
    ['Select many', 'Shift-drag on empty canvas'],
    ['Delete', 'Select, then press Delete'],
    ['Undo', 'Ctrl+Z (Cmd+Z on Mac)'],
  ]) {
    const li = el('li');
    li.append(el('strong', null, t[0]), el('span', null, t[1]));
    ul.append(li);
  }
  tips.append(ul);
  box.append(tips);
}

// Pack-wide sun shadows. Strength, softness and sun angle show up live in the
// preview; quality and distance only matter in game.
function shadowSection() {
  const sh = state.shadows;
  const sec = el('section', 'insp-sec');
  sec.id = 'shadow-sec';
  sec.append(el('h3', null, 'Shadows'));
  const commit = () => { preview.setShadows(state.shadows); pushHistory(); };
  const sw = el('label', 'ctl-switch');
  const cb = el('input');
  cb.type = 'checkbox';
  cb.checked = sh.on;
  cb.addEventListener('change', () => {
    state.shadows = { ...state.shadows, on: cb.checked };
    commit();
    renderInspector();
  });
  sw.append(cb, el('span', 'switch'), el('span', null, 'Sun shadows'));
  sec.append(sw, el('p', 'field-hint', 'Blocks, mobs and chests cast shadows from the sun. Players can still turn them off in Iris → Shader Settings → Shadows.'));
  if (!sh.on) return sec;

  const slider = (label, key, list, fmt, hint) => {
    const range = el('input', 'in-range');
    range.type = 'range';
    range.min = '0';
    range.max = String(list.length - 1);
    range.step = '1';
    range.value = String(Math.max(0, list.indexOf(sh[key])));
    range.setAttribute('aria-label', label);
    const out = el('output', 'in-range-val', fmt(sh[key]));
    range.addEventListener('input', () => {
      state.shadows = { ...state.shadows, [key]: list[Number(range.value)] };
      out.textContent = fmt(state.shadows[key]);
      preview.setShadows(state.shadows);
    });
    range.addEventListener('change', () => pushHistory());
    const rr = el('div', 'range-row');
    rr.append(range, out);
    sec.append(field(label, rr, hint));
  };
  slider('Strength', 'strength', SHADOW_CHOICES.strength, (v) => `${Math.round(v * 100)}%`, 'How dark shadows get. Only sunlight is blocked; torches still light shadowed spots.');
  slider('Softness', 'softness', SHADOW_CHOICES.softness, (v) => v.toFixed(2), 'Blur on the edges, in shadow map pixels. 0 is pixel-sharp.');
  slider('Sun angle', 'sunAngle', SHADOW_CHOICES.sunAngle, (v) => `${v}°`, 'Tilts the sun’s path (sunPathRotation) so shadows fall to one side at noon.');

  const select = (label, key, list, fmt, hint) => {
    const s = el('select', 'in-select');
    for (const v of list) {
      const o = el('option', null, fmt(v));
      o.value = String(v);
      s.append(o);
    }
    s.value = String(sh[key]);
    s.addEventListener('change', () => {
      state.shadows = { ...state.shadows, [key]: Number(s.value) };
      commit();
    });
    sec.append(field(label, s, hint));
  };
  select('Quality', 'resolution', SHADOW_CHOICES.resolution, (v) => `${v} × ${v}${v === 2048 ? ' (default)' : ''}`, 'Shadow map size in game. Higher is sharper and costs more FPS.');
  select('Distance', 'distance', SHADOW_CHOICES.distance, (v) => `${v} blocks`, 'How far from the player shadows are drawn in game.');
  return sec;
}

// --------------------------------------------------------------- status

function renderStatus() {
  const s = $('#status-msg');
  const chip = $('#status-chip');
  const errs = lastErrors.length + (glErrors ? 1 : 0);
  chip.className = 'status-chip ' + (errs ? 'bad' : 'good');
  chip.textContent = errs ? `${errs} problem${errs > 1 ? 's' : ''}` : 'Compiled';
  if (glErrors) {
    const msg = (glErrors.terrainError || glErrors.entityError || glErrors.postError || '').split('\n').find((l) => l.trim()) || 'Shader error';
    s.textContent = `Preview compile error: ${msg}`;
  } else if (lastErrors.length) {
    s.textContent = lastErrors[0].msg;
  } else {
    s.textContent = 'Preview is live. Export when it looks right.';
  }
  const { settings } = collectSettings(state.graphs);
  $('#status-counts').textContent = `Blocks ${state.graphs.terrain.nodes.length} · Items ${state.graphs.entity.nodes.length} · Post FX ${state.graphs.post.nodes.length} nodes · ${state.textures.length} texture${state.textures.length === 1 ? '' : 's'} · ${state.models.length} model${state.models.length === 1 ? '' : 's'} · ${settings.size} setting${settings.size === 1 ? '' : 's'}`;
}

function refreshAll() {
  renderLibrary();
  renderInspector();
  scheduleCompile(0);
  $('#graph-caption').textContent = GRAPH_INFO[state.kind].caption;
  syncTextureView();
}

// ---------------------------------------------------------------- modals

function openModal(title, body, opts = {}) {
  const m = $('#modal');
  const card = $('#modal-card');
  card.className = 'modal-card' + (opts.wide ? ' wide' : '');
  $('#modal-title').textContent = title;
  const b = $('#modal-body');
  b.textContent = '';
  b.append(body);
  m.hidden = false;
  requestAnimationFrame(() => m.classList.add('open'));
  $('#modal-close').focus();
}

function closeModal() {
  const m = $('#modal');
  m.classList.remove('open');
  m.hidden = true;
}

function highlight(code) {
  const esc = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const re = /(\/\*[\s\S]*?\*\/|\/\/[^\n]*)|(^[ \t]*#[^\n]*)|\b(uniform|in|out|flat|const|layout|void|return|if|else|for|break|discard|float|int|bool|vec2|vec3|vec4|mat3|mat4|sampler2D)\b|\b(\d+\.\d*(?:e-?\d+)?|\d+)\b|\b(bg_[A-Za-z0-9_]+|n\d+_[A-Za-z0-9_]+)\b/gm;
  return esc.replace(re, (m, com, pre, kw, num, ours) => {
    if (com) return `<span class="hl-com">${m}</span>`;
    if (pre) return `<span class="hl-pre">${m}</span>`;
    if (kw) return `<span class="hl-kw">${m}</span>`;
    if (num) return `<span class="hl-num">${m}</span>`;
    if (ours) return `<span class="hl-ours">${m}</span>`;
    return m;
  });
}

async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied to clipboard');
  } catch {
    const pre = btn?.closest('.code-pane')?.querySelector('pre');
    if (pre) {
      const r = document.createRange();
      r.selectNodeContents(pre);
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
      toast('Press Ctrl+C to copy the selected code');
    }
  }
}

function openCode() {
  const { files, errors } = buildIris(state.graphs, { name: state.packName, modelBlocks: MD.modelBlocks(), shadows: state.shadows });
  const wrap = el('div', 'code-view');
  const order = ['shaders/gbuffers_terrain.fsh', 'shaders/gbuffers_terrain.vsh', 'shaders/gbuffers_entities.fsh', 'shaders/gbuffers_entities.vsh', 'shaders/gbuffers_hand.fsh', 'shaders/composite1.fsh', 'shaders/composite.fsh', 'shaders/shadow.vsh', 'shaders/shadow.fsh', 'shaders/shaders.properties', 'shaders/block.properties', 'shaders/item.properties', 'shaders/entity.properties', 'shaders/lang/en_us.lang'];
  const names = [...order, ...Object.keys(files).filter((f) => !order.includes(f))];
  const tabs = el('div', 'code-tabs');
  tabs.setAttribute('role', 'tablist');
  const pane = el('div', 'code-pane');
  const bar = el('div', 'code-bar');
  const path = el('span', 'code-path');
  const copy = el('button', 'btn ghost small', 'Copy file');
  copy.type = 'button';
  bar.append(path, copy);
  const pre = el('pre', 'code');
  pane.append(bar, pre);
  let current = names[0];
  const show = (name) => {
    current = name;
    path.textContent = name;
    pre.innerHTML = highlight(files[name]);
    for (const t of tabs.children) t.classList.toggle('active', t.dataset.file === name);
  };
  for (const n of names) {
    const t = el('button', 'code-tab', n.replace('shaders/', ''));
    t.type = 'button';
    t.dataset.file = n;
    t.addEventListener('click', () => show(n));
    tabs.append(t);
  }
  copy.addEventListener('click', () => copyText(files[current], copy));
  const intro = el('p', 'modal-lead', 'This is the GLSL your nodes turn into. The graph writes it for you, the same way Unity Shader Graph writes HLSL. Lines starting with n12_ belong to node 12.');
  wrap.append(intro);
  if (errors.length) wrap.append(el('p', 'insp-error', `${errors.length} problem${errors.length > 1 ? 's' : ''} to fix first: ${errors[0].msg}`));
  wrap.append(tabs, pane);
  show(current);
  openModal('Generated shader code', wrap, { wide: true });
}

function slug(s) {
  return (s || 'blockgraph-pack').trim().replace(/[^A-Za-z0-9 _-]/g, '').replace(/\s+/g, '_').slice(0, 60) || 'BlockGraph_Pack';
}

async function saveFile(filename, blob) {
  const dl = await downloadsReady;
  if (dl) {
    try {
      await dl.save({ filename, data: blob });
      toast(`Saved ${filename}`);
    } catch (e) {
      if (e?.code === 'declined') toast('Download cancelled');
      else if (e?.code === 'rate_limited') toast('A download prompt is already open');
      else toast(`Couldn't save the file here (${e?.code || 'error'}). Use View code to copy the files.`);
    }
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = el('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast(`Downloading ${filename}`);
}

function graphJSON() {
  return JSON.stringify({ app: 'BlockGraph', version: 3, packName: state.packName, graphs: state.graphs, textures: state.textures, texNext: state.texNext, models: state.models, modelNext: state.modelNext, shadows: state.shadows, meshes: MD.meshesForFile() }, null, 2);
}

function openExport() {
  const wrap = el('div', 'export-view');
  const { files, errors, settings } = buildIris(state.graphs, { name: state.packName, modelBlocks: MD.modelBlocks(), shadows: state.shadows });

  const nameIn = el('input', 'in-text');
  nameIn.id = 'pack-name';
  nameIn.value = state.packName;
  nameIn.maxLength = 60;
  nameIn.addEventListener('input', () => {
    state.packName = nameIn.value;
    fileLabel.textContent = `${slug(nameIn.value)}.zip`;
  });
  nameIn.addEventListener('change', () => pushHistory());
  const fileLabel = el('code', null, `${slug(state.packName)}.zip`);
  const nameField = field('Pack name', nameIn);
  const hint = el('span', 'field-hint');
  hint.append('Saves as ', fileLabel);
  nameField.append(hint);
  wrap.append(nameField);

  if (glErrors) {
    const w = el('div', 'insp-error');
    w.textContent = 'The preview shader does not compile (often a typo in a Custom Function). Iris will fail on the same code, so fix it before exporting.';
    wrap.append(w);
  }
  if (errors.length) {
    const warn = el('div', 'insp-error');
    warn.textContent = `Fix ${errors.length} problem${errors.length > 1 ? 's' : ''} first, or the pack may not load: ${errors[0].msg}`;
    wrap.append(warn);
  }

  const sum = el('div', 'export-grid');
  const fileCount = Object.keys(files).length;
  const stats = [
    [String(fileCount), 'files in the pack'],
    [String(state.graphs.terrain.nodes.length + state.graphs.entity.nodes.length + state.graphs.post.nodes.length), 'nodes compiled'],
    [String(settings.size), `in-game setting${settings.size === 1 ? '' : 's'}`],
  ];
  for (const [n, l] of stats) {
    const c = el('div', 'export-stat');
    c.append(el('strong', null, n), el('span', null, l));
    sum.append(c);
  }
  wrap.append(sum);

  const actions = el('div', 'export-actions');
  const dl = el('button', 'btn primary big', 'Download shader pack (.zip)');
  dl.type = 'button';
  dl.addEventListener('click', async () => {
    const tex = await TX.shaderTextureFiles(state.graphs);
    const built = buildIris(state.graphs, { name: state.packName, customTextures: tex.list, modelBlocks: MD.modelBlocks(), shadows: state.shadows });
    const zipFiles = { ...built.files, ...tex.files, 'blockgraph-graph.json': graphJSON() };
    await saveFile(`${slug(state.packName)}.zip`, makeZip(zipFiles));
  });
  const js = el('button', 'btn ghost', 'Save graph file (.json)');
  js.type = 'button';
  js.addEventListener('click', () => saveFile(`${slug(state.packName)}.blockgraph.json`, new Blob([graphJSON()], { type: 'application/json' })));
  actions.append(dl, js);
  wrap.append(actions);

  // Resource pack: textures that replace Minecraft textures, and 3D models.
  const rpCount = TX.texturesWithTarget().length;
  const modelCount = MD.modelCount();
  const rp = el('section', 'export-rp');
  rp.append(el('h3', 'export-h', 'Resource pack'));
  const parts = [];
  if (rpCount) parts.push(`${rpCount} texture${rpCount === 1 ? '' : 's'} from the Textures tab replace${rpCount === 1 ? 's' : ''} Minecraft textures`);
  if (modelCount) parts.push(`${modelCount} 3D model${modelCount === 1 ? '' : 's'} from the Models tab, with ${modelCount === 1 ? 'its' : 'their'} textures`);
  rp.append(el('p', 'modal-lead', parts.length
    ? `${parts.join(', and ')}. Put this zip in .minecraft/resourcepacks and turn it on next to the shader pack, so your shader runs on your own textures.`
    : 'Nothing for the resource pack yet. In the Textures tab, set “Replaces” on a texture (for example block/stone), or add a 3D model in the Models tab.'));
  const rpBtn = el('button', 'btn primary', 'Download resource pack (.zip)');
  rpBtn.type = 'button';
  rpBtn.disabled = !rpCount && !modelCount;
  const rpNote = el('div');
  rpBtn.addEventListener('click', async () => {
    const { files: rpFiles } = await TX.buildResourcePackFiles(state.packName);
    const models = await MD.modelPackFiles(MD.packNamespace(state.packName));
    rpNote.textContent = '';
    if (models.problems.length) {
      const w = el('div', 'insp-error');
      w.textContent = models.problems.join(' ');
      rpNote.append(w);
    }
    await saveFile(`${slug(state.packName)}_textures.zip`, makeZip({ ...rpFiles, ...models.files }));
  });
  rp.append(rpBtn, rpNote);
  wrap.append(rp);

  if (modelCount) {
    const mod = el('section', 'export-rp');
    mod.append(el('h3', 'export-h', 'The BlockGraph Models mod'));
    mod.append(el('p', 'modal-lead', 'Minecraft cannot load 3D model files on its own. The BlockGraph Models mod adds that. It is client side only: it works on any server, and players without it just see the normal item or block. It needs Fabric Loader and Fabric API for 1.21.11, and works with Sodium and Iris.'));
    const link = el('a', 'btn ghost', 'Get the mod (.jar)');
    link.href = MD.MOD_PAGE;
    link.target = '_blank';
    link.rel = 'noopener';
    mod.append(link, el('p', 'field-hint', 'Opens the build page on GitHub. Pick the newest green run and download blockgraph-models-1.21.11 under Artifacts. To build it yourself: cd mod && ./gradlew build.'));
    wrap.append(mod);
  }

  const steps = el('ol', 'install-steps');
  for (const s of [
    ['Install Iris', 'Fabric Loader for 1.21.11, then the Iris and Sodium mods.'],
    ...(MD.modelCount() ? [['Add the models mod', 'Put the BlockGraph Models jar and Fabric API in .minecraft/mods.']] : []),
    ['Drop the zips in', 'Shader pack into .minecraft/shaderpacks, resource pack into .minecraft/resourcepacks. Leave them zipped.'],
    ['Turn on the textures', 'Options → Resource Packs, move your pack to the right side and press Done.'],
    ['Pick it in game', 'Options → Video Settings → Shader Packs, or press O. Select your pack and press Apply.'],
    ['Tweak and reload', 'Your Slider and On/Off nodes are under Shader Settings. After a new export, replace the zip and press R in game to reload.'],
  ]) {
    const li = el('li');
    li.append(el('strong', null, s[0]), el('span', null, s[1]));
    steps.append(li);
  }
  wrap.append(el('h3', 'export-h', 'Install in Minecraft'), steps);
  wrap.append(el('p', 'field-hint', 'The zip also contains blockgraph-graph.json, so you can reopen the graph later with Presets → Open graph file. If no download starts, open View code and copy the files instead.'));
  openModal('Export Iris shader pack', wrap);
}

function openWhy() {
  const wrap = el('div', 'why-view');
  wrap.append(el('p', 'modal-lead', 'Shaders are small programs the graphics card runs for every block and every pixel. Writing them by hand means GLSL, matrices and a lot of trial and error. Nodes turn that into something you can see and rearrange.'));
  const grid = el('div', 'why-grid');
  const points = [
    ['See it while you build', 'Every wire you connect updates the preview straight away. There is no edit, export, reload, squint loop just to test an idea.'],
    ['No code to start', 'Each node is one idea, like Mix, Noise or Vignette. You combine ideas instead of memorising syntax.'],
    ['Real packs, not a toy', 'Export writes an actual Iris shader pack for Minecraft 1.21.11 on Fabric. Drop the zip in shaderpacks and it runs.'],
    ['Players get a settings menu', 'Slider and On/Off nodes become options under Iris → Shader Settings, without hand-editing shaders.properties.'],
    ['Textures and shaders together', 'The Textures tab builds block textures with Blender-style nodes and pixel paint. Export them as a resource pack, see them live under your shader, or feed them to the shader with Image Texture.'],
    ['Real 3D models', 'The Models tab imports OBJ, glTF and GLB files and turns any item or block into a real 3D model, with its textures painted in the Textures tab. A small client-side mod loads them, with Sodium and Iris.'],
    ['You learn the real thing', 'View code shows the GLSL your graph makes, with each line tagged by node. It is a gentle way into shader programming.'],
    ['Works like Unity Shader Graph', 'Live previews on every node, a Lit output with Normal, Smoothness and Metallic, Custom Function, Sticky Notes, and Unity\u2019s node families from Math to UV. What you learn here transfers to Unity, Unreal, Blender and Godot.'],
  ];
  for (const [h, p] of points) {
    const c = el('div', 'why-card');
    c.append(el('h3', null, h), el('p', null, p));
    grid.append(c);
  }
  wrap.append(grid);
  const lim = el('div', 'why-limits');
  lim.append(el('h3', null, 'What this first version leaves out'));
  const ul = el('ul');
  for (const t of [
    'Shadows, reflections and volumetric light. Those need extra passes that are not wired up yet.',
    'From Unity: Sub Graphs, matrix nodes, cubemap asset nodes, parallax mapping and object or reflection probe data. Minecraft has no objects or probes to feed those. (3D models do work, through the Models tab and its mod.)',
    'Entities, the sky and particles keep a simple vanilla-style shader. The graphs cover blocks and the screen.',
    'The preview imitates Minecraft lighting with a small scene. In game, your resource pack and lightmap are used.',
  ]) ul.append(el('li', null, t));
  lim.append(ul);
  wrap.append(lim);
  openModal('Why build shaders with nodes?', wrap, { wide: true });
}

// ---------------------------------------------------------------- presets

function renderPresetMenu() {
  const menu = $('#menu-presets');
  menu.textContent = '';
  for (const p of PRESETS) {
    const b = el('button', 'menu-item');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.append(el('strong', null, p.name), el('span', null, p.blurb));
    b.addEventListener('click', () => {
      closeMenu();
      applyPreset(p);
    });
    menu.append(b);
  }
  menu.append(el('div', 'menu-sep'));
  const open = el('button', 'menu-item');
  open.type = 'button';
  open.setAttribute('role', 'menuitem');
  open.append(el('strong', null, 'Open graph file…'), el('span', null, 'Load a .json graph you saved before.'));
  open.addEventListener('click', () => { closeMenu(); $('#file-input').click(); });
  menu.append(open);
}

function applyPreset(p) {
  state.graphs = withEntityGraph(p.build());
  for (const g of Object.values(state.graphs)) g.needsLayout = true;
  state.presetId = p.id;
  state.views = { ...state.views, terrain: null, entity: null, post: null };
  if (state.kind === 'texture' || state.kind === 'model') switchGraph('terrain');
  editor.load(currentGraph(), null);
  requestAnimationFrame(() => editor.frameAll(true));
  layoutIfNeeded();
  pushHistory();
  refreshAll();
  toast(`Loaded "${p.name}". Undo brings your old graph back.`);
}

function toggleMenu() {
  const m = $('#menu-presets');
  const open = m.hidden;
  m.hidden = !open;
  $('#btn-presets').setAttribute('aria-expanded', open ? 'true' : 'false');
}
function closeMenu() {
  $('#menu-presets').hidden = true;
  $('#btn-presets').setAttribute('aria-expanded', 'false');
}

// ----------------------------------------------------------------- mobile

function setMobile(mode) {
  const app = document.querySelector('.app');
  app.dataset.mobile = mode;
  for (const b of document.querySelectorAll('.mobile-tab')) {
    const on = b.dataset.mode === mode;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  }
  if (mode === 'graph') requestAnimationFrame(() => { if (!state.views[state.kind]) editor.frameAll(); });
}

// ------------------------------------------------------------------ wiring

function bindUI() {
  for (const b of document.querySelectorAll('.graph-tab')) b.addEventListener('click', () => switchGraph(b.dataset.kind));
  for (const b of document.querySelectorAll('.mobile-tab')) b.addEventListener('click', () => setMobile(b.dataset.mode));
  $('#lib-search').addEventListener('input', renderLibrary);
  $('#btn-undo').addEventListener('click', undo);
  $('#btn-redo').addEventListener('click', redo);
  $('#btn-code').addEventListener('click', openCode);
  $('#btn-export').addEventListener('click', openExport);
  $('#btn-why').addEventListener('click', openWhy);
  $('#btn-presets').addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(); });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.menu-wrap')) closeMenu();
    if (!e.target.closest('#search-pop') && !$('#search-pop').hidden && !e.target.closest('#canvas')) closeSearch();
  });
  $('#zoom-in').addEventListener('click', () => editor.zoomBy(1.2));
  $('#zoom-out').addEventListener('click', () => editor.zoomBy(1 / 1.2));
  $('#zoom-fit').addEventListener('click', () => editor.frameAll(true));
  const pvBtn = $('#toggle-previews');
  const syncPvBtn = () => {
    pvBtn.setAttribute('aria-pressed', showPreviews ? 'true' : 'false');
    pvBtn.classList.toggle('on', showPreviews);
  };
  syncPvBtn();
  pvBtn.addEventListener('click', () => {
    showPreviews = !showPreviews;
    store.set(PREVIEWS_KEY, showPreviews ? '1' : '0');
    syncPvBtn();
    editor.render();
    updateNodePreviews();
  });
  $('#modal-close').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

  $('#search-input').addEventListener('input', renderSearch);
  $('#search-input').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSearch(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveSearch(-1); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const a = document.querySelector('.search-item.active');
      if (a) chooseSearch(a.dataset.type);
    } else if (e.key === 'Escape') closeSearch();
  });

  // preview controls
  const time = $('#pv-time');
  const timeOut = $('#pv-time-out');
  const timeName = (t) => {
    const names = [[0.03, 'Sunrise'], [0.2, 'Morning'], [0.3, 'Noon'], [0.45, 'Afternoon'], [0.53, 'Sunset'], [0.7, 'Evening'], [0.8, 'Midnight'], [0.97, 'Late night'], [1.01, 'Sunrise']];
    return names.find(([lim]) => t < lim)[1];
  };
  const tickOf = (t) => Math.round(t * 24000);
  const updTime = () => {
    preview.dayTime = Number(time.value);
    timeOut.textContent = `${timeName(preview.dayTime)} · ${tickOf(preview.dayTime)}`;
  };
  time.addEventListener('input', updTime);
  updTime();
  const rain = $('#pv-rain');
  const rainOut = $('#pv-rain-out');
  rain.addEventListener('input', () => {
    preview.rain = Number(rain.value);
    rainOut.textContent = `${Math.round(preview.rain * 100)}%`;
  });
  const spin = $('#pv-spin');
  spin.checked = preview.autoRotate;
  spin.addEventListener('change', () => { preview.autoRotate = spin.checked; });
  const post = $('#pv-post');
  post.addEventListener('change', () => { preview.postEnabled = post.checked; });
  $('#pv-reset').addEventListener('click', () => preview.resetCamera());

  $('#file-input').addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (!validGraphs(d.graphs)) throw new Error('not a BlockGraph file');
      state.graphs = withEntityGraph(d.graphs);
      state.packName = d.packName || state.packName;
      state.textures = Array.isArray(d.textures) ? d.textures : [];
      state.texNext = Math.max(d.texNext || 1, state.textures.length + 1);
      state.texSel = state.textures[0]?.id || null;
      MD.loadMeshesFromFile(d.meshes);
      state.models = Array.isArray(d.models) ? d.models : [];
      state.modelNext = Math.max(d.modelNext || 1, state.models.length + 1);
      state.modelSel = state.models[0]?.id || null;
      state.shadows = normShadows(d.shadows);
      state.views = { terrain: null, entity: null, post: null };
      TX.syncRegistry();
      TX.loadAll().then(() => MD.refreshViews());
      MD.renderPanel();
      editor.load(currentGraph(), null);
      requestAnimationFrame(() => editor.frameAll(true));
      pushHistory();
      refreshAll();
      toast(`Opened ${f.name}`);
    } catch (err) {
      toast(`Couldn't open ${f.name}: it isn't a BlockGraph graph file.`);
    }
  });

  $('#canvas').addEventListener('pointermove', (e) => { lastPointer = e; });

  document.addEventListener('keydown', (e) => {
    const typing = e.target.closest?.('input, textarea, select, [contenteditable]');
    if (e.key === 'Escape') {
      if (!$('#modal').hidden) closeModal();
      closeSearch();
      closeMenu();
      return;
    }
    if (!$('#modal').hidden || typing) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
    } else if (state.kind === 'model') {
      // the node shortcuts below do nothing in the Models tab
    } else if (mod && e.key.toLowerCase() === 'c') {
      const c = editor.copySelection();
      if (c) { clipboard = c; toast(`Copied ${c.nodes.length} node${c.nodes.length > 1 ? 's' : ''}`); }
    } else if (mod && e.key.toLowerCase() === 'v') {
      if (clipboard) { e.preventDefault(); editor.paste(clipboard); }
    } else if (mod && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      editor.paste(editor.copySelection());
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (editor.deleteSelection()) e.preventDefault();
    } else if ((e.key === ' ' || e.key === 'Tab') && !mod) {
      const r = $('#canvas').getBoundingClientRect();
      const p = lastPointer && lastPointer.clientX >= r.left && lastPointer.clientX <= r.right && lastPointer.clientY >= r.top && lastPointer.clientY <= r.bottom
        ? lastPointer : { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
      if (e.key === 'Tab' && document.activeElement !== $('#canvas')) return;
      e.preventDefault();
      const [x, y] = editor.toWorld(p.clientX, p.clientY);
      openSearch({ clientX: p.clientX, clientY: p.clientY, x, y });
    } else if (e.key.toLowerCase() === 'f' && !mod) {
      editor.frameAll(true);
    }
  });

  // first-run welcome
  const welcome = $('#welcome');
  if (!store.get(WELCOME_KEY)) welcome.hidden = false;
  $('#welcome-close').addEventListener('click', () => { welcome.hidden = true; store.set(WELCOME_KEY, '1'); });
  $('#welcome-why').addEventListener('click', () => { openWhy(); welcome.hidden = true; store.set(WELCOME_KEY, '1'); });
}

// ------------------------------------------------------------------- boot

showPreviews = store.get(PREVIEWS_KEY) !== '0';
try { collapsedCats = new Set(JSON.parse(store.get(COLLAPSED_KEY) || '[]')); } catch { collapsedCats = new Set(); }
loadInitial();
TX.initTextures({
  state, preview,
  pushHistory: () => pushHistory(),
  toast: (m) => toast(m),
  selectTexture: (id) => selectTexture(id),
  onTexturesChanged: () => onTexturesChanged(),
  modelUsage: (id) => MD.usageOf(id),
  uvSegments: (id) => MD.uvSegments(id),
});
const modelsReady = MD.initModels({
  state, preview,
  pushHistory: () => pushHistory(),
  save: () => save(),
  toast: (m) => toast(m),
  editTexture: (id) => editTexture(id),
  onModelsChanged: () => renderStatus(),
});
TX.syncRegistry();
bindUI();
renderPresetMenu();
history = [snapshot()];
historyIndex = 0;
updateUndoButtons();
const startKind = state.kind;
state.kind = null;
switchGraph(startKind);
requestAnimationFrame(() => editor.frameAll(false, $('#welcome').hidden ? 0 : 340));
compileNow();
TX.loadAll().then(async () => {
  if (state.kind === 'texture') updateNodePreviews();
  await modelsReady;
  MD.refreshViews();
});
