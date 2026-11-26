// Minimal PNG reading and writing for the sheet tools (8-bit RGB / RGBA / palette, not interlaced).
import { inflateSync, deflateSync } from 'node:zlib';

export interface RGBA { w: number; h: number; px: Uint8Array }

export function readPng(buf: Buffer): RGBA {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let o = 8, w = 0, h = 0, depth = 0, type = 0, interlace = 0;
  let palette: Buffer | null = null, trns: Buffer | null = null;
  const idat: Buffer[] = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o), kind = buf.toString('ascii', o + 4, o + 8), data = buf.subarray(o + 8, o + 8 + len);
    if (kind === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; type = data[9]; interlace = data[12]; }
    else if (kind === 'PLTE') palette = data;
    else if (kind === 'tRNS') trns = data;
    else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    o += 12 + len;
  }
  if (depth !== 8 || interlace) throw new Error(`unsupported PNG: depth ${depth}, interlace ${interlace}`);
  const bpp = type === 2 ? 3 : type === 6 ? 4 : type === 3 ? 1 : type === 0 ? 1 : type === 4 ? 2 : 0;
  if (!bpp) throw new Error(`unsupported PNG colour type ${type}`);
  const raw = inflateSync(Buffer.concat(idat)), stride = w * bpp;
  const rows = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? rows[dst + x - bpp] : 0, b = y > 0 ? rows[dst - stride + x] : 0, c = x >= bpp && y > 0 ? rows[dst - stride + x - bpp] : 0;
      let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      rows[dst + x] = v & 255;
    }
  }
  const px = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    if (type === 2) { px[i * 4] = rows[i * 3]; px[i * 4 + 1] = rows[i * 3 + 1]; px[i * 4 + 2] = rows[i * 3 + 2]; px[i * 4 + 3] = 255; }
    else if (type === 6) px.set(rows.subarray(i * 4, i * 4 + 4), i * 4);
    else if (type === 3) { const p = rows[i]; px[i * 4] = palette![p * 3]; px[i * 4 + 1] = palette![p * 3 + 1]; px[i * 4 + 2] = palette![p * 3 + 2]; px[i * 4 + 3] = trns && p < trns.length ? trns[p] : 255; }
    else if (type === 0) { px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = rows[i]; px[i * 4 + 3] = 255; }
    else { px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = rows[i * 2]; px[i * 4 + 3] = rows[i * 2 + 1]; }
  }
  return { w, h, px };
}

const CRC = new Uint32Array(256);
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; }
const crc32 = (b: Uint8Array) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4, 'ascii'); out.set(data, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** Opaque RGB PNG from RGBA pixels (alpha dropped). */
export function writePngRgb({ w, h, px }: RGBA): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = (y * w + x) * 4, d = y * (w * 3 + 1) + 1 + x * 3;
    raw[d] = px[s]; raw[d + 1] = px[s + 1]; raw[d + 2] = px[s + 2];
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', new Uint8Array(0))]);
}
