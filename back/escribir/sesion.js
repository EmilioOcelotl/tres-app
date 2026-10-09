// sesion.js — la sesión de escritura: lista de notas → emacs → resumen, con
// bloques de trabajo y descansos (pomodoro). Funciona sin red.
//
// El timer sólo avisa: no cierra emacs ni guarda. El fin del bloque vive en un
// archivo (`sesion-fin`, segundos epoch) que comparten este proceso y emacs,
// así `M-x escribir-mas` puede alargar el bloque desde adentro del editor.
// Lo que pasa dentro de emacs (timer, `@` para enlazar) está en escribir.el.

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import readline from 'readline/promises';
import { stdin, stdout } from 'process';
import {
  leerIndice, archivoDe, modificada, palabras, estadoDe, umbral, leerTexto, hash,
  rutas, escribirListaEnlaces, enlacesRotos
} from './local.js';

const ahora = () => Date.now() / 1000;
const mmss = (s) => {
  const t = Math.max(0, Math.round(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

function avisar(titulo, cuerpo) {
  stdout.write('\x07');
  const n = spawn('notify-send', ['-a', 'escribir', titulo, cuerpo], { stdio: 'ignore' });
  n.on('error', () => {});
}

// El elisp vive en escribir.el; aquí sólo se le pasan los archivos y el umbral.
const ESCRIBIR_EL = fileURLToPath(new URL('./escribir.el', import.meta.url));

function elisp(archivoFin, archivoEnlaces, umbralNota) {
  const q = (v) => (v ? JSON.stringify(v) : 'nil');
  return `(progn (setq escribir-archivo-fin ${q(archivoFin)} escribir-archivo-enlaces ${q(archivoEnlaces)}` +
    ` escribir-umbral ${q(umbralNota)})` +
    ` (load ${q(ESCRIBIR_EL)} nil t) (escribir-iniciar))`;
}

export async function sesion(cfg, { minutos, descanso }) {
  const indice = leerIndice(cfg.carpeta);
  if (!indice) {
    console.log('No hay copia local. Corre primero: npm run escribir -- bajar');
    return;
  }
  const editables = indice.notas.filter((e) => e.editable);
  escribirListaEnlaces(cfg.carpeta);
  const archivoFin = path.join(cfg.carpeta, 'sesion-fin');
  const fin = () => Number(fs.readFileSync(archivoFin, 'utf8'));
  const fijarFin = (t) => fs.writeFileSync(archivoFin, String(t));

  const inicio = new Date();
  const palabrasAlInicio = new Map(editables.map((e) => [e.id, palabras(cfg.carpeta, e)]));
  const hashAlInicio = new Map(editables.map((e) => [e.id, hash(leerTexto(cfg.carpeta, e) ?? '')]));
  const tocadas = new Set();
  let bloque = 1;
  let avisado = false;
  fijarFin(ahora() + minutos * 60);

  // El aviso de escritorio corre aunque emacs ocupe la terminal.
  const reloj = setInterval(() => {
    if (!avisado && ahora() >= fin()) {
      avisado = true;
      avisar('Bloque cumplido', `${minutos} min de trabajo. Toca descanso de ${descanso} min.`);
    }
  }, 2000);

  const rl = readline.createInterface({ input: stdin, output: stdout });
  let filtro = null;
  let todas = false;

  try {
    for (;;) {
      // Bloque terminado y de vuelta en la lista: toca descanso.
      if (ahora() >= fin()) {
        const r = (await rl.question(
          `\n⏱ Bloque ${bloque} cumplido. [Enter] descanso de ${descanso} min · s saltar · número = otros minutos · q terminar: `
        )).trim();
        if (r === 'q') break;
        if (r !== 's') {
          const min = /^\d+$/.test(r) ? Number(r) : descanso;
          await descansar(rl, min);
        }
        bloque++;
        avisado = false;
        fijarFin(ahora() + minutos * 60);
      }

      const lista = elegibles(cfg, editables, { filtro, todas });
      pintarLista(cfg, lista, { bloque, resta: fin() - ahora(), filtro, todas });
      const r = (await rl.question('› ')).trim();

      if (r === 'q') break;
      if (r === 't') { todas = !todas; filtro = null; continue; }
      if (r.startsWith('/')) { filtro = r.slice(1).trim().toLowerCase() || null; continue; }
      if (r.startsWith('+') && /^\+\d+$/.test(r)) { fijarFin(Math.max(fin(), ahora()) + Number(r.slice(1)) * 60); avisado = false; continue; }
      if (!/^\d+$/.test(r)) continue;
      const e = lista[Number(r) - 1];
      if (!e) continue;

      const antes = palabras(cfg.carpeta, e);
      rl.pause();
      await abrirEditor(cfg, e, archivoFin);
      rl.resume();
      const despues = palabras(cfg.carpeta, e);
      if (hash(leerTexto(cfg.carpeta, e) ?? '') !== hashAlInicio.get(e.id)) tocadas.add(e.id);
      const dif = despues - antes;
      console.log(`\n${e.titulo}  ${antes}→${despues}w ${estadoDe(e, despues)}  (${dif >= 0 ? '+' : ''}${dif})`);
      for (const f of enlacesRotos(cfg.carpeta, e)) console.log(`  ⚠ enlace sin destino: [[${f}]] — no se va a subir así`);
    }
  } finally {
    clearInterval(reloj);
    rl.close();
    if (fs.existsSync(archivoFin)) fs.unlinkSync(archivoFin);
  }

  resumen(cfg, editables, { inicio, palabrasAlInicio, tocadas, bloques: bloque });
}

function elegibles(cfg, editables, { filtro, todas }) {
  const fuera = (e) => e.ruta.includes('Referencias');
  if (filtro) {
    return editables.filter((e) => e.ruta.join(' ').toLowerCase().includes(filtro));
  }
  if (todas) return editables.filter((e) => !fuera(e));
  // Por defecto: lo modificado y lo que no llega al umbral, en orden del árbol.
  return editables.filter((e) => {
    if (fuera(e)) return false;
    const w = palabras(cfg.carpeta, e);
    return modificada(cfg.carpeta, e) || (w > 0 && w < umbral(e)) || (w === 0 && e.hijos === 0);
  });
}

function pintarLista(cfg, lista, { bloque, resta, filtro, todas }) {
  const vista = filtro ? `búsqueda «${filtro}»` : todas ? 'todas' : 'por escribir';
  console.log(`\n── ${vista} · bloque ${bloque} · ⏱ ${resta > 0 ? mmss(resta) : '¡tiempo!'} ──`);
  lista.forEach((e, i) => {
    const w = palabras(cfg.carpeta, e);
    const marca = modificada(cfg.carpeta, e) ? '✎' : ' ';
    const sangria = '  '.repeat(Math.max(0, e.nivel - 1));
    const lugar = e.nivel > 1 && !todas ? `  · ${e.ruta.slice(1, -1).join(' › ')}` : '';
    console.log(`${String(i + 1).padStart(3)} ${marca}${estadoDe(e, w)} ${todas ? sangria : ''}${e.titulo}  ${w}w${lugar}`);
  });
  console.log('número abre · /texto busca · t todas/por escribir · +N alarga el bloque · q termina');
}

function abrirEditor(cfg, e, archivoFin) {
  const [cmd, ...args] = cfg.editor;
  return new Promise((resolve) => {
    const enlaces = e.tipo === 'text' ? rutas(cfg.carpeta).enlaces : null;
    const p = spawn(cmd, [...args, archivoDe(cfg.carpeta, e), '--eval', elisp(archivoFin, enlaces, umbral(e))], { stdio: 'inherit' });
    p.on('exit', resolve);
    p.on('error', (err) => { console.error(`✗ no se pudo abrir ${cmd}: ${err.message}`); resolve(); });
  });
}

async function descansar(rl, minutos) {
  const finDescanso = ahora() + minutos * 60;
  rl.pause();
  await new Promise((resolve) => {
    const tic = () => {
      const resta = finDescanso - ahora();
      stdout.write(`\r☕ descanso ${mmss(resta)}  (Enter para volver antes) `);
      if (resta <= 0) { terminar(); }
    };
    const terminar = () => {
      clearInterval(t);
      stdin.off('data', alTeclear);
      avisar('Fin del descanso', 'De vuelta a la escritura.');
      stdout.write('\n');
      resolve();
    };
    const alTeclear = () => terminar();
    const t = setInterval(tic, 1000);
    stdin.resume();
    stdin.once('data', alTeclear);
    tic();
  });
  rl.resume();
}

function resumen(cfg, editables, { inicio, palabrasAlInicio, tocadas, bloques }) {
  const min = Math.round((Date.now() - inicio.getTime()) / 60000);
  const notas = editables.filter((e) => tocadas.has(e.id)).map((e) => {
    const antes = palabrasAlInicio.get(e.id);
    const despues = palabras(cfg.carpeta, e);
    return { id: e.id, titulo: e.titulo, antes, despues, estado: estadoDe(e, despues) };
  });
  const neto = notas.reduce((s, n) => s + n.despues - n.antes, 0);
  console.log(`\n${min} min · ${bloques} bloque${bloques === 1 ? '' : 's'} · ${notas.length} nota${notas.length === 1 ? '' : 's'} · ${neto >= 0 ? '+' : ''}${neto}w`);
  for (const n of notas) console.log(`  ${n.titulo} ${n.antes}→${n.despues} ${n.estado}`);
  if (notas.length) console.log('Para mandarlo a Trilium: npm run escribir -- subir');

  const registro = { inicio: inicio.toISOString(), fin: new Date().toISOString(), minutos: min, bloques, palabras: neto, notas };
  fs.appendFileSync(path.join(cfg.carpeta, 'sesiones.jsonl'), JSON.stringify(registro) + '\n');
}
