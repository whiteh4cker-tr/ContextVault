/**
 * Draw the application icon: `build/icon.png`, 512 × 512.
 *
 * The generator is kept beside the output so the icon can be redrawn and
 * regenerated rather than hand-poked in a graphics program. electron-builder turns a
 * square PNG of this size into whatever container a platform wants, so one file is
 * enough for Windows, macOS and Linux.
 *
 * A vault door: a ring, a handle across it, a hub that only turns if you hold the
 * key. It has to survive being 16 pixels wide next to a taskbar clock, which rules
 * out thin strokes and anything resembling a page full of lines.
 *
 *   node scripts/make-icon.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';

const SIZE = 512;
const OUT_DIR = path.resolve(import.meta.dirname, '..', 'build');
const OUT_FILE = path.join(OUT_DIR, 'icon.png');

/**
 * Everything is drawn in units of 64 across, so the proportions are stated once and
 * hold at whatever size the file is asked for.
 */
function paint(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const unit = size / 64;

  // Rounded slate tile, dark enough that the teal carries the shape.
  ctx.beginPath();
  ctx.roundRect(0, 0, size, size, 14 * unit);
  const background = ctx.createLinearGradient(0, 0, 0, size);
  background.addColorStop(0, '#1B2A31');
  background.addColorStop(1, '#0E1418');
  ctx.fillStyle = background;
  ctx.fill();

  // A hairline of accent colour keeps the tile separate from a dark taskbar.
  ctx.lineWidth = 1.5 * unit;
  ctx.strokeStyle = 'rgba(45, 212, 191, 0.35)';
  ctx.stroke();

  const cx = size / 2;
  const cy = size / 2;

  // Vault door ring.
  ctx.beginPath();
  ctx.arc(cx, cy, 20 * unit, 0, Math.PI * 2);
  ctx.lineWidth = 4 * unit;
  ctx.strokeStyle = '#2DD4BF';
  ctx.stroke();

  // Four spokes, at the diagonals, so at 16 pixels it reads as a wheel and not as
  // a plain circle.
  ctx.lineWidth = 3.5 * unit;
  ctx.strokeStyle = '#0F766E';
  for (const angle of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]) {
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * 12 * unit, cy + Math.sin(angle) * 12 * unit);
    ctx.lineTo(cx + Math.cos(angle) * 27 * unit, cy + Math.sin(angle) * 27 * unit);
    ctx.stroke();
  }

  // Hub, with a hole: the wheel is empty until a key is in it.
  ctx.beginPath();
  ctx.arc(cx, cy, 7.5 * unit, 0, Math.PI * 2);
  ctx.fillStyle = '#E8EEF2';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, 3 * unit, 0, Math.PI * 2);
  ctx.fillStyle = '#0E1418';
  ctx.fill();

  return canvas;
}

await fs.mkdir(OUT_DIR, { recursive: true });
await fs.writeFile(OUT_FILE, paint(SIZE).toBuffer('image/png'));

const stat = await fs.stat(OUT_FILE);
console.log(`wrote ${path.relative(path.resolve(import.meta.dirname, '..'), OUT_FILE)} ${SIZE}x${SIZE} (${stat.size} bytes)`);
