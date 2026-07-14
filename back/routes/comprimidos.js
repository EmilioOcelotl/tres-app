// routes/comprimidos.js — API del visor web de archivos comprimidos (Parte III).
// La web regenera: sin semilla, cada petición produce una instancia nueva.
// Con semilla, la instancia es reproducible mientras la BD no cambie.

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generarInstancia } from '../comprimidos/instancia.js';
import { traducirReceta } from '../comprimidos/traducir.js';
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
// GET /api/comprimidos/instancia?receta=iteracion-zine&semilla=12
router.get('/instancia', async (req, res) => {
  try {
    const nombre = path.basename(String(req.query.receta || ''));
    const ruta = path.join(recetasDir, `${nombre}.md`);
    if (!nombre || !fs.existsSync(ruta)) {
      return res.status(404).json({ error: `Receta no encontrada: "${nombre}"` });
    }
    const semilla = req.query.semilla !== undefined
      ? parseInt(req.query.semilla, 10)
      : Math.floor(Math.random() * 9000) + 1;   // la web regenera
    const instancia = await generarInstancia(ruta, semilla);
    res.json(instancia);
  } catch (err) {
    console.error('Error generando instancia:', err);
    res.status(500).json({ error: err.message });
  }
});

// Imagen adjunta de una nota (las notas embeben api/attachments/<id>/image/…)
router.get('/attachment/:id', async (req, res) => {
  try {
    const blob = await noteService.getAttachmentBlob(req.params.id);
    if (!blob || !blob.content) return res.status(404).json({ error: 'Adjunto no encontrado' });
    res.set('Content-Type', blob.mime || 'application/octet-stream');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(blob.content);
  } catch (err) {
    console.error('Error sirviendo adjunto:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
