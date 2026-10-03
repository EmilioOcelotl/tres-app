// utils/comentarios.js
// Comentarios del autor dentro de la prosa de Trilium.
//
// En una nota de texto, todo lo que va de `//` al fin de la línea es un
// comentario: se escribe en Trilium pero no sale en ninguna salida (PDF, grafo,
// búsqueda, comprimidos, sonido, conteo de palabras). Es la misma convención
// que en el código, con una inversión: en las notas `type=code` los `//` sí se
// imprimen, porque ahí el comentario es contenido. Esta función sólo se aplica
// a notas de texto.
//
// El texto llega como HTML de CKEditor, así que «la línea» termina en:
//   - el cierre de un bloque (<p>, <li>, <h1>…, <td>, <blockquote>, …)
//   - un salto suave <br> (Shift+Enter)
//   - la apertura de otro bloque (una lista anidada dentro de un <li>)
// Lo que queda adentro de <pre> o <code> no se toca.
// Un `//` precedido por `:` o `/` no abre comentario: así sobreviven
// `https://…` y `file:///…`.
// Si un bloque queda vacío después de cortar, se elimina.

const BLOQUES = new Set([
  'p', 'li', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'div', 'blockquote', 'td', 'th', 'tr', 'table', 'figure', 'figcaption', 'section'
]);
const LITERALES = new Set(['pre', 'code']);
// Marca dónde hubo un corte: sólo se eliminan los bloques que vació un
// comentario, no los párrafos vacíos que el autor dejó a propósito.
const MARCA = '\u0000';
const VACIOS = new Set(['br', 'img', 'hr', 'input', 'source', 'wbr', 'col']);

function nombreDe(tag) {
  const m = tag.match(/^<\/?\s*([a-zA-Z0-9]+)/);
  return m ? m[1].toLowerCase() : '';
}

export function quitarComentarios(html) {
  if (!html) return html;
  const str = Buffer.isBuffer(html) ? html.toString('utf8') : html;
  if (!str.includes('//')) return str;

  const tokens = str.split(/(<[^>]*>)/);
  let out = '';
  let literal = 0;        // profundidad dentro de <pre>/<code>
  let cortando = false;   // dentro de un comentario
  let caidos = [];        // etiquetas abiertas dentro del comentario (se descartan con su cierre)
  let ultimo = '';        // último carácter de texto emitido, para el `:` de las URLs
  let huboCorte = false;

  for (const tok of tokens) {
    if (tok === '') continue;

    if (tok.startsWith('<')) {
      const nombre = nombreDe(tok);
      const cierre = tok.startsWith('</');
      const autocierre = tok.endsWith('/>') || VACIOS.has(nombre);

      if (LITERALES.has(nombre) && !cortando) literal += cierre ? -1 : (autocierre ? 0 : 1);

      if (cortando) {
        if (nombre === 'br' || BLOQUES.has(nombre)) {
          // la línea terminó: si el cierre es de algo abierto dentro del
          // comentario, se descarta; si no, se emite y se sale del comentario
          if (cierre && caidos.length && caidos[caidos.length - 1] === nombre) {
            caidos.pop();
            continue;
          }
          cortando = false;
          caidos = [];
          out += tok;
          ultimo = '';
          continue;
        }
        if (autocierre) continue;
        if (!cierre) { caidos.push(nombre); continue; }
        if (caidos.length && caidos[caidos.length - 1] === nombre) { caidos.pop(); continue; }
        out += tok;   // cierre de una etiqueta inline abierta antes del `//`
        continue;
      }

      if (BLOQUES.has(nombre) || nombre === 'br') ultimo = '';
      out += tok;
      continue;
    }

    // texto
    if (cortando) continue;
    if (literal > 0) { out += tok; ultimo = tok.slice(-1); continue; }

    let i = -1;
    let desde = 0;
    while ((i = tok.indexOf('//', desde)) !== -1) {
      const previo = i > 0 ? tok[i - 1] : ultimo;
      if (previo !== ':' && previo !== '/') break;
      desde = i + 2;
    }
    if (i === -1) { out += tok; ultimo = tok.slice(-1) || ultimo; continue; }

    out += tok.slice(0, i).replace(/[ \t ]+$/, '').replace(/(&nbsp;|\s)+$/, '');
    out += MARCA;
    cortando = true;
    huboCorte = true;
    caidos = [];
  }

  if (!huboCorte) return str;

  // bloques que quedaron vacíos (el comentario ocupaba la línea entera)
  const relleno = '(?:\\s|&nbsp;|<br\\s*\\/?>|<(?:strong|em|i|b|u|s|span|a)(?:\\s[^>]*)?>|<\\/(?:strong|em|i|b|u|s|span|a)>)*';
  const vacio = new RegExp(`<(p|li|h[1-6]|blockquote|figcaption)(\\s[^>]*)?>${relleno}${MARCA}${relleno}<\\/\\1>`, 'gi');
  let previo;
  do {
    previo = out;
    out = out.replace(vacio, MARCA);
    out = out.replace(new RegExp(`<(ul|ol)(\\s[^>]*)?>\\s*${MARCA}\\s*<\\/\\1>`, 'gi'), MARCA);
  } while (out !== previo);
  // saltos suaves que quedaron al borde de un bloque por un corte
  out = out.replace(new RegExp(`(<(p|li|h[1-6])(\\s[^>]*)?>)${MARCA}(\\s|<br\\s*\\/?>)+`, 'gi'), '$1');
  out = out.replace(new RegExp(`${MARCA}(<br\\s*\\/?>\\s*)+(<\\/(p|li|h[1-6])>)`, 'gi'), '$2');

  return out.split(MARCA).join('');
}
