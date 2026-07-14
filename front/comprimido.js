// comprimido.js — visor web de archivos comprimidos (Parte III).
// La otra cara del cuadernillo impreso: la misma instancia (receta + semilla
// + estado de la BD) como página navegable solo arriba o abajo. La web
// regenera: REGENERAR pide una instancia con semilla nueva al servidor.
// Audio: capa de granulación (GrainEngine + SnapToGrains, igual que el grafo
// 3D) modulada por el panel visible — el scroll es el modulador.

import { GrainEngine }  from 'treslib/GrainEngine';
import { SnapToGrains } from 'treslib/SnapToGrains';

const RECETA_DEFAULT  = 'iteracion-zine';
const SEMILLA_DEFAULT = 12;

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
    grainActive:  false,
    ctx: null, buffer: null, grainEngine: null, snapToGrains: null,
    masterGain: null, crossfadeTimer: null,
};

// ------------------------------------------------- snapshot sintético (port)

const SNAP_W = 80, SNAP_H = 80;

function hashString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h;
}

function seededRandom(seed) {
    let s = seed >>> 0;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

function generateSyntheticPixels(node) {
    const seed       = hashString(node.id);
    const rng        = seededRandom(seed);
    const level      = node.level || 0;
    const childCount = node.childCount || 0;

    const brightness  = Math.max(0.05, 0.88 - level * 0.1);
    const contrastAmt = Math.min(0.75, 0.08 + childCount * 0.06);
    const complexity  = Math.min(0.7,  level * 0.08 + childCount * 0.03);

    const phaseX = ((seed & 0x3FF) / 0x3FF) * Math.PI * 2;
    const phaseY = (((seed >>> 10) & 0x3FF) / 0x3FF) * Math.PI * 2;

    const M = [[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]];
    const pixels = new Uint8Array(SNAP_W * SNAP_H);

    for (let y = 0; y < SNAP_H; y++) {
        for (let x = 0; x < SNAP_W; x++) {
            let v = brightness;
            v += (rng() - 0.5) * contrastAmt;
            v += Math.sin(x * complexity * 0.4 + phaseX) * complexity * 0.22;
            v += Math.cos(y * complexity * 0.3 + phaseY) * complexity * 0.18;
            const t = M[y % 4][x % 4] / 15;
            v += (t - 0.5) * 0.3;
            pixels[y * SNAP_W + x] = Math.max(0, Math.min(3, Math.round(v * 3)));
        }
    }
    return pixels;
}

function crearCanvasDither(node, part) {
    const canvas = document.createElement('canvas');
    canvas.className = 'dither';
    canvas.width = SNAP_W;
    canvas.height = SNAP_H;
    const pixels  = generateSyntheticPixels(node);
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

        const res = await fetch('/assets/snd/oci3.mp3');
        const raw = await res.arrayBuffer();
        AudioSystem.buffer = await AudioSystem.ctx.decodeAudioData(raw);

        AudioSystem.grainEngine = new GrainEngine(AudioSystem.ctx, AudioSystem.buffer, {
            masterAmp:  0.7,
            overlaps:   6,
            windowSize: 0.12
        });
        AudioSystem.masterGain = AudioSystem.ctx.createGain();
        AudioSystem.masterGain.gain.setValueAtTime(0, AudioSystem.ctx.currentTime);
        AudioSystem.grainEngine.connect(AudioSystem.masterGain);
        AudioSystem.masterGain.connect(AudioSystem.ctx.destination);

        AudioSystem.snapToGrains = new SnapToGrains(AudioSystem.ctx, AudioSystem.grainEngine, {
            smoothingTime:        1.5,
            maxRandomPitch:       0.25,
            pointerTransitionTime: 4.0,
            transitionCurve:      'easeInOut',
            jitter:               0.04
        });

        AudioSystem.initialized = true;
        console.log('Audio listo —', AudioSystem.buffer.duration.toFixed(1), 's');
    } catch (err) {
        console.error('Error iniciando audio:', err);
    }
}

function applyGrainParams(stg, analysis) {
    stg.currentSnapshot = analysis;
    const params = stg.mapSnapshotToAudioParams(analysis);
    stg.generatePointerSequence(analysis);
    stg.applyToGrainEngine(params);
}

function activateGrains(node) {
    if (!AudioSystem.initialized || !AudioSystem.grainEnabled) return;

    const stg  = AudioSystem.snapToGrains;
    const gain = AudioSystem.masterGain.gain;
    const ctx  = AudioSystem.ctx;

    const pixels   = generateSyntheticPixels(node);
    const analysis = stg.analyzePixelData(pixels);
    if (!analysis) return;

    clearTimeout(AudioSystem.crossfadeTimer);

    if (AudioSystem.grainActive) {
        // Crossfade: dip → swap → rise (mismo patrón que el grafo 3D)
        const now = ctx.currentTime;
        gain.cancelScheduledValues(now);
        gain.setValueAtTime(gain.value, now);
        gain.linearRampToValueAtTime(0, now + 0.4);

        AudioSystem.crossfadeTimer = setTimeout(() => {
            stg.stop();
            applyGrainParams(stg, analysis);
            stg.start();
            const t = ctx.currentTime;
            gain.cancelScheduledValues(t);
            gain.setValueAtTime(0, t);
            gain.linearRampToValueAtTime(1, t + 1.2);
        }, 420);
    } else {
        stg.stop();
        applyGrainParams(stg, analysis);
        stg.start();
        AudioSystem.grainActive = true;
        const now = ctx.currentTime;
        gain.cancelScheduledValues(now);
        gain.setValueAtTime(0, now);
        gain.linearRampToValueAtTime(1, now + 1.5);
    }
}

function deactivateGrains() {
    if (!AudioSystem.initialized || !AudioSystem.masterGain) return;
    clearTimeout(AudioSystem.crossfadeTimer);

    const gain = AudioSystem.masterGain.gain;
    const now  = AudioSystem.ctx.currentTime;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(0, now + 1.0);

    AudioSystem.crossfadeTimer = setTimeout(() => {
        AudioSystem.snapToGrains?.stop();
        AudioSystem.grainActive = false;
    }, 1100);
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
    panel.dataset.snapId = snapNode.id;
    panel.dataset.snapLevel = snapNode.level;
    panel.dataset.snapChildren = snapNode.childCount;
    panel.dataset.part = part;
    return panel;
}

function construirTira(instancia) {
    const { params, narrativa, pasos, fecha } = instancia;
    const tira = document.getElementById('tira');
    tira.innerHTML = '';

    // portada
    const portadaSnap = { id: `portada-${params.semilla}`, level: 1, childCount: params.pasos };
    const portada = panelConSnap('panel-portada', portadaSnap, 'p2');
    portada.appendChild(el('div', 'eyebrow', 'TRES ESTUDIOS ABIERTOS · ARCHIVO COMPRIMIDO'));
    portada.appendChild(el('h1', null, params.titulo || 'sin título'));
    portada.appendChild(crearCanvasDither(portadaSnap, 'p2'));
    if (narrativa.portada?.length) {
        portada.appendChild(el('div', 'epigrafe', narrativa.portada.join(' ')));
    }
    portada.appendChild(el('div', 'epigrafe', `semilla ${params.semilla} · ${fecha}`));
    tira.appendChild(portada);

    // fragmentos
    pasos.forEach((paso, i) => {
        const panel = panelConSnap('panel-fragmento', paso, paso.part);
        const num = el('div', 'num', String(i + 1).padStart(2, '0'));
        num.style.color = `var(--${paso.part}, var(--accent))`;
        panel.appendChild(num);
        panel.appendChild(el('h2', null, paso.title));

        const via = paso.via === 'inicio' ? 'punto de partida'
                  : paso.via === 'salto' ? `salto desde: ${paso.origen}`
                  : `enlazada desde: ${paso.origen}`;
        panel.appendChild(el('div', 'via', via));

        if (paso.esCodigo) {
            panel.appendChild(el('pre', 'frag', paso.frag));
        } else {
            panel.appendChild(el('p', 'frag', paso.frag));
        }

        // imágenes reales de la nota, intercaladas con el dither sintético
        if (paso.imagenes?.length) {
            const cont = el('div', 'imagenes');
            paso.imagenes.forEach(im => {
                const img = document.createElement('img');
                img.src = `/api/comprimidos/attachment/${im.attachmentId}`;
                img.alt = im.nombre;
                img.loading = 'lazy';
                cont.appendChild(img);
                cont.appendChild(el('div', 'pie-img', im.nombre));
            });
            panel.appendChild(cont);
        } else {
            panel.appendChild(crearCanvasDither(paso, paso.part));
        }

        panel.appendChild(el('div', 'pie', `${paso.wc} palabras en la nota`));
        tira.appendChild(panel);

        // interludio sintético cada dos fragmentos (la mezcla: dither entre notas)
        if (i % 2 === 1 && i < pasos.length - 1) {
            const interSnap = { id: `interludio-${params.semilla}-${i}`, level: 2, childCount: 3 };
            const inter = panelConSnap('panel-interludio', interSnap, 'p1');
            inter.appendChild(crearCanvasDither(interSnap, 'p1'));
            tira.appendChild(inter);
        }
    });

    // contraportada
    const contraSnap = { id: `reverso-${params.semilla}`, level: 1, childCount: pasos.length };
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
        activateGrains({
            id: panel.dataset.snapId,
            level: parseInt(panel.dataset.snapLevel, 10),
            childCount: parseInt(panel.dataset.snapChildren, 10),
        });
    }, { threshold: [0.4, 0.6] });

    document.querySelectorAll('.panel').forEach(p => AppState.observer.observe(p));
}

// --------------------------------------------------------------- instancias

async function cargarInstancia(receta, semilla) {
    const tira = document.getElementById('tira');
    tira.innerHTML = '<div id="estado">generando instancia…</div>';
    AppState.panelActivo = null;

    const q = semilla != null ? `&semilla=${semilla}` : '';
    const res = await fetch(`/api/comprimidos/instancia?receta=${encodeURIComponent(receta)}${q}`);
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        tira.innerHTML = `<div id="estado">error: ${err.error || res.status}</div>`;
        return;
    }
    const instancia = await res.json();
    AppState.instancia = instancia;

    document.getElementById('inp-semilla').value = instancia.params.semilla;
    const url = new URL(window.location);
    url.searchParams.set('receta', receta);
    url.searchParams.set('semilla', instancia.params.semilla);
    history.replaceState(null, '', url);

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

// --------------------------------------------------------------------- init

async function init() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('flat')) document.body.classList.add('flat');
    const receta  = urlParams.get('receta') || RECETA_DEFAULT;
    const semilla = urlParams.get('semilla') !== null
        ? parseInt(urlParams.get('semilla'), 10)
        : SEMILLA_DEFAULT;

    await cargarRecetas();
    const sel = document.getElementById('sel-receta');
    if ([...sel.options].some(o => o.value === receta)) sel.value = receta;

    document.getElementById('btn-render').addEventListener('click', () => {
        const s = parseInt(document.getElementById('inp-semilla').value, 10);
        cargarInstancia(sel.value, Number.isNaN(s) ? null : s);
    });

    document.getElementById('btn-regenerar').addEventListener('click', () => {
        cargarInstancia(sel.value, null);   // el servidor elige semilla nueva
    });

    sel.addEventListener('change', () => cargarInstancia(sel.value, null));

    const btnAudio = document.getElementById('btn-audio');
    btnAudio.addEventListener('click', async () => {
        await initAudio();   // el click satisface la restricción del navegador
        AudioSystem.grainEnabled = !AudioSystem.grainEnabled;
        btnAudio.textContent = `AUD: ${AudioSystem.grainEnabled ? 'ON' : 'OFF'}`;
        btnAudio.classList.toggle('activo', AudioSystem.grainEnabled);
        if (AudioSystem.grainEnabled && AppState.panelActivo) {
            const p = AppState.panelActivo;
            activateGrains({
                id: p.dataset.snapId,
                level: parseInt(p.dataset.snapLevel, 10),
                childCount: parseInt(p.dataset.snapChildren, 10),
            });
        } else if (!AudioSystem.grainEnabled) {
            deactivateGrains();
        }
    });

    await cargarInstancia(sel.value, semilla);
}

init();
