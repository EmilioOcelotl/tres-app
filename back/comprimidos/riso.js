// comprimidos/riso.js — procesamiento risográfico de las imágenes del zine.
// La riso no imprime color compuesto: imprime una tinta por pasada, con una
// plancha (1 bit) por tinta. Aquí una foto RGB se convierte en eso —
// separación a cian + magenta, trama de punto angulada, y una vista previa que
// simula el sobreimpreso sobre papel (el cruce de las dos tintas da el violeta
// que ya usa la Parte III: la paleta se cierra sola).
//
// Decisiones del autor (2026-07-14): separación por color (E). La inversión
// automática de las imágenes de fondo oscuro se retiró (2026-07-14): el negro
// se imprime como tinta, tal cual.

import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

export const CIAN    = [0x00, 0x97, 0xb2];
export const MAGENTA = [0xd6, 0x00, 0x7f];

export const DPI = 400;          // resolución de trabajo de la trama
export const LPI = 45;           // frecuencia de trama de la riso real (34–71) — para el estudio riso dedicado
// Todo esto (visor web y PDF de salida) es un mockup: alude a la riso pero
// prioriza la definición. Una trama más fina resuelve el detalle que a 45 lpi se
// pierde al verlo en pantalla. Ambas salidas del mockup usan LPI_MOCKUP para que
// el visor siga viendo lo mismo que el pliego; el archivo riso de verdad usará
// LPI (45) con sus planchas, en otro estudio.
export const LPI_MOCKUP = 90;
const ANGULO_CIAN = 15, ANGULO_MAGENTA = 75;   // ángulos distintos: sin muaré
const TINTA_MAX = 0.9;           // un sólido al 100% embarra el papel
const TOTAL_MAX = 1.6;           // tope de tinta sumada entre las dos pasadas

const clamp = v => Math.max(0, Math.min(1, v));

export function decodificar(buf, mime) {
  if (/png/i.test(mime)) {
    const p = PNG.sync.read(buf);
    return { w: p.width, h: p.height, data: p.data };
  }
  const j = jpeg.decode(buf, { useTArray: true });
  return { w: j.width, h: j.height, data: j.data };
}

// Remuestreo con recorte al lienzo (cover) y promediado de caja. El canal alfa
// se compone sobre blanco: lo transparente es papel, no negro (varios PNG de la
// tesis vienen con el fondo recortado y sin esto pedirían tinta plena).
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
          const a = img.data[i + 3] / 255;
          r += img.data[i] * a + 255 * (1 - a);
          g += img.data[i + 1] * a + 255 * (1 - a);
          b += img.data[i + 2] * a + 255 * (1 - a);
          n++;
        }
      }
      const o = (y * W + x) * 3;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
    }
  }
  return { w: W, h: H, data: out };
}

// La riso embarra los medios: abrimos sombras y subimos contraste antes de tramar
function niveles(v, negro = 0.04, blanco = 0.92, gamma = 0.95) {
  return clamp(Math.pow(clamp((v - negro) / (blanco - negro)), gamma));
}

// Separación por color (CMY sin amarillo): cian = 1−R, magenta = 1−G.
// Lo rojo de la foto va a la magenta, lo azul al cian — se conserva la
// relación cromática de la imagen, no sólo su luminosidad.
export function separar(img) {
  const n = img.w * img.h;
  const c = new Float32Array(n), m = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    let cc = clamp(niveles(1 - img.data[o] / 255)) * TINTA_MAX;
    let mm = clamp(niveles(1 - img.data[o + 1] / 255)) * TINTA_MAX;
    const total = cc + mm;
    if (total > TOTAL_MAX) { const k = TOTAL_MAX / total; cc *= k; mm *= k; }
    c[i] = cc; m[i] = mm;
  }
  return { c, m };
}

// Punto agrupado con ángulo de trama, como una prensa: cada tinta lleva su
// ángulo para que el sobreimpreso no genere muaré.
function tramaPunto(cob, w, h, anguloGrados, lpi = LPI) {
  const T = DPI / lpi;
  const a = (anguloGrados * Math.PI) / 180;
  const cosA = Math.cos(a), sinA = Math.sin(a);
  const px = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = (x * cosA - y * sinA) / T, v = (x * sinA + y * cosA) / T;
      const d = (Math.cos(2 * Math.PI * u) + Math.cos(2 * Math.PI * v)) / 4 + 0.5;
      px[y * w + x] = cob[y * w + x] > d ? 1 : 0;
    }
  }
  return px;
}

// Vista previa: tinta sobre papel. Multiplicar es lo que hacen dos tintas
// translúcidas al sobreimprimirse.
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

// Plancha: negro = cobertura de esa tinta. Es el archivo que va a la impresora.
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

// Devuelve la vista previa del sobreimpreso (lo que se ve), las dos planchas
// (lo que se imprime) y la cobertura de tinta de cada una (si es imprimible).
function procesar(original, w, h, lpi = LPI) {
  const remuestreada = remuestrear(original, w, h);
  const { c, m } = separar(remuestreada);
  const pc = tramaPunto(c, w, h, ANGULO_CIAN, lpi);
  const pm = tramaPunto(m, w, h, ANGULO_MAGENTA, lpi);
  return {
    previa: componer([{ px: pc, tinta: CIAN }, { px: pm, tinta: MAGENTA }], w, h),
    planchas: { cian: plancha(pc, w, h), magenta: plancha(pm, w, h) },
    cobertura: { cian: cobertura(pc), magenta: cobertura(pm) },
  };
}

// Para el pliego: la imagen se recorta a la caja que le toca, a la resolución
// de trama (400 dpi). Trama fina (LPI_MOCKUP): el PDF de salida es mockup y se
// mira en pantalla; el archivo riso real usará LPI (45) con sus planchas.
export function procesarImagen(buf, mime, anchoPt, altoPt) {
  return procesar(decodificar(buf, mime),
                  Math.round((anchoPt / 72) * DPI), Math.round((altoPt / 72) * DPI), LPI_MOCKUP);
}

// Para el visor: misma separación y sin recorte — en la web la imagen conserva
// su proporción. Misma trama fina que el pliego (LPI_MOCKUP): el visor sigue
// viendo lo mismo que saldrá en el PDF de salida.
export function procesarParaWeb(buf, mime, anchoPx = 1600) {
  const original = decodificar(buf, mime);
  const w = Math.min(anchoPx, original.w);
  return procesar(original, w, Math.round((w * original.h) / original.w), LPI_MOCKUP);
}
