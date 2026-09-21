// semantica.js — representación de lo que dice cada nota, para que la caminata
// de los archivos comprimidos pueda elegir por contenido y no sólo por los
// enlaces que el autor escribió a mano.
//
// Qué NO hace, y es deliberado: no ordena. Medido el 2026-09-11, rankear los
// candidatos por similitud colapsa la pieza — las semillas 3 y 7 daban la
// caminata idéntica, porque un orden determinista domina al sorteo. Y los
// cosenos que decidirían son ruido (0.007–0.11 sobre una mediana de 0.018): el
// corpus es demasiado ralo para que un orden signifique algo.
//
// Lo que sí hace es construir un grafo: dos notas son vecinas si comparten un
// término que pesa en LAS DOS. Eso restringe el universo sin ordenarlo, así que
// la semilla sigue eligiendo y cada instancia sigue siendo distinta.
//
// Por qué "que pese en ambas" y no "que sea raro en el corpus": medido el
// 2026-09-17, la rareza selecciona lo raro, no lo significativo. Un df<=3 conecta
// notas por `podemos`, por `posteriormente` y hasta por `sugieron`, que es rara
// porque es una errata. Exigir peso en las dos puntas sube la cobertura de 54 a
// 78 de 78 notas y deja términos publicables: `grain`, `jitlib`, `rostro`,
// `windowrandratio`, `etiquetas`, `ciudad`.

// Palabras que no distinguen una nota de otra. Al cierre de la lista van las
// que aparecieron conectando pasos en las sondas sin decir nada: si el
// cuadernillo va a imprimir «llegó aquí por la palabra X», X no puede ser
// `podemos`.
const STOP = new Set((`
de la que el en y a los se del las un por con no una su para es al lo como mas
pero sus le ya o este si porque esta entre cuando muy sin sobre tambien me hasta
hay donde quien desde todo nos durante todos uno les ni contra otros ese eso ante
ellos e esto mi antes algunos unos yo otro otras otra tanto esa estos mucho
quienes nada muchos cual poco ella estar estas algunas algo nosotros mis tu te ti
tus ellas suyo esos esas ser son fue era han ha he has hemos habia sido tiene
tienen tener puede pueden hace hacer asi cada solo sola parte
the of to and in is that it for with as on this an are be by or from not at we which can
forma formas basado basada basadas basados hecho hecha hechos podemos puedo
varios varias misma mismo mismos mismas bajo sigue siguen siguiendo agregar
trabajar utilice utilizar utiliza posteriormente tuvo tuve tenia habian seria
manera maneras momento momentos caso casos vez veces cosa cosas tipo tipos
lugar donde mientras aunque entonces luego despues ademas sino tal tales
`).trim().split(/\s+/));

export const MIN_LARGO = 4;

export function tokenizar(texto) {
  return texto.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .split(/\s+/)
    .filter(p => p.length >= MIN_LARGO && !STOP.has(p) && !/^\d+$/.test(p));
}

// TF-IDF por nota, normalizado a vector unitario. Sin dependencias: la matriz
// completa son ~25 ms sobre el corpus de la tesis.
export function vectores(docs) {
  const df = new Map();
  const tokens = docs.map(d => {
    const t = tokenizar(d.texto);
    new Set(t).forEach(x => df.set(x, (df.get(x) || 0) + 1));
    return t;
  });
  const N = docs.length;
  const vecs = new Map();
  docs.forEach((d, i) => {
    const tf = new Map();
    tokens[i].forEach(x => tf.set(x, (tf.get(x) || 0) + 1));
    const pares = [];
    for (const [x, f] of tf) {
      const w = (1 + Math.log(f)) * Math.log(N / df.get(x));
      if (w > 0) pares.push([x, w]);
    }
    pares.sort((a, b) => b[1] - a[1]);
    let norma = Math.sqrt(pares.reduce((s, [, w]) => s + w * w, 0)) || 1;
    vecs.set(d.id, pares.map(([t, w]) => [t, w / norma]));
  });
  return vecs;
}

export const TOP_TERMINOS = 25;

// Grafo de afinidad: id → Map(idVecino → { termino, peso }).
// El término elegido para cada par es el de mayor peso mínimo entre las dos
// notas — el que ambas usan de verdad, no el que una usa mucho y la otra roza.
export function grafoTerminos(docs, top = TOP_TERMINOS) {
  const vecs = vectores(docs);
  const pesos = new Map();   // id → Map(termino → peso)
  const rangos = new Map();  // id → Map(termino → posición en su propio top)
  for (const [id, v] of vecs) {
    pesos.set(id, new Map(v.map(([t, w]) => [t, w])));
    rangos.set(id, new Map(v.slice(0, top).map(([t], i) => [t, i])));
  }

  const grafo = new Map(docs.map(d => [d.id, new Map()]));
  for (let i = 0; i < docs.length; i++) {
    for (let j = i + 1; j < docs.length; j++) {
      const a = docs[i].id, b = docs[j].id;
      const ra = rangos.get(a), rb = rangos.get(b);
      const pa = pesos.get(a), pb = pesos.get(b);
      let termino = null, mejor = 0;
      for (const t of ra.keys()) {
        if (!rb.has(t)) continue;
        const p = Math.min(pa.get(t), pb.get(t));
        if (p > mejor) { mejor = p; termino = t; }
      }
      if (termino) {
        grafo.get(a).set(b, { termino, peso: mejor });
        grafo.get(b).set(a, { termino, peso: mejor });
      }
    }
  }
  return grafo;
}

// ---------------------------------------------------------------------------
// Rasgos de forma del texto, para que una nota suene a lo que dice.
//
// El sonido del grafo y del visor sale hoy de `generateSyntheticPixels(id,
// level, childCount)`: la estructura del árbol, no el contenido. Medido sobre
// la BD del 19-09, eso da 11 parámetros distintos para 112 notas con texto, y
// 62 de ellas caen en el mismo grupo — `Léeme`, `Mapa de navegación`, `La
// escritura` y `Live Coding` suenan idéntico porque están al mismo nivel y
// tienen los mismos hijos.
//
// Por qué rasgos de forma y no `txtToSeq` (letra → posición en el buffer), que
// era la vía planeada: medido el 2026-09-20 no diferencia. Razón entre/dentro
// 0.049, y el puntero medio de las 78 notas cae entre 0.361 y 0.429. Todas las
// notas están en español y el español tiene una distribución de letras fija, así
// que letra→posición da el mismo paseo para cualquier texto. Sigue valiendo como
// gesto —la tesis leída letra por letra— pero no como mecanismo de diferencia.
//
// Lo que sí varía en este corpus (cv medido el 21-09): el largo `wc` 1.30, los
// dígitos 1.78, las comas 1.31, los paréntesis 1.11, las mayúsculas 0.81. Son
// marcas de género antes que de tema: los dígitos y los paréntesis marcan el
// código y la citación, las comas marcan la prosa subordinada, el largo marca
// si la nota está escrita o es un muñón.
//
// Se normaliza por RANGO PERCENTIL dentro del corpus, no por una escala fija.
// Es deliberado y tiene un costo: el rasgo de una nota depende de las demás, así
// que agregar notas mueve un poco el sonido de todas. A cambio, el corpus usa
// siempre el rango entero de los parámetros — que es el punto, porque las
// distribuciones son largas de cola (una nota de 1,006 palabras contra decenas
// de 20) y una escala fija las apelmazaría todas abajo. La misma propiedad ya la
// tienen los archivos comprimidos: la instancia depende del estado de la BD.

// Debajo de este largo las proporciones son ruido: una nota de tres palabras con
// una coma da una densidad de comas altísima que no significa nada.
export const MIN_PALABRAS_RASGOS = 20;

function contar(texto, re) {
  return (texto.match(re) || []).length;
}

// Rasgos crudos de una nota: el largo, y cuatro densidades por carácter.
export function rasgosCrudos(texto) {
  const palabras = texto.split(/\s+/).filter(Boolean);
  const chars = texto.length || 1;
  return {
    wc:         palabras.length,
    digitos:    contar(texto, /\d/g) / chars,
    parentesis: contar(texto, /[()]/g) / chars,
    comas:      contar(texto, /,/g) / chars,
    mayus:      contar(texto, /[A-ZÁÉÍÓÚÑ]/g) / chars
  };
}

const CLAVES_RASGOS = ['wc', 'digitos', 'parentesis', 'comas', 'mayus'];

// docs: [{ id, texto }] con el texto ya sin etiquetas.
// Devuelve id → { wc, digitos, parentesis, comas, mayus, termino }, con los
// cinco rasgos en 0–1 como rango percentil y el término propio de la nota.
// Sólo incluye las notas que llegan a MIN_PALABRAS_RASGOS: las demás no tienen
// texto que suene y se quedan con el sonido de su lugar en el árbol.
export function rasgosDeNotas(docs) {
  const conTexto = docs.filter(d => d.texto.split(/\s+/).filter(Boolean).length >= MIN_PALABRAS_RASGOS);
  if (!conTexto.length) return new Map();

  const crudos = conTexto.map(d => rasgosCrudos(d.texto));
  const ordenados = {};
  for (const k of CLAVES_RASGOS) ordenados[k] = crudos.map(r => r[k]).sort((a, b) => a - b);

  // Posición del valor dentro del corpus, 0–1. Búsqueda binaria del primer
  // elemento no menor: los empates (muchas notas con cero dígitos) caen todos
  // en el mismo piso en vez de repartirse por orden de llegada.
  const percentil = (k, v) => {
    const arr = ordenados[k];
    let lo = 0, hi = arr.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m; }
    return arr.length > 1 ? lo / (arr.length - 1) : 0.5;
  };

  // El término top-1 de TF-IDF, que ya sabe calcular vectores(). Sobre este
  // corpus da término propio en casi todas las notas; entra como identidad del
  // texto para sembrar la textura, en vez del noteId.
  const vecs = vectores(conTexto);

  const out = new Map();
  conTexto.forEach((d, i) => {
    const r = {};
    for (const k of CLAVES_RASGOS) r[k] = Number(percentil(k, crudos[i][k]).toFixed(4));
    const v = vecs.get(d.id);
    r.termino = v && v.length ? v[0][0] : null;
    out.set(d.id, r);
  });
  return out;
}
