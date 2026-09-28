// publicar.js — congela una edición del archivo comprimido y la deja lista
// para servirse en una URL estable.
//
// La diferencia con `render.js` es la durabilidad. Una instancia depende de la
// semilla Y del estado de la base (que el cron sincroniza), así que una URL
// citable no puede recalcular la caminata: tiene que servir un acta. Y el acta
// tampoco basta por sí sola — el JSON guarda `attachmentId`, y las imágenes se
// pedían a la BD viva (`getAttachmentBlob` filtra `isDeleted = 0`), así que
// borrar la nota fuente vaciaba de imágenes una edición supuestamente congelada.
// Aquí se escriben también los PNG ya separados y tramados.
//
// Uso: npm run publicar -- <receta> [--semilla N]

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { NoteService } from '../services/noteService.js';
import { procesarParaWeb } from './riso.js';
import { usarCatalogo, materialParaNota } from '../../front/corpus.js';
import { snapsDePaneles } from '../../front/paneles.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const recetasDir   = path.join(__dirname, 'recetas');
const salidaDir    = path.join(__dirname, 'salida');
const edicionesDir = path.join(__dirname, 'ediciones');
const sndDir       = path.join(__dirname, '..', '..', 'assets', 'snd');

// Cuántas ediciones contempla el alcance C de la Parte III. El índice declara
// el avance real contra este número: un archivo incompleto es coherente con la
// pieza, uno que aparenta estar cerrado no.
const META_EDICIONES = 7;

function ejecutarRender(rutaReceta, semilla) {
  const args = [path.join(__dirname, 'render.js'), path.relative(path.join(__dirname, '..'), rutaReceta)];
  if (semilla != null) args.push('--semilla', String(semilla));
  return new Promise((res, rej) => {
    const p = spawn(process.execPath, args, {
      cwd: path.join(__dirname, '..'),
      stdio: ['ignore', 'inherit', 'inherit']
    });
    p.on('close', code => code === 0 ? res() : rej(new Error(`render.js salió con código ${code}`)));
  });
}

// Las imágenes viven en un pozo compartido, no dentro de cada edición: el
// procesado riso depende sólo del adjunto, así que dos ediciones que citan la
// misma nota comparten byte por byte el mismo PNG. Sin esto, `anti-zine` s12 y
// s26 duplicaban 3 MB entre las dos.
async function congelarImagenes(pasos, pozoImg) {
  const ns = new NoteService();
  const vistos = new Set();
  let escritas = 0, reusadas = 0, omitidas = 0;

  for (const paso of pasos) {
    for (const im of paso.imagenes || []) {
      if (vistos.has(im.attachmentId)) continue;
      vistos.add(im.attachmentId);

      const destino = path.join(pozoImg, `${im.attachmentId}.png`);
      if (fs.existsSync(destino)) { reusadas++; continue; }

      const blob = await ns.getAttachmentBlob(im.attachmentId);
      if (!blob?.content || !/image\/(jpe?g|png)/i.test(blob.mime || '')) {
        console.warn(`  adjunto omitido: ${im.nombre} (${blob?.mime || 'sin blob'})`);
        omitidas++;
        continue;
      }
      // Misma previa que sirve /api/comprimidos/attachment/:id?riso — el visor
      // congelado muestra exactamente lo que mostraba el vivo.
      const { previa } = procesarParaWeb(blob.content, blob.mime);
      fs.mkdirSync(pozoImg, { recursive: true });
      fs.writeFileSync(destino, previa);
      escritas++;
    }
  }
  return { escritas, reusadas, omitidas };
}

// El sonido se congela igual que las imágenes, y por la misma razón: el visor
// elegía el material contra el catálogo vivo, así que escribir un término en
// fuentes.json, sumar un material o volver a cortar uno cambiaba cómo suena una
// edición ya publicada. Con 18→19 materiales, 180 de 190 nodos cambiaron de
// material, porque el reparto por hash es módulo del tamaño del catálogo.
//
// Se decide aquí, con la misma regla que usa el visor (corpus.js) y sobre los
// mismos paneles (paneles.js), y el acta guarda el material de cada panel —
// también portada, interludios y contraportada, que suenan aunque no sean notas.
// Los mp3 van a un pozo compartido con el hash del contenido en el nombre: dos
// ediciones que usan el mismo material comparten archivo, y un material que se
// vuelve a cortar con el mismo id entra como archivo nuevo sin pisar al viejo.
// El pozo no puede pesar más que las versiones del corpus que se hayan usado.
function congelarSonido(instancia, pozoSnd) {
  const cat = JSON.parse(fs.readFileSync(path.join(sndDir, 'catalogo.json'), 'utf8'));
  usarCatalogo(cat);

  const porPanel = {};
  for (const snap of snapsDePaneles(instancia.params, instancia.pasos)) {
    porPanel[snap.id] = materialParaNota(snap);
  }

  const materiales = {};
  let escritos = 0, reusados = 0;
  for (const id of new Set(Object.values(porPanel))) {
    const ficha = cat.materiales.find(m => m.id === id);
    const bytes = fs.readFileSync(path.join(sndDir, ficha.archivo));
    const sha = crypto.createHash('sha256').update(bytes).digest('hex');
    const archivo = `${id}-${sha.slice(0, 10)}.mp3`;
    const destino = path.join(pozoSnd, archivo);
    if (fs.existsSync(destino)) reusados++;
    else {
      fs.mkdirSync(pozoSnd, { recursive: true });
      fs.writeFileSync(destino, bytes);
      escritos++;
    }
    materiales[id] = { titulo: ficha.titulo, archivo, sha256: sha, terminos: ficha.terminos || [] };
  }

  instancia.sonido = {
    congelado: new Date().toISOString().slice(0, 10),
    catalogo: cat.generado,
    materialesEnCatalogo: cat.materiales.length,
    porPanel,
    materiales
  };
  return { escritos, reusados, usados: Object.keys(materiales).length };
}

function reconstruirIndice() {
  const ediciones = fs.existsSync(edicionesDir)
    ? fs.readdirSync(edicionesDir, { withFileTypes: true })
        .filter(d => d.isDirectory() && d.name !== 'img' && d.name !== 'snd')
        .map(d => {
          const dir = path.join(edicionesDir, d.name);
          const inst = JSON.parse(fs.readFileSync(path.join(dir, 'instancia.json'), 'utf8'));
          const refs = new Set();
          for (const paso of inst.pasos) for (const im of paso.imagenes || []) refs.add(im.attachmentId);
          return {
            slug: d.name,
            titulo: inst.params.titulo,
            receta: inst.params.receta || d.name.replace(/-s\d+$/, ''),
            semilla: inst.params.semilla,
            formato: inst.params.formato,
            pasos: inst.pasos.length,
            fecha: inst.fecha,
            pdf: fs.existsSync(path.join(dir, 'cuadernillo.pdf')),
            imagenes: refs.size
          };
        })
        .sort((a, b) => a.slug.localeCompare(b.slug))
    : [];

  const indice = { meta: META_EDICIONES, publicadas: ediciones.length, ediciones };
  fs.mkdirSync(edicionesDir, { recursive: true });
  fs.writeFileSync(path.join(edicionesDir, 'indice.json'), JSON.stringify(indice, null, 2));
  return indice;
}

async function main() {
  const args = process.argv.slice(2);
  const nombre = args.find(a => !a.startsWith('--') && !/^\d+$/.test(a));
  if (!nombre) {
    console.error('Uso: npm run publicar -- <receta> [--semilla N]');
    console.error(`Recetas: ${fs.readdirSync(recetasDir).filter(f => f.endsWith('.md')).map(f => path.basename(f, '.md')).join(', ')}`);
    process.exit(1);
  }
  const base = path.basename(nombre, '.md');
  const rutaReceta = path.join(recetasDir, `${base}.md`);
  if (!fs.existsSync(rutaReceta)) {
    console.error(`Receta no encontrada: ${rutaReceta}`);
    process.exit(1);
  }
  const iSemilla = args.indexOf('--semilla');
  const semilla = iSemilla !== -1 ? parseInt(args[iSemilla + 1], 10) : null;

  // El PDF manda: su acta es la que se publica, para que el impreso y la web
  // sean literalmente la misma instancia y no dos caminatas equivalentes.
  await ejecutarRender(rutaReceta, semilla);

  const candidatos = fs.readdirSync(salidaDir)
    .filter(f => f.startsWith(`${base}-s`) && f.endsWith('.json'))
    .map(f => ({ f, m: fs.statSync(path.join(salidaDir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  if (!candidatos.length) throw new Error(`render.js no dejó instancia para ${base}`);

  const jsonSalida = path.join(salidaDir, candidatos[0].f);
  const pdfSalida  = jsonSalida.replace(/\.json$/, '.pdf');
  const instancia  = JSON.parse(fs.readFileSync(jsonSalida, 'utf8'));
  instancia.params.receta = base;

  const slug = path.basename(jsonSalida, '.json');
  const dir  = path.join(edicionesDir, slug);
  fs.mkdirSync(dir, { recursive: true });

  const snd = congelarSonido(instancia, path.join(edicionesDir, 'snd'));
  fs.writeFileSync(path.join(dir, 'instancia.json'), JSON.stringify(instancia, null, 2));
  if (fs.existsSync(pdfSalida)) fs.copyFileSync(pdfSalida, path.join(dir, 'cuadernillo.pdf'));

  const img = await congelarImagenes(instancia.pasos, path.join(edicionesDir, 'img'));
  const indice = reconstruirIndice();

  console.log(`\n── Edición publicada ──`);
  console.log(`  ${slug} → back/comprimidos/ediciones/${slug}/`);
  console.log(`  imágenes: ${img.escritas} congeladas, ${img.reusadas} ya en el pozo${img.omitidas ? `, ${img.omitidas} omitidas` : ''}`);
  console.log(`  sonido: ${snd.usados} materiales — ${snd.escritos} congelados, ${snd.reusados} ya en el pozo`);
  console.log(`  índice: ${indice.publicadas} de ${indice.meta}`);
  console.log(`  URL: /comprimidos/${slug}`);
}

main().catch(err => { console.error(err); process.exit(1); });
