// voces.js — dos voces granulares que se cruzan.
//
// Hasta el 2026-09-29 había un solo motor: al cambiar de nota el gain bajaba a 0
// (0.4 s), en silencio se cambiaban material y parámetros, y volvía a subir
// (1.2 s). Se oía un fade-out y un fade-in, nunca las dos notas juntas. Ahora cada
// voz tiene su GrainEngine, su SnapToGrains y su gain, y al cambiar de nota la
// que suena se va mientras la otra entra con el material, los parámetros y la
// secuencia de puntero de la nota nueva: durante el cruce suenan las dos notas
// enteras, cada una con su *cómo* y su *qué*. No toca treslib: son dos
// instancias de lo que ya había.
//
// Vive en front/ y lo importan el grafo (main.js) y el visor (comprimido.js), por
// la misma razón que snapshot.js y corpus.js: los dos tienen que sonar igual, y
// dos copias derivan.
//
// Decisiones del autor (2026-09-29): el cruce dura 4 s y aplica a los dos lados.
// Si llega otra nota a media mezcla, la voz que se estaba yendo se corta rápido
// (0.15 s) y se usa para la nueva, y la que estaba entrando empieza a irse desde
// el volumen que tenga.

import { GrainEngine }  from 'treslib/GrainEngine';
import { SnapToGrains } from 'treslib/SnapToGrains';
import { obtenerBuffer, fijar } from './corpus.js';

const CRUCE   = 4.0;    // s — lo que dura la mezcla entre dos notas
const CORTE   = 0.15;   // s — la voz que se iba, si hace falta reusarla
const ENTRADA = 1.5;    // s — desde silencio (primera nota, o tras apagar)
const SALIDA  = 1.0;    // s — al apagar el audio o deseleccionar
const PASOS   = 24;     // segmentos lineales con que se aproxima la curva

// Igual potencia: dos texturas granulares no están correlacionadas, así que
// sumadas con rampas lineales pierden ~3 dB a la mitad del cruce y se oye un
// hueco. Con seno/coseno la potencia total se sostiene. Las curvas se trazan con
// rampas lineales cortas y no con setValueCurveAtTime, porque ésta choca con
// cualquier automatización previa y cancelarla a media curva no es fiable entre
// navegadores — y aquí se interrumpen curvas todo el tiempo.
function rampa(param, ctx, destino, duracion, forma) {
    const t0 = ctx.currentTime;
    const v0 = param.value;
    param.cancelScheduledValues(t0);
    param.setValueAtTime(v0, t0);
    for (let i = 1; i <= PASOS; i++) {
        const x = i / PASOS;
        const k = forma === 'sube' ? Math.sin(x * Math.PI / 2)
                : forma === 'baja' ? 1 - Math.cos(x * Math.PI / 2)
                : x;
        param.linearRampToValueAtTime(v0 + (destino - v0) * k, t0 + duracion * x);
    }
}

function aplicarParametros(stg, analysis) {
    stg.currentSnapshot = analysis;
    const params = stg.mapSnapshotToAudioParams(analysis);
    stg.generatePointerSequence(analysis);
    stg.applyToGrainEngine(params);
}

export class Voces {
    constructor(ctx, opcionesSnap) {
        this.ctx   = ctx;
        this.voces = [0, 1].map(() => {
            const engine = new GrainEngine(ctx, null, {
                masterAmp:  0.7,
                overlaps:   6,
                windowSize: 0.12
            });
            const gain = ctx.createGain();
            gain.gain.setValueAtTime(0, ctx.currentTime);
            engine.connect(gain);
            return {
                engine,
                gain,
                stg:      new SnapToGrains(ctx, engine, opcionesSnap),
                material: null,   // id del material que tiene puesto
                sonando:  false,  // el motor corre (aunque su gain vaya bajando)
                timer:    null    // el stop pendiente al final de una bajada
            };
        });
        this.actual = null;   // la voz de la nota vigente; null = silencio
        // Cada sonar() toma un turno. Si mientras se descargaba un material se
        // eligió otra nota o se apagó el audio, el turno viejo ya no vale y su
        // carga se descarta al llegar en vez de pisar la actual.
        this.turno  = 0;
    }

    connect(destino) {
        for (const v of this.voces) v.gain.connect(destino);
    }

    get activa() {
        return this.actual !== null;
    }

    // Mide un snapshot. analyzePixelData no depende del estado de la voz, así
    // que cualquiera de las dos sirve.
    analizar(pixels) {
        return this.voces[0].stg.analyzePixelData(pixels);
    }

    // El pool protege del desalojo los materiales de las dos voces: durante un
    // cruce suenan dos y ninguno puede soltarse.
    fijarMateriales() {
        fijar(...this.voces.map(v => v.material).filter(Boolean));
    }

    // Baja la voz a 0 y detiene su motor al terminar.
    bajar(v, duracion, forma) {
        clearTimeout(v.timer);
        rampa(v.gain.gain, this.ctx, 0, duracion, forma);
        v.timer = setTimeout(() => {
            v.stg.stop();
            v.sonando = false;
            v.timer = null;
        }, (duracion + 0.05) * 1000);
    }

    // Deja la voz libre para una nota nueva. Si todavía suena (se estaba yendo de
    // un cruce anterior), se corta en CORTE segundos; la promesa resuelve cuando
    // ya está en silencio.
    liberar(v) {
        clearTimeout(v.timer);
        v.timer = null;
        if (!v.sonando) return Promise.resolve();
        rampa(v.gain.gain, this.ctx, 0, CORTE, 'lineal');
        return new Promise(res => setTimeout(() => {
            v.stg.stop();
            v.sonando = false;
            res();
        }, (CORTE + 0.01) * 1000));
    }

    // Hace sonar una nota: `analysis` es el snapshot ya medido (el *cómo*),
    // `material` el id del corpus (el *qué*).
    sonar(analysis, material) {
        const turno    = ++this.turno;
        const saliente = this.actual;
        // La entrante es la voz que no es la vigente. Si no hay vigente (desde
        // silencio, o tras apagar) se toma la que esté más baja, para no pisar
        // una bajada que todavía se oye.
        const entrante = saliente
            ? this.voces.find(v => v !== saliente)
            : this.voces.reduce((a, b) => (a.gain.gain.value <= b.gain.gain.value ? a : b));

        const llegando = obtenerBuffer(this.ctx, material).catch(err => {
            console.warn('No se pudo cargar el material', material, err);
            return null;
        });
        const libre = this.liberar(entrante);

        // La saliente sigue sonando mientras llega el material: si no estaba en
        // caché, la nota vieja se sostiene y el cruce empieza cuando hay con qué.
        Promise.all([llegando, libre]).then(([buf]) => {
            if (turno !== this.turno) return;

            if (buf && entrante.engine.buffer !== buf) {
                // Basta asignarlo: GrainEngine lee this.buffer en cada createGrain.
                entrante.engine.buffer = buf;
                entrante.material = material;
            }
            if (!entrante.engine.buffer) return;
            this.fijarMateriales();

            clearTimeout(entrante.timer);
            entrante.stg.stop();
            aplicarParametros(entrante.stg, analysis);
            entrante.stg.start();
            entrante.sonando = true;

            // La saliente de este turno es la vigente en este momento, no la de
            // cuando se pidió: si entretanto se apagó, no hay nada que bajar.
            const vigente = this.actual;
            this.actual = entrante;
            if (vigente && vigente !== entrante) {
                // Desde el volumen que tenga: si estaba entrando a medias, se va
                // desde ahí.
                rampa(entrante.gain.gain, this.ctx, 1, CRUCE, 'sube');
                this.bajar(vigente, CRUCE, 'baja');
            } else {
                rampa(entrante.gain.gain, this.ctx, 1, ENTRADA, 'sube');
            }
        });
    }

    // Silencio: las dos voces bajan y se detienen. Quema el turno, así que un
    // material en vuelo ya no arranca al llegar.
    apagar() {
        this.turno++;
        this.actual = null;
        for (const v of this.voces) {
            if (v.sonando) this.bajar(v, SALIDA, 'lineal');
        }
    }
}
