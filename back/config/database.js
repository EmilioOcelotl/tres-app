// config/database.js
import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const databaseDir = path.join(__dirname, '..', 'database');

// En local la copia de la base de Trilium llega con nombres distintos según
// cómo se haya hecho (`loving_kepler.db`, `document.db`, ...), así que se toma
// la más reciente del directorio. En producción no varía: el script de sync la
// fija en `loving_kepler.db` (ese nombre viene de un contenedor de Docker viejo,
// no de Trilium — adentro del contenedor siempre es `document.db`).
//
// Ojo: la ruta se resuelve UNA vez, al cargar el módulo. El contenido sí se
// relee en cada getDatabase(), pero un cambio de nombre pide reiniciar. Y si
// llega a haber más de un .db en el directorio, gana el mtime más nuevo sin
// avisar: en producción conviene pinear TRILIUM_DB en el env de pm2.
function resolverRutaBase() {
  if (process.env.TRILIUM_DB) return path.resolve(process.env.TRILIUM_DB);

  const candidatos = fs.existsSync(databaseDir)
    ? fs.readdirSync(databaseDir)
        .filter((f) => f.endsWith('.db'))
        .map((f) => {
          const ruta = path.join(databaseDir, f);
          return { ruta, mtime: fs.statSync(ruta).mtimeMs };
        })
        .sort((a, b) => b.mtime - a.mtime)
    : [];

  if (candidatos.length === 0) {
    return path.join(databaseDir, 'document.db');
  }
  return candidatos[0].ruta;
}

const databasePath = resolverRutaBase();

export function getDatabase() {
  return new sqlite3.Database(databasePath, sqlite3.OPEN_READONLY);
}

export { databasePath };
