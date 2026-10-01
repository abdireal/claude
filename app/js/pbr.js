// Material maps for shaders, in the LabPBR 1.3 format that Iris reads next to
// each texture (and BlockGraph's Material Maps node decodes):
//   name_n.png  R, G = normal X and Y (DirectX style: +Y points down the image)
//               B = ambient occlusion, A = height (255 = no depth)
//   name_s.png  R = smoothness (1 - roughness)
//               G = reflectance: 0-229 is F0 of non-metals, 255 = metal tinted by the albedo
//               B = porosity / subsurface (unused, 0)
//               A = emission 0-254, 255 = none
// Pure functions on RGBA byte arrays, so they run in tests without a browser.

export const METAL = 255;
export const DIELECTRIC = 10; // F0 0.04, plastic, wood, stone, leather

// Surface choices for a model material. "file" uses the maps that came with
// the model; the others write one flat specular map.
export const SURFACES = {
  file: { label: 'From the model file' },
  matte: { label: 'Matte (no shine)', smooth: 0, f0: DIELECTRIC },
  glossy: { label: 'Glossy (paint, plastic)', smooth: 0.82, f0: DIELECTRIC },
  polished: { label: 'Polished metal', smooth: 0.94, f0: METAL },
  brushed: { label: 'Brushed metal', smooth: 0.62, f0: METAL },
  gem: { label: 'Gem or glass', smooth: 0.96, f0: 30 },
};

export const FLAT_NORMAL = [128, 128, 255, 255];
export const NO_SPECULAR = [0, 0, 0, 0]; // what Iris uses when a texture has no _s

const byte = (v) => Math.max(0, Math.min(255, Math.round(v)));
const emissionAlpha = (e) => (e > 0.5 / 254 ? Math.min(254, byte(e * 254)) : 255);

// One specular pixel for a preset surface, or null when nothing needs writing.
export function flatSpecular(surface, glow = false) {
  const s = SURFACES[surface];
  if (!s || surface === 'file') return null;
  if (surface === 'matte' && !glow) return null;
  return [byte(s.smooth * 255), s.f0, 0, glow ? 254 : 255];
}

export function solidMap(px, w, h) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < out.length; i += 4) out.set(px, i);
  return out;
}

// A metal/roughness material (glTF, or OBJ with PBR .mtl lines) -> LabPBR
// maps. Every image is { data, width, height } at the same size (w x h), or
// null. Factors multiply the images, as in glTF.
//   normal (OpenGL style) * normalScale, occlusion  -> n
//   mr (G roughness, B metal) or rough / metal (R)  -> s, plus emission in alpha
// Returns { n, s, glowTint } where glowTint (or null) is a copy of the albedo
// with glowing pixels tinted towards their emission colour: LabPBR emission
// lights up the albedo, so a blue glow needs blue albedo under it.
export function toLabPbr({ w, h, albedo = null, normal = null, normalScale = 1, occlusion = null, occlusionStrength = 1,
  mr = null, rough = null, metal = null, metallic = 1, roughness = 1, hasMR = false, emissive = null, emissiveFactor = [0, 0, 0] }) {
  const count = w * h;
  let n = null, s = null, glowTint = null;

  if (normal || occlusion) {
    n = new Uint8ClampedArray(count * 4);
    for (let i = 0; i < count; i++) {
      const o = i * 4;
      let x = 0, y = 0;
      if (normal) {
        x = (normal.data[o] / 255 * 2 - 1) * normalScale;
        y = (normal.data[o + 1] / 255 * 2 - 1) * normalScale;
        const l = Math.hypot(x, y, normal.data[o + 2] / 255 * 2 - 1) || 1;
        x /= l;
        y /= l;
      }
      const ao = occlusion ? 1 + occlusionStrength * (occlusion.data[o] / 255 - 1) : 1;
      // glTF normal maps are OpenGL style (+Y up the image); LabPBR is DirectX style.
      n[o] = byte((x * 0.5 + 0.5) * 255);
      n[o + 1] = byte((-y * 0.5 + 0.5) * 255);
      n[o + 2] = byte(ao * 255);
      n[o + 3] = 255;
    }
  }

  const ef = emissiveFactor.slice(0, 3);
  const glowing = Math.max(...ef) > 0;
  const anyMR = hasMR || !!(mr || rough || metal);
  if (anyMR || glowing) {
    s = new Uint8ClampedArray(count * 4);
    if (glowing && albedo) glowTint = new Uint8ClampedArray(albedo.data);
    for (let i = 0; i < count; i++) {
      const o = i * 4;
      const r = roughness * (mr ? mr.data[o + 1] / 255 : rough ? rough.data[o] / 255 : 1);
      const m = metallic * (mr ? mr.data[o + 2] / 255 : metal ? metal.data[o] / 255 : 1);
      let er = ef[0], eg = ef[1], eb = ef[2];
      if (emissive) {
        er *= emissive.data[o] / 255;
        eg *= emissive.data[o + 1] / 255;
        eb *= emissive.data[o + 2] / 255;
      }
      const e = Math.max(er, eg, eb);
      s[o] = byte((1 - r) * 255);
      s[o + 1] = anyMR && m >= 0.5 ? METAL : DIELECTRIC;
      s[o + 2] = 0;
      s[o + 3] = emissionAlpha(e);
      if (glowTint && e > 0.01) {
        const t = Math.min(1, e * 1.6);
        const c = [er / e, eg / e, eb / e];
        for (let k = 0; k < 3; k++) glowTint[o + k] = byte(glowTint[o + k] * (1 - t) + c[k] * 255 * t);
      }
    }
  }
  return { n, s, glowTint };
}

// Downscales an RGBA map by averaging (box filter), for the preview atlas.
// Normals are renormalised so the average keeps a unit length.
export function boxDownscale(src, sw, sh, dw, dh, isNormal = false) {
  const out = new Uint8ClampedArray(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor(y * sh / dh), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sh / dh));
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor(x * sw / dw), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sw / dw));
      const acc = [0, 0, 0, 0];
      let k = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const o = (yy * sw + xx) * 4;
          for (let c = 0; c < 4; c++) acc[c] += src[o + c];
          k++;
        }
      }
      const o = (y * dw + x) * 4;
      if (isNormal) {
        let nx = acc[0] / k / 255 * 2 - 1, ny = acc[1] / k / 255 * 2 - 1;
        const l = Math.hypot(nx, ny);
        if (l > 1) { nx /= l; ny /= l; }
        out[o] = byte((nx * 0.5 + 0.5) * 255);
        out[o + 1] = byte((ny * 0.5 + 0.5) * 255);
        out[o + 2] = byte(acc[2] / k);
        out[o + 3] = byte(acc[3] / k);
      } else {
        for (let c = 0; c < 4; c++) out[o + c] = byte(acc[c] / k);
      }
    }
  }
  return out;
}

// True when an image is grey (R = G = B), like a bump (height) map. OBJ
// files use map_Bump for both bump maps and normal maps.
export function isGrayscale(img) {
  const d = img.data;
  const step = Math.max(1, Math.floor(d.length / 4 / 4096)) * 4;
  let off = 0, n = 0;
  for (let i = 0; i < d.length; i += step, n++) if (Math.abs(d[i] - d[i + 1]) > 3 || Math.abs(d[i + 1] - d[i + 2]) > 3) off++;
  return off <= n * 0.01;
}

// Height map (R, white is high) -> tangent-space normal map, OpenGL style
// like a glTF normal map, so it goes through toLabPbr the same way.
export function normalFromHeight(img, strength = 2) {
  const { width: w, height: h, data: d } = img;
  const out = new Uint8ClampedArray(w * h * 4);
  const H = (x, y) => d[(Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4] / 255;
  const k = strength * Math.max(w, h) / 256;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * k;
      const dy = (H(x, y + 1) - H(x, y - 1)) * k;
      // +Y is up the image in OpenGL style, and rows run down: flip dy.
      const nx = -dx, ny = dy, l = Math.hypot(nx, ny, 1);
      const o = (y * w + x) * 4;
      out[o] = byte((nx / l * 0.5 + 0.5) * 255);
      out[o + 1] = byte((ny / l * 0.5 + 0.5) * 255);
      out[o + 2] = byte((1 / l * 0.5 + 0.5) * 255);
      out[o + 3] = 255;
    }
  }
  return { width: w, height: h, data: out };
}
