// tunel.js — túnel SSH al Trilium del servidor, sólo mientras dura la operación.
//
// Si el puerto local ya responde (un túnel abierto a mano, por ejemplo), se usa
// tal cual y no se cierra al final. Si no, se lanza `ssh -N -L` con la terminal
// heredada para que la contraseña se pida ahí mismo.

import net from 'net';
import { spawn } from 'child_process';

function puertoAbierto(puerto) {
  return new Promise((resolve) => {
    const s = net.connect(puerto, '127.0.0.1');
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
  });
}

export async function abrirTunel({ host, puertoRemoto, puertoLocal }) {
  if (await puertoAbierto(puertoLocal)) return { cerrar: () => {}, propio: false };

  const ssh = spawn('ssh', [
    '-N', '-o', 'ExitOnForwardFailure=yes',
    '-L', `${puertoLocal}:localhost:${puertoRemoto}`, host
  ], { stdio: 'inherit' });

  let salio = null;
  ssh.once('exit', (code) => { salio = code ?? 1; });

  // Hay que dar tiempo a teclear la contraseña.
  const limite = Date.now() + 120_000;
  while (Date.now() < limite) {
    if (salio !== null) throw new Error(`ssh terminó (código ${salio}) antes de abrir el túnel`);
    if (await puertoAbierto(puertoLocal)) {
      return { cerrar: () => ssh.kill(), propio: true };
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  ssh.kill();
  throw new Error('el túnel no abrió en 2 minutos');
}
