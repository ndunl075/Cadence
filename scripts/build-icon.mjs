import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, 'assets', 'cadence-icon-source.png');
const png = path.join(root, 'assets', 'cadence-icon.png');
const ico = path.join(root, 'assets', 'cadence.ico');

const { data, info } = await sharp(source)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

// The generated source uses a green-screen background. Alpha is derived from
// green dominance, leaving the orange/blue mascot and off-white rim intact.
for (let offset = 0; offset < data.length; offset += 4) {
  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  const dominance = green - Math.max(red, blue);
  const alpha = dominance >= 55 ? 0 : dominance <= 15 ? 255 : Math.round(((55 - dominance) / 40) * 255);
  data[offset + 3] = Math.min(data[offset + 3], alpha);
  if (dominance > 4) {
    // Remove green reflected into antialiased edge pixels.
    data[offset + 1] = Math.min(green, Math.max(red, blue));
  }
}

const cutout = await sharp(data, { raw: info })
  .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 4 })
  .resize(220, 220, { fit: 'contain', kernel: 'lanczos3' })
  .extend({
    top: 18,
    bottom: 18,
    left: 18,
    right: 18,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .png()
  .toBuffer();

await fs.writeFile(png, cutout);
await fs.writeFile(ico, await pngToIco(png));

const metadata = await sharp(png).metadata();
if (metadata.width !== 256 || metadata.height !== 256 || metadata.channels !== 4) {
  throw new Error('Generated icon failed PNG validation.');
}

console.log(`Created ${path.relative(root, png)} and ${path.relative(root, ico)}`);
