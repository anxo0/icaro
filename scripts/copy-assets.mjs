// Copia a public/ los binarios que el navegador necesita en runtime y que no queremos ni en el repo
// ni descargados de un CDN ajeno:
//   - el runtime WASM de ONNX (transformers.js lo bajaría de jsdelivr por defecto)
//   - los CMaps de pdf.js (necesarios para extraer texto de algunos PDF con fuentes CID)
// Se ejecuta antes de `dev` y `build` (ver package.json). Las carpetas destino están en .gitignore.
import { cpSync, existsSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

/** Raíz de un paquete a partir de su entrada resuelta (ninguno de estos exporta package.json). */
const packageRoot = (specifier, from) => {
  let dir = dirname(require.resolve(specifier, from ? { paths: [from] } : undefined));
  while (!existsSync(join(dir, 'package.json')) && dir !== dirname(dir)) dir = dirname(dir);
  return dir;
};

// onnxruntime-web es dependencia de transformers.js; se resuelve desde ahí para dar con la misma versión.
const transformersDir = packageRoot('@huggingface/transformers');
const ortDist = join(packageRoot('onnxruntime-web', transformersDir), 'dist');
const ortOut = join(root, 'public', 'ort');
mkdirSync(ortOut, { recursive: true });
let ortCount = 0;
for (const file of readdirSync(ortDist)) {
  // Solo la variante que usa transformers.js (asyncify) y la básica, por si el navegador no soporta la primera.
  if (/^ort-wasm-simd-threaded(\.asyncify)?\.(mjs|wasm)$/.test(file)) {
    copyFileSync(join(ortDist, file), join(ortOut, file));
    ortCount++;
  }
}

const pdfjsDir = packageRoot('pdfjs-dist');
const cmapsOut = join(root, 'public', 'pdfjs', 'cmaps');
if (!existsSync(cmapsOut)) {
  cpSync(join(pdfjsDir, 'cmaps'), cmapsOut, { recursive: true });
}

console.log(`[copy-assets] ${ortCount} ficheros de ONNX Runtime → public/ort, CMaps de pdf.js → public/pdfjs/cmaps`);
