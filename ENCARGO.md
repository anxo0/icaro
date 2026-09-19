# Encargo: «Ícaro» — tu asistente de PDF, IA privada en el navegador

Proyecto open source de soyjulian.dev. Subes un PDF, le preguntas en lenguaje natural y
responde citando las páginas. **Todo corre en el navegador**: ni el PDF ni las preguntas
salen del equipo. Vercel solo sirve ficheros estáticos; no hay funciones, claves ni coste.

## 0. Nombre y dominio

Nombre: **Ícaro**. Tagline: **«Ícaro, tu asistente de PDF»**. Es un nombre de persona, así
que la app habla como un asistente («Ícaro no lo encuentra en el documento»), y el mito
regala el claim: Ícaro voló demasiado cerca del sol; este **no sube a la nube**.

- Dominio: `icaro.soyjulian.dev` (sin tilde). En la web y el README, siempre «Ícaro».
- Repo: `anxo0/icaro`, licencia MIT
- Título de la página: «Ícaro, tu asistente de PDF»
- Claim del hero: «Vuela bajo: tu PDF nunca sube a la nube.»
- Logo: un ala (o una pluma con una gota de cera), trazo simple, sin robots.
- El mito es un guiño, no un tema: un ala en el logo y una frase en el hero; el resto de
  la interfaz, sobria como el generador de QR.
- En la interfaz, los mensajes en primera persona del asistente («Ícaro está leyendo el
  documento…», «Ícaro no lo encuentra en el documento»). El prompt del modelo (§6) no
  cambia: ahí sigue «No aparece en el documento» y la UI lo traduce.

Mismo molde visual que `qr_generator` (tema oscuro por defecto con `data-theme`, ES/EN,
sin analítica, sin servidor), pero la web es **Astro**, con la parte interactiva en islas
de React.

## 1. Reglas

- **Cero peticiones propias.** Las únicas descargas externas son los pesos del modelo,
  que el navegador baja del CDN de Hugging Face y cachea. Ninguna a un servidor tuyo.
- **El PDF nunca se sube.** Se lee con `pdf.js` en el navegador. Decirlo en la interfaz,
  arriba y claro: es el argumento de venta.
- Todo el trabajo pesado (PDF, embeddings, generación) va en **Web Workers**. La UI no
  se congela nunca.
- Funciona sin WebGPU (WASM), pero avisa de que irá lento.
- Móvil: que abra y funcione con PDFs cortos; no es el objetivo.

## 2. Stack y dependencias

```bash
pnpm create astro@latest icaro -- --template minimal --typescript strict
cd icaro
pnpm astro add react tailwind vercel
pnpm add @huggingface/transformers pdfjs-dist
pnpm add -D vitest
```

- **Astro** (`output: 'static'`, adaptador `@astrojs/vercel` solo por los headers y el
  despliegue). Las páginas, el layout, el header, el footer y los textos son `.astro`:
  HTML sin JS. Solo la app en sí es React.
- **Una isla**: `<IcaroApp client:only="react" />`. `client:only`, no `client:load`,
  porque usa `navigator.gpu`, Workers e IndexedDB y no se puede renderizar en servidor.
- **i18n de Astro** (`i18n: { defaultLocale: 'es', locales: ['es', 'en'] }`): `/` en
  español y `/en/` en inglés. Los textos de la isla van en un JSON por idioma que se
  le pasa como prop; nada de detectar idioma en cliente.
- `@huggingface/transformers` (v3): pipelines `feature-extraction` y `text-generation`
  con backend WebGPU o WASM.
- `pdfjs-dist`: extracción de texto por página (`getTextContent`). El worker de pdf.js va
  como asset local (`pdfjs-dist/build/pdf.worker.min.mjs`), no desde un CDN.
- Sin librería de vectores: la búsqueda es coseno sobre un `Float32Array` en memoria.
  Para un PDF de 300 páginas son ~1.500 vectores de 384 dimensiones; es instantáneo.
- Tailwind 4 con tokens semánticos en `@theme` como en el portfolio (`--bg`, `--fg`,
  `--accent`…), fuentes autoalojadas con `@fontsource`.

## 3. Modelos

Los PDFs serán en español, así que **embeddings multilingües**, no `all-MiniLM`.

| Tarea | Modelo | Peso aprox. | Notas |
| --- | --- | --- | --- |
| Embeddings | `Xenova/multilingual-e5-small` | ~120 MB (q8) | 384 dims. Prefijar `query: ` a las preguntas y `passage: ` a los trozos, lo pide el modelo. |
| Generación | `onnx-community/Qwen2.5-0.5B-Instruct` | ~400 MB (q4) | Responde bien en español para su tamaño. Chat template incluido en el tokenizer. |
| Generación (opción ligera) | `HuggingFaceTB/SmolLM2-360M-Instruct` | ~250 MB | Peor en español. Ofrecerlo como «rápido». |

Cargar con `dtype: 'q4'` (generación) y `'q8'` (embeddings), `device: 'webgpu'` si
`navigator.gpu` existe, si no `'wasm'`. Enseñar el progreso de descarga con el callback
`progress_callback` (viene por fichero: agregar a una sola barra).

## 4. Arquitectura

```
src/
├── pages/
│   ├── index.astro              ES: layout + textos + <IcaroApp client:only="react" />
│   └── en/index.astro           EN: lo mismo con el JSON en inglés
├── layouts/Base.astro           <head>, tema, fuentes, meta OG
├── components/
│   ├── Header.astro / Footer.astro / ThemeToggle.astro
│   └── app/                     la isla de React
│       ├── IcaroApp.tsx         estado global: pdf, modelos, mensajes
│       ├── Dropzone.tsx         arrastrar PDF, o botón; muestra páginas y tamaño
│       ├── ModelStatus.tsx      estado de los dos modelos y barra de descarga
│       ├── Chat.tsx             mensajes, streaming, citas [p. 12]
│       └── Sources.tsx          trozos usados en la última respuesta, con página
├── workers/
│   ├── pdf.worker.ts            PDF → [{ page, text }]
│   ├── embed.worker.ts          carga e5, embebe trozos y preguntas
│   └── llm.worker.ts            carga Qwen, genera en streaming
├── lib/
│   ├── chunk.ts                 trocear texto por página (ver §5)
│   ├── search.ts                coseno top-k
│   ├── prompt.ts                plantilla del prompt (ver §6)
│   ├── cache.ts                 IndexedDB: hash del PDF → trozos + vectores
│   └── rpc.ts                   mensajería tipada con los workers (id, tipo, payload)
├── i18n/{es,en}.json            textos de la isla
└── styles/global.css
```

Flujo:

1. Usuario suelta un PDF → `pdf.worker` devuelve el texto por página.
2. `chunk.ts` trocea; `embed.worker` calcula un vector por trozo. Se guarda en IndexedDB
   con clave `sha256(fichero)` para que la segunda vez sea instantáneo.
3. Pregunta → `embed.worker` la embebe → `search.ts` saca los 5 trozos más parecidos.
4. `prompt.ts` monta el prompt con esos trozos → `llm.worker` genera en streaming
   (`TextStreamer`), la UI pinta token a token.
5. Al terminar, `Sources.tsx` enseña los trozos usados con su página.

Los dos modelos se cargan al soltar el PDF (no al abrir la página): quien solo curiosea
no descarga 500 MB.

## 5. Troceado

- Unidad: párrafo (separar por `\n\n` y por líneas que terminan en punto).
- Tamaño objetivo: **~350 tokens** (~1.200 caracteres), solapamiento de ~60 tokens
  entre trozos consecutivos para no cortar frases clave.
- Cada trozo guarda `{ id, page, text, vector }`. Nunca mezclar páginas en un trozo:
  la cita `[p. N]` tiene que ser exacta.
- Limpiar guiones de final de línea (`infor-\nmación` → `información`) y espacios
  dobles, típicos de pdf.js.

## 6. Prompt

Usar el chat template del tokenizer (`tokenizer.apply_chat_template`). Mensajes:

```
system:
Eres un asistente que responde SOLO con la información de los fragmentos.
Si la respuesta no está en ellos, di «No aparece en el documento».
Responde en el idioma de la pregunta, breve, y cita las páginas así: [p. 12].

user:
Fragmentos:
[p. 3] …texto…
[p. 7] …texto…

Pregunta: {pregunta}
```

Parámetros: `max_new_tokens: 300`, `temperature: 0.2`, `do_sample: false` por defecto
(respuestas deterministas). Cortar el contexto a ~1.500 tokens de fragmentos: un 0.5B
se pierde con más.

## 7. Interfaz

- Pantalla vacía: título «Ícaro, tu asistente de PDF», el claim, dropzone grande, estado de WebGPU (✓ o «sin WebGPU: irá
  más lento») y los dos modelos con su peso.
- Con PDF: cabecera con nombre, páginas y trozos; chat a la derecha (o abajo en móvil);
  panel de fuentes plegable.
- Streaming con cursor; botón «Parar». Citas `[p. N]` clicables → muestran el trozo.
- Preguntas sugeridas al cargar: «¿De qué trata?», «Resume en 5 puntos», «¿Qué fechas
  aparecen?».
- «Borrar todo»: limpia IndexedDB y memoria.
- Atajos: `Ctrl/⌘ + K` para enfocar la pregunta, `Esc` para parar.
- Todo lo que no sea la app (hero, «cómo funciona», FAQ, footer) es Astro estático:
  indexable, sin JS, se ve aunque el navegador no tenga WebGPU.

## 8. Rendimiento y trampas

- **Cabeceras** para WASM multihilo (solo hacen falta sin WebGPU, pero ponlas). Con el
  adaptador de Vercel van en `vercel.json`:
  ```json
  { "headers": [{ "source": "/(.*)", "headers": [
    { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" },
    { "key": "Cross-Origin-Embedder-Policy", "value": "require-corp" } ] }] }
  ```
  Ojo: con COEP, cualquier recurso externo necesita CORS. Los de Hugging Face lo tienen.
- Workers en Vite/Astro: `new Worker(new URL('../../workers/llm.worker.ts', import.meta.url), { type: 'module' })`.
  Crearlos dentro de un `useEffect`, nunca en el cuerpo del módulo (la isla se importa
  también en build).
- En `astro.config.mjs`, `vite.optimizeDeps.exclude: ['@huggingface/transformers']` y
  `vite.worker.format: 'es'`; sin lo primero Vite intenta pre-empaquetar los WASM y falla.
- Un solo `pipeline` por worker, cargado una vez (patrón singleton con promesa).
- Embeddings por lotes de 16–32 trozos; normalizar (`normalize: true, pooling: 'mean'`).
- Detectar memoria: si `navigator.deviceMemory < 4`, sugerir el modelo ligero.
- Tests (Vitest): `chunk.ts` (tamaños, solapamiento, sin mezclar páginas), `search.ts`
  (top-k correcto), `prompt.ts` (formato), limpieza de texto.

## 9. README (lo que hace que se comparta)

- GIF de 10 s: soltar PDF → pregunta → respuesta con cita.
- Primer párrafo: qué es, que no hay servidor, que se despliega en Vercel gratis.
- Tabla de modelos con pesos y requisitos (WebGPU, RAM).
- «Cómo funciona» con el flujo de §4 en cinco líneas.
- Limitaciones honestas: modelo pequeño, PDFs escaneados sin OCR no funcionan (idea
  para v2: `tesseract.js`), primera carga lenta.
- ES + EN.

## 10. Lista de comprobación antes de publicar

- [ ] Pestaña Red: solo `huggingface.co` / `cdn-lfs…` durante la descarga; nada después.
- [ ] PDF de 200+ páginas: la UI no se bloquea, trozos y vectores en IndexedDB, segunda
      carga instantánea.
- [ ] Pregunta cuya respuesta no está → «No aparece en el documento».
- [ ] Citas correctas: abrir `[p. N]` y comprobar que el texto está en esa página.
- [ ] Chrome con WebGPU y Firefox sin él (WASM): ambos funcionan.
- [ ] `/` y `/en/` completos; la parte estática se ve con JS desactivado.
- [ ] `pnpm build` sin avisos, `pnpm test` en verde.
- [ ] Lighthouse: sin recursos bloqueantes, fuentes autoalojadas.
- [ ] Añadir a `soyjulian/src/data/projects.ts` (Herramientas, live + repo).

## 11. Después (v2, si engancha)

- Varios PDFs a la vez, con filtro por documento.
- OCR con `tesseract.js` para escaneados.
- Modelo mayor opcional (`Qwen2.5-1.5B`, ~1 GB) para quien tenga máquina.
- Exportar la conversación a Markdown.
