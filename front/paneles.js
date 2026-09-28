// paneles.js — qué paneles tiene el visor de un archivo comprimido y con qué
// identidad de snapshot suena cada uno.
//
// Además de un panel por paso, el visor intercala paneles sintéticos (portada,
// un interludio cada dos fragmentos, contraportada) cuyo snapshot sale de un id
// armado con la semilla. Esos ids deciden textura y sonido, así que los tienen
// que conocer dos sitios: el visor, que construye la tira, y `publicar.js`, que
// congela en el acta qué material suena en cada panel. Viven aquí por la misma
// razón que snapshot.js y corpus.js: dos copias derivan.

export function snapPortada(params) {
    return { id: `portada-${params.semilla}`, level: 1, childCount: params.pasos };
}

export function hayInterludio(i, totalPasos) {
    return i % 2 === 1 && i < totalPasos - 1;
}

export function snapInterludio(params, i) {
    return { id: `interludio-${params.semilla}-${i}`, level: 2, childCount: 3 };
}

export function snapContraportada(params, totalPasos) {
    return { id: `reverso-${params.semilla}`, level: 1, childCount: totalPasos };
}

// Todos los snapshots de la tira, en el orden en que se ven.
export function snapsDePaneles(params, pasos) {
    const snaps = [snapPortada(params)];
    pasos.forEach((paso, i) => {
        snaps.push(paso);
        if (hayInterludio(i, pasos.length)) snaps.push(snapInterludio(params, i));
    });
    snaps.push(snapContraportada(params, pasos.length));
    return snaps;
}
