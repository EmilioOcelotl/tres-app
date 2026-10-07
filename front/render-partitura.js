// render-partitura.js — de la partitura al audio, fuera de tiempo real.
//
// La partitura (partitura.js) se vuelve a tocar con el mismo instrumento del
// visor —voces.js: dos voces granulares que se cruzan— en un OfflineAudioContext.
// Ahí el reloj de audio no avanza con la pared, así que nada puede despertarse
// solo: los motores corren con reloj externo (treslib ≥1.12.0, `tick(t)`) y los
// fines de bajada de voces.js van a una cola en tiempo virtual. El render se
// suspende en una cuadrícula fija y en cada parada dispara los eventos que ya
// tocan, corre la cola y avanza motores y punteros.
//
// El resultado no es una copia de lo que se oyó: el grano tiene azar. Con la
// semilla de la partitura el render es reproducible (misma partitura → mismo
// archivo); es otra interpretación de las mismas decisiones.
//
// Salida en mp3 mono a 128 kbps y 44.1 kHz (decisión del autor 2026-10-07,
// ~9.6 MB por 10 min). Primero fue 32 kbps a 22.05 kHz, lo más ligero posible,
// pero el corpus ya es oscuro y esa tasa cortaba arriba de 11 kHz (el mp3,
// arriba de ~8). Y normalizado a −16 LUFS con limitador (masterizar).

import { Voces } from './voces.js';
import { mapearTiempos } from './partitura.js';

const TASA     = 44100;   // Hz — render y mp3
const KBPS     = 128;
const OBJETIVO_LUFS = -16; // decisión del autor 2026-10-07
const TECHO_DB = -1;       // dBFS de muestra; deja lugar al sobretiro del mp3
// El mp3 a 128 kbps sale ~0.4 LU por debajo del WAV que se le da (medido con
// ffmpeg ebur128 sobre cuatro renders, 0.3–0.5): se apunta ese tanto arriba.
const COMPENSACION_MP3 = 0.4;
const COLA     = 1.5;     // s después del fin: lo que tarda en irse la última voz
const CUANTO   = 128;     // muestras por bloque de render; suspend() redondea a esto
const LAMEJS   = 'https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js';

// mulberry32: azar sembrado para el grano y el puntero.
function azarSembrado(semilla) {
    let a = semilla >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Cola de tiempo virtual con la forma que voces.js espera de un reloj.
function relojVirtual() {
    let ahora = 0, sig = 1;
    const pendientes = new Map();
    return {
        despues(seg, fn) {
            const id = sig++;
            pendientes.set(id, { t: ahora + seg, fn });
            return id;
        },
        cancelar(id) {
            if (id != null) pendientes.delete(id);
        },
        // Corre lo vencido hasta `t`, en orden de vencimiento.
        avanzar(t) {
            ahora = t;
            for (;;) {
                let prox = null;
                for (const [id, p] of pendientes) {
                    if (p.t <= t && (!prox || p.t < prox[1].t)) prox = [id, p];
                }
                if (!prox) return;
                pendientes.delete(prox[0]);
                prox[1].fn();
            }
        }
    };
}

// voces.sonar resuelve material y voz libre con promesas encadenadas: hay que
// dejar correr esas microtareas antes de seguir rindiendo.
async function vaciarMicrotareas() {
    for (let i = 0; i < 8; i++) await null;
}

async function cargarMateriales(ctx, materiales, alAvanzar) {
    const ids = Object.keys(materiales);
    const buffers = new Map();
    let n = 0;
    await Promise.all(ids.map(async id => {
        try {
            const res = await fetch(materiales[id]);
            if (!res.ok) throw new Error(`${materiales[id]}: ${res.status}`);
            buffers.set(id, await ctx.decodeAudioData(await res.arrayBuffer()));
        } catch (err) {
            console.warn('[render] no se pudo cargar', id, err);
        }
        alAvanzar?.('materiales', ++n / ids.length);
    }));
    return buffers;
}

// Devuelve el AudioBuffer renderizado. `opcionesSnap` son las mismas que usa
// el visor en vivo, para que el instrumento sea el mismo.
export async function renderizarPartitura(partitura, opcionesSnap, alAvanzar) {
    const { duracion, eventos } = mapearTiempos(partitura);
    const largo = Math.ceil((duracion + COLA) * TASA);
    const ctx = new OfflineAudioContext(1, largo, TASA);

    const buffers = await cargarMateriales(ctx, partitura.materiales, alAvanzar);

    const reloj = relojVirtual();
    const voces = new Voces(ctx, opcionesSnap, {
        reloj,
        cargar: (_ctx, id) => Promise.resolve(buffers.get(id) || null),
        fijar: () => {},
        relojExterno: true,
        ...(partitura.semilla ? { random: azarSembrado(partitura.semilla) } : {})
    });
    voces.connect(ctx.destination);

    // Una parada cada ~1/60 s alineada a bloques de render (suspend redondea
    // al bloque, y dos paradas en el mismo bloque fallan). Sirve al motor (su
    // look-ahead es de 0.1 s) y al puntero (que avanza por tiempo, no por paso).
    const paso = Math.max(1, Math.round(TASA / 60 / CUANTO)) * CUANTO / TASA;
    const total = Math.floor(largo / (paso * TASA)) - 1;
    let i = 0, k = 0;

    const parada = async () => {
        const t = k * paso;
        while (i < eventos.length && eventos[i].t <= t) {
            const e = eventos[i++];
            if (e.tipo === 'sonar') voces.sonar(e.analisis, e.material);
            else if (e.tipo === 'apagar' || e.tipo === 'fin') voces.apagar();
        }
        await vaciarMicrotareas();
        reloj.avanzar(t);
        await vaciarMicrotareas();
        voces.tick(t);

        if (k % 600 === 0) alAvanzar?.('render', k / total);
        if (++k <= total) ctx.suspend(k * paso).then(parada);
        ctx.resume();
    };

    ctx.suspend(0).then(parada);
    const audio = await ctx.startRendering();
    alAvanzar?.('render', 1);
    return audio;
}

// ------------------------------------------------------------- masterizado
//
// Sonoridad integrada según ITU-R BS.1770 (la misma medida de catalogo.json y
// de ffmpeg ebur128): ponderación K —estante de +4 dB arriba de ~1.7 kHz y
// pasaaltos en 38 Hz—, bloques de 400 ms cada 100 ms, compuerta absoluta en
// −70 LUFS y relativa 10 LU por debajo. Mono: peso 1.

function biquad(x, [b0, b1, b2, a0, a1, a2]) {
    const y = new Float32Array(x.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
    for (let i = 0; i < x.length; i++) {
        const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
    }
    return y;
}

function ponderacionK(x, fs) {
    // Estante (coeficientes de la norma, recalculados para cualquier fs).
    let w = 2 * Math.PI * 1681.9744509555319 / fs, A = Math.pow(10, 3.99984385397 / 40);
    let al = Math.sin(w) / (2 * 0.7071752369554193), c = Math.cos(w), sA = 2 * Math.sqrt(A) * al;
    const estante = [A * ((A + 1) + (A - 1) * c + sA), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - sA),
                     (A + 1) - (A - 1) * c + sA, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - sA];
    w = 2 * Math.PI * 38.13547087613982 / fs; al = Math.sin(w) / (2 * 0.5003270373253953); c = Math.cos(w);
    const pasaaltos = [(1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + al, -2 * c, 1 - al];
    return biquad(biquad(x, estante), pasaaltos);
}

export function medirLufs(x, fs) {
    const k = ponderacionK(x, fs);
    const largo = Math.round(0.4 * fs), salto = Math.round(0.1 * fs);
    const z = [];
    for (let i = 0; i + largo <= k.length; i += salto) {
        let s = 0;
        for (let j = i; j < i + largo; j++) s += k[j] * k[j];
        z.push(s / largo);
    }
    const lufs = v => -0.691 + 10 * Math.log10(v);
    const media = a => a.reduce((p, q) => p + q, 0) / a.length;
    const abs = z.filter(v => lufs(v) > -70);
    if (!abs.length) return -Infinity;
    const umbral = lufs(media(abs)) - 10;
    const rel = abs.filter(v => lufs(v) > umbral);
    return lufs(media(rel));
}

// Limitador con anticipación: nunca deja pasar una muestra sobre el techo. La
// ganancia mínima necesaria se busca 5 ms adelante y se promedia sobre esa
// misma ventana (el ataque llega antes que el pico, sin clic); suelta en ~150 ms.
// Devuelve cuánto bajó en el peor momento, en dB.
function limitar(x, fs, techo) {
    const L = Math.max(1, Math.round(0.005 * fs));
    const n = x.length;
    const req = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const a = Math.abs(x[i]);
        req[i] = a > techo ? techo / a : 1;
    }
    // mínimo en [i, i+L] con una cola monótona
    const m = new Float32Array(n);
    const cola = new Int32Array(n + L + 1);
    let ini = 0, fin = 0, j = 0;
    for (let i = 0; i < n; i++) {
        while (j < n && j <= i + L) {
            while (fin > ini && req[cola[fin - 1]] >= req[j]) fin--;
            cola[fin++] = j++;
        }
        while (cola[ini] < i) ini++;
        m[i] = req[cola[ini]];
    }
    const suelta = 1 - Math.exp(-1 / (0.15 * fs));
    // promedio de m sobre [i−L+1, i]; antes del principio cuenta como 1
    let suma = L, g = 1, peor = 1;
    for (let i = 0; i < n; i++) {
        suma += m[i] - (i >= L ? m[i - L] : 1);
        const prom = suma / L;
        g = prom < g ? prom : g + (prom - g) * suelta;
        // En los primeros 5 ms la ventana todavía no anticipa: ahí recorta.
        x[i] = Math.max(-techo, Math.min(techo, x[i] * g));
        if (g < peor) peor = g;
    }
    return 20 * Math.log10(peor);
}

// Lleva el render a OBJETIVO_LUFS con una ganancia constante y limita los picos
// al techo. Como el limitador le quita algo de sonoridad, se corrige una vez.
// Modifica el buffer y devuelve los números, que van a la partitura (como la
// ficha de cada material en catalogo.json: un número por archivo, a la vista).
export function masterizar(audio) {
    const x = audio.getChannelData(0), fs = audio.sampleRate;
    const antes = medirLufs(x, fs);
    if (!isFinite(antes)) return { objetivo_lufs: OBJETIVO_LUFS, lufs_render: null, ganancia_db: 0, limitado_db: 0 };
    const objetivo = OBJETIVO_LUFS + COMPENSACION_MP3;
    const original = Float32Array.from(x);
    let ganancia = objetivo - antes, aplicada = ganancia, limitado = 0, despues = antes;
    for (let vuelta = 0; vuelta < 2; vuelta++) {
        aplicada = ganancia;
        const g = Math.pow(10, aplicada / 20);
        for (let i = 0; i < x.length; i++) x[i] = original[i] * g;
        limitado = limitar(x, fs, Math.pow(10, TECHO_DB / 20));
        despues = medirLufs(x, fs);
        ganancia += objetivo - despues;
    }
    const r = v => Math.round(v * 10) / 10;
    // lufs_wav: lo que entra al codificador; el mp3 queda ~COMPENSACION_MP3 abajo.
    return { objetivo_lufs: OBJETIVO_LUFS, lufs_render: r(antes), ganancia_db: r(aplicada),
             limitado_db: r(limitado), techo_db: TECHO_DB, lufs_wav: r(despues) };
}

function cargarLame() {
    if (window.lamejs) return Promise.resolve(window.lamejs);
    return new Promise((ok, falla) => {
        const s = document.createElement('script');
        s.src = LAMEJS;
        s.onload = () => ok(window.lamejs);
        s.onerror = () => falla(new Error('no se pudo cargar el codificador mp3'));
        document.head.appendChild(s);
    });
}

// AudioBuffer mono → Blob mp3. Codifica por tandas y suelta el hilo entre una
// y otra para que la barra de progreso se mueva.
export async function codificarMp3(audio, alAvanzar) {
    const lamejs = await cargarLame();
    const enc = new lamejs.Mp3Encoder(1, audio.sampleRate, KBPS);
    const datos = audio.getChannelData(0);
    const TANDA = 1152 * 64;
    const partes = [];
    const pcm = new Int16Array(TANDA);
    for (let ini = 0; ini < datos.length; ini += TANDA) {
        const n = Math.min(TANDA, datos.length - ini);
        for (let j = 0; j < n; j++) {
            // Ya masterizado: el recorte es sólo una red.
            const v = Math.max(-1, Math.min(1, datos[ini + j]));
            pcm[j] = v < 0 ? v * 0x8000 : v * 0x7FFF;
        }
        const mp3 = enc.encodeBuffer(n === TANDA ? pcm : pcm.subarray(0, n));
        if (mp3.length) partes.push(new Uint8Array(mp3));
        alAvanzar?.('mp3', (ini + n) / datos.length);
        await new Promise(r => setTimeout(r, 0));
    }
    const cola = enc.flush();
    if (cola.length) partes.push(new Uint8Array(cola));
    return new Blob(partes, { type: 'audio/mpeg' });
}
