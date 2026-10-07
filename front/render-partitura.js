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
// Salida en mp3, lo más ligero posible (decisión del autor 2026-10-07): mono,
// 22.05 kHz, 32 kbps — ~2.3 MB por 10 min. El render corre ya a 22.05 kHz, así
// que los materiales se decodifican a esa tasa (~4 MB cada uno en vez de 8).

import { Voces } from './voces.js';
import { mapearTiempos } from './partitura.js';

const TASA     = 22050;   // Hz — render y mp3
const KBPS     = 32;
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
            // Sin limitador, como en vivo: lo que pasa de ±1 se recorta.
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
