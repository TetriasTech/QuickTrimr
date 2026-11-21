// Deterministic vector source -> app assets. No network or model dependency.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { Resvg } from '@resvg/resvg-js';
const root = resolve(import.meta.dirname, '../..');
const brand = JSON.parse(
  readFileSync(resolve(root, 'packages/ui/src/theme/brand.json'), 'utf8'),
);
const dir = resolve(root, 'packages/ui/assets/brand');
mkdirSync(dir, { recursive: true });
const { palette: p, mark: m } = brand;
const shapes = `<path d="${m.ring}"/><path d="${m.tail}"/>`;
const svg = (background, foreground) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="${m.viewBox}"><rect width="100" height="100" fill="${background}"/><g fill="none" stroke="${foreground}" stroke-width="${m.strokeWidth}" stroke-linecap="round">${shapes}</g></svg>`;
for (const [name, bg, fg] of [
  ['mark-forest', p.forest, p.citrus],
  ['mark-citrus', p.citrus, p.forest],
]) {
  const source = svg(bg, fg);
  writeFileSync(resolve(dir, name + '.svg'), source + '\n');
  if (name === 'mark-forest')
    writeFileSync(
      resolve(dir, 'app-icon.png'),
      new Resvg(source).render().asPng(),
    );
}
const clear = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="${m.viewBox}"><g fill="none" stroke="${p.citrus}" stroke-width="${m.strokeWidth}" stroke-linecap="round">${shapes}</g></svg>`;
writeFileSync(resolve(dir, 'mark-transparent.svg'), clear + '\n');
writeFileSync(
  resolve(dir, 'adaptive-icon.png'),
  new Resvg(clear).render().asPng(),
);
console.log(
  'Exported editable vector marks and 1024px app icon from brand.json.',
);

// Outline the wordmark with the bundled font so exported SVGs need no installed fonts.
const fontFile = resolve(
  root,
  'apps/mobile/node_modules/@expo-google-fonts/manrope/700Bold/Manrope_700Bold.ttf',
);
for (const [name, background, foreground, text] of [
  ['wordmark', p.forest, p.citrus, p.forest],
  ['wordmark-inverse', p.citrus, p.forest, p.ivory],
]) {
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="1040" height="200" viewBox="0 0 520 100"><rect width="100" height="100" rx="20" fill="${background}"/><g fill="none" stroke="${foreground}" stroke-width="${m.strokeWidth}" stroke-linecap="round">${shapes}</g><text x="120" y="73" fill="${text}" font-family="Manrope" font-size="66" font-weight="700" letter-spacing="-2">${brand.name}</text></svg>`;
  const vector = new Resvg(source, {
    font: { loadSystemFonts: false, fontFiles: [fontFile] },
  });
  writeFileSync(
    resolve(dir, name + '.svg'),
    vector.toString().trimEnd() + '\n',
  );
  writeFileSync(resolve(dir, name + '.png'), vector.render().asPng());
}
