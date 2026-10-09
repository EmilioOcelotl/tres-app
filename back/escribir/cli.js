#!/usr/bin/env node
// cli.js — escribir la tesis desde la terminal.
//
//   npm run escribir -- bajar    con red: trae las notas a la carpeta local
//   npm run escribir -- estado   sin red: qué cambió localmente
//   npm run escribir -- subir    con red: manda lo que cambió
//   npm run escribir             sin red: elegir nota → emacs -nw, con bloques
//                                de trabajo y descansos (--minutos 30 --descanso 10)
//
// Plan y decisiones en texto/plan-escritura-terminal.md (local).

import fs from 'fs';
import path from 'path';
import { cargarConfig } from './config.js';
import { abrirTunel } from './tunel.js';
import { clienteEtapi } from './etapi.js';
import { htmlAMarkdown, normalizarHtml } from './convertir.js';
import { sesion } from './sesion.js';
import {
  rutas, extension, leerIndice, guardarIndice, archivoDe, modificada, hash,
  palabras, estadoDe, leerTexto, contenidoParaSubir, escribirDesdeOriginal,
  escribirListaEnlaces, enlaces, enlacesRotos, CONVERSION
} from './local.js';

async function conRed(cfg, fn) {
  const tunel = await abrirTunel(cfg.ssh);
  try {
    const api = clienteEtapi({ base: `http://127.0.0.1:${cfg.ssh.puertoLocal}`, token: cfg.token });
    return await fn(api);
  } finally {
    tunel.cerrar();
  }
}

async function bajar(cfg) {
  const r = rutas(cfg.carpeta);
  const previo = leerIndice(cfg.carpeta);
  const previas = new Map((previo?.notas || []).map((e) => [e.id, e]));

  await conRed(cfg, async (api) => {
    const info = await api.info();
    console.log(`Trilium ${info.appVersion} · bajando el árbol…`);
    const arbol = await api.arbol(cfg.raices);

    // Primero el árbol entero: los enlaces [[clave]] necesitan conocer todas
    // las notas antes de convertir cualquiera.
    const notas = arbol.map(({ nota, ruta, rutaIds, nivel, parte }) => {
      const editable = nota.type === 'text' || nota.type === 'code';
      return {
        ...(previas.get(nota.noteId) || {}),
        id: nota.noteId, titulo: nota.title, tipo: nota.type, mime: nota.mime,
        ext: editable ? extension(nota) : undefined,
        ruta, rutaIds, nivel, parte, hijos: (nota.childNoteIds || []).length, editable,
        _nota: nota
      };
    });
    const sinNota = (n) => n.map(({ _nota, ...e }) => e);
    guardarIndice(cfg.carpeta, { ...(previo || {}), notas: sinNota(notas) });

    let bajadas = 0, iguales = 0, reconvertidas = 0, retenidas = 0;
    for (const e of notas) {
      const nota = e._nota;
      if (!e.editable) continue;
      const antes = previas.get(e.id);
      if (antes && modificada(cfg.carpeta, antes)) {
        // Hay cambios locales sin subir: no se pisan.
        retenidas++;
        console.log(`  ✋ ${e.titulo}: tiene cambios sin subir, no se baja`);
        continue;
      }
      const original = path.join(r.originales, e.id);
      if (antes && antes.blobId === nota.blobId && fs.existsSync(archivoDe(cfg.carpeta, antes))) {
        if (antes.conversion === CONVERSION) { iguales++; continue; }
        // Mismo contenido, otra forma de convertirlo: se regenera sin red.
        e.hashBajado = hash(escribirDesdeOriginal(cfg.carpeta, e, fs.readFileSync(original, 'utf8')));
        e.conversion = CONVERSION;
        reconvertidas++;
        continue;
      }
      const contenido = await api.contenido(e.id);
      fs.writeFileSync(original, contenido);
      Object.assign(e, {
        hashBajado: hash(escribirDesdeOriginal(cfg.carpeta, e, contenido)),
        blobId: nota.blobId,
        remotoModificado: nota.utcDateModified,
        conversion: CONVERSION
      });
      bajadas++;
    }

    guardarIndice(cfg.carpeta, { bajado: new Date().toISOString(), trilium: info.appVersion, notas: sinNota(notas) });
    escribirListaEnlaces(cfg.carpeta);
    console.log(`${notas.length} notas en el árbol · ${bajadas} bajadas · ${iguales} sin cambios` +
      `${reconvertidas ? ` · ${reconvertidas} reconvertidas` : ''} · ${retenidas} con cambios locales`);
    console.log(`carpeta: ${cfg.carpeta}`);
  });
}

function estado(cfg) {
  const indice = leerIndice(cfg.carpeta);
  if (!indice) return console.log('No hay copia local. Corre primero: npm run escribir -- bajar');
  const cambiadas = indice.notas.filter((e) => e.editable && modificada(cfg.carpeta, e));
  console.log(`Copia del ${indice.bajado.slice(0, 16).replace('T', ' ')} UTC · ${indice.notas.length} notas`);
  if (!cambiadas.length) return console.log('Sin cambios locales.');
  for (const e of cambiadas) {
    const w = palabras(cfg.carpeta, e);
    console.log(`  ✎ ${estadoDe(e, w)} ${(e.ruta.length > 1 ? e.ruta.slice(1) : e.ruta).join(' › ')}  ${w}w`);
    for (const f of enlacesRotos(cfg.carpeta, e)) console.log(`      ⚠ enlace sin destino: [[${f}]]`);
  }
}

// Sube las notas modificadas. Antes de cada una compara el blob remoto con el
// que se bajó: si el servidor cambió mientras tanto, no se sube y la versión
// remota queda en remotos/ para comparar.
async function subir(cfg) {
  const indice = leerIndice(cfg.carpeta);
  if (!indice) return console.log('No hay copia local.');
  const r = rutas(cfg.carpeta);
  const cambiadas = indice.notas.filter((e) => e.editable && modificada(cfg.carpeta, e));
  if (!cambiadas.length) return console.log('Sin cambios locales: nada que subir.');

  await conRed(cfg, async (api) => {
    for (const e of cambiadas) {
      const remota = await api.nota(e.id);
      if (remota.blobId !== e.blobId) {
        const contenido = await api.contenido(e.id);
        const copia = path.join(r.remotos, `${e.id}.${e.ext}`);
        fs.writeFileSync(copia, e.tipo === 'text'
          ? htmlAMarkdown(contenido, { claveDe: enlaces(cfg.carpeta).claveDe }).md : contenido);
        console.log(`  ✋ ${e.titulo}: cambió en el servidor desde que se bajó. No se sube.`);
        console.log(`     versión del servidor: ${copia}`);
        continue;
      }
      const faltantes = [];
      const nuevo = contenidoParaSubir(cfg.carpeta, e, faltantes);
      if (faltantes.length) {
        console.log(`  ✋ ${e.titulo}: enlaces sin destino, no se sube: ${faltantes.map((f) => `[[${f}]]`).join(', ')}`);
        continue;
      }
      await api.subirContenido(e.id, nuevo);
      const devuelto = await api.contenido(e.id);
      const despues = await api.nota(e.id);
      const igual = e.tipo === 'text' ? normalizarHtml(devuelto) === normalizarHtml(nuevo) : devuelto === nuevo;
      fs.writeFileSync(path.join(r.originales, e.id), devuelto);
      Object.assign(e, {
        hashBajado: hash(leerTexto(cfg.carpeta, e)),
        blobId: despues.blobId,
        remotoModificado: despues.utcDateModified
      });
      guardarIndice(cfg.carpeta, indice);
      const w = palabras(cfg.carpeta, e);
      console.log(`  ↑ ${estadoDe(e, w)} ${e.titulo}  ${w}w${igual ? '' : '  ⚠ Trilium guardó algo distinto de lo enviado; revisar en Trilium'}`);
    }
  });
}

function opcion(nombre, porDefecto) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i > 0 && /^\d+$/.test(process.argv[i + 1] || '') ? Number(process.argv[i + 1]) : porDefecto;
}

async function main() {
  const cfg = cargarConfig();
  const [cmd = 'escribir'] = process.argv.slice(2).filter((a, i, arr) => !a.startsWith('--') && !arr[i - 1]?.startsWith('--'));
  if (cmd === 'bajar') return bajar(cfg);
  if (cmd === 'estado') return estado(cfg);
  if (cmd === 'subir') return subir(cfg);
  if (cmd === 'escribir') {
    return sesion(cfg, { minutos: opcion('minutos', cfg.minutos), descanso: opcion('descanso', cfg.descanso) });
  }
  console.log(`Comando desconocido: ${cmd}. Disponibles: bajar, estado, subir (o nada, para escribir).`);
}

main().catch((err) => {
  console.error(`✗ ${err.message}`);
  process.exit(1);
});
