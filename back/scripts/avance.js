// scripts/avance.js — avance de escritura de la tesis, nota por nota.
// Uso: node back/scripts/avance.js (o npm run avance). No requiere el servidor.
// Lee la BD de Trilium en solo lectura vía NoteService, igual que el PDF y el grafo 3D.

import { NoteService } from '../services/noteService.js';

// Umbrales heurísticos — no hay definición objetiva de "completa" para una nota
// de tesis; 150 aprovecha el hueco real de la distribución (nada entre 138 y 187).
const PARTIAL_MIN_WORDS = 1;
const COMPLETE_MIN_WORDS = 150;
// Parte II es glosario y ensayo breve, como las «Notas» de tresEnero: se mide
// con otro umbral (decisión del autor, 2026-10-08). Las líneas `//` ya vienen
// filtradas por NoteService, así que la planeación comentada no cuenta.
const COMPLETE_MIN_WORDS_BY_PART = { 'Parte II': 50 };
const EXCLUDED_TITLES = ['Eliminar'];      // material tresEnero, ver CLAUDE.md > Pendientes técnicos
const SEPARATE_SUBTREES = ['Referencias']; // se reportan aparte, no puntúan

const WEIGHTS = { vacía: 0, parcial: 0.5, completa: 1 };
const ICONS = { vacía: '○', parcial: '◐', completa: '●' };

function wordCount(content) {
  const str = content
    ? (Buffer.isBuffer(content) ? content.toString('utf8') : content)
    : '';
  return str
    .replace(/<[^>]*>/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 0).length;
}

function completeThreshold(partTitle) {
  const key = Object.keys(COMPLETE_MIN_WORDS_BY_PART)
    .find(prefix => partTitle.startsWith(prefix + ' '));
  return key ? COMPLETE_MIN_WORDS_BY_PART[key] : COMPLETE_MIN_WORDS;
}

function classify(words, childCount, minWords) {
  if (words >= minWords) return 'completa';
  if (words >= PARTIAL_MIN_WORDS) return 'parcial';
  return childCount > 0 ? 'contenedor' : 'vacía';
}

// Recorre un subárbol y acumula filas para imprimir y notas puntuables.
function walk(node, depth, acc) {
  if (EXCLUDED_TITLES.includes(node.title)) return;

  if (SEPARATE_SUBTREES.includes(node.title)) {
    const entries = countDescendants(node);
    acc.rows.push({ depth, separate: node.title, entries });
    return;
  }

  const words = wordCount(node.content);
  const state = classify(words, node.children?.length || 0, acc.minWords);
  acc.rows.push({ depth, title: node.title, words, state });
  if (state !== 'contenedor') {
    acc.scored.push(state);
    acc.words += words;
  }

  (node.children || []).forEach(child => walk(child, depth + 1, acc));
}

function countDescendants(node) {
  return (node.children || []).reduce(
    (sum, child) => sum + 1 + countDescendants(child),
    0
  );
}

function percent(scored) {
  if (scored.length === 0) return 0;
  const sum = scored.reduce((s, state) => s + WEIGHTS[state], 0);
  return Math.round((sum / scored.length) * 100);
}

function printPart(acc) {
  for (const row of acc.rows.slice(1)) {
    const indent = '  '.repeat(row.depth);
    if (row.separate) {
      console.log(`${indent}${row.separate}: ${row.entries} entradas (no cuentan para el avance)`);
    } else if (row.state === 'contenedor') {
      console.log(`${indent}${row.title}`);
    } else {
      console.log(`${indent}${ICONS[row.state]} ${row.title}  ${row.words}w`);
    }
  }
}

async function main() {
  // NoteService loggea su progreso por consola; lo silenciamos para que el
  // reporte quede limpio.
  const log = console.log;
  console.log = () => {};
  let root;
  try {
    root = await new NoteService().getCompleteTree();
  } finally {
    console.log = log;
  }

  const partes = (root.children || []).filter(
    child => child.title.startsWith('Parte') && !EXCLUDED_TITLES.includes(child.title)
  );

  console.log(`=== Avance de tesis — ${root.title} ===`);
  console.log(`generado ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`);

  const allScored = [];
  for (const parte of partes) {
    const acc = { rows: [], scored: [], words: 0, minWords: completeThreshold(parte.title) };
    walk(parte, 0, acc);
    allScored.push(...acc.scored);

    console.log('');
    console.log(`${parte.title.toUpperCase().padEnd(52)}${String(percent(acc.scored)).padStart(3)}%  (${acc.words} palabras, completa ≥${acc.minWords}w)`);
    printPart(acc);
  }

  console.log('');
  console.log('-'.repeat(64));
  const plural = { completa: 'completas', parcial: 'parciales', vacía: 'vacías' };
  console.log(`${'TOTAL'.padEnd(52)}${String(percent(allScored)).padStart(3)}%  (${allScored.length} notas: ${
    ['completa', 'parcial', 'vacía']
      .map(s => `${allScored.filter(x => x === s).length} ${plural[s]}`)
      .join(', ')
  })`);
  console.log('');
  console.log('(Nodo "Eliminar" excluido — ver CLAUDE.md > Pendientes técnicos)');
}

main().catch(err => {
  console.error('Error generando avance:', err.message);
  process.exit(1);
});
