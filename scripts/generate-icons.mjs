import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.resolve(__dirname, '../assets');
const MASTER_LOGO = path.join(ASSETS_DIR, 'logo.png');
const OUT_DIR = path.join(ASSETS_DIR, 'icons');

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.allocUnsafe(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.allocUnsafe(4);
  const combined = Buffer.concat([typeBuf, data]);
  crcBuf.writeUInt32BE(crc32(combined), 0);
  return Buffer.concat([len, combined, crcBuf]);
}

function encodePNG(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4 + 1;
  const raw = Buffer.allocUnsafe(stride * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // filter None
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodePNG(buffer) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) {
    if (buffer[i] !== sig[i]) {
      throw new Error('Invalid PNG signature');
    }
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks = [];

  while (offset < buffer.length) {
    const len = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + len);
    offset += 12 + len;

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`Unsupported PNG format: bitDepth=${bitDepth}, colorType=${colorType}`);
  }

  const bpp = colorType === 6 ? 4 : 3;
  const rowBytes = width * bpp;
  const inflated = zlib.inflateSync(Buffer.concat(idatChunks));
  const rgba = Buffer.alloc(width * height * 4);
  let prevRow = new Uint8Array(rowBytes);

  for (let y = 0; y < height; y++) {
    const filter = inflated[y * (rowBytes + 1)];
    const srcRow = inflated.subarray(y * (rowBytes + 1) + 1, (y + 1) * (rowBytes + 1));
    const recon = new Uint8Array(rowBytes);

    for (let x = 0; x < rowBytes; x++) {
      const a = x >= bpp ? recon[x - bpp] : 0;
      const b = prevRow[x];
      const c = x >= bpp ? prevRow[x - bpp] : 0;
      let val = srcRow[x];
      if (filter === 1) val = (val + a) & 0xff;
      else if (filter === 2) val = (val + b) & 0xff;
      else if (filter === 3) val = (val + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) val = (val + paethPredictor(a, b, c)) & 0xff;
      recon[x] = val;
    }

    for (let x = 0; x < width; x++) {
      const out = (y * width + x) * 4;
      const src = x * bpp;
      rgba[out] = recon[src];
      rgba[out + 1] = recon[src + 1];
      rgba[out + 2] = recon[src + 2];
      rgba[out + 3] = bpp === 4 ? recon[src + 3] : 255;
    }

    prevRow = recon;
  }

  return { width, height, rgba };
}

function sinc(x) {
  if (x === 0) return 1;
  const px = Math.PI * x;
  return Math.sin(px) / px;
}

function lanczos2(x) {
  const ax = Math.abs(x);
  if (ax >= 2) return 0;
  return sinc(ax) * sinc(ax * 0.5);
}

/**
 * Downsample source RGBA buffer with premultiplied-alpha Lanczos-2 filtering.
 */
function resizeFromMaster(master, targetSize, disabled = false) {
  const { width: srcW, height: srcH, rgba } = master;
  const out = Buffer.alloc(targetSize * targetSize * 4);
  const scale = srcW / targetSize;
  const radius = Math.max(2, scale * 1.15);

  for (let dy = 0; dy < targetSize; dy++) {
    const srcCy = (dy + 0.5) * scale - 0.5;
    const yStart = Math.max(0, Math.floor(srcCy - radius));
    const yEnd = Math.min(srcH - 1, Math.ceil(srcCy + radius));

    for (let dx = 0; dx < targetSize; dx++) {
      const srcCx = (dx + 0.5) * scale - 0.5;
      const xStart = Math.max(0, Math.floor(srcCx - radius));
      const xEnd = Math.min(srcW - 1, Math.ceil(srcCx + radius));

      let sumW = 0;
      let accR = 0;
      let accG = 0;
      let accB = 0;
      let accA = 0;

      for (let sy = yStart; sy <= yEnd; sy++) {
        const wy = lanczos2(((sy - srcCy) / Math.max(1, scale * 0.55)));
        if (wy === 0) continue;
        for (let sx = xStart; sx <= xEnd; sx++) {
          const wx = lanczos2(((sx - srcCx) / Math.max(1, scale * 0.55)));
          const w = wx * wy;
          if (w === 0) continue;

          const p = (sy * srcW + sx) * 4;
          const a = rgba[p + 3] / 255;
          accR += rgba[p] * a * w;
          accG += rgba[p + 1] * a * w;
          accB += rgba[p + 2] * a * w;
          accA += rgba[p + 3] * w;
          sumW += w;
        }
      }

      if (sumW <= 0) continue;
      let alpha = Math.max(0, Math.min(255, accA / sumW));
      if (alpha < 1) continue;

      const invAlpha = 255 / accA;
      let r = Math.max(0, Math.min(255, accR * invAlpha));
      let g = Math.max(0, Math.min(255, accG * invAlpha));
      let b = Math.max(0, Math.min(255, accB * invAlpha));

      if (disabled) {
        const luma = 0.299 * r + 0.587 * g + 0.114 * b;
        r = luma * 0.85 + 24;
        g = luma * 0.85 + 26;
        b = luma * 0.85 + 32;
        alpha = alpha * 0.56;
      }

      const outIdx = (dy * targetSize + dx) * 4;
      out[outIdx] = Math.min(255, Math.round(r));
      out[outIdx + 1] = Math.min(255, Math.round(g));
      out[outIdx + 2] = Math.min(255, Math.round(b));
      out[outIdx + 3] = Math.min(255, Math.round(alpha));
    }
  }

  return encodePNG(targetSize, targetSize, out);
}

export function generateAllIcons() {
  if (!fs.existsSync(MASTER_LOGO)) {
    throw new Error(`Missing master logo PNG at ${MASTER_LOGO}`);
  }
  const master = decodePNG(fs.readFileSync(MASTER_LOGO));
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const specs = [
    { size: 16, disabled: false, name: 'icon16.png' },
    { size: 19, disabled: false, name: 'icon19.png' },
    { size: 19, disabled: true, name: 'icon19_disabled.png' },
    { size: 32, disabled: false, name: 'icon32.png' },
    { size: 38, disabled: false, name: 'icon38.png' },
    { size: 38, disabled: true, name: 'icon38_disabled.png' },
    { size: 48, disabled: false, name: 'icon48.png' },
    { size: 48, disabled: true, name: 'icon48_disabled.png' },
    { size: 128, disabled: false, name: 'icon128.png' },
  ];

  for (const spec of specs) {
    const filePath = path.join(OUT_DIR, spec.name);
    fs.writeFileSync(filePath, resizeFromMaster(master, spec.size, spec.disabled));
  }
  return specs.map((s) => s.name);
}

if (
  import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` ||
  process.argv[1]?.endsWith('generate-icons.mjs')
) {
  const generated = generateAllIcons();
  console.log(`Generated ${generated.length} crisp icons from ${MASTER_LOGO} -> ${OUT_DIR}`);
}
