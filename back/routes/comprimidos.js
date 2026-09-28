// routes/comprimidos.js — API del visor web de archivos comprimidos (Parte III).
// La web regenera: sin semilla, cada petición produce una instancia nueva.
// Con semilla, la instancia es reproducible mientras la BD no cambie.

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generarInstancia, generarInstanciaDeTexto, notasDeArranque } from '../comprimidos/instancia.js';
import { traducirReceta, traducirTexto } from '../comprimidos/traducir.js';
import { renderizarPDF } from '../comprimidos/render.js';
import { procesarParaWeb } from '../comprimidos/riso.js';
import { NoteService } from '../services/noteService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const recetasDir = path.join(__dirname, '..', 'comprimidos', 'recetas');

const router = express.Router();
const noteService = new NoteService();

// Lista de recetas disponibles (nombre de archivo + cues traducidos)
router.get('/recetas', (req, res) => {
  try {
    const recetas = fs.readdirSync(recetasDir)
      .filter(f => f.endsWith('.md'))
      .map(f => {
        const { params } = traducirReceta(path.join(recetasDir, f));
        return { archivo: path.basename(f, '.md'), ...params };
      });
    res.json({ recetas });
  } catch (err) {
    console.error('Error listando recetas:', err);
    res.status(500).json({ error: err.message });
  }
});

// Instancia de un archivo comprimido: receta + semilla → caminata congelada.
// GET /api/comprimidos/instancia?receta=primera-caminata&semilla=9
router.get('/instancia', async (req, res) => {
  try {
    const nombre = path.basename(String(req.query.receta || ''));
    const ruta = path.join(recetasDir, `${nombre}.md`);
    if (!nombre || !fs.existsSync(ruta)) {
      return res.status(404).json({ error: `Receta no encontrada: "${nombre}"` });
    }
    // La web regenera: sin semilla — o con `semilla=nueva`, que es lo que manda
    // REGENERAR desde una edición congelada — el servidor sortea una. Sólo un
    // número la fija. Ojo: `parseInt('nueva')` es NaN, y un NaN aquí se cuela
    // hasta `generarInstancia`, que lo descarta y vuelve a la semilla de la
    // receta; el resultado es que REGENERAR repetía siempre la misma caminata.
    const pedida = parseInt(req.query.semilla, 10);
    const semilla = Number.isFinite(pedida)
      ? pedida
      : Math.floor(Math.random() * 9000) + 1;
    const instancia = await generarInstancia(ruta, semilla);
    res.json(instancia);
  } catch (err) {
    console.error('Error generando instancia:', err);
    res.status(500).json({ error: err.message });
  }
});

// Imagen adjunta de una nota (las notas embeben api/attachments/<id>/image/…).
// Con `?riso` se entrega ya separada a cian/magenta y tramada, igual que en el
// pliego: el visor muestra la imagen impresa, no la original de pantalla.
const cacheRiso = new Map();

router.get('/attachment/:id', async (req, res) => {
  try {
    const riso = req.query.riso !== undefined;
    if (riso && cacheRiso.has(req.params.id)) {
      res.set('Content-Type', 'image/png');
      res.set('Cache-Control', 'public, max-age=3600');
      return res.send(cacheRiso.get(req.params.id));
    }

    const blob = await noteService.getAttachmentBlob(req.params.id);
    if (!blob || !blob.content) return res.status(404).json({ error: 'Adjunto no encontrado' });

    if (riso && /image\/(jpe?g|jpg|png)/i.test(blob.mime || '')) {
      const { previa } = procesarParaWeb(blob.content, blob.mime);
      cacheRiso.set(req.params.id, previa);
      res.set('Content-Type', 'image/png');
      res.set('Cache-Control', 'public, max-age=3600');
      return res.send(previa);
    }

    res.set('Content-Type', blob.mime || 'application/octet-stream');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(blob.content);
  } catch (err) {
    console.error('Error sirviendo adjunto:', err);
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------ recetas de visitante
//
// Un visitante escribe su receta en el visor (controles + texto editable) y ve o
// descarga su cuadernillo. No se publica ni se guarda: la instancia y el PDF se
// generan, se entregan y se olvidan. Pasa por el mismo traductor que las recetas
// del autor, con topes para que una receta no tumbe el servidor casero.

const TOPES = {
  texto: 4000,                  // caracteres de la receta completa
  portada: 400,                 // caracteres del epígrafe escrito
  pasos: [2, 8],
  recorte: [10, 150],
};

function recetaDeVisitante(body) {
  const texto = typeof body?.receta === 'string' ? body.receta : '';
  if (!texto.trim()) throw new ErrorReceta('La receta está vacía');
  if (texto.length > TOPES.texto) throw new ErrorReceta(`La receta pasa de ${TOPES.texto} caracteres`);
  const { params, narrativa } = traducirTexto(texto);   // lanza si un cue no es válido
  const fuera = (v, [a, b]) => !Number.isFinite(v) || v < a || v > b;
  if (fuera(params.pasos, TOPES.pasos)) throw new ErrorReceta(`pasos va de ${TOPES.pasos[0]} a ${TOPES.pasos[1]}`);
  if (fuera(params.recorte, TOPES.recorte)) throw new ErrorReceta(`recorte va de ${TOPES.recorte[0]} a ${TOPES.recorte[1]}`);
  if (narrativa.portada.join(' ').length > TOPES.portada) {
    throw new ErrorReceta(`El epígrafe pasa de ${TOPES.portada} caracteres`);
  }
  // La semilla puede venir aparte (la que el visor ya mostró, para que el PDF
  // sea la misma caminata que la vista previa) o como cue en la receta. Si no
  // viene de ninguna forma, se sortea.
  const pedida = parseInt(body?.semilla, 10);
  const semilla = Number.isFinite(pedida) && pedida > 0 ? pedida
                : /^\s*semilla\s*:/im.test(texto) ? params.semilla
                : Math.floor(Math.random() * 9000) + 1;
  return { texto, semilla };
}

class ErrorReceta extends Error {}

// Límite por IP en memoria: ventana de diez minutos. El servidor está detrás de
// Cloudflare, así que la IP real viene en la cabecera.
const VENTANA_MS = 10 * 60 * 1000;
const LIMITES = { instancia: 60, pdf: 12 };
const visitas = new Map();      // `${tipo}:${ip}` → [timestamps]

function excedido(req, tipo) {
  const ip = req.headers['cf-connecting-ip']
          || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
          || req.ip;
  const clave = `${tipo}:${ip}`;
  const ahora = Date.now();
  const recientes = (visitas.get(clave) || []).filter(t => ahora - t < VENTANA_MS);
  if (recientes.length >= LIMITES[tipo]) { visitas.set(clave, recientes); return true; }
  recientes.push(ahora);
  visitas.set(clave, recientes);
  if (visitas.size > 5000) visitas.clear();   // tope de memoria, burdo pero suficiente
  return false;
}

// Un PDF con imágenes tarda 1–4 s (la separación riso es lo caro). Se atienden
// pocos a la vez; si no hay lugar, se pide reintentar en vez de encolar.
const MAX_PDF_SIMULTANEOS = 2;
let pdfEnCurso = 0;

const json = express.json({ limit: '16kb' });

function responderError(res, err) {
  if (err instanceof ErrorReceta || /^(Cue|Formato|Tipo de cobertura|No encontré|afinidad|cobertura)/.test(err.message)) {
    return res.status(400).json({ error: err.message });
  }
  console.error('Error en receta de visitante:', err);
  res.status(500).json({ error: 'No se pudo generar el cuadernillo' });
}

// Notas donde puede arrancar una caminata (≥15 palabras, sin Referencias).
let cacheNotas = { t: 0, notas: null };
router.get('/notas', async (req, res) => {
  try {
    if (!cacheNotas.notas || Date.now() - cacheNotas.t > 60_000) {
      cacheNotas = { t: Date.now(), notas: await notasDeArranque() };
    }
    res.json({ notas: cacheNotas.notas });
  } catch (err) {
    console.error('Error listando notas de arranque:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/comprimidos/receta/instancia  { receta, semilla? } → instancia
router.post('/receta/instancia', json, async (req, res) => {
  if (excedido(req, 'instancia')) return res.status(429).json({ error: 'Demasiadas recetas seguidas; espera unos minutos' });
  try {
    const { texto, semilla } = recetaDeVisitante(req.body);
    res.json(await generarInstanciaDeTexto(texto, semilla));
  } catch (err) {
    responderError(res, err);
  }
});

// POST /api/comprimidos/receta/pdf  { receta, semilla } → application/pdf
router.post('/receta/pdf', json, async (req, res) => {
  if (excedido(req, 'pdf')) return res.status(429).json({ error: 'Demasiados PDF seguidos; espera unos minutos' });
  if (pdfEnCurso >= MAX_PDF_SIMULTANEOS) return res.status(503).json({ error: 'El servidor está imprimiendo otros cuadernillos; intenta en unos segundos' });
  pdfEnCurso++;
  try {
    const { texto, semilla } = recetaDeVisitante(req.body);
    const instancia = await generarInstanciaDeTexto(texto, semilla);
    const { pdf } = await renderizarPDF(instancia);
    const base = (instancia.params.titulo || 'cuadernillo')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'cuadernillo';
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="${base}-s${instancia.params.semilla}.pdf"`);
    res.set('Cache-Control', 'no-store');
    res.send(pdf);
  } catch (err) {
    responderError(res, err);
  } finally {
    pdfEnCurso--;
  }
});

// Un cuerpo que no es JSON (o que pasa del límite) es error del que pide, no
// del servidor: sin esto caía al manejador global como 500.
router.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
    return res.status(400).json({ error: 'La receta no llegó bien formada' });
  }
  next(err);
});

export default router;
