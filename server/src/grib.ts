// A minimal GRIB2 reader for the weather fields (server/src/weather.ts): one message on a regular latitude/longitude
// grid (grid template 3.0), packed with complex packing and spatial differencing (data template 5.3), with or
// without a bitmap of the points that have a value (snow depth: land only), which is how NOAA's GFS publishes them. Anything else is rejected rather than misread. Layout per the WMO GRIB2 manual (FM 92);
// the unpacking follows NCEP's g2clib (comunpack.c).

export interface GribField {
  /** points along a row (longitude) and rows (latitude) */
  ni: number;
  nj: number;
  /** first point's latitude and longitude, degrees, and the steps between points (dj negative: rows run south) */
  lat0: number;
  lon0: number;
  di: number;
  dj: number;
  /** row-major values, NaN where missing */
  values: Float32Array;
}

/** Reads unsigned integers of any width from a byte array, most significant bit first. */
class Bits {
  private pos = 0; // in bits
  constructor(
    private readonly b: Uint8Array,
    byteOffset: number,
  ) {
    this.pos = byteOffset * 8;
  }
  read(n: number): number {
    let v = 0;
    for (let k = 0; k < n;) {
      const byte = this.b[this.pos >> 3],
        used = this.pos & 7,
        take = Math.min(8 - used, n - k);
      v = v * (1 << take) + ((byte >> (8 - used - take)) & ((1 << take) - 1));
      this.pos += take;
      k += take;
    }
    return v;
  }
  /** skip to the next whole byte */
  align(): void {
    this.pos = (this.pos + 7) & ~7;
  }
}

const u32 = (b: Uint8Array, o: number): number => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
const u16 = (b: Uint8Array, o: number): number => (b[o] << 8) | b[o + 1];
/** GRIB2's signed integers: the top bit is the sign, the rest the magnitude */
const signed = (v: number, bits: number): number => {
  const top = 2 ** (bits - 1);
  return v >= top ? -(v - top) : v;
};
const s16 = (b: Uint8Array, o: number): number => signed(u16(b, o), 16);
const s32 = (b: Uint8Array, o: number): number => signed(u32(b, o), 32);

/** Decode one GRIB2 message. */
export function decodeGrib2(buf: Uint8Array): GribField {
  if (buf.length < 16 || String.fromCharCode(buf[0], buf[1], buf[2], buf[3]) !== 'GRIB' || buf[7] !== 2) throw new Error('not a GRIB2 message');
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const total = Number(dv.getBigUint64(8));
  const sec: Record<number, number> = {}; // section number -> byte offset
  for (let p = 16; p < Math.min(total, buf.length) - 4;) {
    const len = u32(buf, p);
    if (len < 5) throw new Error('GRIB2: bad section length');
    sec[buf[p + 4]] ??= p;
    p += len;
  }
  for (const s of [3, 5, 6, 7]) if (sec[s] === undefined) throw new Error(`GRIB2: no section ${s}`);

  // section 3: the grid
  const g = sec[3];
  if (u16(buf, g + 12) !== 0) throw new Error(`GRIB2: grid template ${u16(buf, g + 12)}, only 3.0 (lat/lon) is supported`);
  const ni = u32(buf, g + 30),
    nj = u32(buf, g + 34);
  const unit = 1e-6;
  const lat0 = s32(buf, g + 46) * unit,
    lon0 = s32(buf, g + 50) * unit,
    lat1 = s32(buf, g + 55) * unit;
  const di = u32(buf, g + 63) * unit;
  // scanning mode: only rows running west to east, one row after another (bit 0x40, rows running north, is fine)
  if (buf[g + 71] & 0xb0) throw new Error(`GRIB2: scanning mode ${buf[g + 71]} not supported`);
  const dj = nj > 1 ? (lat1 - lat0) / (nj - 1) : 0;

  // section 6: a bitmap (indicator 0: one bit per grid point, set where there is a value, e.g. snow depth only over
  // land) or none (255: every grid point has one)
  const bitmapFlag = buf[sec[6] + 5];
  if (bitmapFlag !== 0 && bitmapFlag !== 255) throw new Error(`GRIB2: bitmap indicator ${bitmapFlag} not supported`);
  const bitmapAt = sec[6] + 6;

  // section 5: how the values are packed
  const r = sec[5];
  const n = u32(buf, r + 5);
  if (u16(buf, r + 9) !== 3) throw new Error(`GRIB2: data template 5.${u16(buf, r + 9)}, only 5.3 (complex packing, spatial differencing) is supported`);
  if (bitmapFlag === 255 && n !== ni * nj) throw new Error('GRIB2: value count does not match the grid');
  if (bitmapFlag === 0 && u32(buf, sec[6]) < 6 + Math.ceil((ni * nj) / 8)) throw new Error('GRIB2: bitmap too short');
  const R = dv.getFloat32(r + 11),
    E = s16(buf, r + 15),
    D = s16(buf, r + 17),
    nbits = buf[r + 19],
    missingMode = buf[r + 22],
    ng = u32(buf, r + 31),
    widthRef = buf[r + 35],
    widthBits = buf[r + 36],
    lenRef = u32(buf, r + 37),
    lenInc = buf[r + 41],
    lastLen = u32(buf, r + 42),
    lenBits = buf[r + 46],
    order = buf[r + 47],
    ndesc = buf[r + 48];
  if (order !== 1 && order !== 2) throw new Error(`GRIB2: spatial differencing of order ${order}`);

  // section 7: the extra descriptors (first values and the minimum of the differences), then the groups
  const bits = new Bits(buf, sec[7] + 5);
  const ival1 = signed(bits.read(ndesc * 8), ndesc * 8);
  const ival2 = order === 2 ? signed(bits.read(ndesc * 8), ndesc * 8) : 0;
  const minsd = signed(bits.read(ndesc * 8), ndesc * 8);
  const refs = new Float64Array(ng),
    widths = new Uint8Array(ng),
    lens = new Uint32Array(ng);
  for (let i = 0; i < ng; i++) refs[i] = nbits ? bits.read(nbits) : 0;
  bits.align();
  for (let i = 0; i < ng; i++) widths[i] = (widthBits ? bits.read(widthBits) : 0) + widthRef;
  bits.align();
  for (let i = 0; i < ng; i++) lens[i] = (lenBits ? bits.read(lenBits) : 0) * lenInc + lenRef;
  lens[ng - 1] = lastLen;
  bits.align();

  const raw = new Float64Array(n);
  const missing = new Uint8Array(n);
  let k = 0;
  for (let i = 0; i < ng; i++) {
    const w = widths[i],
      ref = refs[i];
    for (let j = 0; j < lens[i] && k < n; j++, k++) {
      if (w === 0) {
        if (missingMode && nbits && ref === 2 ** nbits - 1) missing[k] = 1;
        else raw[k] = ref;
      } else {
        const v = bits.read(w);
        if (missingMode >= 1 && v === 2 ** w - 1) missing[k] = 1;
        else if (missingMode === 2 && v === 2 ** w - 2) missing[k] = 1;
        else raw[k] = ref + v;
      }
    }
  }
  if (k !== n) throw new Error('GRIB2: groups do not add up to the grid');

  // undo the spatial differencing over the values that are present
  const present: number[] = [];
  for (let i = 0; i < n; i++) if (!missing[i]) present.push(i);
  if (present.length) {
    raw[present[0]] = ival1;
    if (order === 1) for (let m = 1; m < present.length; m++) raw[present[m]] += minsd + raw[present[m - 1]];
    else {
      if (present.length > 1) raw[present[1]] = ival2;
      for (let m = 2; m < present.length; m++) raw[present[m]] += minsd + 2 * raw[present[m - 1]] - raw[present[m - 2]];
    }
  }
  const scale = 2 ** E,
    dec = 10 ** -D;
  const packed = (i: number): number => (missing[i] ? NaN : (R + raw[i] * scale) * dec);
  const values = new Float32Array(ni * nj);
  if (bitmapFlag === 255) for (let i = 0; i < n; i++) values[i] = packed(i);
  else {
    // the packed values belong, in order, to the grid points whose bit is set; the rest have none
    let k2 = 0;
    for (let i = 0; i < ni * nj; i++) values[i] = (buf[bitmapAt + (i >> 3)] >> (7 - (i & 7))) & 1 && k2 < n ? packed(k2++) : NaN;
    if (k2 !== n) throw new Error('GRIB2: bitmap and values do not match');
  }
  return { ni, nj, lat0, lon0, di, dj, values };
}
