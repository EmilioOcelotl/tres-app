// back/scripts/frases-anti.mjs — copia las frases de escena de anti a tres-app.
//
// El cue `epigrafe: anti` de las recetas de Parte III elige una frase de las
// que 4nt1 muestra en pantalla (anti/txt/txtsc1–3 y txtInstrucciones, leídas
// por anti/index.js). Esos archivos viven en el repo `anti`, y producción sólo
// tiene `tres-app`, así que se versiona una copia con su procedencia: de qué
// archivo sale cada frase, de qué commit, y el año de la primera versión del
// archivo (que es el que va en la atribución).
//
// Sólo las escenas, por decisión del autor (2026-09-28): son material terminado,
// escrito para leerse suelto. Los CSV de 2021 quedan fuera porque están mal
// delimitados, y los borradores de proceso porque no se escribieron para
// publicarse. Se descartan líneas vacías y repetidas (los estribillos, como
// «Predicciones y presencias», cuentan una vez: la primera).
//
// Sólo corre en la máquina del autor (lee ../anti).
//
//   node back/scripts/frases-anti.mjs

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const AQUI    = path.dirname(fileURLToPath(import.meta.url));
const RAIZ    = path.resolve(AQUI, '../..');
const ANTI    = path.resolve(RAIZ, '../anti');
const SALIDA  = path.join(RAIZ, 'back/comprimidos/fuentes/anti-escenas.json');
const ARCHIVOS = ['txt/txtsc1.txt', 'txt/txtsc2.txt', 'txt/txtsc3.txt', 'txt/txtInstrucciones.txt'];

function git(...args) {
  const r = spawnSync('git', ['-C', ANTI, ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

const commit = git('rev-parse', '--short', 'HEAD');
const vistas = new Set();
const frases = [];
const archivos = {};

for (const rel of ARCHIVOS) {
  const primera = git('log', '--follow', '--format=%ad', '--date=format:%Y', '--', rel).split('\n').pop();
  archivos[path.basename(rel)] = { ruta: `anti/${rel}`, año: Number(primera) };
  const lineas = fs.readFileSync(path.join(ANTI, rel), 'utf8').split('\n');
  for (const cruda of lineas) {
    const texto = cruda.trim();
    if (!texto || vistas.has(texto)) continue;
    vistas.add(texto);
    frases.push({ texto, archivo: path.basename(rel) });
  }
}

const doc = {
  _procedencia: {
    repo: 'anti',
    commit,
    copiado: new Date().toISOString().slice(0, 10),
    criterio: 'frases de escena de 4nt1, una por línea, sin vacías ni repetidas',
    regenerar: 'node back/scripts/frases-anti.mjs (sólo en la máquina del autor)'
  },
  autor: '4nt1',
  archivos,
  frases
};

fs.mkdirSync(path.dirname(SALIDA), { recursive: true });
fs.writeFileSync(SALIDA, JSON.stringify(doc, null, 2) + '\n');
console.log(`${frases.length} frases de ${ARCHIVOS.length} archivos (anti@${commit}) → ${path.relative(RAIZ, SALIDA)}`);
