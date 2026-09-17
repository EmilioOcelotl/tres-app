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
