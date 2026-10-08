// iconos.js — los iconos de los controles, compartidos por el grafo y el visor.
//
// Un solo juego para las dos vistas (misma razón que snapshot.js y voces.js:
// si cada una dibuja los suyos, derivan). Trazo fino en SVG sobre una retícula
// de 16 y `currentColor`, así heredan la tinta del soporte y el color de la
// Parte que marca `.activo`. Siempre van con su texto: el icono sugiere qué
// pasa, el texto lo dice. Lo apagado se tacha.
//
// Uso: en el HTML, `data-icono="nombre"` sobre el botón o enlace; `ponerIconos()`
// los dibuja al iniciar. Cuando el código cambia el rótulo, `rotular(el, nombre,
// texto)` en vez de `textContent`, que borraría el icono.

const LLENO = 'fill="currentColor" stroke="none"';

const TRAZOS = {
    renderizar: `<path d="M5 3.2 L12.6 8 L5 12.8 Z" ${LLENO}/>`,
    regenerar:  '<path d="M3 8a5 5 0 0 1 8.6-3.5L13 6"/><path d="M13 2.6V6H9.6"/><path d="M13 8a5 5 0 0 1-8.6 3.5L3 10"/><path d="M3 13.4V10h3.4"/>',
    'sonido-no': '<path d="M2.5 6h2.4l3.4-3v10L4.9 10H2.5z"/><path d="M11 6l3.6 4M14.6 6L11 10"/>',
    'sonido-si': '<path d="M2.5 6h2.4l3.4-3v10L4.9 10H2.5z"/><path d="M10.8 5.6a3.4 3.4 0 0 1 0 4.8"/><path d="M12.6 3.7a6 6 0 0 1 0 8.6"/>',
    grabar:     `<circle cx="8" cy="8" r="4.2" ${LLENO}/>`,
    detener:    `<rect x="4" y="4" width="8" height="8" rx="0.6" ${LLENO}/>`,
    descargar:  '<path d="M8 2.5v8M4.6 7.4L8 10.8l3.4-3.4M3 13.5h10"/>',
    receta:     '<path d="M3 13l.9-3.4L10.9 2.6l2.5 2.5-7 7z"/><path d="M9.4 4.1l2.5 2.5"/>',
    cerrar:     '<path d="M4 4l8 8M12 4l-8 8"/>',
    ver:        '<path d="M1.5 8s2.4-4.4 6.5-4.4S14.5 8 14.5 8s-2.4 4.4-6.5 4.4S1.5 8 1.5 8z"/><circle cx="8" cy="8" r="1.9"/>',
    imprimir:   '<path d="M4.5 6V2.5h7V6"/><path d="M4.5 11.5h-2V6h11v5.5h-2"/><rect x="4.5" y="9.2" width="7" height="4.3"/>',
    'refs-si':  `<path d="M4 4.2L12 5M4 4.2L7.4 12M12 5L7.4 12" stroke-width="0.9"/><circle cx="4" cy="4.2" r="1.7" ${LLENO}/><circle cx="12" cy="5" r="1.7" ${LLENO}/><circle cx="7.4" cy="12" r="1.7" ${LLENO}/>`,
    'refs-no':  `<path d="M4 4.2L12 5M4 4.2L7.4 12M12 5L7.4 12" stroke-width="0.9"/><circle cx="4" cy="4.2" r="1.7" ${LLENO}/><circle cx="12" cy="5" r="1.7" ${LLENO}/><circle cx="7.4" cy="12" r="1.7" ${LLENO}/><path d="M2 14L14 2"/>`,
    caminar:    `<path d="M2.5 13L6 8.5l3 2.5 4.5-7" stroke-width="1"/><circle cx="2.5" cy="13" r="1.4" ${LLENO}/><circle cx="6" cy="8.5" r="1.4" ${LLENO}/><circle cx="9" cy="11" r="1.4" ${LLENO}/><path d="M11 3.5h2.8v2.8"/>`,
    ediciones:  '<rect x="2.5" y="4.5" width="8" height="9.5"/><path d="M5 4.5V2h8.5v9.5H10.5"/>',
    papel:      '<path d="M3.5 1.8h6l3 3v9.4h-9z"/><path d="M9.5 1.8v3h3"/><path d="M5.5 7.5h5M5.5 9.7h5M5.5 11.9h3"/>',
    iniciar:    `<circle cx="8" cy="8" r="6"/><path d="M6.5 5.3L10.8 8l-4.3 2.7z" ${LLENO}/>`,
};

const CIRCUNFERENCIA = 2 * Math.PI * 5.4;

// `progreso` (0–1) dibuja un arco que se llena, para las esperas con avance.
function trazo(nombre, progreso) {
    if (nombre === 'progreso') {
        const lleno = (Math.max(0, Math.min(1, progreso ?? 0)) * CIRCUNFERENCIA).toFixed(2);
        return '<circle cx="8" cy="8" r="5.4" stroke-width="1.6" opacity="0.2"/>'
             + `<circle cx="8" cy="8" r="5.4" stroke-width="1.6" stroke-dasharray="${lleno} ${CIRCUNFERENCIA}" transform="rotate(-90 8 8)"/>`;
    }
    return TRAZOS[nombre] ?? '';
}

export function svgIcono(nombre, progreso) {
    return `<svg class="icono" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${trazo(nombre, progreso)}</svg>`;
}

const ESTILO = `
.con-icono { display: inline-flex; align-items: center; gap: 0.7em; }
.con-icono > .icono { flex: none; width: 1.3em; height: 1.3em; }
.con-icono.solo-icono { justify-content: center; }
.con-icono.solo-icono > .icono { width: 14px; height: 14px; }
.con-icono.parpadea > .icono { animation: icono-parpadeo 1s steps(1) infinite; }
@keyframes icono-parpadeo { 50% { opacity: 0.25; } }
@media (prefers-reduced-motion: reduce) { .con-icono.parpadea > .icono { animation: none; } }
`;

function inyectarEstilo() {
    if (document.getElementById('iconos-estilo')) return;
    const s = document.createElement('style');
    s.id = 'iconos-estilo';
    s.textContent = ESTILO;
    document.head.appendChild(s);
}

// Pone (o cambia) el icono y el rótulo de un control. Sin `texto`, conserva el
// rótulo que tenga; con texto vacío queda sólo el icono (el control debe traer
// su aria-label).
export function rotular(el, nombre, texto, { progreso, parpadea = false } = {}) {
    if (!el) return;
    inyectarEstilo();
    let rotulo = el.querySelector(':scope > .rotulo');
    if (texto === undefined) texto = rotulo ? rotulo.textContent : el.textContent.trim();
    el.innerHTML = svgIcono(nombre, progreso);
    if (texto) {
        rotulo = document.createElement('span');
        rotulo.className = 'rotulo';
        rotulo.textContent = texto;
        el.appendChild(rotulo);
    }
    el.dataset.icono = nombre;
    el.classList.add('con-icono');
    el.classList.toggle('solo-icono', !texto);
    el.classList.toggle('parpadea', parpadea);
}

// Dibuja los iconos declarados en el HTML con `data-icono`. Un control cuyo
// texto es sólo «×» queda como icono solo.
export function ponerIconos(raiz = document) {
    raiz.querySelectorAll('[data-icono]').forEach(el => {
        const texto = el.textContent.trim();
        rotular(el, el.dataset.icono, texto === '×' ? '' : texto);
    });
}
