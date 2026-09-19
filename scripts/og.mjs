// Genera public/og.png (1200×630) a partir de un SVG con el ala y el claim. Se ejecuta a mano: `node scripts/og.mjs`.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const sharp = require(require.resolve('sharp', { paths: [require.resolve('astro/package.json').replace(/package\.json$/, '')] }));

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#1c1c20"/>
  <g transform="translate(96 150) scale(4)" fill="none" stroke="#6b8cff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 27C7 13 17 5 29 5"/><path d="M29 5c-4 5-9 9-16 12"/><path d="M24 11c-4 5-9 8-15 10"/><path d="M18 17c-4 4-8 7-15 10"/>
  </g>
  <text x="96" y="345" font-family="Inter, Segoe UI, Helvetica, Arial, sans-serif" font-size="72" font-weight="600" fill="#ececee">Ícaro, tu asistente de PDF</text>
  <text x="96" y="410" font-family="Inter, Segoe UI, Helvetica, Arial, sans-serif" font-size="36" fill="#9db1ff">Vuela bajo: tu PDF nunca sube a la nube.</text>
  <text x="96" y="500" font-family="Inter, Segoe UI, Helvetica, Arial, sans-serif" font-size="26" fill="#a8a8b0">IA privada en el navegador · sin servidor · sin cuenta · código abierto</text>
  <text x="96" y="570" font-family="Inter, Segoe UI, Helvetica, Arial, sans-serif" font-size="24" fill="#75757e">icaro.soyjulian.dev</text>
</svg>`;

const png = await sharp(Buffer.from(svg)).png().toBuffer();
writeFileSync(new URL('../public/og.png', import.meta.url), png);
console.log(`[og] public/og.png (${(png.length / 1024).toFixed(0)} KB)`);
