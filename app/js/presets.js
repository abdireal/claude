// Ready-made graphs. Each preset returns fresh { terrain, post } graphs.

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
      const scene = add(post, 'sceneColor', 40, 60);
      const satAmt = slider(post, 40, 190, 'SATURATION', 'Saturation', 0, 2, 0.05, 1.15);
      const sat = add(post, 'saturation', 320, 70);
      const vigAmt = slider(post, 320, 230, 'VIGNETTE', 'Vignette', 0, 1, 0.05, 0.35);
      const vig = add(post, 'vignette', 600, 90);
      const outp = add(post, 'postOutput', 860, 110);
      wire(post, scene, 'rgb', sat, 'c');
      wire(post, satAmt, 'out', sat, 'amt');
      wire(post, sat, 'out', vig, 'c');
      wire(post, vigAmt, 'out', vig, 's');
      wire(post, vig, 'out', outp, 'color');
      return { terrain, post };
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
      return { terrain, post };
    },
  },
  {
    id: 'vanilla',
    name: 'Blank (vanilla look)',
    blurb: 'Just the two output nodes. Start from scratch.',
    build() {
      const terrain = graph();
      add(terrain, 'terrainOutput', 360, 120);
      const post = graph();
      add(post, 'postOutput', 360, 100);
      return { terrain, post };
    },
  },
];
