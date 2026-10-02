// Ready-made graphs. Each preset returns fresh { terrain, post } graphs, plus
// an entity graph when it changes items and mobs. Presets without one get the
// default Items & Entities graph, which looks like vanilla.

import { NODE_DEFS } from './nodes.js';
import { defaultParams } from './codegen.js';

function graph() {
  return { nodes: [], links: [], nextId: 1 };
}

function add(g, type, x, y, params = {}, defaults = {}) {
  const def = NODE_DEFS[type];
  const node = { id: g.nextId++, type, x, y, params: { ...defaultParams(def), ...params }, defaults };
  g.nodes.push(node);
  return node;
}

function wire(g, a, ap, b, bp) {
  g.links.push({ id: g.nextId++, from: { node: a.id, port: ap }, to: { node: b.id, port: bp } });
}

function slider(g, x, y, name, label, min, max, step, value) {
  return add(g, 'slider', x, y, { name, label, min, max, step, value });
}

// Shared pieces ---------------------------------------------------------------

function texturedBlocks(g, out) {
  const tex = add(g, 'blockTexture', 40, 40);
  const tint = add(g, 'vertexColor', 40, 200);
  const mul = add(g, 'multiply', 300, 70);
  wire(g, tex, 'rgb', mul, 'a');
  wire(g, tint, 'rgb', mul, 'b');
  wire(g, mul, 'out', out, 'color');
  return { tex, tint, mul };
}

function wavingPlants(g, out, y = 340) {
  const type = add(g, 'blockType', 40, y);
  const str = slider(g, 40, y + 160, 'WIND_STRENGTH', 'Wind Strength', 0, 3, 0.1, 1);
  const wind = add(g, 'wind', 320, y + 40);
  wire(g, type, 'wave', wind, 'mask');
  wire(g, str, 'out', wind, 'str');
  wire(g, wind, 'out', out, 'offset');
}

function softGrade(post, sat = 1.15, vig = 0.35) {
  const scene = add(post, 'sceneColor', 40, 60);
  const satAmt = slider(post, 40, 190, 'SATURATION', 'Saturation', 0, 2, 0.05, sat);
  const s = add(post, 'saturation', 320, 70);
  const vigAmt = slider(post, 320, 230, 'VIGNETTE', 'Vignette', 0, 1, 0.05, vig);
  const v = add(post, 'vignette', 600, 90);
  const outp = add(post, 'postOutput', 860, 110);
  wire(post, scene, 'rgb', s, 'c');
  wire(post, satAmt, 'out', s, 'amt');
  wire(post, s, 'out', v, 'c');
  wire(post, vigAmt, 'out', v, 's');
  wire(post, v, 'out', outp, 'color');
}

// Presets -----------------------------------------------------------------------

export const PRESETS = [
  {
    id: 'waving',
    name: 'Waving Plants',
    blurb: 'Leaves and grass sway in the wind, with a richer, softly vignetted image.',
    build() {
      const terrain = graph();
      const out = add(terrain, 'terrainOutput', 640, 120);
      texturedBlocks(terrain, out);
      wavingPlants(terrain, out);

      const post = graph();
      softGrade(post);
      return { terrain, post };
    },
  },
  {
    id: 'shiny',
    name: 'Shiny Weapons',
    blurb: 'Swords, tools, armour and shields turn to polished metal that catches the sun and reflects the sky.',
    build() {
      const terrain = graph();
      const tOut = add(terrain, 'terrainOutput', 640, 120);
      texturedBlocks(terrain, tOut);
      wavingPlants(terrain, tOut);

      // Items & Entities: Lit lighting, and a metal mask for weapons and gear.
      const entity = graph();
      const out = add(entity, 'entityOutput', 1240, 80, { lighting: 'Lit' });
      const { tex } = texturedBlocks(entity, out);
      const swords = add(entity, 'itemMask', 40, 360, { group: 'Swords' });
      const tools = add(entity, 'itemMask', 40, 500, { group: 'Tools' });
      const armor = add(entity, 'itemMask', 40, 640, { group: 'Armor' });
      const shields = add(entity, 'itemMask', 40, 780, { group: 'Shields' });
      const m1 = add(entity, 'max', 300, 400);
      const m2 = add(entity, 'max', 300, 560);
      const gear = add(entity, 'max', 300, 720);
      wire(entity, swords, 'mask', m1, 'a');
      wire(entity, tools, 'mask', m1, 'b');
      wire(entity, m1, 'out', m2, 'a');
      wire(entity, armor, 'mask', m2, 'b');
      wire(entity, m2, 'out', gear, 'a');
      wire(entity, shields, 'mask', gear, 'b');
      // Bright pixels are the metal blade; dark ones are the wooden handle.
      const gray = add(entity, 'grayscale', 560, 240);
      const bright = add(entity, 'smoothstep', 560, 400, {}, { e0: 0.35, e1: 0.7 });
      wire(entity, tex, 'rgb', gray, 'c');
      wire(entity, gray, 'luma', bright, 'x');
      const metal = add(entity, 'multiply', 820, 420);
      wire(entity, gear, 'out', metal, 'a');
      wire(entity, bright, 'out', metal, 'b');
      const shineAmt = slider(entity, 820, 580, 'WEAPON_SHINE', 'Weapon Shine', 0, 1, 0.05, 0.9);
      const smooth = add(entity, 'multiply', 1040, 500);
      wire(entity, metal, 'out', smooth, 'a');
      wire(entity, shineAmt, 'out', smooth, 'b');
      wire(entity, smooth, 'out', out, 'smooth');
      wire(entity, metal, 'out', out, 'metal');
      add(entity, 'note', 560, 640, { text: 'Item ID Mask reads item.properties, so it works on held, dropped and framed items and on worn armour. Lighting is Lit on the output, so Smoothness and Metallic catch the sun and reflect the sky.' });

      const post = graph();
      softGrade(post, 1.1, 0.3);
      return { terrain, entity, post };
    },
  },
  {
    id: 'toon',
    name: 'Toon World',
    blurb: 'Flat colour bands and stepped lighting, like a cel-shaded cartoon.',
    build() {
      const terrain = graph();
      const out = add(terrain, 'terrainOutput', 900, 120);
      const { mul } = texturedBlocks(terrain, out);
      terrain.links = terrain.links.filter((l) => !(l.from.node === mul.id && l.to.node === out.id));
      const steps = slider(terrain, 300, 230, 'TOON_STEPS', 'Toon Steps', 2, 8, 1, 4);
      const post1 = add(terrain, 'posterize', 600, 60);
      wire(terrain, mul, 'out', post1, 'x');
      wire(terrain, steps, 'out', post1, 's');
      wire(terrain, post1, 'out', out, 'color');
      const light = add(terrain, 'light', 300, 380);
      const post2 = add(terrain, 'posterize', 600, 360, {}, { s: 3 });
      wire(terrain, light, 'rgb', post2, 'x');
      wire(terrain, post2, 'out', out, 'light');
      wavingPlants(terrain, out, 560);

      const post = graph();
      const scene = add(post, 'sceneColor', 40, 60);
      const con = add(post, 'contrast', 300, 60, {}, { amt: 1.2 });
      const sat = add(post, 'saturation', 560, 60, {}, { amt: 1.35 });
      const outp = add(post, 'postOutput', 820, 80);
      wire(post, scene, 'rgb', con, 'c');
      wire(post, con, 'out', sat, 'c');
      wire(post, sat, 'out', outp, 'color');
      return { terrain, post };
    },
  },
  {
    id: 'retro',
    name: 'Retro TV',
    blurb: 'Chunky pixels, colour fringing and scanlines, like an old CRT.',
    build() {
      const terrain = graph();
      add(terrain, 'terrainOutput', 360, 120);

      const post = graph();
      const size = slider(post, 40, 40, 'PIXEL_SIZE', 'Pixel Size', 1, 12, 1, 4);
      const pix = add(post, 'pixelate', 300, 40);
      const ca = add(post, 'chroma', 560, 40, {}, { amt: 0.9 });
      const scan = add(post, 'scanlines', 820, 40, {}, { i: 0.3, n: 220 });
      const vig = add(post, 'vignette', 820, 220, {}, { s: 0.55 });
      const grain = add(post, 'grain', 1080, 160);
      const outp = add(post, 'postOutput', 1320, 160);
      wire(post, size, 'out', pix, 's');
      wire(post, pix, 'out', ca, 'uv');
      wire(post, ca, 'out', scan, 'c');
      wire(post, scan, 'out', vig, 'c');
      wire(post, vig, 'out', grain, 'c');
      wire(post, grain, 'out', outp, 'color');
      return { terrain, post };
    },
  },
  {
    id: 'night',
    name: 'Night Vision',
    blurb: 'Green goggles with film grain. An On/Off setting lets players switch it in-game.',
    build() {
      const terrain = graph();
      const out = add(terrain, 'terrainOutput', 640, 120);
      texturedBlocks(terrain, out);

      const post = graph();
      const scene = add(post, 'sceneColor', 40, 80);
      const gray = add(post, 'grayscale', 300, 160);
      const green = add(post, 'color', 300, 320, { color: '#5dff7e' });
      const tint = add(post, 'multiply', 560, 200, {}, {});
      const boost = add(post, 'multiply', 780, 200, {}, { b: 1.8 });
      const grain = add(post, 'grain', 1000, 200, {}, { amt: 0.09 });
      const vig = add(post, 'vignette', 1240, 200, {}, { s: 0.75, f: 2 });
      const on = add(post, 'toggle', 1000, 40, { name: 'NIGHT_VISION', label: 'Night Vision', value: true });
      const mix = add(post, 'lerp', 1480, 80);
      const outp = add(post, 'postOutput', 1720, 100);
      wire(post, scene, 'rgb', gray, 'c');
      wire(post, gray, 'luma', tint, 'a');
      wire(post, green, 'rgb', tint, 'b');
      wire(post, tint, 'out', boost, 'a');
      wire(post, boost, 'out', grain, 'c');
      wire(post, grain, 'out', vig, 'c');
      wire(post, scene, 'rgb', mix, 'a');
      wire(post, vig, 'out', mix, 'b');
      wire(post, on, 'out', mix, 't');
      wire(post, mix, 'out', outp, 'color');
      return { terrain, post };
    },
  },
  {
    id: 'dreamy',
    name: 'Dreamy Glow',
    blurb: 'Soft bloom around bright blocks, warm colours and a pastel tint.',
    build() {
      const terrain = graph();
      const out = add(terrain, 'terrainOutput', 640, 120);
      texturedBlocks(terrain, out);
      wavingPlants(terrain, out);

      const post = graph();
      const scene = add(post, 'sceneColor', 40, 40);
      const glowAmt = slider(post, 40, 180, 'GLOW', 'Glow', 0, 2, 0.05, 0.9);
      const glow = add(post, 'glow', 300, 160, {}, { t: 0.6, r: 7 });
      const addN = add(post, 'add', 560, 80);
      const tintC = add(post, 'color', 560, 260, { color: '#ffd6e8' });
      const blend = add(post, 'blend', 800, 80, { mode: 'soft light' }, { o: 0.6 });
      const sat = add(post, 'saturation', 1060, 80, {}, { amt: 1.15 });
      const outp = add(post, 'postOutput', 1310, 100);
      wire(post, glowAmt, 'out', glow, 'i');
      wire(post, scene, 'rgb', addN, 'a');
      wire(post, glow, 'out', addN, 'b');
      wire(post, addN, 'out', blend, 'base');
      wire(post, tintC, 'rgb', blend, 'layer');
      wire(post, blend, 'out', sat, 'c');
      wire(post, sat, 'out', outp, 'color');
      return { terrain, post };
    },
  },
  {
    id: 'ocean',
    name: 'Ocean Waves',
    blurb: 'Water rises and falls, sparkles in the sun (Lit lighting) and glows at grazing angles.',
    build() {
      const terrain = graph();
      const out = add(terrain, 'terrainOutput', 980, 120, { lighting: 'Lit' });
      const { mul } = texturedBlocks(terrain, out);
      terrain.links = terrain.links.filter((l) => !(l.from.node === mul.id && l.to.node === out.id));
      const type = add(terrain, 'blockType', 40, 360);
      const shine = add(terrain, 'multiply', 760, 300, {}, { b: 0.9 });
      wire(terrain, type, 'water', shine, 'a');
      wire(terrain, shine, 'out', out, 'smooth');
      const fres = add(terrain, 'fresnel', 300, 240, {}, { p: 4 });
      const rim = add(terrain, 'multiply', 540, 240);
      const lerp = add(terrain, 'lerp', 760, 80);
      const white = add(terrain, 'color', 540, 380, { color: '#dff4ff' });
      wire(terrain, fres, 'f', rim, 'a');
      wire(terrain, type, 'water', rim, 'b');
      wire(terrain, mul, 'out', lerp, 'a');
      wire(terrain, white, 'rgb', lerp, 'b');
      wire(terrain, rim, 'out', lerp, 't');
      wire(terrain, lerp, 'out', out, 'color');

      const wave = add(terrain, 'wave', 40, 560, {}, { speed: 2, freq: 1.3 });
      const height = slider(terrain, 40, 760, 'WAVE_HEIGHT', 'Wave Height', 0, 0.3, 0.01, 0.08);
      const amp = add(terrain, 'multiply', 320, 580);
      const mask = add(terrain, 'multiply', 540, 580);
      const vec = add(terrain, 'combine', 760, 560);
      wire(terrain, wave, 'out', amp, 'a');
      wire(terrain, height, 'out', amp, 'b');
      wire(terrain, amp, 'out', mask, 'a');
      wire(terrain, type, 'water', mask, 'b');
      wire(terrain, mask, 'out', vec, 'y');
      wire(terrain, vec, 'v3', out, 'offset');

      const post = graph();
      add(post, 'postOutput', 360, 100);
      return { terrain, post };
    },
  },
  {
    id: 'planet',
    name: 'Tiny Planet',
    blurb: 'The world curves away from you like a little planet, with a tilt-shift blur that makes it look like a toy.',
    build() {
      // Blocks: push every vertex down by distance², so the ground bends away.
      const terrain = graph();
      const out = add(terrain, 'terrainOutput', 980, 120);
      texturedBlocks(terrain, out);
      const dist = add(terrain, 'camDistance', 40, 380);
      const sq = add(terrain, 'multiply', 300, 360);
      const curve = slider(terrain, 300, 480, 'PLANET_CURVE', 'Planet Curve', 0, 0.02, 0.001, 0.004);
      const bend = add(terrain, 'multiply', 540, 380);
      const down = add(terrain, 'negate', 760, 380);
      const vec = add(terrain, 'combine', 760, 480);
      wire(terrain, dist, 'd', sq, 'a');
      wire(terrain, dist, 'd', sq, 'b');
      wire(terrain, sq, 'out', bend, 'a');
      wire(terrain, curve, 'out', bend, 'b');
      wire(terrain, bend, 'out', down, 'x');
      wire(terrain, down, 'out', vec, 'y');
      wire(terrain, vec, 'v3', out, 'offset');

      // Post FX: blur the top and bottom of the screen (tilt-shift) and boost colour.
      const post = graph();
      const scene = add(post, 'sceneColor', 40, 40);
      const blur = add(post, 'blur', 40, 170, {}, { r: 3 });
      const suv = add(post, 'screenUV', 40, 330);
      const split = add(post, 'split', 270, 330);
      const center = add(post, 'subtract', 480, 330, {}, { b: 0.5 });
      const away = add(post, 'abs', 690, 330);
      const band = add(post, 'smoothstep', 690, 440, {}, { e0: 0.12, e1: 0.42 });
      const mix = add(post, 'lerp', 920, 80);
      const sat = add(post, 'saturation', 1150, 80, {}, { amt: 1.35 });
      const outp = add(post, 'postOutput', 1380, 100);
      wire(post, suv, 'uv', split, 'v');
      wire(post, split, 'y', center, 'a');
      wire(post, center, 'out', away, 'x');
      wire(post, away, 'out', band, 'x');
      wire(post, scene, 'rgb', mix, 'a');
      wire(post, blur, 'out', mix, 'b');
      wire(post, band, 'out', mix, 't');
      wire(post, mix, 'out', sat, 'c');
      wire(post, sat, 'out', outp, 'color');
      return { terrain, post };
    },
  },
  {
    id: 'comic',
    name: 'Comic Outline',
    blurb: 'Ink lines wherever depth jumps, over flat poster colours. Outline width is an in-game slider.',
    build() {
      const terrain = graph();
      const out = add(terrain, 'terrainOutput', 640, 120);
      texturedBlocks(terrain, out);
      wavingPlants(terrain, out);

      const post = graph();
      const suv = add(post, 'screenUV', 40, 40);
      const px = add(post, 'screenSize', 40, 170);
      const width = slider(post, 40, 300, 'OUTLINE_WIDTH', 'Outline Width', 0.5, 4, 0.5, 1.5);
      const off = add(post, 'multiply', 290, 190);
      const uv2 = add(post, 'add', 500, 60);
      const dOff = add(post, 'sceneDepth', 720, 40);
      const d0 = add(post, 'sceneDepth', 720, 200);
      const diff = add(post, 'subtract', 940, 90);
      const ab = add(post, 'abs', 1150, 90);
      const rel = add(post, 'divide', 1360, 90);
      const edge = add(post, 'step', 1570, 90, {}, { e: 0.04 });
      const ink = add(post, 'oneMinus', 1790, 90);
      const scene = add(post, 'sceneColor', 1150, 330);
      const poster = add(post, 'posterize', 1360, 330, {}, { s: 6 });
      const sat = add(post, 'saturation', 1570, 330, {}, { amt: 1.3 });
      const mul = add(post, 'multiply', 2000, 200);
      const outp = add(post, 'postOutput', 2220, 220);
      const note = add(post, 'note', 40, 470, { text: 'Outline trick: compare the depth at this pixel with the depth one step away. A big relative jump means an edge, so Step turns it into a black ink line.' });
      void note;
      wire(post, px, 'texel', off, 'a');
      wire(post, width, 'out', off, 'b');
      wire(post, suv, 'uv', uv2, 'a');
      wire(post, off, 'out', uv2, 'b');
      wire(post, uv2, 'out', dOff, 'uv');
      wire(post, dOff, 'd', diff, 'a');
      wire(post, d0, 'd', diff, 'b');
      wire(post, diff, 'out', ab, 'x');
      wire(post, ab, 'out', rel, 'a');
      wire(post, d0, 'd', rel, 'b');
      wire(post, rel, 'out', edge, 'x');
      wire(post, edge, 'out', ink, 'x');
      wire(post, scene, 'rgb', poster, 'x');
      wire(post, poster, 'out', sat, 'c');
      wire(post, sat, 'out', mul, 'a');
      wire(post, ink, 'out', mul, 'b');
      wire(post, mul, 'out', outp, 'color');
      return { terrain, post };
    },
  },
  {
    id: 'lit',
    name: 'Lit & Bumpy',
    blurb: 'Unity-style Lit surface: sun shading, Perlin bump maps from Normal From Height, and shiny water.',
    build() {
      const terrain = graph();
      const out = add(terrain, 'terrainOutput', 980, 100, { lighting: 'Lit' });
      texturedBlocks(terrain, out);
      const pos = add(terrain, 'worldPos', 40, 360);
      const noise = add(terrain, 'gradientNoise', 280, 360, {}, { s: 6 });
      const bumpAmt = slider(terrain, 280, 500, 'BUMPINESS', 'Bumpiness', 0, 0.5, 0.01, 0.12);
      const bump = add(terrain, 'normalFromHeight', 520, 380);
      const type = add(terrain, 'blockType', 520, 560);
      const shine = add(terrain, 'remap', 760, 560, {}, { c: 0.25, d: 0.95 });
      const note = add(terrain, 'note', 40, 620, { text: 'Lighting is set to Lit on the Block Output, so Normal and Smoothness now catch the sun. Turn the time of day to watch the highlights move.' });
      void note;
      wire(terrain, pos, 'p', noise, 'p');
      wire(terrain, noise, 'out', bump, 'h');
      wire(terrain, bumpAmt, 'out', bump, 's');
      wire(terrain, bump, 'n', out, 'normal');
      wire(terrain, type, 'water', shine, 'x');
      wire(terrain, shine, 'out', out, 'smooth');

      const post = graph();
      const scene = add(post, 'sceneColor', 40, 60);
      const wb = add(post, 'whiteBalance', 300, 60, {}, { t: 0.15 });
      const outp = add(post, 'postOutput', 560, 80);
      wire(post, scene, 'rgb', wb, 'c');
      wire(post, wb, 'out', outp, 'color');

      const entity = graph();
      const eOut = add(entity, 'entityOutput', 640, 100, { lighting: 'Lit' });
      texturedBlocks(entity, eOut);
      return { terrain, entity, post };
    },
  },
  {
    id: 'vanilla',
    name: 'Blank (vanilla look)',
    blurb: 'Just the output nodes. Start from scratch.',
    build() {
      const terrain = graph();
      add(terrain, 'terrainOutput', 360, 120);
      const entity = graph();
      add(entity, 'entityOutput', 360, 120);
      const post = graph();
      add(post, 'postOutput', 360, 100);
      return { terrain, entity, post };
    },
  },
];

// -----------------------------------------------------------------------------
// Texture presets for the Textures tab. Each builds a texture graph; `target`
// is the Minecraft texture it replaces in the resource pack ('' = shader only).

function texGraph() {
  const g = graph();
  const out = add(g, 'textureOutput', 820, 80);
  return { g, out };
}

function stoneBase(g, x = 40, y = 40, colors = ['#5c5c5c', '#7b7b7b', '#9c9c9c']) {
  const mus = add(g, 'musgrave', x, y, {}, { s: 1.4, det: 4, dim: 1, lac: 2.1 });
  const white = add(g, 'whiteNoise', x, y + 250);
  const mix = add(g, 'lerp', x + 250, y + 60, {}, { t: 0.3 });
  const ramp = add(g, 'gradient', x + 480, y + 40, { stops: [{ c: colors[0], t: 0 }, { c: colors[1], t: 0.5 }, { c: colors[2], t: 1 }] });
  wire(g, mus, 'fac', mix, 'a');
  wire(g, white, 'v', mix, 'b');
  wire(g, mix, 'out', ramp, 't');
  return ramp;
}

export const TEXTURE_PRESETS = [
  {
    id: 'stone', name: 'Stone', target: 'block/stone', size: 16,
    blurb: 'Rough grey rock from Musgrave noise and white noise through a colour ramp.',
    build() {
      const { g, out } = texGraph();
      const ramp = stoneBase(g);
      wire(g, ramp, 'rgb', out, 'color');
      return g;
    },
  },
  {
    id: 'bricks', name: 'Bricks', target: 'block/bricks', size: 16,
    blurb: 'Blender-style Brick Texture with a little pixel noise on each brick.',
    build() {
      const { g, out } = texGraph();
      const brick = add(g, 'brick', 40, 40);
      const white = add(g, 'whiteNoise', 40, 420);
      const vary = add(g, 'remap', 300, 400, {}, { c: 0.85, d: 1.08 });
      const mul = add(g, 'multiply', 560, 100);
      wire(g, white, 'v', vary, 'x');
      wire(g, brick, 'rgb', mul, 'a');
      wire(g, vary, 'out', mul, 'b');
      wire(g, mul, 'out', out, 'color');
      return g;
    },
  },
  {
    id: 'planks', name: 'Oak Planks', target: 'block/oak_planks', size: 16,
    blurb: 'Long boards from Brick Texture, with wood grain from a stretched Wave Texture.',
    build() {
      const { g, out } = texGraph();
      const boards = add(g, 'brick', 40, 40, {}, { bw: 1, rh: 0.25, m: 0.05, c1: [0.64, 0.51, 0.31], c2: [0.56, 0.44, 0.25], mc: [0.42, 0.32, 0.19] });
      const grain = add(g, 'waveTexture', 40, 460, { kind: 'bands', dir: 'x', profile: 'sine' }, { s: 0.6, d: 3, ds: 0.8 });
      const shade = add(g, 'remap', 300, 460, {}, { c: 0.82, d: 1.06 });
      const mul = add(g, 'multiply', 560, 100);
      wire(g, grain, 'fac', shade, 'x');
      wire(g, boards, 'rgb', mul, 'a');
      wire(g, shade, 'out', mul, 'b');
      wire(g, mul, 'out', out, 'color');
      return g;
    },
  },
  {
    id: 'diamond', name: 'Diamond Ore', target: 'block/diamond_ore', size: 16,
    blurb: 'Stone with cyan gems wherever Voronoi cells are close to their centre.',
    build() {
      const { g, out } = texGraph();
      const ramp = stoneBase(g);
      const vor = add(g, 'voronoi', 40, 560, {}, { s: 0.9, j: 0.9 });
      const spot = add(g, 'step', 300, 560, {}, { e: 0.28 });
      const gem = add(g, 'oneMinus', 520, 560);
      const gemCol = add(g, 'gradient', 520, 700, { stops: [{ c: '#0f6e78', t: 0 }, { c: '#3fe0ea', t: 0.6 }, { c: '#c8fbff', t: 1 }] });
      const mix = add(g, 'lerp', 820, 360);
      wire(g, vor, 'd', spot, 'x');
      wire(g, spot, 'out', gem, 'x');
      wire(g, vor, 'cells', gemCol, 't');
      wire(g, ramp, 'rgb', mix, 'a');
      wire(g, gemCol, 'rgb', mix, 'b');
      wire(g, gem, 'out', mix, 't');
      out.x = 1080;
      wire(g, mix, 'out', out, 'color');
      return g;
    },
  },
  {
    id: 'grassTop', name: 'Grass Top', target: 'block/grass_block_top', size: 16,
    blurb: 'Grey speckles. Minecraft tints this texture green by biome, so it stays grey here.',
    build() {
      const { g, out } = texGraph();
      const white = add(g, 'whiteNoise', 40, 60);
      const range = add(g, 'remap', 300, 60, {}, { c: 0.55, d: 0.88 });
      wire(g, white, 'v', range, 'x');
      wire(g, range, 'out', out, 'color');
      return g;
    },
  },
  {
    id: 'leaves', name: 'Leaves', target: 'block/oak_leaves', size: 16,
    blurb: 'Grey leaves with see-through gaps. Minecraft tints them green.',
    build() {
      const { g, out } = texGraph();
      const white = add(g, 'whiteNoise', 40, 60);
      const range = add(g, 'remap', 300, 40, {}, { c: 0.38, d: 0.82 });
      const split = add(g, 'split', 300, 260);
      const holes = add(g, 'step', 540, 260, {}, { e: 0.2 });
      wire(g, white, 'v', range, 'x');
      wire(g, white, 'rgb', split, 'v');
      wire(g, split, 'y', holes, 'x');
      wire(g, range, 'out', out, 'color');
      wire(g, holes, 'out', out, 'alpha');
      return g;
    },
  },
  {
    id: 'marble', name: 'Marble', target: '', size: 64,
    blurb: 'Veined marble from a distorted Wave Texture. Use it in a shader through Image Texture.',
    build() {
      const { g, out } = texGraph();
      const wave = add(g, 'waveTexture', 40, 40, { kind: 'bands', dir: 'diagonal', profile: 'sine' }, { s: 0.35, d: 7, ds: 0.7 });
      const ramp = add(g, 'gradient', 320, 60, { stops: [{ c: '#5f5853', t: 0 }, { c: '#cfc8bd', t: 0.35 }, { c: '#f3f0e9', t: 1 }] });
      wire(g, wave, 'fac', ramp, 't');
      wire(g, ramp, 'rgb', out, 'color');
      return g;
    },
  },
  {
    id: 'hellfire', name: 'Hellfire', target: 'block/glowstone', size: 32,
    blurb: 'Glowing infernal swirls: Magic Texture heated through Blackbody. Replaces glowstone.',
    build() {
      const { g, out } = texGraph();
      const magic = add(g, 'magic', 40, 40, { depth: '3' }, { s: 0.55, d: 2.2 });
      const heat = add(g, 'remap', 300, 60, {}, { c: 900, d: 3600 });
      const bb = add(g, 'blackbody', 540, 60);
      const boost = add(g, 'multiply', 540, 240, {}, { b: 1.25 });
      wire(g, magic, 'fac', heat, 'x');
      wire(g, heat, 'out', bb, 't');
      wire(g, bb, 'rgb', boost, 'a');
      wire(g, boost, 'out', out, 'color');
      return g;
    },
  },
  {
    id: 'blank', name: 'Blank', target: '', size: 16,
    blurb: 'An empty texture graph.',
    build() {
      return texGraph().g;
    },
  },
];

// Mob animation presets ------------------------------------------------------------
// Each one builds only the Animations graph and leaves the shader graphs alone.

function animPart(g, x, y, mob, part, mode = 'Add to vanilla') {
  return add(g, 'animPart', x, y, { mob, part, mode });
}

function animNote(g, x, y) {
  return add(g, 'note', x, y, { text: 'In game this needs the Entity Model Features and Entity Texture Features mods (Fabric) and the resource pack from Export.' });
}

// The default Animations graph: zombies bob their head and swing their arms
// with each step, and breathe while standing.
export function defaultAnimGraph() {
  const g = graph();
  const walk = add(g, 'animWalk', 40, 60);
  const tilt = add(g, 'animMul', 320, 40, {}, { b: 8 });
  const armR = add(g, 'animMul', 320, 180, {}, { b: 20 });
  const armL = add(g, 'animMul', 320, 320, {}, { b: 20 });
  const breathe = add(g, 'animWave', 320, 460, {}, { speed: 0.35, amp: 3 });
  const head = animPart(g, 660, 40, 'Zombie', 'head');
  const right = animPart(g, 660, 400, 'Zombie', 'right_arm');
  const left = animPart(g, 960, 400, 'Zombie', 'left_arm');
  wire(g, walk, 'swing', tilt, 'a');
  wire(g, walk, 'swing', armR, 'a');
  wire(g, walk, 'opp', armL, 'a');
  wire(g, tilt, 'out', head, 'rz');
  wire(g, breathe, 'out', head, 'rx');
  wire(g, armR, 'out', right, 'rx');
  wire(g, armL, 'out', left, 'rx');
  animNote(g, 40, 330);
  return g;
}

export const ANIM_PRESETS = [
  {
    id: 'animLively',
    name: 'Lively Zombies',
    blurb: 'Zombies bob their heads and swing their arms with every step, and breathe while standing.',
    build: defaultAnimGraph,
  },
  {
    id: 'animBreathing',
    name: 'Breathing Idle',
    blurb: 'Zombies and players sway their arms gently while standing; it fades out as they walk.',
    build() {
      const g = graph();
      const wave = add(g, 'animWave', 40, 40, {}, { speed: 0.3, amp: 4 });
      const walk = add(g, 'animWalk', 40, 260);
      const still = add(g, 'animNot', 300, 300);
      const amt = add(g, 'animMul', 300, 60);
      const neg = add(g, 'animNeg', 560, 200);
      wire(g, walk, 'speed', still, 'x');
      wire(g, wave, 'out', amt, 'a');
      wire(g, still, 'out', amt, 'b');
      wire(g, amt, 'out', neg, 'x');
      const parts = [
        ['Zombie', 'right_arm', amt, 820, 40], ['Zombie', 'left_arm', neg, 1120, 40],
        ['Player', 'right_arm', amt, 820, 420], ['Player', 'left_arm', neg, 1120, 420],
      ];
      for (const [mob, part, src, x, y] of parts) wire(g, src, 'out', animPart(g, x, y, mob, part), 'rz');
      animNote(g, 40, 460);
      return g;
    },
  },
  {
    id: 'animPig',
    name: 'Happy Pigs',
    blurb: 'Pigs waddle and nod while they trot, and flinch their head when hit.',
    build() {
      const g = graph();
      const walk = add(g, 'animWalk', 40, 40);
      const nod = add(g, 'animWave', 320, 40, {}, { speed: 2.5, amp: 8 });
      const nodAmt = add(g, 'animMul', 600, 40);
      const waddle = add(g, 'animMul', 320, 260, {}, { b: 6 });
      const hurt = add(g, 'animHurt', 40, 400);
      const flinch = add(g, 'animMul', 320, 440, {}, { b: 30 });
      wire(g, nod, 'out', nodAmt, 'a');
      wire(g, walk, 'speed', nodAmt, 'b');
      wire(g, walk, 'swing', waddle, 'a');
      wire(g, hurt, 'hurt', flinch, 'a');
      const head = animPart(g, 900, 40, 'Pig', 'head');
      const body = animPart(g, 900, 420, 'Pig', 'body');
      wire(g, nodAmt, 'out', head, 'rx');
      wire(g, flinch, 'out', head, 'ry');
      wire(g, waddle, 'out', body, 'ry');
      animNote(g, 40, 620);
      return g;
    },
  },
  {
    id: 'animCreeper',
    name: 'Bouncy Creepers',
    blurb: 'Creepers hop with each step and puff up their heads when they chase you.',
    build() {
      const g = graph();
      const walk = add(g, 'animWalk', 40, 40);
      const bounce = add(g, 'animAbs', 320, 40);
      const height = add(g, 'animMul', 560, 40, {}, { b: 2 });
      const angry = add(g, 'animState', 40, 300, { state: 'Aggressive' });
      const smooth = add(g, 'animSmooth', 320, 300, {}, { speed: 6 });
      const puff = add(g, 'animRemap', 560, 260, {}, { c: 1, d: 1.15 });
      wire(g, walk, 'swing', bounce, 'x');
      wire(g, bounce, 'out', height, 'a');
      wire(g, angry, 'out', smooth, 'x');
      wire(g, smooth, 'out', puff, 'x');
      const head = animPart(g, 860, 40, 'Creeper', 'head');
      const body = animPart(g, 1160, 40, 'Creeper', 'body');
      wire(g, height, 'out', head, 'ty');
      wire(g, height, 'out', body, 'ty');
      wire(g, puff, 'out', head, 'scale');
      animNote(g, 40, 520);
      return g;
    },
  },
];
