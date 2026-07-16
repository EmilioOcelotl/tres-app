// comprimidos/instancia.js — genera la instancia de un archivo comprimido:
// receta + semilla → caminata por los enlaces internos → JSON congelado.
// La instancia es el intermedio compartido entre las dos salidas de Parte III
// (mismo patrón que el JSON de ciudad-monstruo): render.js la vuelve pliego
// imprimible y el visor web (front/comprimido.html) la vuelve página navegable.
// Misma semilla ⇒ misma caminata y mismos fragmentos en ambas.

import { NoteService } from '../services/noteService.js';
import { ContentProcessor } from '../services/contentProcessor.js';
import { traducirReceta } from './traducir.js';

// Mismo hash y LCG que el snapshot sintético del front (front/main.js)
export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}
export function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function htmlATexto(html) {
  return html
    .replace(/<(p|div|br|li|h[1-6])[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

// Ventana de `recorte` palabras elegida con semilla: la remezcla no siempre
// empieza al principio de la nota.
function recortarConSemilla(texto, recorte, rng) {
  const palabras = texto.replace(/\n/g, ' ').split(/\s+/).filter(w => w);
  if (palabras.length <= recorte) return { frag: palabras.join(' '), parcial: false };
  const maxInicio = palabras.length - recorte;
  const inicio = Math.floor(rng() * maxInicio);
  const frag = palabras.slice(inicio, inicio + recorte).join(' ');
  return { frag: (inicio > 0 ? '…' : '') + frag + '…', parcial: true };
}

// Lo mismo para notas de código, pero por líneas: la indentación es parte del
// material, así que la ventana nunca corta dentro de una línea.
function recortarLineasConSemilla(texto, recorte, rng) {
  const lineas = texto.replace(/\s+$/, '').split('\n');
  if (lineas.length <= recorte) return { frag: lineas.join('\n'), parcial: false };
  const maxInicio = lineas.length - recorte;
  const inicio = Math.floor(rng() * maxInicio);
  const frag = lineas.slice(inicio, inicio + recorte).join('\n');
  return { frag: (inicio > 0 ? '…\n' : '') + frag + '\n…', parcial: true };
}

function extraerImagenes(html) {
  const imagenes = [];
  const re = /<img[^>]*src="api\/attachments\/([^/"]+)\/image\/([^"]*)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    imagenes.push({ attachmentId: m[1], nombre: decodeURIComponent(m[2]) });
  }
  return imagenes;
}

function aplanar(root) {
  const nodos = new Map();
  (function walk(n, level, part) {
    let p = part;
    if (level === 1) {
      if (/Parte I\b/.test(n.title)) p = 'p1';
      else if (/Parte II\b/.test(n.title)) p = 'p2';
      else if (/Parte III\b/.test(n.title)) p = 'p3';
    }
    // Igual que en el front: la detección de refs le gana a la herencia de parte
    if (/^Referencias/.test(n.title)) p = 'refs';
    const contenido = n.content
      ? (Buffer.isBuffer(n.content) ? n.content.toString('utf8') : n.content)
      : '';
    const esCodigo = n.type === 'code';
    const texto = esCodigo ? contenido : htmlATexto(contenido);
    const wc = texto.split(/\s+/).filter(w => w).length;
    nodos.set(n.noteId, {
      id: n.noteId, title: n.title, level, part: p || 'root',
      childCount: (n.children || []).length, wc, texto, esCodigo,
      imagenes: esCodigo ? [] : extraerImagenes(contenido),
    });
    (n.children || []).forEach(c => walk(c, level + 1, p));
  })(root, 0, null);
  return nodos;
}

// Tipos de contenido que cubre una nota, para el cue `cobertura:`. Una nota
// de texto con adjuntos cubre prosa e imagen a la vez.
function tiposDe(nodo) {
  if (nodo.esCodigo) return ['codigo'];
  return nodo.imagenes.length > 0 ? ['prosa', 'imagen'] : ['prosa'];
}

function caminata(nodos, crossLinks, params, rng) {
  const ady = new Map();
  const conecta = (a, b) => {
    if (!ady.has(a)) ady.set(a, new Set());
    ady.get(a).add(b);
  };
  for (const l of crossLinks) { conecta(l.source, l.target); conecta(l.target, l.source); }

  const buscado = params.desde.toLowerCase();
  let actual = [...nodos.values()].find(n => n.title.toLowerCase() === buscado)
            || [...nodos.values()].find(n => n.title.toLowerCase().includes(buscado));
  if (!actual) throw new Error(`No encontré la nota de arranque "${params.desde}"`);

  const visitados = new Set([actual.id]);
  const pasos = [];
  const soloCodigo = params.codigo === 'solo';
  // `codigo: evitar` filtra las notas type=code de la caminata; `codigo: solo`
  // deja únicamente las de código. El arranque por `desde:` queda exento en
  // ambos casos (lo nombró el autor).
  const elegibles = ids => [...ids].filter(id => {
    if (visitados.has(id) || !nodos.has(id)) return false;
    const n = nodos.get(id);
    if (n.wc < 15) return false;
    if (params.codigo === 'evitar' && n.esCodigo) return false;
    if (soloCodigo && !n.esCodigo) return false;
    return true;
  });
  // Entre notas de código no hay enlaces reales (solo 4/11 tienen grado ≥1),
  // así que en modo `solo` el teletransporte sale de todas las notas de
  // código, no del grafo de citas: la caminata es (casi) pura de saltos y el
  // cuadernillo lo asume.
  const universoSalto = () => elegibles(soloCodigo ? nodos.keys() : ady.keys());

  // Cobertura: tipos que el recorrido promete incluir. Se van tachando con
  // cada paso; los saltos prefieren tipos faltantes y, cuando quedan justo
  // los pasos para cumplir, la selección se dirige (por enlace si se puede,
  // salto forzado sobre todo el árbol si no).
  const porCubrir = new Set(params.cobertura || []);
  const cubre = nodo => tiposDe(nodo).forEach(t => porCubrir.delete(t));
  const cubreFaltante = id => tiposDe(nodos.get(id)).some(t => porCubrir.has(t));

  if (actual.wc >= 15) { pasos.push({ nodo: actual, via: 'inicio', origen: null }); cubre(actual); }

  let anterior = actual;
  while (pasos.length < params.pasos) {
    let candidatos = elegibles(ady.get(anterior.id) || []);
    let via = 'enlace';

    if (porCubrir.size >= params.pasos - pasos.length) {
      const porEnlace = candidatos.filter(cubreFaltante);
      if (porEnlace.length > 0) {
        candidatos = porEnlace;
      } else {
        const porSalto = elegibles(nodos.keys()).filter(cubreFaltante);
        if (porSalto.length > 0) { candidatos = porSalto; via = 'salto'; }
        // Si no queda nota que cubra, la caminata sigue normal: la cobertura
        // es mejor-esfuerzo cuando el corpus se agota.
      }
    }

    if (candidatos.length === 0) {
      candidatos = universoSalto();   // teletransporte
      via = 'salto';
      if (porCubrir.size > 0) {
        const dirigidos = candidatos.filter(cubreFaltante);
        if (dirigidos.length > 0) candidatos = dirigidos;
      }
      if (candidatos.length === 0) break;
    }
    const sig = nodos.get(candidatos[Math.floor(rng() * candidatos.length)]);
    visitados.add(sig.id);
    pasos.push({ nodo: sig, via, origen: anterior.title });
    cubre(sig);
    anterior = sig;
  }
  // El grado en el grafo de citas: con cuántas notas conversa cada una. Es el
  // dato que el archivo comprimido imprime en vez de un número de página.
  return pasos.map(p => ({ ...p, grado: (ady.get(p.nodo.id) || new Set()).size }));
}

const LINEAS_CODIGO = 16;

export async function generarInstancia(rutaReceta, semillaOverride = null) {
  const { params, narrativa } = traducirReceta(rutaReceta);
  if (semillaOverride != null && !Number.isNaN(semillaOverride)) {
    params.semilla = semillaOverride;
  }

  const ns = new NoteService();
  const root = await ns.getCompleteTree();
  const crossLinks = ns.extractCrossLinks(root);
  const nodos = aplanar(root);
  const rng = seededRandom(params.semilla);
  const caminataPasos = caminata(nodos, crossLinks, params, rng);

  // El fragmento se congela aquí para que PDF y web muestren el mismo texto:
  // ventana determinista por nota (hash del id ⊕ semilla), igual que hacía
  // pagFragmento en render.js.
  const pasos = caminataPasos.map(({ nodo, via, origen, grado }) => {
    // La semilla entra al hash FNV, no por XOR: el primer sorteo del LCG casi
    // no responde a cambios en bits bajos y la ventana quedaba fija por nota.
    const rngNota = seededRandom(hashString(`${nodo.id}#${params.semilla}`));
    const frag = nodo.esCodigo
      ? recortarLineasConSemilla(nodo.texto, LINEAS_CODIGO, rngNota).frag
      : recortarConSemilla(nodo.texto, params.recorte, rngNota).frag;
    return {
      id: nodo.id, title: nodo.title, part: nodo.part, level: nodo.level,
      childCount: nodo.childCount, wc: nodo.wc, esCodigo: nodo.esCodigo,
      grado, via, origen, frag, imagenes: nodo.imagenes,
      // Para el visor: el fragmento de código ya colorizado con el mismo
      // espejo del overlay 3D (.code-line + tok-*); el PDF toma `frag`.
      fragHtml: nodo.esCodigo ? ContentProcessor.processCodeForFrontend(frag) : undefined,
    };
  });

  return {
    params,
    narrativa,
    pasos,
    fecha: new Date().toISOString().slice(0, 10),
  };
}
