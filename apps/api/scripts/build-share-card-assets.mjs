/**
 * Regera `assets/share-card/muscles.json` e as ilustrações (tema dark) a partir de
 * `js-rich-body-highlighter` (devDependency de apps/web, versão fixada).
 *
 * O card é renderizado no servidor (resvg), então a API não depende do pacote em runtime:
 * só dos paths das máscaras e das ilustrações. O resvg não decodifica WebP, por isso as
 * ilustrações são convertidas para PNG (720×1080 = 2× a largura de 360 px usada no card).
 * Rodar quando a versão da biblioteca mudar:
 *   node apps/api/scripts/build-share-card-assets.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import process from 'node:process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'assets', 'share-card');
const webRequire = createRequire(join(here, '..', '..', 'web', 'package.json'));
const pkgJson = webRequire.resolve('js-rich-body-highlighter/package.json');
const root = dirname(pkgJson);
const { MUSCLES } = await import(pathToFileURL(join(root, 'dist', 'index.js')).href);

const PX2MM = 25.4 / 96;
const muscles = {};
for (const m of MUSCLES) {
  const key = `${m.gender}-${m.view}`;
  const transform =
    m.offset && (m.offset.x || m.offset.y)
      ? `translate(${m.offset.x * PX2MM} ${m.offset.y * PX2MM})`
      : undefined;
  (muscles[key] ??= []).push({ group: m.group, d: m.d, ...(transform ? { transform } : {}) });
}
mkdirSync(join(out, 'bodies'), { recursive: true });
writeFileSync(join(out, 'muscles.json'), `${JSON.stringify(muscles)}\n`);
// `sharp` chega pelo Next (dependência dele, não nossa): resolve a partir do pacote `next`.
const sharp = createRequire(webRequire.resolve('next/package.json'))('sharp');
for (const gender of ['male', 'female']) {
  for (const view of ['front', 'back']) {
    const name = `${gender}-${view}-dark`;
    await sharp(join(root, 'dist', 'bodies', `${name}.webp`))
      .resize({ width: 720 })
      .png({ compressionLevel: 9, effort: 10 })
      .toFile(join(out, 'bodies', `${name}.png`));
  }
}
process.stdout.write(`share-card assets regenerados em ${out}\n`);
