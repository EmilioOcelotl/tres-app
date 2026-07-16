// utils/tokensCodigo.js — tokenización de notas de código (pseudocódigo).
// Fuente única de las reglas de sintaxis que comparten el PDF de la tesis
// (routes/pdf.js) y el renderizador de archivos comprimidos
// (comprimidos/render.js). El espejo HTML del overlay 3D vive en
// services/contentProcessor.js (mismas reglas, salida en spans tok-*).
//
// Cada token sale con un tipo semántico; el color y la fuente los decide
// quien dibuja: 'texto' | 'encabezado' | 'keyword' | 'numero' | 'cadena'
// | 'comentario'.

export const REGEX_TOKEN_CODIGO = /("[^"]*"|'[^']*'|“[^”]*”|\b\d+(?:[.,]\d+)?\b|\b(?:await|async|new|nuevo|function|funcion|función|return|const|let|var)\b)/g;

function tipoTokenCodigo(parte) {
  if (/^(?:"[^"]*"|'[^']*'|“[^”]*”)$/.test(parte)) return 'cadena';
  if (/^\d+(?:[.,]\d+)?$/.test(parte))             return 'numero';
  if (/^(?:await|async|new|nuevo|function|funcion|función|return|const|let|var)$/.test(parte)) return 'keyword';
  return 'texto';
}

export function tokenizarLineaCodigo(linea) {
  const tokens = [];

  // Comentario: primer "//" que no venga de un protocolo (https://)
  const iComentario = linea.search(/(?<!:)\/\//);
  let codigo       = iComentario >= 0 ? linea.slice(0, iComentario) : linea;
  const comentario = iComentario >= 0 ? linea.slice(iComentario) : '';

  // Encabezado de sección: palabras en MAYÚSCULAS al inicio de línea (se admite sangría)
  if (/^ *[A-ZÁÉÍÓÚÑÜ]{2,}/.test(codigo)) {
    const m = codigo.match(/^ *(?:[A-ZÁÉÍÓÚÑÜ0-9]+(?:\s+|$))+/);
    if (m) {
      tokens.push({ texto: m[0], tipo: 'encabezado' });
      codigo = codigo.slice(m[0].length);
    }
  }

  for (const parte of codigo.split(REGEX_TOKEN_CODIGO)) {
    if (parte) tokens.push({ texto: parte, tipo: tipoTokenCodigo(parte) });
  }

  if (comentario) tokens.push({ texto: comentario, tipo: 'comentario' });

  return tokens;
}

// Envuelve una línea lógica (ya tokenizada) en líneas visuales de maxChars,
// cortando de preferencia en espacios y con sangría de continuación.
export function envolverLineaTokens(tokens, maxChars) {
  const textoCompleto = tokens.map(t => t.texto).join('');
  const indentCont = Math.min(textoCompleto.match(/^ */)[0].length + 4, Math.floor(maxChars / 2));

  const lineas = [];
  let actual = [];
  let usado  = 0;

  const saltar = () => {
    lineas.push(actual);
    actual = [{ texto: ' '.repeat(indentCont), tipo: 'texto' }];
    usado  = indentCont;
  };

  for (const token of tokens) {
    let resto = token.texto;
    while (usado + resto.length > maxChars) {
      const presupuesto = maxChars - usado;
      const trozo   = resto.slice(0, presupuesto);
      const iCorte  = trozo.lastIndexOf(' ');
      const corte   = iCorte > 0 ? iCorte + 1 : (presupuesto > 0 ? presupuesto : 1);
      actual.push({ ...token, texto: resto.slice(0, corte) });
      resto = resto.slice(corte).replace(/^ +/, '');
      saltar();
    }
    if (resto) {
      actual.push({ ...token, texto: resto });
      usado += resto.length;
    }
  }
  lineas.push(actual);
  return lineas;
}
