// comprimidos/riso-especimen.js — hoja de especímenes para decidir el
// procesamiento risográfico de las imágenes del zine. NO toca render.js:
// sólo imprime la misma foto bajo varios tratamientos para comparar en papel.
//
// Uso:  node back/comprimidos/riso-especimen.js [salida.pdf]

import PDFDocument from 'pdfkit';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { NoteService } from '../services/noteService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fontsPath = path.join(__dirname, '..', '..', 'assets', 'fonts');

const CIAN    = [0x00, 0x97, 0xb2];
const MAGENTA = [0xd6, 0x00, 0x7f];

// ------------------------------------------------------------------ decodificar

function decodificar(buf, mime) {
  if (/png/i.test(mime)) {
    const p = PNG.sync.read(buf);
    return { w: p.width, h: p.height, data: p.data };   // RGBA
  }
  const j = jpeg.decode(buf, { useTArray: true });
  return { w: j.width, h: j.height, data: j.data };     // RGBA
}

// Remuestreo con recorte al lienzo (cover) y promediado de caja
function remuestrear(img, W, H) {
  const escala = Math.max(W / img.w, H / img.h);
  const sw = W / escala, sh = H / escala;
  const ox = (img.w - sw) / 2, oy = (img.h - sh) / 2;
  const out = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const x0 = Math.floor(ox + (x / W) * sw), x1 = Math.max(x0 + 1, Math.floor(ox + ((x + 1) / W) * sw));
      const y0 = Math.floor(oy + (y / H) * sh), y1 = Math.max(y0 + 1, Math.floor(oy + ((y + 1) / H) * sh));
      let r = 0, g = 0, b = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * img.w + sx) * 4;
          r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; n++;
        }
      }
      const o = (y * W + x) * 3;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
    }
  }
  return { w: W, h: H, data: out };
}

const clamp = v => Math.max(0, Math.min(1, v));
const luma = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

// Niveles: la riso embarra los medios y no imprime bien sólidos >90%.
// Abrimos sombras y subimos contraste antes de tramar.
function niveles(v, negro = 0.06, blanco = 0.94, gamma = 0.85) {
  return clamp(Math.pow(clamp((v - negro) / (blanco - negro)), gamma));
}

// -------------------------------------------------------------- separaciones
// Cada una devuelve la cobertura de tinta (0..1) por píxel para cada plancha.

// Por tono (duotono clásico): el cian carga las sombras, la magenta los medios.
function sepTono(img) {
  const n = img.w * img.h;
  const c = new Float32Array(n), m = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    const d = 1 - niveles(luma(img.data[o], img.data[o + 1], img.data[o + 2]));
    c[i] = clamp(Math.pow(d, 1.5)) * 0.9;
    m[i] = clamp(Math.pow(d, 0.85)) * 0.7;
  }
  return { c, m };
}

// Por color (CMY sin amarillo): cian = 1−R, magenta = 1−G. Lo rojo va a la
// magenta, lo azul al cian — conserva la relación cromática de la foto.
function sepColor(img) {
  const n = img.w * img.h;
  const c = new Float32Array(n), m = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    c[i] = clamp(niveles(1 - img.data[o] / 255, 0.04, 0.92, 0.95)) * 0.9;
    m[i] = clamp(niveles(1 - img.data[o + 1] / 255, 0.04, 0.92, 0.95)) * 0.9;
  }
  return { c, m };
}

// Una sola tinta (la de la Parte): cobertura = oscuridad
function sepMono(img) {
  const n = img.w * img.h;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    c[i] = clamp(1 - niveles(luma(img.data[o], img.data[o + 1], img.data[o + 2]))) * 0.9;
  }
  return { c, m: null };
}

// ------------------------------------------------------------------- tramados
// Devuelven bool por píxel: ¿cae tinta aquí?

const BAYER8 = [
  [0, 32, 8, 40, 2, 34, 10, 42], [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38], [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41], [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37], [63, 31, 55, 23, 61, 29, 53, 21],
];

function tramaBayer(cob, w, h) {
  const px = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const u = (BAYER8[y & 7][x & 7] + 0.5) / 64;
      px[y * w + x] = cob[y * w + x] > u ? 1 : 0;
    }
  return px;
}

// Punto agrupado con ángulo de trama (lo que hace una prensa de verdad).
// Ángulos distintos por tinta evitan el muaré en el sobreimpreso.
function tramaPunto(cob, w, h, lpi, dpi, anguloGrados) {
  const T = dpi / lpi;                       // píxeles por celda de trama
  const a = (anguloGrados * Math.PI) / 180;
  const cosA = Math.cos(a), sinA = Math.sin(a);
  const px = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = (x * cosA - y * sinA) / T, v = (x * sinA + y * cosA) / T;
      // función de punto: 0 en el centro de la celda, 1 en la esquina
      const d = (Math.cos(2 * Math.PI * u) + Math.cos(2 * Math.PI * v)) / 4 + 0.5;
      px[y * w + x] = cob[y * w + x] > d ? 1 : 0;
    }
  }
  return px;
}

// ------------------------------------------------------------------ compuesto

// Vista previa: tinta sobre papel, multiplicando (el sobreimpreso cian+magenta
// da el violeta que ya usa la Parte III — la paleta se cierra sola).
function componer(planchas, w, h) {
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) {
    let r = 255, g = 255, b = 255;
    for (const { px, tinta } of planchas) {
      if (!px[i]) continue;
      r = (r * tinta[0]) / 255; g = (g * tinta[1]) / 255; b = (b * tinta[2]) / 255;
    }
    const o = i * 4;
    png.data[o] = r; png.data[o + 1] = g; png.data[o + 2] = b; png.data[o + 3] = 255;
  }
  return PNG.sync.write(png);
}

// Plancha para imprimir: negro = tinta. Es el archivo que se manda a la riso.
function plancha(px, w, h) {
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) {
    const v = px[i] ? 0 : 255;
    const o = i * 4;
    png.data[o] = v; png.data[o + 1] = v; png.data[o + 2] = v; png.data[o + 3] = 255;
  }
  return PNG.sync.write(png);
}

const cobertura = px => px.reduce((a, v) => a + v, 0) / px.length;

// --------------------------------------------------------------- tratamientos

const CELDA_W = 150, CELDA_H = 112;
const DPI_TRAMA = 400;                       // resolución de trabajo del halftone
const LPI = 45;                              // frecuencia de trama (riso: 34–71)
const CHUNK = 2.2;                           // pt por píxel en los tramados gruesos

function tratamientos(img) {
  // dos resoluciones: gruesa (dither visible, hermano del snapshot 2bpp) y
  // fina (trama de punto, "impreso de verdad")
  const gw = Math.round(CELDA_W / CHUNK), gh = Math.round(CELDA_H / CHUNK);
  const fw = Math.round((CELDA_W / 72) * DPI_TRAMA), fh = Math.round((CELDA_H / 72) * DPI_TRAMA);
  const grueso = remuestrear(img, gw, gh);
  const fino = remuestrear(img, fw, fh);

  const out = [];

  // A — original (lo que hace hoy render.js)
  out.push({ nombre: 'A · original (hoy)', png: null, img });

  // B — monotinta, dither Bayer grueso
  {
    const { c } = sepMono(grueso);
    const px = tramaBayer(c, gw, gh);
    out.push({
      nombre: 'B · monotinta Bayer', png: componer([{ px, tinta: CIAN }], gw, gh),
      w: gw, h: gh, cob: [['cian', cobertura(px)]],
    });
  }

  // C — duotono por tono, dither Bayer grueso
  {
    const { c, m } = sepTono(grueso);
    const pc = tramaBayer(c, gw, gh), pm = tramaBayer(m, gw, gh);
    out.push({
      nombre: 'C · duotono Bayer', png: componer([{ px: pc, tinta: CIAN }, { px: pm, tinta: MAGENTA }], gw, gh),
      w: gw, h: gh, cob: [['cian', cobertura(pc)], ['magenta', cobertura(pm)]],
    });
  }

  // D — duotono por tono, trama de punto con ángulos (15° / 75°)
  {
    const { c, m } = sepTono(fino);
    const pc = tramaPunto(c, fw, fh, LPI, DPI_TRAMA, 15);
    const pm = tramaPunto(m, fw, fh, LPI, DPI_TRAMA, 75);
    out.push({
      nombre: 'D · duotono punto 45lpi', png: componer([{ px: pc, tinta: CIAN }, { px: pm, tinta: MAGENTA }], fw, fh),
      w: fw, h: fh, cob: [['cian', cobertura(pc)], ['magenta', cobertura(pm)]],
      planchas: [{ nombre: 'cian', png: plancha(pc, fw, fh) }, { nombre: 'magenta', png: plancha(pm, fw, fh) }],
    });
  }

  // E — separación por color (CMY sin amarillo), trama de punto
  {
    const { c, m } = sepColor(fino);
    const pc = tramaPunto(c, fw, fh, LPI, DPI_TRAMA, 15);
    const pm = tramaPunto(m, fw, fh, LPI, DPI_TRAMA, 75);
    out.push({
      nombre: 'E · sep. por color, punto', png: componer([{ px: pc, tinta: CIAN }, { px: pm, tinta: MAGENTA }], fw, fh),
      w: fw, h: fh, cob: [['cian', cobertura(pc)], ['magenta', cobertura(pm)]],
      planchas: [{ nombre: 'cian', png: plancha(pc, fw, fh) }, { nombre: 'magenta', png: plancha(pm, fw, fh) }],
    });
  }

  // F — como D, pero invirtiendo las imágenes de fondo oscuro (capturas de
  // pantalla): la tinta cae sobre la figura, no sobre el campo. Sin esto, una
  // captura de terminal se traga la tinta de la máquina.
  {
    const finoInv = invertirSiOscura(fino);
    const { c, m } = sepTono(finoInv);
    const pc = tramaPunto(c, fw, fh, LPI, DPI_TRAMA, 15);
    const pm = tramaPunto(m, fw, fh, LPI, DPI_TRAMA, 75);
    out.push({
      nombre: 'F · D + invertir si oscura', png: componer([{ px: pc, tinta: CIAN }, { px: pm, tinta: MAGENTA }], fw, fh),
      w: fw, h: fh, cob: [['cian', cobertura(pc)], ['magenta', cobertura(pm)]],
      planchas: [{ nombre: 'cian', png: plancha(pc, fw, fh) }, { nombre: 'magenta', png: plancha(pm, fw, fh) }],
    });
  }

  return out;
}

// Si la imagen es mayoritariamente oscura, la invertimos: en papel el negro no
// es ausencia sino tinta, y una captura de fondo negro pediría cobertura total.
function invertirSiOscura(img, umbral = 0.45) {
  const n = img.w * img.h;
  let suma = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    suma += luma(img.data[o], img.data[o + 1], img.data[o + 2]);
  }
  if (suma / n >= umbral) return img;
  const data = new Float32Array(img.data.length);
  for (let i = 0; i < data.length; i++) data[i] = 255 - img.data[i];
  return { w: img.w, h: img.h, data };
}

// ---------------------------------------------------------------------- main

const OBJETIVO = ['anti2.jpg', 'antiHydra2.jpg', 'three2-r.png'];

async function main() {
  const salida = process.argv[2] || path.join(__dirname, 'salida', 'riso-especimen.pdf');

  const ns = new NoteService();
  const root = await ns.getCompleteTree();
  const adjuntos = [];
  (function walk(n) {
    const c = n.content ? (Buffer.isBuffer(n.content) ? n.content.toString('utf8') : n.content) : '';
    for (const m of c.matchAll(/<img[^>]*src="api\/attachments\/([^/"]+)\/image\/([^"]*)"/g)) {
      adjuntos.push({ nota: n.title, id: m[1], nombre: decodeURIComponent(m[2]) });
    }
    (n.children || []).forEach(walk);
  })(root);

  const elegidos = OBJETIVO.map(n => adjuntos.find(a => a.nombre === n)).filter(Boolean);

  const doc = new PDFDocument({ autoFirstPage: false, margin: 0 });
  doc.registerFont('mono', path.join(fontsPath, 'SpaceMono-Regular.ttf'));
  doc.pipe(fs.createWriteStream(salida));

  const M = 28, GAP = 12;
  const SW = M * 2 + 6 * CELDA_W + 5 * GAP;
  const SH = M * 2 + 3 * (CELDA_H + 34) + 30;
  doc.addPage({ size: [SW, SH], margin: 0 });
  doc.font('mono').fontSize(9).fillColor('#111')
     .text('ESPECÍMENES RISO — imágenes del zine bajo seis tratamientos', M, 14, { characterSpacing: 1 });
  doc.fontSize(5.5).fillColor('#888')
     .text(`trama de punto a ${LPI} lpi sobre ${DPI_TRAMA} dpi · dither Bayer a ${(72 / CHUNK).toFixed(0)} dpi · tintas cian ${'#0097b2'} + magenta ${'#d6007f'}`, M, 26);

  const primeras = [];
  for (let fila = 0; fila < elegidos.length; fila++) {
    const a = elegidos[fila];
    const blob = await ns.getAttachmentBlob(a.id);
    const img = decodificar(blob.content, blob.mime);
    const trats = tratamientos(img);
    if (fila === 0) primeras.push(...trats);

    console.log(`\n${a.nombre} (${a.nota}) ${img.w}×${img.h}`);
    const y = M + 18 + fila * (CELDA_H + 34);
    trats.forEach((t, col) => {
      const x = M + col * (CELDA_W + GAP);
      if (t.png) doc.image(t.png, x, y, { width: CELDA_W, height: CELDA_H });
      else {
        doc.save().rect(x, y, CELDA_W, CELDA_H).clip();
        doc.image(blob.content, x, y, { cover: [CELDA_W, CELDA_H], align: 'center', valign: 'center' });
        doc.restore();
      }
      doc.save().strokeColor('#ccc').lineWidth(0.4).rect(x, y, CELDA_W, CELDA_H).stroke().restore();
      doc.font('mono').fontSize(5.5).fillColor('#111').text(t.nombre, x, y + CELDA_H + 4);
      const cob = (t.cob || []).map(([n, v]) => `${n} ${(v * 100).toFixed(0)}%`).join(' · ');
      doc.fontSize(5).fillColor('#888').text(cob || 'sin separación (no imprimible en riso)', x, y + CELDA_H + 13);
      if (t.cob) console.log(`  ${t.nombre.padEnd(26)} ${cob}  total ${(t.cob.reduce((s, [, v]) => s + v, 0) * 100).toFixed(0)}%`);
    });
    doc.font('mono').fontSize(5).fillColor('#888')
       .text(`${a.nombre} — ${a.nota}`, M, y + CELDA_H + 22);
  }

  // Segunda página: las planchas tal como se mandarían a la riso
  const conPlanchas = primeras.filter(t => t.planchas);
  const PW = 210;
  doc.addPage({ size: [M * 2 + 4 * PW + 3 * GAP, M * 2 + PW * 0.75 + 60], margin: 0 });
  doc.font('mono').fontSize(9).fillColor('#111')
     .text('PLANCHAS — un archivo por tinta (negro = cobertura). Así se manda a imprimir.', M, 14, { characterSpacing: 1 });
  conPlanchas.forEach((t, i) => {
    t.planchas.forEach((p, j) => {
      const x = M + (i * 2 + j) * (PW + GAP), y = M + 18;
      doc.image(p.png, x, y, { width: PW, height: PW * 0.75 });
      doc.save().strokeColor('#ccc').lineWidth(0.4).rect(x, y, PW, PW * 0.75).stroke().restore();
      doc.font('mono').fontSize(5.5).fillColor('#111')
         .text(`${t.nombre.slice(0, 1)} · plancha ${p.nombre}`, x, y + PW * 0.75 + 4);
    });
  });

  doc.end();
  console.log(`\nEspecímenes: ${salida}`);
}

main().catch(err => { console.error(err); process.exit(1); });
