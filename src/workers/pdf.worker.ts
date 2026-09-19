/**
 * PDF → trozos por página. Corre en un Web Worker para que la UI no se congele con documentos
 * largos. pdf.js, a su vez, hace el parseo en su propio worker (anidado), servido como asset local.
 */
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { serve } from '@/lib/rpc';
import { chunkDocument } from '@/lib/chunk';
import type { PageText } from '@/lib/types';
import type { PdfProtocol } from './protocols';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/**
 * Recompone el texto de una página a partir de los items de pdf.js. `hasEOL` marca fin de línea;
 * el salto vertical entre líneas decide si además hay cambio de párrafo (hueco > 1,5 líneas).
 */
export function assemblePage(items: TextItem[]): string {
  let out = '';
  let lastY: number | null = null;
  let lastH = 0;
  let pendingEOL = false;
  for (const item of items) {
    const y = item.transform[5] as number;
    const h = item.height || lastH;
    if (lastY !== null) {
      const gap = Math.abs(lastY - y);
      if (pendingEOL) out += gap > lastH * 1.5 ? '\n\n' : '\n';
      else if (gap > lastH * 0.5 && out && !out.endsWith('\n')) out += '\n';
    }
    out += item.str;
    pendingEOL = item.hasEOL;
    lastY = y;
    if (h) lastH = h;
  }
  return out;
}

serve<PdfProtocol>({
  async parse({ buffer }, emit) {
    const task = getDocument({
      data: new Uint8Array(buffer),
      cMapUrl: '/pdfjs/cmaps/',
      cMapPacked: true,
      useSystemFonts: false,
    });
    const doc = await task.promise;
    try {
      const total = doc.numPages;
      const pages: PageText[] = [];
      let chars = 0;
      for (let n = 1; n <= total; n++) {
        const page = await doc.getPage(n);
        const content = await page.getTextContent();
        const text = assemblePage(content.items.filter((i): i is TextItem => 'str' in i));
        page.cleanup();
        chars += text.length;
        if (text.trim()) pages.push({ page: n, text });
        emit({ page: n, total });
      }
      return { pages: total, chunks: chunkDocument(pages), chars };
    } finally {
      await task.destroy();
    }
  },
});
