import { deflateSync, inflateSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';

const SOURCE = new URL('./assets/logo.png', import.meta.url);
// Recorte del monstruo: la fila 565 del logo separa el descendente de "project"
// de los puños del monstruo, así que el icono arranca justo debajo.
const CROP = { x: 227, y: 566, w: 632, h: 315 };
const CONTENT = 0.72;
const SIZES = [32, 180, 192, 512];

const TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function decode(path) {
  const file = readFileSync(path);
  const parts = [];
  let width = 0;
  let height = 0;
  let offset = 8;

  while (offset < file.length) {
    const len = file.readUInt32BE(offset);
    const type = file.toString('ascii', offset + 4, offset + 8);
    if (type === 'IHDR') {
      width = file.readUInt32BE(offset + 8);
      height = file.readUInt32BE(offset + 12);
      if (file[offset + 16] !== 8 || file[offset + 17] !== 2 || file[offset + 20] !== 0) {
        throw new Error('se espera un PNG RGB de 8 bits sin entrelazar');
      }
    }
    if (type === 'IDAT') parts.push(file.subarray(offset + 8, offset + 8 + len));
    offset += 12 + len;
  }

  const raw = inflateSync(Buffer.concat(parts));
  const stride = width * 3;
  const px = Buffer.alloc(height * stride);

  for (let y = 0, read = 0; y < height; y++) {
    const filter = raw[read++];
    const line = raw.subarray(read, read + stride);
    read += stride;
    const cur = px.subarray(y * stride, (y + 1) * stride);
    const up = y ? px.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= 3 ? cur[i - 3] : 0;
      const b = up[i];
      const c = i >= 3 ? up[i - 3] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 255;
    }
  }
  return { width, height, px };
}

// Media por área: cada píxel destino promedia el rectángulo de origen que le toca.
function resize(src, sw, sh, dw, dh) {
  const out = Buffer.alloc(dw * dh * 3);
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor((y * sh) / dh);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * sh) / dh));
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor((x * sw) / dw);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * sw) / dw));
      let r = 0, g = 0, b = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * sw + sx) * 3;
          r += src[i]; g += src[i + 1]; b += src[i + 2]; n++;
        }
      }
      const o = (y * dw + x) * 3;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
    }
  }
  return out;
}

function icon(source, size) {
  const scale = Math.min((size * CONTENT) / CROP.w, (size * CONTENT) / CROP.h);
  const dw = Math.max(1, Math.round(CROP.w * scale));
  const dh = Math.max(1, Math.round(CROP.h * scale));
  const art = resize(source, CROP.w, CROP.h, dw, dh);

  const canvas = Buffer.alloc(size * size * 3, 255);
  const ox = Math.round((size - dw) / 2);
  const oy = Math.round((size - dh) / 2);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const from = (y * dw + x) * 3;
      const to = ((y + oy) * size + x + ox) * 3;
      canvas[to] = art[from];
      canvas[to + 1] = art[from + 1];
      canvas[to + 2] = art[from + 2];
    }
  }

  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0, i = 0; y < size; y++) {
    raw[i++] = 0;
    canvas.copy(raw, i, y * size * 3, (y + 1) * size * 3);
    i += size * 3;
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const logo = decode(SOURCE);
const cropped = Buffer.alloc(CROP.w * CROP.h * 3);
for (let y = 0; y < CROP.h; y++) {
  for (let x = 0; x < CROP.w; x++) {
    const from = ((y + CROP.y) * logo.width + x + CROP.x) * 3;
    const to = (y * CROP.w + x) * 3;
    // La fuente trae una sombra tenue alrededor; la aplastamos a blanco puro.
    const flat = logo.px[from] > 238 && logo.px[from + 1] > 238 && logo.px[from + 2] > 238;
    cropped[to] = flat ? 255 : logo.px[from];
    cropped[to + 1] = flat ? 255 : logo.px[from + 1];
    cropped[to + 2] = flat ? 255 : logo.px[from + 2];
  }
}

for (const size of SIZES) {
  writeFileSync(new URL(`./icon-${size}.png`, import.meta.url), icon(cropped, size));
  console.log(`icon-${size}.png`);
}
