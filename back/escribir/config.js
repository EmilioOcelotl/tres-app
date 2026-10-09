// config.js — configuración local del editor de terminal.
//
// Vive fuera del repo (~/.config/escribir/config.json, permisos 600) porque
// guarda el token de la ETAPI. Todo lo demás tiene default.

import fs from 'fs';
import os from 'os';
import path from 'path';

export const RUTA_CONFIG = path.join(os.homedir(), '.config', 'escribir', 'config.json');

const DEFAULTS = {
  ssh: { host: 'ocelotl', puertoRemoto: 8085, puertoLocal: 37840 },
  carpeta: path.join(os.homedir(), '.local', 'share', 'escribir', 'tres-app'),
  // Sólo se baja lo que cuelga de estas notas (las tres Partes de la tesis).
  raices: ['e3tzs8MTlFZM', '6EJm5Rn6VLOJ', 'LEUrQ0gOqXEd'],
  minutos: 45,
  descanso: 10,
  editor: ['emacs', '-nw']
};

export function cargarConfig() {
  if (!fs.existsSync(RUTA_CONFIG)) {
    throw new Error(`falta ${RUTA_CONFIG} con { "token": "…" } (Trilium → Opciones → ETAPI)`);
  }
  const propia = JSON.parse(fs.readFileSync(RUTA_CONFIG, 'utf8'));
  const cfg = {
    ...DEFAULTS,
    ...propia,
    ssh: { ...DEFAULTS.ssh, ...(propia.ssh || {}) }
  };
  // Para probar contra otras notas sin tocar la copia de la tesis.
  if (process.env.ESCRIBIR_CARPETA) cfg.carpeta = process.env.ESCRIBIR_CARPETA;
  if (process.env.ESCRIBIR_RAICES) cfg.raices = process.env.ESCRIBIR_RAICES.split(',');
  return cfg;
}
