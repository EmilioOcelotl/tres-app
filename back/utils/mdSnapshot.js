// utils/mdSnapshot.js
// Genera .tres-snapshot.md al arrancar la app: volcado completo del árbol de notas
// en Markdown plano para revisión local de ideas.

import { writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import turndown from 'turndown';
import { NoteService } from '../services/noteService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const SNAPSHOT_PATH = path.join(__dirname, '..', '..', '.tres-snapshot.md');

const td = new turndown({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced'
});

// Ignorar figuras de Trilium — no aportan al repaso de ideas
td.addRule('triliumFigure', {
  filter: (node) =>
    node.nodeName === 'FIGURE' && node.className?.includes('image'),
  replacement: () => ''
});

function nodoAMarkdown(nodo, nivel) {
  if (!nodo) return '';
  const partes = [];

  const hashes = '#'.repeat(Math.min(nivel + 1, 6));
  if (nodo.title) partes.push(`${hashes} ${nodo.title}`);

  if (nodo.content) {
    const html = Buffer.isBuffer(nodo.content)
      ? nodo.content.toString('utf8')
      : nodo.content;
    const md = td.turndown(html).trim();
    if (md) partes.push(md);
  }

  for (const hijo of nodo.children || []) {
    partes.push(nodoAMarkdown(hijo, nivel + 1));
  }

  return partes.filter(Boolean).join('\n\n');
}

export async function generarSnapshot() {
  try {
    const noteService = new NoteService();
    const tree  = await noteService.getCompleteTree();
    const cuerpo = nodoAMarkdown(tree, 0);
    const timestamp = new Date().toISOString();
    const contenido = `<!-- snapshot generado: ${timestamp} -->\n\n${cuerpo}\n`;
    await writeFile(SNAPSHOT_PATH, contenido, 'utf8');
    console.log(`Snapshot MD → ${SNAPSHOT_PATH}`);
  } catch (err) {
    console.error('Error generando snapshot MD:', err.message);
  }
}
