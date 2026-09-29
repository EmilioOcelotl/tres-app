// corpus.js — el pool de materiales sonoros.
//
// Hasta aquí la pieza granulaba una muestra sola: los dos fronts hacían fetch de
// assets/snd/oci3.mp3 y ese buffer duraba toda la sesión. Desde el 2026-09-20 hay
// corpus propio —fragmentos de 45 s medidos y normalizados, con su acta en
// assets/snd/catalogo.json— y desde el 21-09 el texto de la nota ya decide *cómo*
// suena (sus rasgos de forma → mapSnapshotToAudioParams, ver snapshot.js). Este
// archivo es la otra mitad: *qué* suena.
//
// Por qué un pool y no cargarlos todos: decodificado, un fragmento de 45 s mono
// ocupa 45 × sampleRate × 4 bytes de RAM — 7.9 MB si el AudioContext corre a
// 44.1k y 8.2 MB si a 48k, porque decodeAudioData remuestrea a la tasa del
// dispositivo y no a la del archivo. Con dieciocho son ~148 MB, contra 9.3 MB de
// descarga si se piden todos y 528 KB si se pide uno. Así que se cargan bajo
// demanda, se cachea lo decodificado y lo que no se usa se suelta.
//
// Vive en front/ y lo importan el grafo (main.js) y el visor de comprimidos
// (comprimido.js), por la misma razón que snapshot.js: los dos tienen que sonar
// igual para la misma nota, y dos copias derivan — ya pasó una vez.

import { hashString } from './snapshot.js';

const RUTA_CATALOGO = '/assets/snd/catalogo.json';
const BASE_CORPUS   = '/assets/snd/';

// Cuántos buffers decodificados se sostienen a la vez. A ~8 MB cada uno, cuatro
// son ~33 MB: alcanza para que ir y volver entre dos o tres notas no vuelva a
// descargar, y no le pelea memoria a la escena de Three.js. El que está sonando
// está fijado y nunca se suelta; durante un cruce son dos (ver voces.js), así
// que para navegar quedan dos o tres.
const PRESUPUESTO = 4;

let materiales = [];            // el catálogo, en su orden
let porTermino = new Map();     // término declarado por el autor → material

const cache   = new Map();      // id → AudioBuffer. El orden del Map es el de uso:
                                // lo más reciente al final, así que el primero que
                                // devuelve keys() es el candidato a soltarse.
const enVuelo = new Map();      // id → Promise<AudioBuffer> en curso
let   fijados = new Set();      // ids de los que están sonando: exentos del
                                // desalojo (dos durante un cruce, ver voces.js)

// Los términos del catálogo los escribe el autor a mano y el top-1 de TF-IDF sale
// del extractor, así que se comparan sin acentos ni mayúsculas para que
// "Parsing", "parsing" y "parséo" no se pierdan por la forma.
function normalizar(t) {
    return String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

export async function cargarCatalogo() {
    if (materiales.length) return materiales;
    const res = await fetch(RUTA_CATALOGO);
    if (!res.ok) throw new Error(`catálogo de sonido: ${res.status}`);
    return usarCatalogo(await res.json());
}

// Instala un catálogo ya leído. Lo usan cargarCatalogo, publicar.js (que en Node
// lee el archivo de disco para congelar el material de cada panel) y el visor de
// una edición congelada, que pasa los materiales del acta con su `url` al pozo.
export function usarCatalogo(cat) {
    materiales = (cat.materiales || []).filter(m => m && m.id && (m.archivo || m.url));
    porTermino = new Map();
    for (const m of materiales) {
        // Si dos materiales reclaman la misma palabra, gana el primero del
        // catálogo: el orden del archivo es el desempate, y es visible.
        for (const t of m.terminos || []) {
            const k = normalizar(t);
            if (!porTermino.has(k)) porTermino.set(k, m);
        }
    }
    return materiales;
}

export function catalogo() {
    return materiales;
}

// Cuántos materiales tienen término declarado. Sirve para decir en consola si el
// puente del autor está en uso o si todo está cayendo al reparto provisional.
export function conTermino() {
    return materiales.filter(m => (m.terminos || []).length).length;
}

// QUÉ suena para esta nota. Dos reglas, en orden:
//
// 1. El término declarado. El autor escribe en assets/snd/fuentes.json qué
//    palabras reclama cada material (`terminos`; `npm run corpus` las copia al
//    catálogo). La nota trae sus términos de más peso —los 25 primeros de TF-IDF,
//    en `rasgos.terminos`— y se recorren en orden: el primero que algún material
//    reclame decide. Así una palabra alcanza a las notas donde de verdad pesa, no
//    sólo a aquella donde quedó primera (hasta el 2026-09-22 se comparaba sólo el
//    top-1, y `ciudad` no alcanzaba a Ciudad Monstruo). Si una nota coincide con
//    varios materiales, gana el término que más pesa en ella. Es el mecanismo que
//    el autor decidió el 2026-09-20 («el texto modula y selecciona»).
//    Las actas publicadas antes de este cambio sólo traen `rasgos.termino`, y con
//    eso se comparan.
//
// 2. Reparto estable, y arbitrario a propósito. Mientras 1 no dispare, la nota cae
//    en un material por hash de su término (o de su id, si no tiene texto). Es
//    estable —la misma nota suena siempre con el mismo material— y reparte las
//    notas sobre todo el catálogo, que es lo que hace falta para que el corpus se
//    oiga y el pool se ejercite. No pretende significar nada, y esto es
//    deliberado: el emparejamiento automático nota→material está medido y no
//    funciona (45 de 78 notas, cosenos 0.02–0.08; `ventilador` se llevaba ocho
//    notas porque «computadora» es palabra frecuente en la tesis). Por eso el
//    puente lo declara el autor y esto es relleno reemplazable.
export function materialParaNota(node) {
    if (!materiales.length) return null;

    const termino = node?.rasgos?.termino;
    const candidatos = node?.rasgos?.terminos || (termino ? [termino] : []);
    for (const t of candidatos) {
        const declarado = porTermino.get(normalizar(t));
        if (declarado) return declarado.id;
    }

    const clave = termino || node?.id || '';
    return materiales[hashString(`material#${clave}`) % materiales.length].id;
}

export function enCache(id) {
    return cache.get(id) || null;
}

// Marca los que están sonando para que el desalojo no se los lleve. Reemplaza
// la marca anterior: se pasan siempre todos los vigentes.
export function fijar(...ids) {
    fijados = new Set(ids.filter(Boolean));
}

// Suelta lo más viejo hasta caber en el presupuesto, sin tocar los que suenan.
function desalojar() {
    for (const id of [...cache.keys()]) {
        if (cache.size <= PRESUPUESTO) return;
        if (fijados.has(id)) continue;
        cache.delete(id);
        console.log(`[corpus] suelta ${id} — quedan ${[...cache.keys()].join(', ')}`);
    }
}

// Devuelve el AudioBuffer del material, decodificándolo si hace falta. Si ya está
// en caché resuelve en el microtask siguiente, así que el llamador puede tratar el
// caso común como si fuera inmediato.
export async function obtenerBuffer(ctx, id) {
    if (!id) return null;

    const yaEsta = cache.get(id);
    if (yaEsta) {
        cache.delete(id);        // reinsertar lo manda al final: queda como reciente
        cache.set(id, yaEsta);
        return yaEsta;
    }
    if (enVuelo.has(id)) return enVuelo.get(id);

    const material = materiales.find(m => m.id === id);
    if (!material) return null;

    const tarea = (async () => {
        const url = material.url || BASE_CORPUS + material.archivo;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${url}: ${res.status}`);
        const raw = await res.arrayBuffer();
        // decodeAudioData desprende el ArrayBuffer (byteLength queda en 0 después),
        // así que el tamaño se mide antes y el raw no se reusa.
        const kb = raw.byteLength / 1024;
        const buf = await ctx.decodeAudioData(raw);
        cache.set(id, buf);
        console.log(`[corpus] ${id} — ${buf.duration.toFixed(1)}s, ${kb.toFixed(0)} KB, ${cache.size}/${PRESUPUESTO} en caché`);
        desalojar();
        return buf;
    })();

    enVuelo.set(id, tarea);
    try {
        return await tarea;
    } finally {
        enVuelo.delete(id);
    }
}
