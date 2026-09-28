// comprimidos/traducir.js — el "autotune" de los archivos comprimidos.
// Traduce una receta escrita en lenguaje natural (recetas/*.md) a parámetros
// para el renderizador experimental (render.js). Mismo principio que
// neo_cdm/traducir.mjs en ciudad-monstruo: la narrativa manda, el sistema
// traduce solo lo formal (los cues `clave: valor` al inicio de línea).
// Todo lo que no es cue se conserva como narrativa del autor y puede
// imprimirse (la de `## Portada` entra como epígrafe de la portada).

import fs from 'fs';

// Cues reconocidos y sus defaults. Cualquier otra línea es narrativa.
const DEFAULTS = {
  titulo: null,          // título del cuadernillo (default: nombre de la receta)
  semilla: 1,            // semilla del render — cada semilla es una instancia distinta
  formato: 'zine8',      // zine8 | mapa
  desde: 'Léeme',        // título (o fragmento) de la nota donde arranca la caminata
  pasos: 6,              // notas que recoge la caminata por crossLinks
  recorte: 70,           // palabras máximas por fragmento
  codigo: 'incluir',     // notas type=code en la caminata: incluir | evitar | solo
  cobertura: null,       // tipos de contenido garantizados en el recorrido:
                         // lista de prosa | codigo | imagen (al menos una nota de cada uno)
  afinidad: 'enlace',    // por dónde camina: enlace (los crossLinks que escribió el
                         // autor) | termino (el término que pesa en las dos notas)
  epigrafe: null,        // portada automática: anti (una frase de las escenas de
                         // 4nt1). Si la receta trae `## Portada`, gana lo escrito.
};

const FUENTES_EPIGRAFE = ['anti'];

const TIPOS_COBERTURA = ['prosa', 'codigo', 'imagen'];

const CUE_RE = /^([a-záéíóúñ]+)\s*:\s*(.+)$/i;

export function traducirReceta(rutaReceta) {
  const texto = fs.readFileSync(rutaReceta, 'utf8');
  const params = { ...DEFAULTS };
  const narrativa = { general: [], portada: [] };
  let seccion = 'general';

  for (const lineaRaw of texto.split('\n')) {
    const linea = lineaRaw.trim();
    if (!linea) continue;

    if (linea.startsWith('##')) {
      const nombre = linea.replace(/^#+\s*/, '').toLowerCase();
      seccion = nombre.startsWith('portada') ? 'portada' : 'general';
      continue;
    }
    if (linea.startsWith('#')) {
      if (!params.titulo) params.titulo = linea.replace(/^#+\s*/, '').replace(/^receta:?\s*/i, '');
      continue;
    }

    const m = linea.match(CUE_RE);
    if (m) m[1] = m[1].toLowerCase().replace(/^código$/, 'codigo').replace(/^epígrafe$/, 'epigrafe');
    if (m && m[1] in DEFAULTS) {
      const clave = m[1];
      const valor = m[2].trim();
      params[clave] = (clave === 'semilla' || clave === 'pasos' || clave === 'recorte')
        ? parseInt(valor, 10)
        : valor;
      continue;
    }

    narrativa[seccion].push(linea);
  }

  if (params.formato !== 'zine8' && params.formato !== 'mapa') {
    throw new Error(`Formato desconocido: "${params.formato}" (usa zine8 o mapa)`);
  }
  if (!['incluir', 'evitar', 'solo'].includes(params.codigo)) {
    throw new Error(`Cue codigo desconocido: "${params.codigo}" (usa incluir, evitar o solo)`);
  }
  if (!['enlace', 'termino'].includes(params.afinidad)) {
    throw new Error(`Cue afinidad desconocido: "${params.afinidad}" (usa enlace o termino)`);
  }
  // `codigo: solo` ya define su propio universo (las notas de código, que casi
  // no se enlazan entre sí y se recorren a saltos). Cruzarlo con la afinidad por
  // término daría dos criterios peleando por el mismo paso.
  if (params.afinidad === 'termino' && params.codigo === 'solo') {
    throw new Error('afinidad: termino no combina con codigo: solo');
  }
  if (params.epigrafe) {
    params.epigrafe = params.epigrafe.toLowerCase();
    if (!FUENTES_EPIGRAFE.includes(params.epigrafe)) {
      throw new Error(`Cue epigrafe desconocido: "${params.epigrafe}" (usa ${FUENTES_EPIGRAFE.join(', ')})`);
    }
    // Lo escrito a mano manda sobre lo automático: el cue queda anotado pero no
    // actúa, y se avisa para que no parezca que el sorteo falló.
    if (narrativa.portada.length) {
      console.warn(`La receta trae ## Portada: se ignora "epigrafe: ${params.epigrafe}"`);
      params.epigrafe = null;
    }
  }
  if (params.cobertura) {
    params.cobertura = params.cobertura.split(',')
      .map(t => t.trim().toLowerCase().replace(/^código$/, 'codigo'))
      .filter(t => t);
    const raros = params.cobertura.filter(t => !TIPOS_COBERTURA.includes(t));
    if (raros.length > 0) {
      throw new Error(`Tipo de cobertura desconocido: "${raros.join(', ')}" (usa prosa, codigo o imagen)`);
    }
    if (params.codigo === 'solo') {
      throw new Error('cobertura no combina con codigo: solo (esa caminata ya es solo código)');
    }
    if (params.codigo === 'evitar' && params.cobertura.includes('codigo')) {
      throw new Error('cobertura pide codigo pero el cue codigo dice evitar');
    }
  }

  return { params, narrativa };
}
