// A small PNG encoder and decoder for 8-bit RGBA pixels.
// The browser's canvas stores premultiplied alpha, so a canvas round trip
// wipes the colour of pixels with low alpha. LabPBR specular maps keep
// emission in alpha, so they are encoded and decoded here instead.
// Uses CompressionStream (browsers and Node 18+).

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes, start, end) {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

const paeth = (a, b, c) => {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

// rgba: Uint8Array or Uint8ClampedArray of width * height * 4 bytes.
export async function encodePng(rgba, width, height) {
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    // Paeth filter: smooth maps (normals, flat specular) shrink a lot.
    const o = y * (stride + 1), r = y * stride;
    raw[o] = 4;
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? rgba[r + x - 4] : 0;
      const b = y > 0 ? rgba[r - stride + x] : 0;
      const c = x >= 4 && y > 0 ? rgba[r - stride + x - 4] : 0;
      raw[o + 1 + x] = (rgba[r + x] - paeth(a, b, c)) & 0xff;
    }
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8 bit, RGBA, deflate, adaptive filters, no interlace
  const idat = await pipe(raw, new CompressionStream('deflate'));
  const parts = [new Uint8Array(SIGNATURE), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// Decodes 8-bit greyscale, RGB or RGBA PNGs (with or without alpha), not
// interlaced, which is what encodePng and most tools write. Returns
// { width, height, data } with data as RGBA bytes.
export async function decodePng(bytes) {
  bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIGNATURE[i]) throw new Error('Not a PNG file.');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0, depth = 0, type = 0, interlace = 0;
  const idat = [];
  for (let o = 8; o + 8 <= bytes.length;) {
    const len = dv.getUint32(o);
    const name = String.fromCharCode(...bytes.subarray(o + 4, o + 8));
    const data = bytes.subarray(o + 8, o + 8 + len);
    if (name === 'IHDR') {
      width = dv.getUint32(o + 8);
      height = dv.getUint32(o + 12);
      [depth, type] = [data[8], data[9]];
      interlace = data[12];
    } else if (name === 'IDAT') {
      idat.push(data);
    } else if (name === 'IEND') {
      break;
    }
    o += 12 + len;
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[type];
  if (depth !== 8 || !channels || interlace) throw new Error('Only 8-bit, non-interlaced PNGs can be read here.');
  const joined = new Uint8Array(idat.reduce((n, d) => n + d.length, 0));
  let p = 0;
  for (const d of idat) {
    joined.set(d, p);
    p += d.length;
  }
  const raw = await pipe(joined, new DecompressionStream('deflate'));
  const bpp = channels, stride = width * bpp;
  const px = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[dst + x - bpp] : 0;
      const b = y > 0 ? px[dst - stride + x] : 0;
      const c = x >= bpp && y > 0 ? px[dst - stride + x - bpp] : 0;
      const v = raw[src + x];
      px[dst + x] = (f === 0 ? v : f === 1 ? v + a : f === 2 ? v + b : f === 3 ? v + ((a + b) >> 1) : v + paeth(a, b, c)) & 0xff;
    }
  }
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, j = 0; i < width * height; i++, j += bpp) {
    const g = channels < 3;
    data[i * 4] = px[j];
    data[i * 4 + 1] = g ? px[j] : px[j + 1];
    data[i * 4 + 2] = g ? px[j] : px[j + 2];
    data[i * 4 + 3] = channels === 4 ? px[j + 3] : channels === 2 ? px[j + 1] : 255;
  }
  return { width, height, data };
}
