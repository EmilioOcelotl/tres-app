// partitura.js — grabar no graba sonido: registra una partitura.
//
// Idea del autor (2026-09-28): GRABAR anota las decisiones de quien usa el visor
// hasta DETENER —qué panel suena, cuándo se apaga o se prende el sonido, qué
// instancia se está leyendo— y después un render (render-partitura.js) produce
// el audio desde esa partitura. Una sesión de horas son pocos KB.
//
// Los eventos son autosuficientes: cada `sonar` lleva el análisis ya medido (el
// *cómo*) y el id del material (el *qué*), y la partitura trae la ruta de cada
// material. Así no depende de que snapshot.js o el catálogo sigan iguales, ni de
// instancias que no se guardan en ningún lado (REGENERAR, recetas de visitante).
//
// El tiempo es el del AudioContext (decisión del autor 2026-10-07): el mismo
// reloj con que suena. Si el navegador suspende el contexto, ese tramo no cuenta.
//
// Decisiones del autor (2026-10-07): si la sesión pasa de DURACION_MAXIMA se
// reparte proporcional puro —todo se escala por el mismo factor, también los
// tramos en silencio— y sólo se escala la partitura, nunca los tiempos del
// instrumento (cruces, fundidos, recorrido del puntero, grano).

export const DURACION_MAXIMA = 600;   // s — lo más largo que dura un render

export class Grabador {
    constructor(ctx) {
        this.ctx = ctx;
        this.t0 = null;
        this.eventos = [];
        this.materiales = {};
        this.inicio = null;
    }

    get grabando() {
        return this.t0 !== null;
    }

    // Segundos de sesión grabados hasta ahora.
    get transcurrido() {
        return this.grabando ? this.ctx.currentTime - this.t0 : 0;
    }

    iniciar() {
        this.t0 = this.ctx.currentTime;
        this.inicio = new Date().toISOString();
        this.eventos = [];
        this.materiales = {};
    }

    anotar(evento) {
        if (!this.grabando) return;
        const t = Math.round((this.ctx.currentTime - this.t0) * 1000) / 1000;
        this.eventos.push({ t, ...evento });
    }

    // Un panel empieza a sonar. `node` es el nodo del panel; `url` la ruta del
    // material (ver corpus.js > urlDeMaterial).
    sonar(node, analisis, material, url) {
        if (!this.grabando) return;
        if (material && url) this.materiales[material] = url;
        const { brightness, contrast, complexity, colorDistribution } = analisis;
        this.anotar({
            tipo: 'sonar',
            id: node?.id || null,
            titulo: node?.title || node?.titulo || null,
            analisis: { brightness, contrast, complexity, colorDistribution },
            material: material || null
        });
    }

    apagar() {
        this.anotar({ tipo: 'apagar' });
    }

    // Qué se está leyendo: no suena, queda como acta.
    instancia(datos) {
        this.anotar({ tipo: 'instancia', ...datos });
    }

    // Cierra la partitura. La semilla del azar del render va adentro para que
    // la partitura describa un archivo exacto (D3: opcional — sin ella, cada
    // render es otra interpretación).
    detener() {
        const duracion = Math.round(this.transcurrido * 1000) / 1000;
        this.anotar({ tipo: 'fin' });
        this.t0 = null;
        return {
            partitura: 1,
            inicio: this.inicio,
            duracion,
            semilla: 1 + Math.floor(Math.random() * 999999),
            eventos: this.eventos,
            materiales: this.materiales
        };
    }
}

// Lleva la partitura a lo que dura el render: 1:1 si cabe en DURACION_MAXIMA,
// si no, todos los tiempos por el mismo factor (proporcional puro: una visita de
// 5 s en una sesión de 3 h dura 0.28 s, menos que un cruce, y el instrumento
// la resuelve como cualquier cambio a media mezcla).
export function mapearTiempos(partitura, maximo = DURACION_MAXIMA) {
    const T = partitura.duracion;
    const k = T > maximo ? maximo / T : 1;
    return {
        factor: k,
        duracion: T * k,
        eventos: partitura.eventos.map(e => ({ ...e, t: e.t * k }))
    };
}

// 3h12m, 9m40s, 42s
export function duracionLegible(seg) {
    const s = Math.round(seg);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    if (h) return `${h}h${String(m).padStart(2, '0')}m`;
    if (m) return `${m}m${String(r).padStart(2, '0')}s`;
    return `${r}s`;
}
