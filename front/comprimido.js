// comprimido.js — visor web de archivos comprimidos (Parte III).
// La otra cara del cuadernillo impreso: la misma instancia (receta + semilla
// + estado de la BD) como página navegable solo arriba o abajo. La web
// regenera: REGENERAR pide una instancia con semilla nueva al servidor.
// Audio: capa de granulación (GrainEngine + SnapToGrains en dos voces que se
// cruzan, igual que el grafo 3D — ver voces.js) modulada por el panel visible:
// el scroll es el modulador.

import { generateSyntheticPixels, OPCIONES_GRANO } from './snapshot.js';
import { cargarCatalogo, usarCatalogo, catalogo, conTermino, materialParaNota } from './corpus.js';
import { Voces } from './voces.js';
import { snapPortada, hayInterludio, snapInterludio, snapContraportada } from './paneles.js';

const RECETA_DEFAULT  = 'primera-caminata';
const SEMILLA_DEFAULT = 9;

// Bajo /comprimidos/<receta>-s<semilla> el visor sirve una edición congelada:
// lee el acta publicada en vez de pedir una caminata nueva, y toma las imágenes
// del pozo congelado en vez de la base viva (que se vacía si se borra la nota).
// Es lo que hace que el enlace impreso en la tesis siga diciendo lo mismo.
const EDICION = (() => {
    const m = window.location.pathname.match(/^\/comprimidos\/([a-z0-9-]+-s\d+)\/?$/i);
    return m ? m[1] : null;
})();

const NOMBRE_PARTE = {
    p1: 'parte I', p2: 'parte II', p3: 'parte III',
    refs: 'referencias', root: 'raíz'
};

// Paletas por Parte sobre papel: mismas tintas que el PDF de render.js,
// índice 0 = tinta plena → 3 = papel (espejo del (3−v)/3 del impreso)
const SNAPSHOT_PALETTES = {
    p1:   [[0,151,178],[85,186,204],[170,220,229],[255,255,255]],
    p2:   [[214,0,127],[228,85,170],[241,170,212],[255,255,255]],
    p3:   [[109,77,224],[158,136,234],[206,196,245],[255,255,255]],
    refs: [[91,99,119],[146,151,164],[200,203,210],[255,255,255]],
    root: [[17,17,17],[96,96,96],[176,176,176],[255,255,255]]
};

const AppState = {
    instancia: null,
    panelActivo: null,
    observer: null,
};

const AudioSystem = {
    initialized:  false,
    grainEnabled: false,
    ctx:   null,
    voces: null,   // dos motores que se cruzan, ver voces.js
};

// ------------------------------------------------- snapshot sintético (port)

const SNAP_W = 80, SNAP_H = 80;


function crearCanvasDither(node, part) {
    const canvas = document.createElement('canvas');
    canvas.className = 'dither';
    canvas.width = SNAP_W;
    canvas.height = SNAP_H;
    const pixels  = generateSyntheticPixels(node, SNAP_W, SNAP_H);
    const palette = SNAPSHOT_PALETTES[part] || SNAPSHOT_PALETTES.root;
    const img  = new ImageData(SNAP_W, SNAP_H);
    for (let i = 0; i < pixels.length; i++) {
        const c = palette[pixels[i]];
        img.data[i * 4]     = c[0];
        img.data[i * 4 + 1] = c[1];
        img.data[i * 4 + 2] = c[2];
        img.data[i * 4 + 3] = 255;
    }
    canvas.getContext('2d').putImageData(img, 0, 0);
    return canvas;
}

// ------------------------------------------------------------ audio (grains)

async function initAudio() {
    if (AudioSystem.initialized) return;
    try {
        AudioSystem.ctx = new (window.AudioContext || window.webkitAudioContext)();

        // Igual que el grafo: el material lo trae el pool cuando se sabe qué panel
        // suena, así que los motores arrancan sin buffer (ver corpus.js). Una edición
        // con el sonido congelado no mira el catálogo vivo: el pool sólo conoce los
        // materiales del acta, servidos desde el pozo de la edición.
        const congelado = sonidoCongelado();
        if (congelado) {
            usarCatalogo({ materiales: Object.entries(congelado.materiales).map(([id, m]) => ({
                ...m, id, url: `/comprimidos/${EDICION}/snd/${m.archivo}`
            })) });
        } else {
            await cargarCatalogo();
        }

        AudioSystem.voces = new Voces(AudioSystem.ctx, {
            smoothingTime:        1.5,
            maxRandomPitch:       0.25,
            pointerTransitionTime: 4.0,
            transitionCurve:      'easeInOut',
            jitter:               0.04,
            ...OPCIONES_GRANO
        });
        AudioSystem.voces.connect(AudioSystem.ctx.destination);

        AudioSystem.initialized = true;
        console.log(congelado
            ? `Audio listo — sonido congelado el ${congelado.congelado}: ${catalogo().length} materiales del acta`
            : `Audio listo — ${catalogo().length} materiales, ${conTermino()} con término declarado`);
    } catch (err) {
        console.error('Error iniciando audio:', err);
    }
}

// El acta de una edición publicada trae el material de cada panel (ver
// publicar.js). Sólo cuenta dentro de la edición: REGENERAR sale al visor vivo.
function sonidoCongelado() {
    return EDICION ? AppState.instancia?.sonido || null : null;
}

// QUÉ suena en este panel: lo que dice el acta si la edición lo congeló; si no,
// la regla viva de corpus.js contra el catálogo de hoy. Las ediciones publicadas
// antes del 2026-09-28 no traen `sonido` y siguen sonando por la regla viva.
function materialDelPanel(node) {
    const congelado = sonidoCongelado();
    if (congelado) return congelado.porPanel[node.id] || null;
    return materialParaNota(node);
}

function activateGrains(node) {
    if (!AudioSystem.initialized || !AudioSystem.grainEnabled) return;

    const pixels   = generateSyntheticPixels(node, SNAP_W, SNAP_H);
    const analysis = AudioSystem.voces.analizar(pixels);
    if (!analysis) return;

    AudioSystem.voces.sonar(analysis, materialDelPanel(node));
}

function deactivateGrains() {
    if (!AudioSystem.initialized) return;
    AudioSystem.voces.apagar();
}

// -------------------------------------------------------------- construcción

function el(tag, className, texto) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (texto !== undefined) e.textContent = texto;
    return e;
}

// Cada panel lleva la identidad de su snapshot (la misma que usa el PDF),
// que alimenta tanto el dither visible como los parámetros de granulación.
function panelConSnap(clase, snapNode, part) {
    const panel = el('section', `panel ${clase}`);
    // El nodo entero queda colgado del elemento, no volcado a data-*. Antes el
    // panel guardaba sólo id/level/childCount y el audio se reconstruía de ahí, así
    // que perdía los `rasgos` que sí le llegaban al dither: desde el 2026-09-21 el
    // mismo panel se dibujaba por el texto y sonaba por su lugar en el árbol. Es la
    // misma clase de deriva que unificó snapshot.js, una capa más abajo — la
    // fórmula era una sola, el sitio donde se llama no.
    panel._snap = snapNode;
    panel.dataset.snapId = snapNode.id;   // sigue aquí para inspeccionar en el DOM
    panel.dataset.part = part;
    return panel;
}

function construirTira(instancia) {
    const { params, narrativa, pasos, fecha } = instancia;
    const tira = document.getElementById('tira');
    tira.innerHTML = '';

    // portada
    const portadaSnap = snapPortada(params);
    const portada = panelConSnap('panel-portada', portadaSnap, 'p2');
    portada.appendChild(el('div', 'eyebrow', 'TRES ESTUDIOS ABIERTOS · ARCHIVO COMPRIMIDO'));
    portada.appendChild(el('h1', null, params.titulo || 'sin título'));
    portada.appendChild(crearCanvasDither(portadaSnap, 'p2'));
    if (narrativa.portada?.length) {
        portada.appendChild(el('div', 'epigrafe', narrativa.portada.join(' ')));
    } else if (instancia.epigrafe) {
        // Portada automática (cue `epigrafe:`): frase, atribución aparte y, si
        // salió por afinidad con la caminata, el término — igual que el PDF.
        const ep = instancia.epigrafe;
        const bloque = el('div', 'epigrafe', ep.texto);
        bloque.appendChild(document.createElement('br'));
        bloque.appendChild(document.createTextNode(ep.atribucion));
        if (ep.termino) {
            bloque.appendChild(document.createElement('br'));
            bloque.appendChild(el('span', 'epigrafe-termino', `por «${ep.termino}»`));
        }
        portada.appendChild(bloque);
    }
    portada.appendChild(el('div', 'epigrafe', `semilla ${params.semilla} · ${fecha}`));
    tira.appendChild(portada);

    // fragmentos
    pasos.forEach((paso, i) => {
        const panel = panelConSnap('panel-fragmento', paso, paso.part);
        // sin número de página: el id de la nota y sus datos relacionales, como
        // en el pliego. La secuencia no jerarquiza.
        const id = el('div', 'noteid', paso.id);
        id.style.color = `var(--${paso.part}, var(--accent))`;
        panel.appendChild(id);
        panel.appendChild(el('h2', null, paso.title));

        const enlaces = paso.grado === 1 ? '1 enlace interno' : `${paso.grado || 0} enlaces internos`;
        panel.appendChild(el('div', 'via',
            `${NOMBRE_PARTE[paso.part] || ''} · ${paso.wc} palabras · ${enlaces}`));

        // Con `afinidad: termino` el paso se justifica por la palabra que comparten
        // las dos notas, y esa palabra se imprime: el criterio de selección es
        // material de la pieza, no un `via` mudo. El recorte se sesga para que el
        // término se vea en los dos paneles, así el lector puede comprobarlo.
        const via = paso.via === 'inicio' ? 'punto de partida'
                  : paso.via === 'salto' ? `salto desde: ${paso.origen}`
                  : paso.via === 'palabra' && paso.termino
                    ? `por «${paso.termino}» desde: ${paso.origen}`
                  : `enlazada desde: ${paso.origen}`;
        panel.appendChild(el('div', 'via', via));

        if (paso.esCodigo && paso.fragHtml) {
            // colorizado en el back con el mismo espejo del overlay 3D
            // (.code-line con sangría francesa + spans tok-*)
            const cont = el('div', 'frag frag-codigo');
            cont.innerHTML = paso.fragHtml;
            panel.appendChild(cont);
        } else if (paso.esCodigo) {
            panel.appendChild(el('pre', 'frag', paso.frag));
        } else {
            panel.appendChild(el('p', 'frag', paso.frag));
        }

        // imágenes reales de la nota, ya separadas a dos tintas y tramadas por el
        // back (`?riso`): en el visor se ve lo que va a salir impreso
        if (paso.imagenes?.length) {
            const cont = el('div', 'imagenes');
            paso.imagenes.forEach(im => {
                const img = document.createElement('img');
                img.src = EDICION
                    ? `/comprimidos/${EDICION}/img/${im.attachmentId}.png`
                    : `/api/comprimidos/attachment/${im.attachmentId}?riso`;
                img.alt = im.nombre;
                img.loading = 'lazy';
                cont.appendChild(img);
                cont.appendChild(el('div', 'pie-img', im.nombre));
            });
            panel.appendChild(cont);
        } else {
            panel.appendChild(crearCanvasDither(paso, paso.part));
        }

        tira.appendChild(panel);

        // interludio sintético cada dos fragmentos (la mezcla: dither entre notas)
        if (hayInterludio(i, pasos.length)) {
            const interSnap = snapInterludio(params, i);
            const inter = panelConSnap('panel-interludio', interSnap, 'p1');
            inter.appendChild(crearCanvasDither(interSnap, 'p1'));
            tira.appendChild(inter);
        }
    });

    // contraportada
    const contraSnap = snapContraportada(params, pasos.length);
    const contra = panelConSnap('panel-contraportada', contraSnap, 'root');
    contra.innerHTML = `
        <div class="fuerte">instancia irrepetible</div>
        <div>semilla ${params.semilla} · ${pasos.length} pasos por los enlaces internos</div>
        <div>la caminata depende del estado del documento: regenerar no repite</div>
        <br>
        <div>las otras salidas de esta tesis —</div>
        <div><a href="/">visualización 3D</a> · <a href="/pdf">PDF</a></div>
    `;
    tira.appendChild(contra);

    // Anclas por panel (deep-link: comprimido.html?...#panel-2)
    tira.querySelectorAll('.panel').forEach((p, i) => { p.id = `panel-${i}`; });

    observarPaneles();
}

// El scroll como modulador: el panel más visible define los granos.
function observarPaneles() {
    if (AppState.observer) AppState.observer.disconnect();
    AppState.observer = new IntersectionObserver(entries => {
        let mejor = null;
        for (const e of entries) {
            if (e.isIntersecting && (!mejor || e.intersectionRatio > mejor.intersectionRatio)) {
                mejor = e;
            }
        }
        if (!mejor) return;
        const panel = mejor.target;
        if (panel === AppState.panelActivo) return;
        AppState.panelActivo = panel;
        activateGrains(panel._snap);
    }, { threshold: [0.4, 0.6] });

    document.querySelectorAll('.panel').forEach(p => AppState.observer.observe(p));
}

// --------------------------------------------------------------- instancias

async function cargarInstancia(receta, semilla) {
    const tira = document.getElementById('tira');
    tira.innerHTML = '<div id="estado">generando instancia…</div>';
    AppState.panelActivo = null;

    const q = semilla != null ? `&semilla=${semilla}` : '';
    const res = EDICION
        ? await fetch(`/comprimidos/${EDICION}/instancia.json`)
        : await fetch(`/api/comprimidos/instancia?receta=${encodeURIComponent(receta)}${q}`);
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        tira.innerHTML = `<div id="estado">error: ${err.error || res.status}</div>`;
        return;
    }
    const instancia = await res.json();
    AppState.instancia = instancia;

    document.getElementById('inp-semilla').value = instancia.params.semilla;
    if (!EDICION) {
        const url = new URL(window.location);
        url.searchParams.set('receta', receta);
        url.searchParams.set('semilla', instancia.params.semilla);
        history.replaceState(null, '', url);
    }

    construirTira(instancia);
    if (window.location.hash) {
        document.querySelector(window.location.hash)?.scrollIntoView();
    } else {
        window.scrollTo({ top: 0 });
    }
}

async function cargarRecetas() {
    const sel = document.getElementById('sel-receta');
    const res = await fetch('/api/comprimidos/recetas');
    const { recetas } = await res.json();
    sel.innerHTML = '';
    for (const r of recetas) {
        const opt = document.createElement('option');
        opt.value = r.archivo;
        opt.textContent = r.titulo || r.archivo;
        sel.appendChild(opt);
    }
    return recetas;
}

// ------------------------------------------------------ receta de visitante
//
// Los controles escriben una receta en el mismo formato que las del autor
// (cues `clave: valor` + `## Portada`); el texto se muestra, no se edita
// (decisión del autor 2026-09-28), y es lo que se manda. El servidor la pasa por
// el mismo traductor. Nada se publica ni se guarda: VER la muestra en la tira,
// DESCARGAR PDF la imprime.

const Receta = {
    notas: [],           // arranques posibles, de /api/comprimidos/notas
};

const $ = id => document.getElementById(id);
const valorRadio = nombre => document.querySelector(`input[name="${nombre}"]:checked`)?.value;

async function cargarNotasDeArranque() {
    const res = await fetch('/api/comprimidos/notas');
    const { notas } = await res.json();
    Receta.notas = notas;
    const sel = $('r-desde');
    sel.innerHTML = '';
    // Agrupadas por Parte, con la ruta en el árbol: hay cuatro «Léeme».
    const grupos = new Map();
    for (const n of notas) {
        const parte = n.ruta[0] || 'Tres Estudios Abiertos';
        if (!grupos.has(parte)) grupos.set(parte, []);
        grupos.get(parte).push(n);
    }
    for (const [parte, lista] of grupos) {
        const og = document.createElement('optgroup');
        og.label = parte;
        for (const n of lista) {
            const opt = document.createElement('option');
            opt.value = n.id;
            const camino = n.ruta.slice(1).concat(n.title).join(' › ');
            opt.textContent = `${camino} (${n.wc}w${n.esCodigo ? ', código' : ''})`;
            og.appendChild(opt);
        }
        sel.appendChild(og);
    }
    const inicial = notas.find(n => n.title === 'Aprendizaje de Máquinas');
    if (inicial) sel.value = inicial.id;
}

function recetaDesdeControles() {
    const titulo  = $('r-titulo').value.trim() || 'Mi caminata';
    const desde   = $('r-desde').value;
    const nota    = Receta.notas.find(n => n.id === desde);
    const epigrafe = valorRadio('r-epigrafe');
    const cobertura = [...document.querySelectorAll('input[name="r-cobertura"]:checked')].map(c => c.value);
    const semilla = $('r-semilla').value.trim();

    const lineas = [
        `# Receta: ${titulo}`,
        '',
        `formato: ${$('r-formato').value}`,
        `desde: ${desde}`,
        `pasos: ${$('r-pasos').value}`,
        `recorte: ${$('r-recorte').value}`,
        `afinidad: ${valorRadio('r-afinidad')}`,
        `codigo: ${valorRadio('r-codigo')}`,
    ];
    if (cobertura.length) lineas.push(`cobertura: ${cobertura.join(', ')}`);
    if (semilla) lineas.push(`semilla: ${semilla}`);
    if (epigrafe === 'anti') lineas.push('epigrafe: anti');
    if (nota) lineas.push('', `(arranca en ${nota.ruta.concat(nota.title).join(' › ')})`);
    const propio = $('r-portada').value.trim();
    if (epigrafe === 'propio' && propio) lineas.push('', '## Portada', '', propio);
    return lineas.join('\n') + '\n';
}

function actualizarTexto() {
    $('r-portada').hidden = valorRadio('r-epigrafe') !== 'propio';
    $('r-texto').value = recetaDesdeControles();
}

function estadoReceta(html, error = false) {
    const e = $('r-estado');
    e.innerHTML = html;
    e.classList.toggle('error', error);
}

function ocupado(si) {
    $('r-ver').disabled = si;
    $('r-pdf').disabled = si;
}

// La semilla que se manda: la del campo si hay; si no, el servidor sortea y la
// devuelve, y se escribe en el campo para que el PDF repita la vista previa.
function cuerpoReceta() {
    const s = parseInt($('r-semilla').value, 10);
    return JSON.stringify({ receta: $('r-texto').value, semilla: Number.isFinite(s) ? s : undefined });
}

async function errorDe(res) {
    const err = await res.json().catch(() => ({}));
    return err.error || `error ${res.status}`;
}

async function verReceta() {
    ocupado(true);
    estadoReceta('generando la caminata<span class="puntos"></span>');
    try {
        const res = await fetch('/api/comprimidos/receta/instancia', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: cuerpoReceta()
        });
        if (!res.ok) return estadoReceta(await errorDe(res), true);
        const instancia = await res.json();
        AppState.instancia = instancia;
        AppState.panelActivo = null;
        $('r-semilla').value = instancia.params.semilla;
        actualizarTexto();
        construirTira(instancia);
        window.scrollTo({ top: 0 });
        estadoReceta(`semilla ${instancia.params.semilla} · ${instancia.pasos.length} pasos`);
    } catch (err) {
        estadoReceta('no se pudo conectar con el servidor', true);
    } finally {
        ocupado(false);
    }
}

async function descargarReceta() {
    ocupado(true);
    // Con imágenes, la separación a dos tintas tarda unos segundos.
    estadoReceta('imprimiendo el cuadernillo — puede tardar unos segundos<span class="puntos"></span>');
    try {
        const res = await fetch('/api/comprimidos/receta/pdf', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: cuerpoReceta()
        });
        if (!res.ok) return estadoReceta(await errorDe(res), true);
        const blob = await res.blob();
        const nombre = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'cuadernillo.pdf';
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = nombre;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        estadoReceta(`listo: ${nombre}`);
    } catch (err) {
        estadoReceta('no se pudo conectar con el servidor', true);
    } finally {
        ocupado(false);
    }
}

async function abrirReceta() {
    const panel = $('receta');
    panel.style.top = `${$('barra').offsetHeight}px`;
    panel.hidden = false;
    $('btn-receta').classList.add('activo');
    if (!Receta.notas.length) {
        try {
            await cargarNotasDeArranque();
        } catch {
            return estadoReceta('no se pudo cargar la lista de notas', true);
        }
        actualizarTexto();
    }
}

function cerrarReceta() {
    $('receta').hidden = true;
    $('btn-receta').classList.remove('activo');
}

function prepararReceta() {
    $('btn-receta').addEventListener('click', () => {
        // Dentro de una edición congelada, la receta propia vive en el visor vivo:
        // la edición es el archivo y no se sobrescribe en sitio.
        if (EDICION) { window.location.href = '/comprimido.html?escribir'; return; }
        if ($('receta').hidden) abrirReceta(); else cerrarReceta();
    });
    $('receta-cerrar').addEventListener('click', cerrarReceta);

    const controles = document.querySelectorAll('#receta input:not(#r-semilla), #receta select, #r-portada');
    controles.forEach(c => c.addEventListener('input', actualizarTexto));
    controles.forEach(c => c.addEventListener('change', actualizarTexto));
    $('r-semilla').addEventListener('input', actualizarTexto);

    $('r-ver').addEventListener('click', verReceta);
    $('r-pdf').addEventListener('click', descargarReceta);
}

// --------------------------------------------------------------------- init

async function init() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('flat')) document.body.classList.add('flat');
    const receta  = urlParams.get('receta') || RECETA_DEFAULT;
    // Sin `semilla` se usa el default (la instancia de referencia). Con
    // `semilla=nueva` se pide una sorteada por el servidor — es lo que manda
    // REGENERAR desde una edición congelada, donde "sin semilla" no basta
    // porque el default volvería a fijarla.
    const semillaParam = urlParams.get('semilla');
    const semilla = semillaParam === null ? SEMILLA_DEFAULT
                  : semillaParam === 'nueva' ? null
                  : parseInt(semillaParam, 10);

    await cargarRecetas();
    const sel = document.getElementById('sel-receta');
    if ([...sel.options].some(o => o.value === receta)) sel.value = receta;

    // En una edición congelada los controles no re-sortean en sitio: llevan al
    // visor vivo. La edición es el archivo (citable); /comprimido.html es la
    // máquina (explorable). El salto entre los dos es explícito y va en la URL.
    const irAVivo = (receta, semilla) => {
        const q = new URLSearchParams({ receta, semilla: semilla != null ? String(semilla) : 'nueva' });
        window.location.href = `/comprimido.html?${q}`;
    };

    document.getElementById('btn-render').addEventListener('click', () => {
        const s = parseInt(document.getElementById('inp-semilla').value, 10);
        const semilla = Number.isNaN(s) ? null : s;
        if (EDICION) irAVivo(sel.value, semilla);
        else cargarInstancia(sel.value, semilla);
    });

    document.getElementById('btn-regenerar').addEventListener('click', () => {
        if (EDICION) irAVivo(sel.value, null);
        else cargarInstancia(sel.value, null);   // el servidor elige semilla nueva
    });

    sel.addEventListener('change', () => {
        if (EDICION) irAVivo(sel.value, null);
        else cargarInstancia(sel.value, null);
    });

    const btnAudio = document.getElementById('btn-audio');
    btnAudio.addEventListener('click', async () => {
        await initAudio();   // el click satisface la restricción del navegador
        AudioSystem.grainEnabled = !AudioSystem.grainEnabled;
        btnAudio.textContent = `AUD: ${AudioSystem.grainEnabled ? 'ON' : 'OFF'}`;
        btnAudio.classList.toggle('activo', AudioSystem.grainEnabled);
        if (AudioSystem.grainEnabled && AppState.panelActivo) {
            activateGrains(AppState.panelActivo._snap);
        } else if (!AudioSystem.grainEnabled) {
            deactivateGrains();
        }
    });

    prepararReceta();
    if (urlParams.has('escribir')) abrirReceta();

    await cargarInstancia(sel.value, semilla);

    // Ya con el acta cargada, el selector refleja la receta de la edición.
    if (EDICION && AppState.instancia) {
        const r = AppState.instancia.params.receta;
        if (r && [...sel.options].some(o => o.value === r)) sel.value = r;
    }
}

init();
