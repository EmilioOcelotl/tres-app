// back/scripts/corpus-sonoro.mjs — construye el corpus sonoro de la pieza.
//
// Las grabaciones fuente viven fuera del repo (son de campo, pesan gigas y no
// todas entran al proyecto). Lo que se versiona es el resultado: un fragmento
// por fuente, recortado, en mono y normalizado, más la ficha medida de cada
// uno. `assets/snd/fuentes.json` declara de dónde sale cada fragmento y desde
// qué segundo; este script lo ejecuta y escribe `assets/snd/catalogo.json`.
//
// La normalización es ganancia constante, no compresión: se mide la sonoridad
// integrada (EBU R128) y el pico real, y se aplica el menor de los dos ajustes
// que hacen falta para llegar al objetivo sin rebasar el techo. Así la
// dinámica de cada grabación queda intacta y la ganancia aplicada es un número
// que se puede leer en el catálogo.
//
//   npm run corpus              todas las fuentes
//   npm run corpus -- --solo=metro-cdmx
//   npm run corpus -- --dry     sólo mide, no escribe audio

import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const AQUI    = path.dirname(fileURLToPath(import.meta.url));
const RAIZ    = path.resolve(AQUI, '../..');
const DIR_SND = path.join(RAIZ, 'assets/snd');
const DIR_OUT = path.join(DIR_SND, 'corpus');
const TMP     = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-'));

const args = process.argv.slice(2);
const dry  = args.includes('--dry');
const solo = (args.find(a => a.startsWith('--solo=')) || '').split('=')[1];

// ffmpeg reparte sus informes entre las dos salidas: ebur128 resume por stderr
// y `ametadata=print:file=-` escribe por stdout. Como aquí siempre se escribe a
// un archivo o al muxer nulo, juntarlas no mezcla nada con el audio.
function ff(params) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', '-y', ...params],
                      { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`ffmpeg falló:\n${(r.stderr || '').slice(-600)}`);
  return (r.stdout || '') + (r.stderr || '');
}

const expandir = (p, raiz) =>
  path.isAbsolute(p) ? p : path.join(raiz.replace(/^~/, os.homedir()), p);

// --- medición -------------------------------------------------------------

function sonoridad(archivo) {
  // Sólo interesa el bloque final (`Summary:`), no las lecturas por cuadro.
  const txt = ff(['-i', archivo, '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  const resumen = txt.slice(txt.lastIndexOf('Summary:'));
  const dato = (re) => { const m = resumen.match(re); return m ? parseFloat(m[1]) : null; };
  return {
    lufs: dato(/I:\s*(-?[\d.]+) LUFS/),
    lra:  dato(/LRA:\s*(-?[\d.]+) LU/),
    tp:   dato(/Peak:\s*(-?[\d.]+) dBFS/),
  };
}

function espectro(archivo) {
  const txt = ff(['-i', archivo, '-af',
    'aspectralstats=measure=centroid+flatness+rolloff,ametadata=mode=print:file=-',
    '-f', 'null', '-']);
  const saca = (clave) => {
    const v = [...txt.matchAll(new RegExp(`lavfi\\.aspectralstats\\.1\\.${clave}=([\\d.eE+-]+)`, 'g'))]
      .map(m => parseFloat(m[1])).filter(Number.isFinite);
    if (!v.length) return null;
    v.sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)];
  };
  return { centroide: saca('centroid'), planitud: saca('flatness'), rolloff: saca('rolloff') };
}

// Dispersión del nivel en dB sobre ventanas de ~100 ms: el eje que separa el
// material sostenido (drone, granulable) del gestual. Bajo = quieto.
function quietud(archivo) {
  const txt = ff(['-i', archivo, '-af',
    'asetnsamples=4410,astats=metadata=1:reset=1,ametadata=mode=print:file=-:key=lavfi.astats.Overall.RMS_level',
    '-f', 'null', '-']);
  const todos = [...txt.matchAll(/RMS_level=(-?[\d.]+)/g)]
    .map(m => parseFloat(m[1])).filter(Number.isFinite);
  if (todos.length < 4) return null;
  // Los bloques casi mudos se descartan: si contaran, un material sostenido con
  // pausas mediría como gestual y el descriptor dejaría de ser lo que dice ser.
  const piso = Math.max(...todos) - 40;
  const v = todos.filter(x => x > piso);
  if (v.length < 4) return null;
  const media = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((a, b) => a + (b - media) ** 2, 0) / v.length);
}

// --- construcción ---------------------------------------------------------

const cfg = JSON.parse(fs.readFileSync(path.join(DIR_SND, 'fuentes.json'), 'utf8'));
const { objetivo_lufs: OBJ, techo_dbtp: TECHO, duracion_s: DUR, bitrate: BR, raiz } = cfg;
const LIMITAR = cfg.limitar_picos !== false;

// Las fuentes compuestas (varios archivos que son una sola pieza) se arman una
// vez y quedan en el temporal, para que dos fragmentos de la misma pieza no la
// concatenen dos veces.
const compuestas = {};
function resolver(ref) {
  if (!ref.startsWith('@')) return expandir(ref, raiz);
  if (compuestas[ref]) return compuestas[ref];
  const def = cfg.compuestas?.[ref];
  if (!def) throw new Error(`Fuente compuesta no declarada: ${ref}`);
  const lista = path.join(TMP, `${ref.slice(1)}.txt`);
  fs.writeFileSync(lista, def.concatenar
    .map(p => `file '${expandir(p, raiz)}'`).join('\n'));
  const salida = path.join(TMP, `${ref.slice(1)}.wav`);
  ff(['-f', 'concat', '-safe', '0', '-i', lista, '-ac', '1', '-ar', '44100', salida]);
  compuestas[ref] = salida;
  return salida;
}

fs.mkdirSync(DIR_OUT, { recursive: true });
const fichas = [];

for (const f of cfg.fuentes) {
  if (solo && f.id !== solo) continue;
  const fuente = resolver(f.archivo);
  if (!fs.existsSync(fuente)) {
    console.error(`  ✗ ${f.id}: no existe ${fuente}`);
    continue;
  }

  // 1. recorte en mono, sin tocar el nivel todavía
  const crudo = path.join(TMP, `${f.id}.wav`);
  ff(['-ss', String(f.desde), '-t', String(DUR), '-i', fuente,
      '-ac', '1', '-ar', '44100', '-c:a', 'pcm_s16le', crudo]);

  // 2. medir y decidir la ganancia
  //
  // Lo que frena la ganancia casi siempre es un pico aislado: un golpe, un
  // roce del micrófono. Medido sobre este corpus, los archivos que topan pasan
  // menos del 0.35% del tiempo por encima de medio pico, y `ventilador` un
  // 0.00% — un chasquido único le costaba 7.5 dB en 45 s de material estable.
  // Con `limitar_picos` se aplica la ganancia que pide la sonoridad y se deja
  // que un limitador se ocupe de esos instantes; sin él, la ganancia se recorta
  // para que ningún pico rebase el techo y el material queda más bajo.
  const antes = sonoridad(crudo);
  const porSonoridad = OBJ - antes.lufs;
  const porPico      = TECHO - antes.tp;
  const topaPico     = porPico < porSonoridad;
  const ganancia     = (LIMITAR || !topaPico) ? porSonoridad : porPico;
  const limitadoDb   = (LIMITAR && topaPico) ? porSonoridad - porPico : 0;

  const limite = Math.pow(10, TECHO / 20).toFixed(4);
  const cadena = limitadoDb > 0
    ? `volume=${ganancia.toFixed(2)}dB,alimiter=limit=${limite}:attack=5:release=50:level=disabled`
    : `volume=${ganancia.toFixed(2)}dB`;

  const destino = path.join(DIR_OUT, `${f.id}.mp3`);
  if (!dry) {
    ff(['-i', crudo, '-af', cadena, '-c:a', 'libmp3lame', '-b:a', BR, '-ac', '1', destino]);
  }

  // 3. ficha del resultado (no del original: es lo que la pieza va a sonar)
  const medir = dry ? crudo : destino;
  const despues = dry
    ? { lufs: antes.lufs + ganancia, tp: Math.min(antes.tp + ganancia, TECHO), lra: antes.lra }
    : sonoridad(medir);
  const esp = espectro(medir);
  const q   = quietud(medir);

  fichas.push({
    id: f.id,
    titulo: f.titulo,
    archivo: `corpus/${f.id}.mp3`,
    terminos: f.terminos || [],
    fuente: { ruta: f.archivo, desde: f.desde, criterio: f.criterio },
    duracion_s: DUR,
    lufs: redondear(despues.lufs), pico_dbfs: redondear(despues.tp), lra: redondear(despues.lra),
    ganancia_db: redondear(ganancia),
    picos_limitados_db: limitadoDb > 0 ? redondear(limitadoDb) : 0,
    quietud_db: redondear(q), centroide_hz: redondear(esp.centroide),
    planitud: esp.planitud == null ? null : Number(esp.planitud.toFixed(4)),
    rolloff_hz: redondear(esp.rolloff),
    bytes: dry || !fs.existsSync(destino) ? null : fs.statSync(destino).size,
  });

  console.log(`  ${f.id.padEnd(20)} ${String(antes.lufs).padStart(7)} → ${String(redondear(despues.lufs)).padStart(6)} LUFS` +
              `  (${ganancia >= 0 ? '+' : ''}${ganancia.toFixed(1)} dB` +
              `${limitadoDb > 0 ? `, picos −${limitadoDb.toFixed(1)} dB` : ''})`);
}

function redondear(v) { return v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10; }

if (!dry && fichas.length) {
  const catalogo = {
    generado: new Date().toISOString().slice(0, 10),
    _medicion: {
      lufs: 'sonoridad integrada EBU R128 del fragmento ya normalizado',
      pico_dbfs: 'pico de muestra tras la normalización',
      lra: 'rango de sonoridad (LU); alto = el material cambia de nivel a lo largo del fragmento',
      ganancia_db: 'ganancia constante aplicada — la dinámica de la grabación no se tocó',
      picos_limitados_db: 'cuánto tuvo que ceder el limitador en los picos aislados; 0 = no actuó',
      quietud_db: 'dispersión del nivel en ventanas de 100 ms. Bajo = sostenido (textura granulable), alto = gestual',
      centroide_hz: 'mediana del centroide espectral (ffmpeg aspectralstats, magnitud lineal — no comparable con medidas hechas sobre potencia)',
      planitud: 'planitud espectral: cerca de 0 es tonal, cerca de 1 es ruido',
      rolloff_hz: 'frecuencia por debajo de la cual está el 85% de la energía',
      terminos: 'los escribe el autor: son el puente entre una nota y este material. Vacío = todavía no asignado',
    },
    objetivo_lufs: OBJ, techo_dbtp: TECHO, duracion_s: DUR, bitrate: BR,
    total_bytes: fichas.reduce((a, f) => a + (f.bytes || 0), 0),
    materiales: fichas,
  };
  fs.writeFileSync(path.join(DIR_SND, 'catalogo.json'), JSON.stringify(catalogo, null, 2) + '\n');
  console.log(`\n${fichas.length} materiales · ${(catalogo.total_bytes / 1048576).toFixed(1)} MB · catalogo.json escrito`);
}
fs.rmSync(TMP, { recursive: true, force: true });
