// Wraps compiled graph code into complete shaders for two targets:
//  - "preview": WebGL2 (GLSL ES 3.00) for the live preview in the browser
//  - "iris":    an Iris / OptiFine-format shader pack (GLSL 330 compatibility)
// It also builds the tiny shaders behind each node's own preview thumbnail.

import { compileStage, collectSettings, defaultParams } from './codegen.js';
import { GLSL_HELPERS, GLSL_FRAG_HELPERS, NODE_DEFS, texSampler, ID_GROUPS } from './nodes.js';

export const BLOCK_IDS = { leaves: 10001, plants: 10002, water: 10003, model: 10004 };

// ------------------------------------------------------------------ settings

function decimalsOf(n) {
  const s = String(n);
  const i = s.indexOf('.');
  return i < 0 ? 0 : Math.min(4, s.length - i - 1);
}

export function sliderValues(s) {
  let min = Number(s.min), max = Number(s.max), step = Math.abs(Number(s.step)) || 0.1;
  if (!Number.isFinite(min)) min = 0;
  if (!Number.isFinite(max)) max = 1;
  if (max < min) [min, max] = [max, min];
  let count = Math.floor((max - min) / step + 1e-6) + 1;
  if (count > 101) {
    step *= Math.ceil(count / 101);
    count = Math.floor((max - min) / step + 1e-6) + 1;
  }
  const dec = Math.max(1, decimalsOf(step), decimalsOf(min));
  const vals = [];
  for (let i = 0; i < count; i++) vals.push(Number((min + i * step).toFixed(dec)));
  const v = Number(Number(s.value).toFixed(dec));
  if (Number.isFinite(v) && !vals.includes(v)) {
    vals.push(v);
    vals.sort((a, b) => a - b);
  }
  return { vals, dec, value: Number.isFinite(v) ? v : vals[0] };
}

export function choiceOptions(s) {
  const list = String(s.options || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 16);
  return list.length ? list : ['Off', 'On'];
}

export function choiceIndex(s) {
  const n = choiceOptions(s).length;
  return Math.max(0, Math.min(n - 1, Math.round(Number(s.value) || 0)));
}

function irisSettingDefines(settings) {
  const out = [];
  for (const [name, s] of settings) {
    if (s.kind === 'slider') {
      const { vals, dec, value } = sliderValues(s);
      out.push(`#define ${name} ${value.toFixed(dec)} // [${vals.map((x) => x.toFixed(dec)).join(' ')}]`);
    } else if (s.kind === 'choice') {
      const n = choiceOptions(s).length;
      out.push(`#define ${name} ${choiceIndex(s)} // [${Array.from({ length: n }, (_, i) => i).join(' ')}]`);
    } else {
      out.push(`${s.value ? '' : '//'}#define ${name}`);
      out.push(`#ifdef ${name}`, `const float TG_${name} = 1.0;`, '#else', `const float TG_${name} = 0.0;`, '#endif');
    }
  }
  return out.join('\n');
}

function previewSettingUniforms(settings) {
  return [...settings].map(([name, s]) => `uniform float ${s.kind === 'toggle' ? 'TG_' + name : name};`).join('\n');
}

const indent = (lines, pad = '\t') => lines.join('\n').split('\n').map((l) => (l ? pad + l : l)).join('\n');

// ------------------------------------------------------------- compile both

// An Items & Entities graph that only holds its output: looks like vanilla.
export function defaultEntityGraph() {
  return { nodes: [{ id: 1, type: 'entityOutput', x: 360, y: 120, params: defaultParams(NODE_DEFS.entityOutput), defaults: {} }], links: [], nextId: 2 };
}

export function compileAll(graphs) {
  const tFrag = compileStage(graphs.terrain, 'terrain', 'fragment');
  const tVert = compileStage(graphs.terrain, 'terrain', 'vertex');
  const eg = graphs.entity || defaultEntityGraph();
  const eFrag = compileStage(eg, 'entity', 'fragment');
  const eVert = compileStage(eg, 'entity', 'vertex');
  const post = compileStage(graphs.post, 'post', 'fragment');
  const { settings, problems } = collectSettings(graphs);
  const errors = [
    ...tFrag.errors.map((e) => ({ ...e, graph: 'terrain' })),
    ...tVert.errors.map((e) => ({ ...e, graph: 'terrain' })),
    ...eFrag.errors.map((e) => ({ ...e, graph: 'entity' })),
    ...eVert.errors.map((e) => ({ ...e, graph: 'entity' })),
    ...post.errors.map((e) => ({ ...e, graph: 'post' })),
    ...problems.map((e) => ({ ...e, graph: null })),
  ];
  const seen = new Set();
  const uniqErrors = errors.filter((e) => {
    const k = `${e.graph}:${e.node}:${e.msg}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { tFrag, tVert, eFrag, eVert, post, settings, errors: uniqErrors };
}

// ---------------------------------------------------------------- builtins
// Every graph sees the same bg_* names. Each target fills them from its own
// uniforms and varyings.

const PREVIEW_LIGHT = `
vec3 bg_lightmapColor(vec2 lm, float daylight) {
  float sky = lm.y * lm.y;
  float blk = lm.x * lm.x;
  vec3 skyCol = mix(vec3(0.09, 0.10, 0.19), vec3(1.0, 1.0, 0.97), daylight) * sky;
  vec3 blkCol = vec3(1.0, 0.8, 0.55) * blk * 1.15;
  return clamp(max(skyCol, blkCol) + vec3(0.035), 0.0, 1.0);
}
`;

const COMMON_TIME = (pv) => [
  `float bg_time = ${pv ? 'u_time' : 'frameTimeCounter'};`,
  `float bg_dayTime = ${pv ? 'u_dayTime' : 'float(worldTime) / 24000.0'};`,
  'float bg_daylight = smoothstep(-0.1, 0.25, sin(bg_dayTime * 6.2831853));',
  `float bg_rain = ${pv ? 'u_rain' : 'rainStrength'};`,
  `vec3 bg_sunDir = normalize(${pv ? 'u_sunDir' : 'mat3(gbufferModelViewInverse) * sunPosition'});`,
  `vec3 bg_skyColor = ${pv ? 'u_skyColor' : 'skyColor'};`,
  `vec3 bg_fogColor = ${pv ? 'u_fogColor' : 'fogColor'};`,
  `vec3 bg_camPos = ${pv ? 'u_cam' : 'cameraPosition'};`,
  `vec3 bg_camFwd = ${pv ? 'u_camFwd' : '-gbufferModelViewInverse[2].xyz'};`,
  `vec2 bg_resolution = ${pv ? 'u_res' : 'vec2(viewWidth, viewHeight)'};`,
  'float bg_aspect = bg_resolution.x / bg_resolution.y;',
  `int bg_heldItemId = ${pv ? 'u_heldItem' : 'heldItemId'};`,
  `int bg_heldItemId2 = ${pv ? 'u_heldItem2' : 'heldItemId2'};`,
];

function terrainBuiltins(target, stage) {
  const pv = target === 'preview';
  const v = stage === 'vertex';
  const src = pv
    ? { uv: v ? 'a_uv' : 'v_uv', pos: v ? 'a_pos' : 'v_world', n: v ? 'a_normal' : 'v_normal', col: v ? 'a_color' : 'v_color', lm: v ? 'a_lm' : 'v_lm', top: v ? 'a_top' : 'v_top', dist: v ? 'length(a_pos - u_cam)' : 'v_dist' }
    : { uv: 'texcoord', pos: v ? 'wPos' : 'worldPos', n: v ? 'wNormal' : 'worldNormal', col: 'glcolor', top: v ? 'top' : 'plantTop', dist: v ? 'length(playerPos.xyz)' : 'viewDist' };
  const lines = [
    `vec2 bg_uv = ${src.uv};`,
    ...COMMON_TIME(pv),
    `vec3 bg_worldPos = ${src.pos};`,
    `vec3 bg_normal = bg_safeNormalize(${src.n});`,
    `vec4 bg_vcolor = ${src.col};`,
  ];
  if (pv) {
    lines.push(
      `vec2 bg_lm = ${src.lm};`,
      'vec3 bg_light = bg_lightmapColor(bg_lm, bg_daylight);',
      `float bg_blockId = ${v ? 'a_block' : 'v_block'};`,
      'float bg_isLeaves = abs(bg_blockId - 1.0) < 0.5 ? 1.0 : 0.0;',
      'float bg_isPlant = abs(bg_blockId - 2.0) < 0.5 ? 1.0 : 0.0;',
      'float bg_isWater = abs(bg_blockId - 3.0) < 0.5 ? 1.0 : 0.0;',
      'float bg_isModel = abs(bg_blockId - 4.0) < 0.5 ? 1.0 : 0.0;',
    );
  } else {
    lines.push(
      'vec2 bg_lm = clamp((lmcoord - 0.03125) * 1.06667, 0.0, 1.0);',
      `vec3 bg_light = ${v ? 'textureLod(lightmap, lmcoord, 0.0).rgb' : 'texture(lightmap, lmcoord).rgb'};`,
      `int bg_id = ${v ? 'id' : 'blockId'};`,
      `float bg_isLeaves = bg_id == ${BLOCK_IDS.leaves} ? 1.0 : 0.0;`,
      `float bg_isPlant = bg_id == ${BLOCK_IDS.plants} ? 1.0 : 0.0;`,
      `float bg_isWater = bg_id == ${BLOCK_IDS.water} ? 1.0 : 0.0;`,
      `float bg_isModel = bg_id == ${BLOCK_IDS.model} ? 1.0 : 0.0;`,
    );
  }
  lines.push(
    `float bg_plantTop = ${src.top};`,
    `float bg_viewDist = ${src.dist};`,
    'vec3 bg_viewDir = bg_safeNormalize(bg_camPos - bg_worldPos);',
    'vec2 bg_faceUV = bg_faceUVOf(bg_worldPos, bg_normal);',
  );
  return lines.join('\n');
}

// Builtins for the Items & Entities graph. `prog` is the Iris program family:
// 'hand' (first person), 'entity' (gbuffers_entities) or 'block' (block entities).
// Only standard vertex attributes are read, so modded meshes (OBJ models drawn
// through the item and block paths) work as long as they carry a normal.
function entityBuiltins(target, stage, prog) {
  const pv = target === 'preview';
  const v = stage === 'vertex';
  const src = pv
    ? { uv: v ? 'a_uv' : 'v_uv', pos: v ? 'wPos' : 'v_world', n: v ? 'wNormal' : 'v_normal', col: v ? 'a_color' : 'v_color', lm: v ? 'a_lm' : 'v_lm', dist: v ? 'length(wPos - u_cam)' : 'v_dist' }
    : { uv: 'texcoord', pos: v ? 'wPos' : 'worldPos', n: v ? 'wNormal' : 'worldNormal', col: 'glcolor', dist: v ? 'length(playerPos.xyz)' : 'viewDist' };
  const lines = [
    `vec2 bg_uv = ${src.uv};`,
    ...COMMON_TIME(pv),
    `vec3 bg_worldPos = ${src.pos};`,
    `vec3 bg_normal = bg_safeNormalize(${src.n});`,
    `vec4 bg_vcolor = ${src.col};`,
  ];
  if (pv) {
    lines.push(
      `vec2 bg_lm = ${src.lm};`,
      'vec3 bg_light = bg_lightmapColor(bg_lm, bg_daylight);',
      'int bg_itemId = u_itemId;',
      'int bg_entityId = u_entityId;',
      'int bg_blockEntityId = u_blockEntityId;',
      'float bg_isHeld = u_isHeld;',
      'float bg_isEntity = u_isEntity;',
      'float bg_isBlockEntity = u_isBlockEntity;',
    );
  } else {
    lines.push(
      'vec2 bg_lm = clamp((lmcoord - 0.03125) * 1.06667, 0.0, 1.0);',
      `vec3 bg_light = ${v ? 'textureLod(lightmap, lmcoord, 0.0).rgb' : 'texture(lightmap, lmcoord).rgb'};`,
      'int bg_itemId = currentRenderedItemId;',
      'int bg_entityId = entityId;',
      'int bg_blockEntityId = blockEntityId;',
      `float bg_isHeld = ${prog === 'hand' ? '1.0' : '0.0'};`,
      `float bg_isEntity = ${prog === 'entity' ? '1.0' : '0.0'};`,
      `float bg_isBlockEntity = ${prog === 'block' ? '1.0' : '0.0'};`,
    );
  }
  lines.push(
    'float bg_plantTop = 0.0;',
    `float bg_viewDist = ${src.dist};`,
    'vec3 bg_viewDir = bg_safeNormalize(bg_camPos - bg_worldPos);',
    'vec2 bg_faceUV = bg_faceUVOf(bg_worldPos, bg_normal);',
  );
  return lines.join('\n');
}

function postBuiltins(target) {
  const pv = target === 'preview';
  return [`vec2 bg_screenUV = ${pv ? 'v_uv' : 'texcoord'};`, ...COMMON_TIME(pv)].join('\n');
}

// The end of every block shader: Unity-style surface inputs become a colour.
function surfaceToColor(o, params, target, opts = {}) {
  const lit = params.lighting === 'Lit';
  const fog = params.fog !== false;
  const lines = [
    `vec3 bg_col = ${o.color};`,
    ...(opts.flash ? [`bg_col = mix(bg_col, ${opts.flash}.rgb, ${opts.flash}.a); // hurt / creeper flash`] : []),
    `float bg_alpha = ${o.alpha};`,
    `vec3 bg_lit = ${o.light};`,
    `float bg_emit = ${o.emission};`,
    `float bg_ao = ${o.ao};`,
    `float bg_clip = ${o.clip};`,
    `if (bg_alpha < bg_clip) discard;`,
    'vec3 rgb = bg_col * bg_lit * bg_ao;',
  ];
  if (lit) {
    lines.push(
      '// Lit: sun shading and a Blinn-Phong highlight driven by Normal, Smoothness and Metallic.',
      `vec3 bg_N = normalize(${o.normal});`,
      `float bg_sm = clamp(${o.smooth}, 0.0, 1.0);`,
      `float bg_mt = clamp(${o.metal}, 0.0, 1.0);`,
      'float bg_sunVis = bg_daylight * bg_lm.y * bg_lm.y * (1.0 - bg_rain * 0.75);',
      'float bg_ndl = dot(bg_N, bg_sunDir);',
      'rgb *= mix(1.0, 0.72 + 0.5 * max(bg_ndl, 0.0), bg_sunVis) * (1.0 - 0.6 * bg_mt);',
      'vec3 bg_H = normalize(bg_sunDir + bg_viewDir);',
      'float bg_exp = mix(6.0, 600.0, bg_sm * bg_sm);',
      'vec3 bg_F0 = mix(vec3(0.04), bg_col, bg_mt);',
      'vec3 bg_F = bg_F0 + (1.0 - bg_F0) * pow(1.0 - max(dot(bg_N, bg_viewDir), 0.0), 5.0);',
      'float bg_spec = pow(max(dot(bg_N, bg_H), 0.0), bg_exp) * (bg_exp + 8.0) / 25.13 * step(0.0, bg_ndl);',
      'rgb += bg_F * bg_spec * bg_sm * bg_sunVis * vec3(1.0, 0.95, 0.85);',
      '// Cheap sky reflection for metals: the sky colour above, the fog colour at the horizon.',
      'vec3 bg_R = reflect(-bg_viewDir, bg_N);',
      'float bg_skyVis = bg_lm.y * bg_lm.y * (0.3 + 0.7 * bg_daylight);',
      'vec3 bg_env = mix(bg_fogColor, bg_skyColor, smoothstep(-0.15, 0.55, bg_R.y)) * mix(0.35, 1.0, step(0.0, bg_R.y));',
      'rgb += bg_F * bg_env * bg_skyVis * bg_mt * (0.25 + 0.75 * bg_sm);',
    );
  }
  lines.push('rgb += bg_col * bg_emit;');
  if (fog) {
    lines.push(target === 'preview'
      ? 'rgb = mix(rgb, u_fogColor, clamp((bg_viewDist - u_far * 0.75) / (u_far * 0.25), 0.0, 1.0));'
      : 'rgb = mix(rgb, fogColor, clamp((viewDist - far * 0.75) / (far * 0.25), 0.0, 1.0));');
  }
  return lines;
}

// ------------------------------------------------------------------ preview

const PREVIEW_COMMON_UNIFORMS = `uniform vec3 u_cam;
uniform vec3 u_camFwd;
uniform vec3 u_sunDir;
uniform vec3 u_skyColor;
uniform vec3 u_fogColor;
uniform vec2 u_res;
uniform float u_time;
uniform float u_dayTime;
uniform float u_rain;
uniform int u_heldItem;
uniform int u_heldItem2;`;

const PREVIEW_ENTITY_UNIFORMS = `uniform int u_itemId;
uniform int u_entityId;
uniform int u_blockEntityId;
uniform float u_isHeld;
uniform float u_isEntity;
uniform float u_isBlockEntity;`;

export function buildPreview(graphs) {
  const c = compileAll(graphs);
  const settingUniforms = previewSettingUniforms(c.settings);
  const o = c.tFrag.outputs;
  const vFns = c.tVert.functions.join('\n');
  const fFns = c.tFrag.functions.join('\n');

  const terrainVS = `#version 300 es
precision highp float;
precision highp int;
in vec3 a_pos;
in vec3 a_normal;
in vec2 a_uv;
in vec4 a_color;
in vec2 a_lm;
in float a_block;
in float a_top;
uniform mat4 u_viewProj;
uniform sampler2D u_atlas;
${PREVIEW_COMMON_UNIFORMS}
${settingUniforms}
out vec2 v_uv;
out vec2 v_lm;
out vec4 v_color;
out vec3 v_world;
out vec3 v_normal;
out float v_dist;
flat out float v_block;
out float v_top;
${GLSL_HELPERS}
${PREVIEW_LIGHT}
vec4 bg_sampleBlock(vec2 uv) { return textureLod(u_atlas, uv, 0.0); }
vec4 bg_sampleBlockLod(vec2 uv, float lod) { return textureLod(u_atlas, uv, lod); }
${vFns}
void main() {
${indent([terrainBuiltins('preview', 'vertex')], '  ')}
${indent(c.tVert.lines.length ? c.tVert.lines : ['// (no vertex nodes)'], '  ')}
  vec3 bg_offset = ${c.tVert.outputs.offset || 'vec3(0.0)'};
  vec3 wp = a_pos + bg_offset;
  v_uv = a_uv;
  v_lm = a_lm;
  v_color = a_color;
  v_world = wp;
  v_normal = a_normal;
  v_dist = length(wp - u_cam);
  v_block = a_block;
  v_top = a_top;
  gl_Position = u_viewProj * vec4(wp, 1.0);
}
`;

  const terrainFS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_atlas;
uniform float u_far;
${PREVIEW_COMMON_UNIFORMS}
${settingUniforms}
in vec2 v_uv;
in vec2 v_lm;
in vec4 v_color;
in vec3 v_world;
in vec3 v_normal;
in float v_dist;
flat in float v_block;
in float v_top;
out vec4 fragColor;
${GLSL_HELPERS}
${GLSL_FRAG_HELPERS}
${PREVIEW_LIGHT}
vec4 bg_sampleBlock(vec2 uv) { return texture(u_atlas, uv); }
vec4 bg_sampleBlockLod(vec2 uv, float lod) { return textureLod(u_atlas, uv, lod); }
${fFns}
void main() {
${indent([terrainBuiltins('preview', 'fragment')], '  ')}
${indent(c.tFrag.lines.length ? c.tFrag.lines : ['// (no nodes)'], '  ')}
${indent(surfaceToColor(o, c.tFrag.outParams, 'preview'), '  ')}
  fragColor = vec4(rgb, bg_alpha);
}
`;

  const postFS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_scene;
uniform sampler2D u_depth;
uniform mat4 u_projInv;
${PREVIEW_COMMON_UNIFORMS}
${settingUniforms}
in vec2 v_uv;
out vec4 fragColor;
${GLSL_HELPERS}
${GLSL_FRAG_HELPERS}
vec4 bg_sampleScene(vec2 uv) { return texture(u_scene, uv); }
float bg_sceneDistance(vec2 uv) {
  float d = texture(u_depth, uv).r;
  vec4 v = u_projInv * vec4(vec3(uv, d) * 2.0 - 1.0, 1.0);
  return length(v.xyz / v.w);
}
float bg_isSky(vec2 uv) { return texture(u_depth, uv).r >= 0.99999 ? 1.0 : 0.0; }
${c.post.functions.join('\n')}
void main() {
${indent([postBuiltins('preview')], '  ')}
${indent(c.post.lines.length ? c.post.lines : ['// (no nodes)'], '  ')}
  fragColor = vec4(clamp(${c.post.outputs.color}, 0.0, 1.0), 1.0);
}
`;

  const eo = c.eFrag.outputs;
  const entityVS = `#version 300 es
precision highp float;
precision highp int;
in vec3 a_pos;
in vec3 a_normal;
in vec2 a_uv;
in vec4 a_color;
in vec2 a_lm;
in float a_block;
in float a_top;
uniform mat4 u_viewProj;
uniform mat4 u_model;
uniform sampler2D u_atlas;
${PREVIEW_COMMON_UNIFORMS}
${PREVIEW_ENTITY_UNIFORMS}
${settingUniforms}
out vec2 v_uv;
out vec2 v_lm;
out vec4 v_color;
out vec3 v_world;
out vec3 v_normal;
out float v_dist;
${GLSL_HELPERS}
${PREVIEW_LIGHT}
vec4 bg_sampleBlock(vec2 uv) { return textureLod(u_atlas, uv, 0.0); }
vec4 bg_sampleBlockLod(vec2 uv, float lod) { return textureLod(u_atlas, uv, lod); }
${c.eVert.functions.join('\n')}
void main() {
  vec3 wPos = (u_model * vec4(a_pos, 1.0)).xyz;
  vec3 wNormal = mat3(u_model) * a_normal;
${indent([entityBuiltins('preview', 'vertex')], '  ')}
${indent(c.eVert.lines.length ? c.eVert.lines : ['// (no vertex nodes)'], '  ')}
  vec3 bg_offset = ${c.eVert.outputs.offset || 'vec3(0.0)'};
  vec3 wp = wPos + bg_offset;
  v_uv = a_uv;
  v_lm = a_lm;
  v_color = a_color;
  v_world = wp;
  v_normal = wNormal;
  v_dist = length(wp - u_cam);
  gl_Position = u_viewProj * vec4(wp, 1.0);
}
`;

  const entityFS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_atlas;
uniform float u_far;
uniform vec4 u_entityColor;
${PREVIEW_COMMON_UNIFORMS}
${PREVIEW_ENTITY_UNIFORMS}
${settingUniforms}
in vec2 v_uv;
in vec2 v_lm;
in vec4 v_color;
in vec3 v_world;
in vec3 v_normal;
in float v_dist;
out vec4 fragColor;
${GLSL_HELPERS}
${GLSL_FRAG_HELPERS}
${PREVIEW_LIGHT}
vec4 bg_sampleBlock(vec2 uv) { return texture(u_atlas, uv); }
vec4 bg_sampleBlockLod(vec2 uv, float lod) { return textureLod(u_atlas, uv, lod); }
${c.eFrag.functions.join('\n')}
void main() {
${indent([entityBuiltins('preview', 'fragment')], '  ')}
${indent(c.eFrag.lines.length ? c.eFrag.lines : ['// (no nodes)'], '  ')}
${indent(surfaceToColor(eo, c.eFrag.outParams, 'preview', { flash: 'u_entityColor' }), '  ')}
  fragColor = vec4(rgb, bg_alpha);
}
`;

  return { terrainVS, terrainFS, entityVS, entityFS, postFS, settings: c.settings, errors: c.errors };
}

// ------------------------------------------------------------- node previews

// Tile in the atlas the terrain thumbnails wrap around the preview ball.
export const PREVIEW_TILE = { origin: [0.125, 0.0], size: 0.125 }; // tile 1 of the 8×8 preview atlas

export function previewableNode(def) {
  return def && def.outputs.length && !def.isOutput && !def.isNote && !def.setting && !def.noPreview && !['number', 'constant'].includes(def.type);
}

// Builds a small fragment shader that shows one node's first output.
// Blocks graph: on a ball wrapped in a grass-block texture. Post FX: over the live scene.
export function buildNodePreview(graphs, kind, nodeId) {
  const graph = graphs[kind];
  const r = compileStage(graph, kind, 'fragment', { root: nodeId });
  const { settings } = collectSettings(graphs);
  const viz = { float: `vec3(${r.value})`, vec2: `vec3(${r.value}, 0.0)`, vec3: r.value, vec4: `(${r.value}).rgb` }[r.type] || `vec3(${r.value})`;
  const body = r.lines.join('\n');
  const head = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_atlas;
uniform sampler2D u_scene;
uniform sampler2D u_depth;
uniform mat4 u_projInv;
uniform vec2 u_tileOrigin;
uniform float u_tileSize;
uniform vec2 u_tileRes;
uniform vec2 u_texSize;
${PREVIEW_COMMON_UNIFORMS}
${previewSettingUniforms(settings)}
in vec2 v_uv;
out vec4 fragColor;
${GLSL_HELPERS}
${GLSL_FRAG_HELPERS}
${PREVIEW_LIGHT}
vec4 bg_sampleBlock(vec2 uv) { return texture(u_atlas, uv); }
vec4 bg_sampleBlockLod(vec2 uv, float lod) { return textureLod(u_atlas, uv, lod); }
vec4 bg_sampleScene(vec2 uv) { return texture(u_scene, uv); }
float bg_sceneDistance(vec2 uv) {
  float d = texture(u_depth, uv).r;
  vec4 v = u_projInv * vec4(vec3(uv, d) * 2.0 - 1.0, 1.0);
  return length(v.xyz / v.w);
}
float bg_isSky(vec2 uv) { return texture(u_depth, uv).r >= 0.99999 ? 1.0 : 0.0; }
${r.functions.join('\n')}
`;
  let main;
  if (kind === 'terrain' || kind === 'entity') {
    const ids = kind === 'entity'
      ? `\n  int bg_itemId = ${ID_GROUPS.items.swords.id};\n  int bg_entityId = 0;\n  int bg_blockEntityId = 0;\n  float bg_isHeld = 1.0;\n  float bg_isEntity = 0.0;\n  float bg_isBlockEntity = 0.0;`
      : '';
    main = `void main() {
  vec2 q = v_uv;
  float aspect = u_tileRes.x / u_tileRes.y;
  vec2 p = (q * 2.0 - 1.0) * vec2(aspect, 1.0) * 1.12;
  float r2 = dot(p, p);
  if (r2 > 1.0) {
    vec2 ck = floor(gl_FragCoord.xy / 8.0);
    fragColor = vec4(vec3(mix(0.11, 0.15, mod(ck.x + ck.y, 2.0))), 1.0);
    return;
  }
  vec3 n = vec3(p.x, p.y, sqrt(1.0 - r2));
  vec2 sph = vec2(atan(n.x, n.z) * 0.15915494 + 0.5, acos(clamp(n.y, -1.0, 1.0)) * 0.31830989);
  vec2 bg_uv = u_tileOrigin + fract(sph * vec2(4.0, 2.0)) * u_tileSize;
${indent(COMMON_TIME(true), '  ')}
  vec3 bg_worldPos = n * 1.5 + vec3(0.0, 1.0, 0.0);
  vec3 bg_normal = n;
  vec4 bg_vcolor = vec4(1.0);
  vec2 bg_lm = vec2(0.0, 1.0);
  vec3 bg_light = bg_lightmapColor(bg_lm, bg_daylight);
  float bg_isLeaves = 0.0;
  float bg_isPlant = 0.0;
  float bg_isWater = 0.0;
  float bg_isModel = 0.0;
  float bg_plantTop = step(0.0, p.y);
  float bg_viewDist = 8.0;
  vec3 bg_viewDir = vec3(0.0, 0.0, 1.0);
  vec2 bg_faceUV = fract(sph * vec2(4.0, 2.0));${ids}
${indent([body], '  ')}
  vec3 c = clamp(${viz}, 0.0, 1.0);
  fragColor = vec4(c, 1.0);
}
`;
  } else if (kind === 'texture') {
    main = `void main() {
  vec2 q = vec2(v_uv.x, 1.0 - v_uv.y);
  float aspect = u_tileRes.x / u_tileRes.y;
  vec2 sq = vec2((q.x - 0.5) * aspect + 0.5, q.y);
  if (sq.x < 0.0 || sq.x > 1.0) {
    vec2 ck = floor(gl_FragCoord.xy / 8.0);
    fragColor = vec4(vec3(mix(0.11, 0.15, mod(ck.x + ck.y, 2.0))), 1.0);
    return;
  }
  vec2 bg_texSize = max(u_texSize, vec2(1.0));
  vec2 bg_pixel = (floor(sq * bg_texSize) + 0.5);
  vec2 bg_uv = bg_pixel / bg_texSize;
  float bg_time = 0.0;
${indent([body], '  ')}
  fragColor = vec4(clamp(${viz}, 0.0, 1.0), 1.0);
}
`;
  } else {
    main = `void main() {
  vec2 bg_screenUV = v_uv;
${indent(COMMON_TIME(true), '  ')}
${indent([body], '  ')}
  fragColor = vec4(clamp(${viz}, 0.0, 1.0), 1.0);
}
`;
  }
  const src = head + main;
  const animated = /bg_time|bg_custom_/.test(body);
  return { src, animated, errors: r.errors };
}

// ------------------------------------------------------------ texture bake

// Turns a texture graph into a shader that paints the texture one pixel at a
// time. bg_uv runs 0–1 with v = 0 at the top row, like Minecraft textures.
// Seamless mode blends in a half-shifted copy near the edges so it tiles.
export function buildTextureShader(graph) {
  const r = compileStage(graph, 'texture', 'fragment');
  const o = r.outputs;
  const src = `#version 300 es
precision highp float;
precision highp int;
uniform vec2 u_texSize;
uniform float u_seamless;
out vec4 fragColor;
${GLSL_HELPERS}
${GLSL_FRAG_HELPERS}
${r.functions.join('\n')}
vec4 bg_texEval(vec2 bg_uv) {
  vec2 bg_texSize = u_texSize;
  vec2 bg_pixel = bg_uv * u_texSize;
  float bg_time = 0.0;
${indent(r.lines.length ? r.lines : ['// (no nodes)'], '  ')}
  return vec4(${o.color || 'vec3(0.5)'}, ${o.alpha || '1.0'});
}
void main() {
  vec2 p = floor(gl_FragCoord.xy) + 0.5;
  vec2 uv = vec2(p.x, u_texSize.y - p.y) / u_texSize;
  vec4 c = bg_texEval(uv);
  if (u_seamless > 0.5) {
    vec4 c2 = bg_texEval(fract(uv + 0.5));
    vec2 e = abs(uv - 0.5) * 2.0;
    c = mix(c, c2, smoothstep(0.55, 1.0, max(e.x, e.y)));
  }
  fragColor = clamp(c, 0.0, 1.0);
}
`;
  return { src, errors: r.errors };
}

// --------------------------------------------------------------------- iris

const HEADER = (what) => `#version 330 compatibility
// ${what}
// Generated by BlockGraph (node shader editor) for Iris on Minecraft 1.21.11.
`;

const IRIS_COMMON_UNIFORMS = `uniform mat4 gbufferModelView;
uniform mat4 gbufferModelViewInverse;
uniform vec3 cameraPosition;
uniform vec3 sunPosition;
uniform vec3 skyColor;
uniform vec3 fogColor;
uniform float far;
uniform float viewWidth;
uniform float viewHeight;
uniform float frameTimeCounter;
uniform int worldTime;
uniform float rainStrength;
uniform int heldItemId;
uniform int heldItemId2;`;

function settingsUsedIn(stageResult, all) {
  const m = new Map();
  for (const name of stageResult.settings.keys()) if (all.has(name)) m.set(name, all.get(name));
  return m;
}

function irisTerrain(c, programName) {
  const vSet = settingsUsedIn(c.tVert, c.settings);
  const fSet = settingsUsedIn(c.tFrag, c.settings);
  const o = c.tFrag.outputs;

  const vsh = `${HEADER(`${programName}.vsh: Blocks graph, vertex stage (Vertex Offset)`)}
${irisSettingDefines(vSet)}

${IRIS_COMMON_UNIFORMS}
uniform sampler2D gtexture;
uniform sampler2D lightmap;

in vec4 mc_Entity;
in vec2 mc_midTexCoord;

out vec2 texcoord;
out vec2 lmcoord;
out vec4 glcolor;
out vec3 worldPos;
out vec3 worldNormal;
out float viewDist;
out float plantTop;
flat out int blockId;
${GLSL_HELPERS}
vec4 bg_sampleBlock(vec2 uv) { return textureLod(gtexture, uv, 0.0); }
vec4 bg_sampleBlockLod(vec2 uv, float lod) { return textureLod(gtexture, uv, lod); }
${c.tVert.functions.join('\n')}
void main() {
	texcoord = (gl_TextureMatrix[0] * gl_MultiTexCoord0).xy;
	lmcoord = (gl_TextureMatrix[1] * gl_MultiTexCoord1).xy;
	glcolor = gl_Color;
	int id = int(mc_Entity.x + 0.5);
	float top = gl_MultiTexCoord0.y < mc_midTexCoord.y ? 1.0 : 0.0;
	blockId = id;
	plantTop = top;

	vec4 playerPos = gbufferModelViewInverse * (gl_ModelViewMatrix * gl_Vertex);
	vec3 wPos = playerPos.xyz + cameraPosition;
	vec3 wNormal = normalize(mat3(gbufferModelViewInverse) * normalize(gl_NormalMatrix * gl_Normal));

${indent([terrainBuiltins('iris', 'vertex')])}

${indent(c.tVert.lines.length ? c.tVert.lines : ['// (nothing is wired into Vertex Offset)'])}
	vec3 bg_offset = ${c.tVert.outputs.offset || 'vec3(0.0)'};

	playerPos.xyz += bg_offset;
	worldPos = wPos + bg_offset;
	worldNormal = wNormal;
	viewDist = length(playerPos.xyz);
	gl_Position = gl_ProjectionMatrix * (gbufferModelView * playerPos);
}
`;

  const fsh = `${HEADER(`${programName}.fsh: Blocks graph, pixel stage`)}
${irisSettingDefines(fSet)}

${IRIS_COMMON_UNIFORMS}
uniform sampler2D gtexture;
uniform sampler2D lightmap;
uniform float alphaTestRef = 0.1;

in vec2 texcoord;
in vec2 lmcoord;
in vec4 glcolor;
in vec3 worldPos;
in vec3 worldNormal;
in float viewDist;
in float plantTop;
flat in int blockId;

/* RENDERTARGETS: 0 */
layout(location = 0) out vec4 outColor0;
${GLSL_HELPERS}
${GLSL_FRAG_HELPERS}
vec4 bg_sampleBlock(vec2 uv) { return texture(gtexture, uv); }
vec4 bg_sampleBlockLod(vec2 uv, float lod) { return textureLod(gtexture, uv, lod); }
${c.tFrag.functions.join('\n')}
void main() {
${indent([terrainBuiltins('iris', 'fragment')])}

${indent(c.tFrag.lines.length ? c.tFrag.lines : ['// (no nodes)'])}
${indent(surfaceToColor(o, c.tFrag.outParams, 'iris'))}
	outColor0 = vec4(rgb, bg_alpha);
}
`;
  return { vsh, fsh };
}

const ENTITY_WHAT = {
  hand: 'items in your hands, first person',
  entity: 'mobs, players, worn armour, dropped items, item frames and item displays',
  block: 'block entities: chests, signs, banners, beds, heads and shulker boxes',
};

function irisEntity(c, programName, prog) {
  const vSet = settingsUsedIn(c.eVert, c.settings);
  const fSet = settingsUsedIn(c.eFrag, c.settings);
  const o = c.eFrag.outputs;
  const vsh = `${HEADER(`${programName}.vsh: Items & Entities graph, vertex stage. Draws ${ENTITY_WHAT[prog]}.`)}
${irisSettingDefines(vSet)}

${IRIS_COMMON_UNIFORMS}
uniform sampler2D gtexture;
uniform sampler2D lightmap;
uniform int entityId;
uniform int blockEntityId;
uniform int currentRenderedItemId;

out vec2 texcoord;
out vec2 lmcoord;
out vec4 glcolor;
out vec3 worldPos;
out vec3 worldNormal;
out float viewDist;
${GLSL_HELPERS}
vec4 bg_sampleBlock(vec2 uv) { return textureLod(gtexture, uv, 0.0); }
vec4 bg_sampleBlockLod(vec2 uv, float lod) { return textureLod(gtexture, uv, lod); }
${c.eVert.functions.join('\n')}
void main() {
	texcoord = (gl_TextureMatrix[0] * gl_MultiTexCoord0).xy;
	lmcoord = (gl_TextureMatrix[1] * gl_MultiTexCoord1).xy;
	glcolor = gl_Color;

	vec4 playerPos = gbufferModelViewInverse * (gl_ModelViewMatrix * gl_Vertex);
	vec3 wPos = playerPos.xyz + cameraPosition;
	vec3 wNormal = bg_safeNormalize(mat3(gbufferModelViewInverse) * (gl_NormalMatrix * gl_Normal));

${indent([entityBuiltins('iris', 'vertex', prog)])}

${indent(c.eVert.lines.length ? c.eVert.lines : ['// (nothing is wired into Vertex Offset)'])}
	vec3 bg_offset = ${c.eVert.outputs.offset || 'vec3(0.0)'};

	playerPos.xyz += bg_offset;
	worldPos = wPos + bg_offset;
	worldNormal = wNormal;
	viewDist = length(playerPos.xyz);
	gl_Position = gl_ProjectionMatrix * (gbufferModelView * playerPos);
}
`;
  const fsh = `${HEADER(`${programName}.fsh: Items & Entities graph, pixel stage. Draws ${ENTITY_WHAT[prog]}.`)}
${irisSettingDefines(fSet)}

${IRIS_COMMON_UNIFORMS}
uniform sampler2D gtexture;
uniform sampler2D lightmap;
uniform vec4 entityColor;
uniform int entityId;
uniform int blockEntityId;
uniform int currentRenderedItemId;

in vec2 texcoord;
in vec2 lmcoord;
in vec4 glcolor;
in vec3 worldPos;
in vec3 worldNormal;
in float viewDist;

/* RENDERTARGETS: 0 */
layout(location = 0) out vec4 outColor0;
${GLSL_HELPERS}
${GLSL_FRAG_HELPERS}
vec4 bg_sampleBlock(vec2 uv) { return texture(gtexture, uv); }
vec4 bg_sampleBlockLod(vec2 uv, float lod) { return textureLod(gtexture, uv, lod); }
${c.eFrag.functions.join('\n')}
void main() {
${indent([entityBuiltins('iris', 'fragment', prog)])}

${indent(c.eFrag.lines.length ? c.eFrag.lines : ['// (no nodes)'])}
${indent(surfaceToColor(o, c.eFrag.outParams, 'iris', { flash: 'entityColor' }))}
	outColor0 = vec4(rgb, bg_alpha);
}
`;
  return { vsh, fsh };
}

function irisComposite(c) {
  const set = settingsUsedIn(c.post, c.settings);
  const vsh = `${HEADER('composite.vsh: full-screen pass for the Post FX graph')}
out vec2 texcoord;

void main() {
	gl_Position = ftransform();
	texcoord = (gl_TextureMatrix[0] * gl_MultiTexCoord0).xy;
}
`;
  const fsh = `${HEADER('composite.fsh: Post FX graph')}
${irisSettingDefines(set)}

${IRIS_COMMON_UNIFORMS}
uniform sampler2D colortex0;
uniform sampler2D depthtex0;
uniform mat4 gbufferProjectionInverse;

in vec2 texcoord;

/* RENDERTARGETS: 0 */
layout(location = 0) out vec4 outColor0;
${GLSL_HELPERS}
${GLSL_FRAG_HELPERS}
vec4 bg_sampleScene(vec2 uv) { return texture(colortex0, uv); }
float bg_sceneDistance(vec2 uv) {
	float d = texture(depthtex0, uv).r;
	vec4 v = gbufferProjectionInverse * vec4(vec3(uv, d) * 2.0 - 1.0, 1.0);
	return length(v.xyz / v.w);
}
float bg_isSky(vec2 uv) { return texture(depthtex0, uv).r >= 0.99999 ? 1.0 : 0.0; }
${c.post.functions.join('\n')}
void main() {
${indent([postBuiltins('iris')])}

${indent(c.post.lines.length ? c.post.lines : ['// (no nodes)'])}
	outColor0 = vec4(clamp(${c.post.outputs.color}, 0.0, 1.0), 1.0);
}
`;
  return { vsh, fsh };
}

// Programs the graphs don't cover. Kept close to vanilla so entities, the sky,
// particles and the hand look normal.
const STATIC_PROGRAMS = {
  'gbuffers_basic.vsh': `${HEADER('gbuffers_basic.vsh: lines and untextured geometry')}
out vec2 lmcoord;
out vec4 glcolor;

void main() {
	gl_Position = ftransform();
	lmcoord = (gl_TextureMatrix[1] * gl_MultiTexCoord1).xy;
	glcolor = gl_Color;
}
`,
  'gbuffers_basic.fsh': `${HEADER('gbuffers_basic.fsh')}
uniform sampler2D lightmap;
uniform float alphaTestRef = 0.1;

in vec2 lmcoord;
in vec4 glcolor;

/* RENDERTARGETS: 0 */
layout(location = 0) out vec4 color;

void main() {
	color = glcolor * texture(lightmap, lmcoord);
	if (color.a < alphaTestRef) discard;
}
`,
  'gbuffers_textured.vsh': `${HEADER('gbuffers_textured.vsh: entities, particles, the hand and other textured things')}
out vec2 lmcoord;
out vec2 texcoord;
out vec4 glcolor;

void main() {
	gl_Position = ftransform();
	texcoord = (gl_TextureMatrix[0] * gl_MultiTexCoord0).xy;
	lmcoord = (gl_TextureMatrix[1] * gl_MultiTexCoord1).xy;
	glcolor = gl_Color;
}
`,
  'gbuffers_textured.fsh': `${HEADER('gbuffers_textured.fsh')}
uniform sampler2D gtexture;
uniform sampler2D lightmap;
uniform vec4 entityColor;
uniform float alphaTestRef = 0.1;

in vec2 lmcoord;
in vec2 texcoord;
in vec4 glcolor;

/* RENDERTARGETS: 0 */
layout(location = 0) out vec4 color;

void main() {
	color = texture(gtexture, texcoord) * glcolor;
	color.rgb = mix(color.rgb, entityColor.rgb, entityColor.a);
	color *= texture(lightmap, lmcoord);
	if (color.a < alphaTestRef) discard;
}
`,
  'gbuffers_clouds.vsh': `${HEADER('gbuffers_clouds.vsh')}
out vec2 texcoord;
out vec4 glcolor;

void main() {
	gl_Position = ftransform();
	texcoord = (gl_TextureMatrix[0] * gl_MultiTexCoord0).xy;
	glcolor = gl_Color;
}
`,
  'gbuffers_clouds.fsh': `${HEADER('gbuffers_clouds.fsh')}
uniform sampler2D gtexture;
uniform float alphaTestRef = 0.1;

in vec2 texcoord;
in vec4 glcolor;

/* RENDERTARGETS: 0 */
layout(location = 0) out vec4 color;

void main() {
	color = texture(gtexture, texcoord) * glcolor;
	if (color.a < alphaTestRef) discard;
}
`,
  'gbuffers_armor_glint.vsh': `${HEADER('gbuffers_armor_glint.vsh: enchantment glint on items and armour. Kept separate so the Items & Entities graph never touches it.')}
out vec2 texcoord;
out vec4 glcolor;

void main() {
	gl_Position = ftransform();
	texcoord = (gl_TextureMatrix[0] * gl_MultiTexCoord0).xy;
	glcolor = gl_Color;
}
`,
  'gbuffers_armor_glint.fsh': `${HEADER('gbuffers_armor_glint.fsh: the scrolling glint texture, blended by Minecraft as usual')}
uniform sampler2D gtexture;

in vec2 texcoord;
in vec4 glcolor;

/* RENDERTARGETS: 0 */
layout(location = 0) out vec4 color;

void main() {
	color = texture(gtexture, texcoord) * glcolor;
	if (color.a < 0.1) discard;
}
`,
  'gbuffers_skybasic.vsh': `${HEADER('gbuffers_skybasic.vsh: sky colour and stars')}
out vec4 starData;

void main() {
	gl_Position = ftransform();
	starData = vec4(gl_Color.rgb, float(gl_Color.r == gl_Color.g && gl_Color.g == gl_Color.b && gl_Color.r > 0.0));
}
`,
  'gbuffers_skybasic.fsh': `${HEADER('gbuffers_skybasic.fsh')}
uniform int renderStage;
uniform float viewHeight;
uniform float viewWidth;
uniform mat4 gbufferModelView;
uniform mat4 gbufferProjectionInverse;
uniform vec3 fogColor;
uniform vec3 skyColor;

in vec4 starData;

/* RENDERTARGETS: 0 */
layout(location = 0) out vec4 color;

float fogify(float x, float w) {
	return w / (x * x + w);
}

vec3 calcSkyColor(vec3 pos) {
	float upDot = dot(pos, gbufferModelView[1].xyz);
	return mix(skyColor, fogColor, fogify(max(upDot, 0.0), 0.25));
}

void main() {
	if (renderStage == MC_RENDER_STAGE_STARS) {
		color = starData;
	} else {
		vec4 pos = vec4(gl_FragCoord.xy / vec2(viewWidth, viewHeight) * 2.0 - 1.0, 1.0, 1.0);
		pos = gbufferProjectionInverse * pos;
		color = vec4(calcSkyColor(normalize(pos.xyz)), 1.0);
	}
}
`,
  'gbuffers_skytextured.vsh': `${HEADER('gbuffers_skytextured.vsh: sun and moon')}
out vec2 texcoord;
out vec4 glcolor;

void main() {
	gl_Position = ftransform();
	texcoord = (gl_TextureMatrix[0] * gl_MultiTexCoord0).xy;
	glcolor = gl_Color;
}
`,
  'gbuffers_skytextured.fsh': `${HEADER('gbuffers_skytextured.fsh')}
uniform sampler2D gtexture;

in vec2 texcoord;
in vec4 glcolor;

/* RENDERTARGETS: 0 */
layout(location = 0) out vec4 color;

void main() {
	color = texture(gtexture, texcoord) * glcolor;
}
`,
};

const LEAVES = [
  'oak_leaves', 'spruce_leaves', 'birch_leaves', 'jungle_leaves', 'acacia_leaves', 'dark_oak_leaves',
  'mangrove_leaves', 'cherry_leaves', 'azalea_leaves', 'flowering_azalea_leaves', 'pale_oak_leaves', 'vine',
];
const PLANTS = [
  'short_grass', 'tall_grass', 'fern', 'large_fern', 'dead_bush', 'dandelion', 'poppy', 'blue_orchid', 'allium',
  'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy', 'cornflower',
  'lily_of_the_valley', 'torchflower', 'sunflower', 'lilac', 'rose_bush', 'peony', 'wheat', 'carrots', 'potatoes',
  'beetroots', 'sweet_berry_bush', 'sugar_cane', 'oak_sapling', 'spruce_sapling', 'birch_sapling', 'jungle_sapling',
  'acacia_sapling', 'dark_oak_sapling', 'cherry_sapling', 'pale_oak_sapling', 'short_dry_grass', 'tall_dry_grass',
  'bush', 'firefly_bush',
];

export function buildIris(graphs, opts = {}) {
  const c = compileAll(graphs);
  const terrain = irisTerrain(c, 'gbuffers_terrain');
  const water = irisTerrain(c, 'gbuffers_water');
  const comp = irisComposite(c);
  const files = {};
  files['shaders/gbuffers_terrain.vsh'] = terrain.vsh;
  files['shaders/gbuffers_terrain.fsh'] = terrain.fsh;
  files['shaders/gbuffers_water.vsh'] = water.vsh;
  files['shaders/gbuffers_water.fsh'] = water.fsh;
  files['shaders/composite.vsh'] = comp.vsh;
  files['shaders/composite.fsh'] = comp.fsh;
  for (const [name, prog] of [
    ['gbuffers_hand', 'hand'], ['gbuffers_hand_water', 'hand'],
    ['gbuffers_entities', 'entity'], ['gbuffers_entities_translucent', 'entity'],
    ['gbuffers_block', 'block'], ['gbuffers_block_translucent', 'block'],
  ]) {
    const e = irisEntity(c, name, prog);
    files[`shaders/${name}.vsh`] = e.vsh;
    files[`shaders/${name}.fsh`] = e.fsh;
  }
  for (const [name, src] of Object.entries(STATIC_PROGRAMS)) files['shaders/' + name] = src;

  files['shaders/block.properties'] = [
    '# Block IDs used by the Block Type node (read in the shader through mc_Entity).',
    `block.${BLOCK_IDS.leaves}=${LEAVES.join(' ')}`,
    `block.${BLOCK_IDS.plants}=${PLANTS.join(' ')}`,
    `block.${BLOCK_IDS.water}=water`,
    ...(opts.modelBlocks?.length ? [
      '# Blocks that use a 3D model from the Models tab (BlockGraph Models mod).',
      `block.${BLOCK_IDS.model}=${opts.modelBlocks.join(' ')}`,
    ] : []),
    '',
    '# Block entities, read through blockEntityId by the Block Entity Mask node.',
    ...Object.values(ID_GROUPS.blockEntities).map((g) => `block.${g.id}=${g.names.join(' ')}`),
    '',
    '# Common building blocks. As items they count as "Blocks as items" (currentRenderedItemId).',
    `block.${ID_GROUPS.buildingBlocks.id}=${ID_GROUPS.buildingBlocks.names.join(' ')}`,
    '',
  ].join('\n');

  files['shaders/item.properties'] = [
    '# Item groups for the Item ID Mask and Held Item Mask nodes',
    '# (currentRenderedItemId, heldItemId, heldItemId2).',
    ...Object.values(ID_GROUPS.items).map((g) => `item.${g.id}=${g.names.join(' ')}`),
    '',
  ].join('\n');

  files['shaders/entity.properties'] = [
    '# Entity groups for the Entity Type Mask node (entityId).',
    ...Object.values(ID_GROUPS.entities).map((g) => `entity.${g.id}=${g.names.join(' ')}`),
    '',
  ].join('\n');

  const names = [...c.settings.keys()];
  const sliders = names.filter((n) => c.settings.get(n).kind === 'slider');
  const props = [
    `# ${opts.name || 'BlockGraph pack'}, made with BlockGraph.`,
    '# Keep vanilla per-face shading so blocks read as 3D.',
    'oldLighting = true',
  ];
  if (opts.customTextures?.length) {
    props.push('', '# Textures from the Textures tab, used by Image Texture nodes.');
    for (const t of opts.customTextures) props.push(`customTexture.${texSampler(t.id)} = textures/${texSampler(t.id)}.png`);
  }
  if (names.length) {
    props.push('', '# Settings menu (Iris → Shader Settings). Built from your Slider, On/Off and Dropdown nodes.');
    props.push(`screen = ${names.join(' ')}`);
    if (sliders.length) props.push(`sliders = ${sliders.join(' ')}`);
  }
  files['shaders/shaders.properties'] = props.join('\n') + '\n';

  const lang = ['# Labels for the settings menu'];
  for (const n of names) {
    const s = c.settings.get(n);
    lang.push(`option.${n}=${String(s.label || n).replace(/\n/g, ' ')}`);
    if (s.kind === 'slider') lang.push(`option.${n}.comment=Range ${s.min} to ${s.max}. Made with BlockGraph.`);
    if (s.kind === 'choice') choiceOptions(s).forEach((label, i) => lang.push(`value.${n}.${i}=${label}`));
  }
  files['shaders/lang/en_us.lang'] = lang.join('\n') + '\n';
  for (const k of Object.keys(files)) files[k] = files[k].replace(/\n{3,}/g, '\n\n');
  return { files, errors: c.errors, settings: c.settings };
}

export { NODE_DEFS };
