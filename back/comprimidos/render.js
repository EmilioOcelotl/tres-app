// comprimidos/render.js — renderizador experimental de archivos comprimidos.
// Módulo hermano de routes/pdf.js: no lo toca. Consume la instancia congelada
// que produce instancia.js (receta → caminata por crossLinks → JSON) y la
// compone como cuadernillo imprimible: zine de 8 (pliego con imposición 4×2
// y corte central) o mapa desplegable (acordeón con reverso de imagen única).
// El sistema selecciona y compone notas ya escritas; no redacta.
//
// Uso:  node comprimidos/render.js recetas/<receta>.md [--semilla N]

import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generarInstancia, hashString, seededRandom } from './instancia.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fontsPath = path.join(__dirname, '..', '..', 'assets', 'fonts');

const FUENTE_TEXTO = path.join(fontsPath, 'SpaceGrotesk.ttf');
const FUENTE_MONO  = path.join(fontsPath, 'SpaceMono-Regular.ttf');
const FUENTE_MONO_B = path.join(fontsPath, 'SpaceMono-Bold.ttf');

// Paleta bipolar sobre papel (tintas, no pantalla): cian/magenta ≈ riso
const COLOR_PARTE = {
  p1:   '#0097b2',
  p2:   '#d6007f',
  p3:   '#6d4de0',
  refs: '#5b6377',
  root: '#111111',
};
const COLOR_TINTA = '#111111';
const COLOR_GRIS  = '#8a8a8a';
const URL_SALIDAS = 'https://api.ocelotl.cc/';

// -------------------------------------------------------- snapshot sintético

// Port del generador del front (LCG + Bayer 4×4). Valores 0..3; en papel
// invertimos: 0 = tinta plena, 3 = papel.
function pixelesSinteticos(idSemilla, level, childCount, W, H) {
  const seed = hashString(idSemilla);
  const rng = seededRandom(seed);
  const brightness  = Math.max(0.05, 0.88 - level * 0.1);
  const contrastAmt = Math.min(0.75, 0.08 + childCount * 0.06);
  const complexity  = Math.min(0.7, level * 0.08 + childCount * 0.03);
  const phaseX = ((seed & 0x3FF) / 0x3FF) * Math.PI * 2;
  const phaseY = (((seed >>> 10) & 0x3FF) / 0x3FF) * Math.PI * 2;
  const M = [[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]];
  const px = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v = brightness;
      v += (rng() - 0.5) * contrastAmt;
      v += Math.sin(x * complexity * 0.4 + phaseX) * complexity * 0.22;
      v += Math.cos(y * complexity * 0.3 + phaseY) * complexity * 0.18;
      v += (M[y % 4][x % 4] / 15 - 0.5) * 0.3;
      px[y * W + x] = Math.max(0, Math.min(3, Math.round(v * 3)));
    }
  }
  return px;
}

function dibujarSnapshot(doc, px, W, H, x, y, celda, color, escala = 1) {
  doc.save();
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const v = px[j * W + i];
      if (v === 3) continue;                 // papel
      doc.rect(x + i * celda, y + j * celda, celda, celda)
         .fillOpacity(((3 - v) / 3) * escala)
         .fill(color);
    }
  }
  doc.fillOpacity(1).restore();
}

// ------------------------------------------------------------ páginas lógicas

// Cada página lógica se dibuja en coordenadas locales (0..w, 0..h) dentro de
// un panel del pliego, con rotación opcional de 180° (fila superior del zine).
function enPanel(doc, x, y, w, h, rotar, fn) {
  doc.save();
  if (rotar) doc.rotate(180, { origin: [x + w / 2, y + h / 2] });
  doc.translate(x, y);
  fn(w, h);
  doc.restore();
}

function pagPortada(doc, w, h, params, narrativa, fecha) {
  const m = 16;
  doc.font('mono').fontSize(5.5).fillColor(COLOR_GRIS)
     .text('TRES ESTUDIOS ABIERTOS', m, m, { characterSpacing: 1.5 })
     .text('archivo comprimido · parte III', m, m + 9);
  doc.font('texto').fontSize(22).fillColor(COLOR_TINTA)
     .text(params.titulo || 'sin título', m, h * 0.22, { width: w - 2 * m });
  const px = pixelesSinteticos(`portada-${params.semilla}`, 1, params.pasos, 26, 26);
  const celda = (w - 2 * m) * 0.45 / 26;
  dibujarSnapshot(doc, px, 26, 26, m, h * 0.44, celda, COLOR_PARTE.p2);
  if (narrativa.portada.length) {
    doc.font('mono').fontSize(6).fillColor(COLOR_GRIS)
       .text(narrativa.portada.join(' '), m, h * 0.72, { width: w - 2 * m });
  }
  doc.font('mono').fontSize(5.5).fillColor(COLOR_GRIS)
     .text(`semilla ${params.semilla} · ${fecha}`, m, h - m - 8);
}

function pagFragmento(doc, w, h, paso, num) {
  const m = 16;
  const color = COLOR_PARTE[paso.part] || COLOR_TINTA;
  doc.rect(0, 0, 4, h).fill(color);

  doc.font('texto').fontSize(26).fillColor(color).fillOpacity(0.35)
     .text(String(num).padStart(2, '0'), m, m - 4);
  doc.fillOpacity(1);
  doc.font('texto').fontSize(10.5).fillColor(COLOR_TINTA)
     .text(paso.title, m, m + 26, { width: w - 2 * m });

  const via = paso.via === 'inicio' ? 'punto de partida'
            : paso.via === 'salto' ? `salto desde: ${paso.origen}`
            : `enlazada desde: ${paso.origen}`;
  doc.font('mono').fontSize(5.5).fillColor(COLOR_GRIS)
     .text(via, m, doc.y + 4, { width: w - 2 * m });

  const yTexto = doc.y + 10;
  if (paso.esCodigo) {
    doc.font('mono').fontSize(5.8).fillColor(COLOR_TINTA)
       .text(paso.frag, m, yTexto, { width: w - 2 * m, height: h - yTexto - 70, ellipsis: true });
  } else {
    doc.font('texto').fontSize(7.8).fillColor(COLOR_TINTA)
       .text(paso.frag, m, yTexto, { width: w - 2 * m, height: h - yTexto - 70, lineGap: 1.5, ellipsis: true });
  }

  const px = pixelesSinteticos(paso.id, paso.level, paso.childCount, 22, 22);
  const lado = 40;
  dibujarSnapshot(doc, px, 22, 22, w - m - lado, h - m - lado, lado / 22, color);
  doc.font('mono').fontSize(5).fillColor(COLOR_GRIS)
     .text(`${paso.wc}w`, m, h - m - 6);
}

function pagInterludio(doc, w, h, params, num) {
  const px = pixelesSinteticos(`interludio-${params.semilla}-${num}`, 2, 3, 30, 42);
  const celda = Math.min((w - 32) / 30, (h - 32) / 42);
  dibujarSnapshot(doc, px, 30, 42, 16, 16, celda, COLOR_PARTE.p1);
}

function pagContraportada(doc, w, h, params, pasos, fecha) {
  const m = 16;
  doc.font('mono').fontSize(6).fillColor(COLOR_TINTA)
     .text('instancia irrepetible', m, h * 0.3)
     .text(`semilla ${params.semilla} · ${pasos.length} pasos por los enlaces internos`, m, doc.y + 3, { width: w - 2 * m });
  doc.font('mono').fontSize(6).fillColor(COLOR_GRIS)
     .text('las otras salidas de esta tesis —', m, doc.y + 14)
     .text(`${URL_SALIDAS}  (PDF · visualización 3D)`, m, doc.y + 2, { width: w - 2 * m });
  doc.font('mono').fontSize(5.5).fillColor(COLOR_GRIS)
     .text(`render.js · ${fecha}`, m, h - m - 8);
}

// -------------------------------------------------------------------- zine 8

function renderZine8(doc, paginas) {
  // Pliego A4 apaisado; 4 columnas × 2 filas. Doblez central horizontal,
  // corte del cuarto central (línea punteada). Fila superior rotada 180°.
  const SW = 842, SH = 595;
  const pw = SW / 4, ph = SH / 2;
  doc.addPage({ size: [SW, SH], margin: 0 });

  // Orden estándar del mini-zine: arriba (rotadas) 5·4·3·2, abajo 6·7·8·1
  const arriba = [4, 3, 2, 1];   // índices 0-based de páginas lógicas 5,4,3,2
  const abajo  = [5, 6, 7, 0];   // 6,7,8,1
  arriba.forEach((idx, col) => enPanel(doc, col * pw, 0, pw, ph, true, (w, h) => paginas[idx](w, h)));
  abajo.forEach((idx, col) => enPanel(doc, col * pw, ph, pw, ph, false, (w, h) => paginas[idx](w, h)));

  // Guías: dobleces (gris tenue) y corte (punteado, del cuarto central)
  doc.save().strokeColor('#cccccc').lineWidth(0.3);
  for (let c = 1; c < 4; c++) doc.moveTo(c * pw, 0).lineTo(c * pw, SH).stroke();
  doc.moveTo(0, ph).lineTo(SW / 4, ph).stroke();
  doc.moveTo(3 * SW / 4, ph).lineTo(SW, ph).stroke();
  doc.dash(3, { space: 3 }).strokeColor('#999999')
     .moveTo(SW / 4, ph).lineTo(3 * SW / 4, ph).stroke().undash();
  doc.font('mono').fontSize(5).fillColor('#999999')
     .text('8< corte', SW / 2 - 14, ph - 9);
  doc.restore();

  // Páginas de lectura (orden secuencial, para pantalla y revisión)
  paginas.forEach(pag => {
    doc.addPage({ size: [pw, ph], margin: 0 });
    pag(pw, ph);
  });
}

// ---------------------------------------------------------------------- mapa

function renderMapa(doc, paginas, params, pasos) {
  // Acordeón: un panel por página lógica. Frente = secuencia; reverso =
  // imagen única (campo dither + el recorrido de la caminata).
  const PW = 240, PH = 595;
  const SW = PW * paginas.length, SH = PH;

  doc.addPage({ size: [SW, SH], margin: 0 });
  paginas.forEach((pag, i) => enPanel(doc, i * PW, 0, PW, PH, false, (w, h) => pag(w, h)));
  doc.save().strokeColor('#cccccc').lineWidth(0.3).dash(4, { space: 4 });
  for (let c = 1; c < paginas.length; c++) doc.moveTo(c * PW, 0).lineTo(c * PW, SH).stroke();
  doc.undash().restore();

  // Reverso
  doc.addPage({ size: [SW, SH], margin: 0 });
  const cols = Math.floor(SW / 14), rows = Math.floor(SH / 14);
  const px = pixelesSinteticos(`reverso-${params.semilla}`, 1, pasos.length, cols, rows);
  dibujarSnapshot(doc, px, cols, rows, (SW - cols * 14) / 2, (SH - rows * 14) / 2, 14, COLOR_PARTE.p1, 0.3);

  // El recorrido: nodos sobre una línea que serpentea el pliego
  const rng = seededRandom(params.semilla ^ 0x9e3779b9);
  const margen = PW * 0.6;
  const puntos = pasos.map((paso, i) => ({
    x: margen + (SW - 2 * margen) * (pasos.length === 1 ? 0.5 : i / (pasos.length - 1)),
    y: SH / 2 + Math.sin(i * 1.7 + params.semilla) * SH * 0.18 + (rng() - 0.5) * SH * 0.12,
    paso,
  }));
  doc.save().lineWidth(1);
  for (let i = 1; i < puntos.length; i++) {
    const a = puntos[i - 1], b = puntos[i];
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2 - 40;
    doc.moveTo(a.x, a.y).quadraticCurveTo(cx, cy, b.x, b.y)
       .strokeOpacity(0.6)
       .strokeColor(COLOR_PARTE[b.paso.part] || COLOR_TINTA);
    if (b.paso.via === 'salto') doc.dash(3, { space: 3 });
    doc.stroke().undash();
  }
  doc.strokeOpacity(1);
  puntos.forEach((p, i) => {
    const color = COLOR_PARTE[p.paso.part] || COLOR_TINTA;
    const r = 5 + Math.min(p.paso.wc / 300, 1) * 11;
    doc.circle(p.x, p.y, r).fillOpacity(0.85).fill(color).fillOpacity(1);
    doc.font('mono').fontSize(7).fillColor(COLOR_TINTA)
       .text(`${i + 1} · ${p.paso.title}`, p.x - 70, p.y + r + 6, { width: 140, align: 'center' });
  });
  doc.font('mono').fontSize(6).fillColor(COLOR_GRIS)
     .text(`${params.titulo || ''} — recorrido de la semilla ${params.semilla}`, 16, SH - 20);
  doc.restore();
}

// ---------------------------------------------------------------------- main

async function main() {
  const args = process.argv.slice(2);
  const rutaReceta = args.find(a => !a.startsWith('--'));
  if (!rutaReceta) {
    console.error('Uso: node comprimidos/render.js recetas/<receta>.md [--semilla N]');
    process.exit(1);
  }
  const iSemilla = args.indexOf('--semilla');
  const semillaOverride = iSemilla !== -1 ? parseInt(args[iSemilla + 1], 10) : null;

  const instancia = await generarInstancia(
    path.resolve(__dirname, '..', rutaReceta), semillaOverride);
  const { params, narrativa, pasos, fecha } = instancia;

  console.log(`Receta: ${params.titulo} · formato ${params.formato} · semilla ${params.semilla}`);
  console.log('Caminata:');
  pasos.forEach((p, i) => console.log(`  ${i + 1}. [${p.via}] ${p.title} (${p.wc}w, ${p.part})`));

  const paginas = [(w, h) => pagPortada(doc, w, h, params, narrativa, fecha)];
  const cuerpo = params.formato === 'zine8' ? 6 : pasos.length;
  for (let i = 0; i < cuerpo; i++) {
    if (i < pasos.length) paginas.push((w, h) => pagFragmento(doc, w, h, pasos[i], i + 1));
    else paginas.push((w, h) => pagInterludio(doc, w, h, params, i));
  }
  paginas.push((w, h) => pagContraportada(doc, w, h, params, pasos, fecha));

  const salidaDir = path.join(__dirname, 'salida');
  fs.mkdirSync(salidaDir, { recursive: true });
  const nombre = `${path.basename(rutaReceta, '.md')}-s${params.semilla}.pdf`;
  const rutaPdf = path.join(salidaDir, nombre);

  const doc = new PDFDocument({ autoFirstPage: false, margin: 0 });
  doc.registerFont('texto', FUENTE_TEXTO);
  doc.registerFont('mono', FUENTE_MONO);
  doc.registerFont('monobold', FUENTE_MONO_B);
  const stream = fs.createWriteStream(rutaPdf);
  doc.pipe(stream);

  if (params.formato === 'zine8') renderZine8(doc, paginas);
  else renderMapa(doc, paginas, params, pasos);

  doc.end();
  await new Promise(res => stream.on('finish', res));

  // Acta de la instancia: la caminata depende de la semilla Y del estado de
  // la BD (que se sincroniza por cron), así que el JSON congela lo que este
  // PDF realmente contiene.
  const rutaJson = rutaPdf.replace(/\.pdf$/, '.json');
  fs.writeFileSync(rutaJson, JSON.stringify(instancia, null, 2));
  console.log(`PDF: ${rutaPdf}`);
  console.log(`Instancia: ${rutaJson}`);
}

main().catch(err => { console.error(err); process.exit(1); });
