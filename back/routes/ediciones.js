// ediciones.js — la cara pública de la Parte III.
//
// El visor de `/comprimido.html` regenera: cada carga sortea una caminata sobre
// la base viva, y eso es lo que la pieza argumenta. Pero un enlace que va
// impreso en la tesis no puede regenerar, tiene que decir siempre lo mismo.
// De ahí la separación: aquí se sirven ediciones congeladas (lo citable) y
// dentro de cada una sigue vivo REGENERAR (lo explorable).

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const edicionesDir = path.join(__dirname, '..', 'comprimidos', 'ediciones');
const frontDir = path.join(__dirname, '..', '..', 'front');

const router = express.Router();

const leerIndice = () => {
  const ruta = path.join(edicionesDir, 'indice.json');
  if (!fs.existsSync(ruta)) return { meta: 7, publicadas: 0, ediciones: [] };
  return JSON.parse(fs.readFileSync(ruta, 'utf8'));
};

// Un slug es <receta>-s<semilla>; nada más entra a componer una ruta de disco.
const slugValido = (s) => /^[a-z0-9-]+-s\d+$/i.test(s);
const dirEdicion = (slug) => path.join(edicionesDir, slug);

router.get('/', (req, res) => {
  const { meta, publicadas, ediciones } = leerIndice();
  const filas = ediciones.map(e => `
      <li>
        <a class="ed" href="/comprimidos/${e.slug}">
          <span class="tit">${e.titulo}</span>
          <span class="meta">semilla ${e.semilla} · ${e.formato} · ${e.pasos} pasos · ${e.imagenes} imágenes</span>
        </a>
        ${e.pdf ? `<a class="pdf" href="/comprimidos/${e.slug}/cuadernillo.pdf">PDF</a>` : ''}
      </li>`).join('');

  res.type('html').send(`<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Archivos comprimidos — Tres Estudios Abiertos</title>
<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
  :root { --cian:#0097b2; --magenta:#d6007f; --tinta:#1a1a1a; --papel:#f4f2ec; }
  * { box-sizing:border-box; }
  body { margin:0; padding:3rem 1.5rem; background:var(--papel); color:var(--tinta);
         font:14px/1.6 'Space Mono', monospace; }
  main { max-width:44rem; margin:0 auto; }
  h1 { font-size:1.3rem; letter-spacing:.02em; margin:0 0 .4rem; }
  .sub { color:var(--cian); margin:0 0 2.5rem; font-size:.82rem; }
  .avance { border:1px solid var(--magenta); color:var(--magenta); display:inline-block;
            padding:.15rem .5rem; font-size:.75rem; margin-bottom:2rem; }
  ul { list-style:none; padding:0; margin:0; }
  li { display:flex; align-items:stretch; gap:.6rem; margin-bottom:.7rem; }
  .ed { flex:1; display:block; padding:.9rem 1rem; text-decoration:none; color:inherit;
        border:1px solid rgba(0,0,0,.25); }
  .ed:hover { border-color:var(--cian); }
  .tit { display:block; font-weight:700; }
  .meta { display:block; font-size:.74rem; color:rgba(0,0,0,.55); margin-top:.25rem; }
  .pdf { display:flex; align-items:center; padding:0 .9rem; text-decoration:none;
         border:1px solid rgba(0,0,0,.25); color:var(--magenta); font-size:.75rem; }
  .pdf:hover { border-color:var(--magenta); }
  .nota { margin-top:2.5rem; font-size:.76rem; color:rgba(0,0,0,.55); border-top:1px solid rgba(0,0,0,.15); padding-top:1rem; }
  a.vuelta { color:var(--cian); }
  @media (max-width:480px) { body { padding:2rem 1rem; } li { flex-direction:column; } .pdf { padding:.6rem; justify-content:center; } }
</style></head><body><main>
  <h1>Archivos comprimidos</h1>
  <p class="sub">Parte III — Tres Estudios Abiertos</p>
  <p class="avance">${publicadas} de ${meta} ediciones</p>
  <ul>${filas || '<li>Todavía no hay ediciones publicadas.</li>'}</ul>
  <p class="nota">
    Cada edición es una instancia congelada: una caminata por los enlaces internos
    del documento, fijada por su semilla y por el estado de la base en el momento
    de publicarla. El enlace no cambia. Dentro de cada una, REGENERAR vuelve a
    sortear sobre el documento vivo.<br><br>
    <a class="vuelta" href="/">← volver a la visualización</a>
  </p>
</main></body></html>`);
});

router.get('/:slug/instancia.json', (req, res) => {
  const { slug } = req.params;
  if (!slugValido(slug)) return res.status(404).json({ error: 'Edición no encontrada' });
  const ruta = path.join(dirEdicion(slug), 'instancia.json');
  if (!fs.existsSync(ruta)) return res.status(404).json({ error: `Edición no encontrada: ${slug}` });
  res.sendFile(ruta);
});

router.get('/:slug/cuadernillo.pdf', (req, res) => {
  const { slug } = req.params;
  if (!slugValido(slug)) return res.status(404).send('Edición no encontrada');
  const ruta = path.join(dirEdicion(slug), 'cuadernillo.pdf');
  if (!fs.existsSync(ruta)) return res.status(404).send(`Sin PDF para ${slug}`);
  res.sendFile(ruta);
});

// Pozo compartido: el PNG procesado depende del adjunto, no de la edición.
router.get('/:slug/img/:id.png', (req, res) => {
  const id = req.params.id;
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return res.status(404).end();
  const ruta = path.join(edicionesDir, 'img', `${id}.png`);
  if (!fs.existsSync(ruta)) return res.status(404).end();
  res.set('Cache-Control', 'public, max-age=86400');
  res.sendFile(ruta);
});

// Pozo compartido del sonido congelado: `<material>-<hash>.mp3` (ver publicar.js).
router.get('/:slug/snd/:archivo', (req, res) => {
  const { archivo } = req.params;
  if (!/^[a-z0-9-]+-[0-9a-f]{10}\.mp3$/.test(archivo)) return res.status(404).end();
  const ruta = path.join(edicionesDir, 'snd', archivo);
  if (!fs.existsSync(ruta)) return res.status(404).end();
  // El nombre lleva el hash del contenido: el archivo no cambia nunca.
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.sendFile(ruta);
});

// La edición se ve con el mismo visor; `?edicion=` le dice de dónde leer.
router.get('/:slug', (req, res) => {
  const { slug } = req.params;
  if (!slugValido(slug) || !fs.existsSync(path.join(dirEdicion(slug), 'instancia.json'))) {
    return res.status(404).type('html').send(
      `<p style="font-family:monospace">Edición no encontrada: ${slug} — <a href="/comprimidos">ver el índice</a></p>`);
  }
  res.sendFile(path.join(frontDir, 'comprimido.html'));
});

export default router;
