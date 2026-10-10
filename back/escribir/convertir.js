// convertir.js — HTML de Trilium ↔ Markdown para editar en emacs.
//
// La ida usa turndown (el mismo que el PDF); la vuelta, marked. Lo que el
// Markdown no representa con fidelidad (figuras con adjunto) viaja como bloque
// opaco: una línea `<!-- trilium:bloque N -->` en el Markdown y el HTML
// original guardado aparte, que se reinserta byte a byte.

import turndown from 'turndown';
import { marked } from 'marked';

// Enlaces internos: en el Markdown son `[[clave]]`, donde la clave es el
// título de la nota destino (con la ruta delante sólo si el título se repite:
// `[[Parte III - Archivos comprimidos › Léeme]]`). Como en Trilium, el texto
// del enlace es siempre el título vigente, no el que tenía al insertarse.
//
// `[[clave|texto]]` es un enlace con texto propio, para citas con página o
// «citado en»: `[[(de Assis, 2018)|(Rheinberger, 1997, p. 2, citado en de
// Assis, 2018, p. 114)]]`. En Trilium es un enlace interno sin la clase
// `reference-link` (la que hace que se muestre el título), así que el texto se
// conserva y no se reescribe al subir. El PDF y el grafo lo resuelven por el
// href, igual que los demás.
const RE_ENLACE = /\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/g;
const ALIAS = 'TRILIUMALIAS';
const idDeHref = (href) => href.split('/').pop();
const escaparHtml = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// La marca lleva el inicio del pie de figura para orientarse; ese texto es sólo
// referencia: editarlo no cambia la figura.
const MARCA = (n, pie) => `<!-- trilium:bloque ${n}${pie ? ` · ${pie}` : ''} -->`;
const RE_MARCA = /^<!-- trilium:bloque (\d+)\b.*-->$/;
const RE_MARCADOR = /^TRILIUMBLOQUE(\d+)$/;

function pieDeFigura(html) {
  const m = (html || '').match(/<figcaption>([\s\S]*?)<\/figcaption>/);
  if (!m) return 'figura';
  const texto = m[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  return 'figura: ' + (texto.length > 60 ? texto.slice(0, 60) + '…' : texto).replace(/--/g, '—');
}

function servicioTurndown(bloques, claveDe) {
  const td = turndown({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
    br: '\\'
  });
  td.addRule('bloque', {
    filter: (node) => node.nodeName === 'P' && RE_MARCADOR.test(node.textContent),
    replacement: (_c, node) => {
      const n = Number(node.textContent.match(RE_MARCADOR)[1]);
      return `\n\n${MARCA(n, pieDeFigura(bloques[n - 1]))}\n\n`;
    }
  });
  // Enlace a una nota del árbol → [[clave]]. Si el destino no está en el árbol
  // (una nota borrada), queda como [texto](#root/…) y no se toca.
  td.addRule('enlaceInterno', {
    filter: (node) => node.nodeName === 'A' && /reference-link/.test(node.className || '')
      && !!claveDe?.(idDeHref(node.getAttribute('href') || '')),
    replacement: (_c, node) => `[[${claveDe(idDeHref(node.getAttribute('href')))}]]`
  });
  // Enlace interno con texto propio → [[clave|texto]].
  td.addRule('enlaceConTexto', {
    filter: (node) => node.nodeName === 'A' && !/reference-link/.test(node.className || '')
      && /^#root\//.test(node.getAttribute('href') || '')
      && !!claveDe?.(idDeHref(node.getAttribute('href') || '')),
    replacement: (_c, node) => {
      const texto = node.textContent.replace(/\s+/g, ' ').trim();
      return `[[${claveDe(idDeHref(node.getAttribute('href')))}|${texto}]]`;
    }
  });
  return td;
}

export function htmlAMarkdown(html, { claveDe } = {}) {
  // Las figuras salen del texto crudo antes de turndown, que colapsa espacios
  // en el DOM: el bloque tiene que volver idéntico.
  const bloques = [];
  const sinBloques = (html || '').replace(/<figure\b[\s\S]*?<\/figure>/g, (m) => {
    bloques.push(m);
    return `<p>TRILIUMBLOQUE${bloques.length}</p>`;
  });
  const limpio = sinBloques
    .replace(/&nbsp;/g, ' ').replace(/\u00a0/g, ' ')
    // Un <br> al final de un párrafo no se ve; en Markdown quedaría como «\».
    .replace(/(\s|<br>)+<\/p>/g, '</p>')
    .replace(/<p>\s*<\/p>/g, '');
  const md = servicioTurndown(bloques, claveDe).turndown(limpio);
  return { md: md.trim() + '\n', bloques };
}

// `resolver(clave)` → { href, titulo } o null. Las claves que no resuelve se
// juntan en `faltantes` y quedan como texto literal.
export function markdownAHtml(md, bloques = [], { resolver, faltantes } = {}) {
  // Las marcas se separan antes de marked y se reponen después.
  const partes = [];
  let actual = [];
  for (const linea of md.split('\n')) {
    const m = linea.trim().match(RE_MARCA);
    if (m) {
      partes.push({ md: actual.join('\n') });
      partes.push({ bloque: Number(m[1]) });
      actual = [];
    } else actual.push(linea);
  }
  partes.push({ md: actual.join('\n') });

  let html = '';
  for (const p of partes) {
    if (p.bloque) {
      const original = bloques[p.bloque - 1];
      if (original == null) throw new Error(`el bloque ${p.bloque} no existe`);
      html += original;
    } else if (p.md.trim()) {
      // gfm apagado: una URL suelta en la nota es texto, no enlace.
      const conEnlaces = p.md.replace(RE_ENLACE, (todo, clave, texto) => {
        const destino = resolver?.(clave.trim());
        if (!destino) { faltantes?.push(clave.trim()); return todo; }
        if (texto?.trim()) {
          // La marca evita que ajustarATrilium le ponga la clase reference-link.
          return `<a href="${ALIAS}${destino.href}">${escaparHtml(texto.trim())}</a>`;
        }
        return `<a class="reference-link" href="${destino.href}">${escaparHtml(destino.titulo)}</a>`;
      });
      html += ajustarATrilium(marked.parse(conEnlaces, { gfm: false, breaks: false }))
        .replaceAll(`href="${ALIAS}`, 'href="');
    }
  }
  return html;
}

// Del HTML de marked al dialecto que escribe CKEditor en Trilium.
function ajustarATrilium(html) {
  return html
    .replace(/<a href="(#root\/[^"]*)"/g, '<a class="reference-link" href="$1"')
    .replace(/<em>/g, '<i>').replace(/<\/em>/g, '</i>')
    .replace(/<br\s*\/?>\n?/g, '<br>')
    .replace(/>\s*\n\s*</g, '><')
    .replace(/\n/g, ' ')
    .trim();
}

// Para comparar dos HTML sin contar diferencias que no se ven: espacios junto a
// etiquetas en línea, énfasis vacíos, enlaces sin destino, márgenes en cero.
export function normalizarHtml(html) {
  return (html || '')
    .replace(/&nbsp;|\u00a0/g, ' ')
    // Un enlace interno se compara por su destino: el texto y la ruta intermedia
    // se reescriben a propósito (título vigente, ruta actual del árbol).
    .replace(/\s*<a class="reference-link" href="[^"]*?([A-Za-z0-9_]+)">[^<]*<\/a>\s*/g, '<ref $1>')
    // Con texto propio, el texto sí cuenta; la ruta intermedia no.
    .replace(/\s*<a href="#root\/[^"]*?([A-Za-z0-9_]+)">([^<]*)<\/a>\s*/g, '<ref $1|$2>')
    .replace(/ style="margin-left:0(\.0)?px;"/g, '')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&gt;/g, '>')
    .replace(/<a href="">([^<]*)<\/a>/g, '$1')
    .replace(/\s+/g, ' ')
    .replace(/<(strong|i)>\s*<\/\1>/g, ' ')
    .replace(/\s*(<\/?(?:a|strong|i|code|figcaption)\b[^>]*>|<br>)\s*/g, '$1')
    .replace(/<br><\/p>/g, '</p>')
    .replace(/\s*(<\/?(?:p|li|ul|ol|h\d|blockquote|figure)\b[^>]*>)\s*/g, '$1')
    .replace(/<p><\/p>/g, '')
    .replace(/\s*(<ref [^>]+>)\s*/g, '$1')
    .trim();
}

export function contarPalabras(md) {
  const texto = md
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\]\([^)]*\)/g, ']')
    .replace(/[#*_>\[\]`\\-]/g, ' ');
  return (texto.match(/\S+/g) || []).length;
}
