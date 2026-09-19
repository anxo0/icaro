// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import vercel from '@astrojs/vercel';
import tailwindcss from '@tailwindcss/vite';
import icon from 'astro-icon';
import Icons from 'unplugin-icons/vite';

// Cabeceras de aislamiento: hacen falta para el WASM multihilo (sin WebGPU). En producción las pone
// vercel.json; aquí se replican para que el servidor de desarrollo se comporte igual.
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

// https://astro.build/config
export default defineConfig({
  site: 'https://icaro.soyjulian.dev',
  output: 'static',
  adapter: vercel(),
  // Iconos Solar: astro-icon en los .astro (<Icon name="solar:…">) y unplugin-icons en React (~icons/solar/…).
  // Ambos leen @iconify-json/solar y compilan a SVG inline: ninguna petición en runtime.
  integrations: [react(), icon({ include: { solar: ['*'] } })],
  i18n: {
    defaultLocale: 'es',
    locales: ['es', 'en'],
    routing: { prefixDefaultLocale: false },
  },
  vite: {
    plugins: [tailwindcss(), Icons({ compiler: 'jsx', jsx: 'react' })],
    server: { headers: isolationHeaders },
    preview: { headers: isolationHeaders },
    // Sin esto Vite intenta pre-empaquetar los WASM de transformers.js y falla.
    optimizeDeps: { exclude: ['@huggingface/transformers', 'pdfjs-dist'] },
    worker: { format: 'es' },
    build: {
      // Los modelos ya pesan cientos de MB; el aviso por chunks de JS grandes solo mete ruido.
      chunkSizeWarningLimit: 2000,
    },
  },
});
