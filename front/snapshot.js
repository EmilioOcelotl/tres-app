// snapshot.js — el snapshot sintético 2bpp: una textura por nota, y de sus
// estadísticas sale la granulación (analyzePixelData → mapSnapshotToAudioParams).
//
// Vive aquí, en front/, porque lo importan los tres que tienen que dibujar lo
// mismo: el grafo (front/main.js), el visor de comprimidos (front/comprimido.js)
// y el pliego imprimible (back/comprimidos/render.js, que es Node pero esto es
// ESM sin nada de navegador). Antes eran tres copias de la fórmula y derivaron:
// el 2026-09-21 el visor pasó a dibujar por los rasgos del texto y el pliego se
// quedó en level/childCount, así que el mismo cuadernillo salía distinto en
// papel y en pantalla. Eso rompe lo que la Parte III promete — misma semilla ⇒
// misma caminata, mismos fragmentos y misma textura en las dos salidas.

export function hashString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
}

export function seededRandom(seed) {
    let s = seed >>> 0;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

// De dónde salen el brillo, el contraste y la complejidad — que es lo mismo que
// decir de dónde sale el sonido, porque analyzePixelData los vuelve a leer de
// los píxeles y mapSnapshotToAudioParams los convierte en rate, amp y overlaps.
//
// Si la nota tiene texto, manda el texto: los rasgos vienen precalculados del
// servidor (ver back/services/semantica.js, que explica por qué son rasgos de
// forma y no letra→posición). Si no lo tiene —un contenedor, un muñón de tres
// palabras, o una textura que no es de ninguna nota como la portada o los
// interludios del cuadernillo— manda el lugar en el árbol, como antes.
//
// El reparto: el largo manda el brillo (y con él la velocidad de lectura del
// buffer, así que una nota escrita corre y un muñón se arrastra); los dígitos y
// los paréntesis mandan el contraste (y con él la amplitud: el código y la
// citación pegan más fuerte que la prosa); las comas y las mayúsculas mandan la
// complejidad (y con ella cuántos granos se superponen).
//
// Los pisos y los rangos replican los que producía la estructura, para que el
// corpus ocupe el mismo territorio sonoro de antes y sólo cambie quién ocupa
// cada parte de él.
export function paramsDeSnapshot(node) {
    const r = node.rasgos;
    if (!r) {
        const level      = node.level || 0;
        const childCount = node.childCount || 0;
        return {
            brightness:  Math.max(0.05, 0.88 - level * 0.1),
            contrastAmt: Math.min(0.75, 0.08 + childCount * 0.06),
            complexity:  Math.min(0.7,  level * 0.08 + childCount * 0.03)
        };
    }
    return {
        brightness:  0.18 + r.wc * 0.62,
        contrastAmt: 0.10 + (r.parentesis * 0.6 + r.digitos * 0.4) * 0.62,
        complexity:  0.06 + (r.comas * 0.6 + r.mayus * 0.4) * 0.60
    };
}

const BAYER = [[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]];

// Valores 0..3. En pantalla 3 es claro; en papel render.js lo invierte, así que
// allí 0 es tinta plena.
export function generateSyntheticPixels(node, W, H) {
    // La textura se siembra con el término propio de la nota cuando lo hay: dos
    // notas con rasgos parecidos siguen teniendo grano distinto, y el grano de
    // una nota deja de depender de un noteId que no significa nada.
    const seed = hashString(node.rasgos?.termino ? `${node.id}#${node.rasgos.termino}` : node.id);
    const rng  = seededRandom(seed);
    const { brightness, contrastAmt, complexity } = paramsDeSnapshot(node);

    const phaseX = ((seed & 0x3FF) / 0x3FF) * Math.PI * 2;
    const phaseY = (((seed >>> 10) & 0x3FF) / 0x3FF) * Math.PI * 2;

    const pixels = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            let v = brightness;
            v += (rng() - 0.5) * contrastAmt;
            v += Math.sin(x * complexity * 0.4 + phaseX) * complexity * 0.22;
            v += Math.cos(y * complexity * 0.3 + phaseY) * complexity * 0.18;
            v += (BAYER[y % 4][x % 4] / 15 - 0.5) * 0.3;
            pixels[y * W + x] = Math.max(0, Math.min(3, Math.round(v * 3)));
        }
    }
    return pixels;
}
