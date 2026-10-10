// local.js — la copia local de las notas, que permite escribir sin red.
//
// <carpeta>/indice.json        árbol + lo que se sabe del servidor al bajar
// <carpeta>/notas/<id>.<ext>   lo que se edita (.md para texto, .js/.md para código)
// <carpeta>/bloques/<id>.json  HTML de las figuras (bloques opacos)
// <carpeta>/originales/<id>    contenido tal como llegó del servidor (respaldo)
// <carpeta>/remotos/<id>.<ext> versión del servidor cuando hubo conflicto al subir
// <carpeta>/enlaces.tsv        claves y rutas para la búsqueda del `@` en emacs

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { quitarComentarios } from '../utils/comentarios.js';
import { htmlAMarkdown, markdownAHtml } from './convertir.js';

// Sube cuando cambia cómo se convierte el HTML a Markdown: las notas sin
// cambios locales se regeneran desde originales/ al siguiente `bajar`.
// 2 = enlaces internos como [[clave]].
// 3 = enlaces internos con texto propio como [[clave|texto]].
export const CONVERSION = 3;

export const hash = (t) => crypto.createHash('sha1').update(t).digest('hex');

export function rutas(carpeta) {
  const r = {
    indice: path.join(carpeta, 'indice.json'),
    notas: path.join(carpeta, 'notas'),
    bloques: path.join(carpeta, 'bloques'),
    originales: path.join(carpeta, 'originales'),
    remotos: path.join(carpeta, 'remotos'),
    enlaces: path.join(carpeta, 'enlaces.tsv')
  };
  for (const d of [r.notas, r.bloques, r.originales, r.remotos]) fs.mkdirSync(d, { recursive: true });
  return r;
}

export function extension(nota) {
  if (nota.type === 'text') return 'md';
  if (/javascript/.test(nota.mime || '')) return 'js';
  if (/markdown/.test(nota.mime || '')) return 'md';
  return 'txt';
}

// ── Índice y enlaces ─────────────────────────────────────────────────────────

const cache = new Map();

export function leerIndice(carpeta) {
  if (cache.has(carpeta)) return cache.get(carpeta).indice;
  const r = rutas(carpeta);
  if (!fs.existsSync(r.indice)) return null;
  const indice = JSON.parse(fs.readFileSync(r.indice, 'utf8'));
  cache.set(carpeta, { indice, enlaces: armarEnlaces(indice) });
  return indice;
}

export function guardarIndice(carpeta, indice) {
  const r = rutas(carpeta);
  const tmp = r.indice + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(indice, null, 1));
  fs.renameSync(tmp, r.indice);
  cache.set(carpeta, { indice, enlaces: armarEnlaces(indice) });
}

// Clave de cada nota: su título, o el sufijo de ruta más corto que la vuelva
// única cuando el título se repite (`Introducción › Léeme`).
function armarEnlaces(indice) {
  const notas = indice.notas.filter((e) => e.rutaIds);
  const segmentos = (e) => e.ruta.map((t) => t.trim());
  const porId = new Map();
  const porClave = new Map();
  for (const e of notas) {
    const seg = segmentos(e);
    let clave = seg[seg.length - 1];
    for (let n = 1; n <= seg.length; n++) {
      const sufijo = seg.slice(-n).join(' › ');
      const iguales = notas.filter((o) => segmentos(o).slice(-n).join(' › ') === sufijo);
      if (iguales.length === 1) { clave = sufijo; break; }
    }
    const destino = {
      id: e.id, clave, titulo: e.titulo.trim(),
      href: '#root/' + e.rutaIds.join('/'),
      lugar: seg.slice(0, -1).join(' › ')
    };
    porId.set(e.id, destino);
    porClave.set(clave, destino);
  }
  // Tolerancia al escribir a mano: sin distinguir mayúsculas, o la ruta entera.
  const porMinusculas = new Map();
  for (const d of porId.values()) {
    porMinusculas.set(d.clave.toLowerCase(), d);
    porMinusculas.set(`${d.lugar} › ${d.titulo}`.toLowerCase(), d);
  }
  return {
    claveDe: (id) => porId.get(id)?.clave ?? null,
    resolver: (clave) => porClave.get(clave) ?? porMinusculas.get(clave.toLowerCase()) ?? null,
    destinos: [...porId.values()]
  };
}

export function enlaces(carpeta) {
  leerIndice(carpeta);
  return cache.get(carpeta)?.enlaces;
}

// Lista para la búsqueda de emacs: «clave<TAB>título<TAB>lugar», una por línea.
export function escribirListaEnlaces(carpeta) {
  const lineas = enlaces(carpeta).destinos.map((d) => `${d.clave}\t${d.titulo}\t${d.lugar}`);
  fs.writeFileSync(rutas(carpeta).enlaces, lineas.join('\n') + '\n');
}

// ── Notas ────────────────────────────────────────────────────────────────────

export const archivoDe = (carpeta, e) => path.join(rutas(carpeta).notas, `${e.id}.${e.ext}`);

export function leerTexto(carpeta, e) {
  const f = archivoDe(carpeta, e);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
}

export function leerBloques(carpeta, e) {
  const f = path.join(rutas(carpeta).bloques, `${e.id}.json`);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : [];
}

export function modificada(carpeta, e) {
  const t = leerTexto(carpeta, e);
  return t != null && hash(t) !== e.hashBajado;
}

// Escribe el archivo editable a partir del contenido del servidor. Devuelve el
// texto escrito (para el hash).
export function escribirDesdeOriginal(carpeta, e, contenido) {
  const r = rutas(carpeta);
  let texto = contenido;
  if (e.tipo === 'text') {
    const { md, bloques } = htmlAMarkdown(contenido, { claveDe: enlaces(carpeta)?.claveDe });
    texto = md;
    fs.writeFileSync(path.join(r.bloques, `${e.id}.json`), JSON.stringify(bloques));
  }
  fs.writeFileSync(archivoDe(carpeta, e), texto);
  return texto;
}

// Lo que se le manda a Trilium a partir del archivo local. `faltantes` junta
// los [[enlaces]] que no apuntan a ninguna nota.
export function contenidoParaSubir(carpeta, e, faltantes) {
  const t = leerTexto(carpeta, e);
  if (e.tipo !== 'text') return t;
  return markdownAHtml(t, leerBloques(carpeta, e), { resolver: enlaces(carpeta)?.resolver, faltantes });
}

export function enlacesRotos(carpeta, e) {
  const faltantes = [];
  if (e.tipo === 'text') contenidoParaSubir(carpeta, e, faltantes);
  return faltantes;
}

// Mismo conteo que `npm run avance`: sobre el HTML, sin los comentarios `//`.
export function palabras(carpeta, e) {
  const t = leerTexto(carpeta, e);
  if (!t) return 0;
  const html = e.tipo === 'text' ? quitarComentarios(contenidoParaSubir(carpeta, e)) : t;
  return html.replace(/<[^>]*>/g, ' ').split(/\s+/).filter(Boolean).length;
}

export function umbral(e) {
  return e.parte.startsWith('Parte II ') ? 50 : 150;
}

export function estadoDe(e, w) {
  if (w >= umbral(e)) return '●';
  if (w > 0) return '◐';
  return e.hijos > 0 ? ' ' : '○';
}
