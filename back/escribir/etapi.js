// etapi.js — cliente mínimo de la ETAPI de Trilium.
//
// Cuatro operaciones, que son el "backend" del editor: listar el árbol, bajar
// el contenido de una nota, consultar su versión remota y subir contenido.

export function clienteEtapi({ base, token }) {
  async function pedir(ruta, opciones = {}) {
    const res = await fetch(`${base}/etapi${ruta}`, {
      ...opciones,
      headers: { Authorization: token, ...(opciones.headers || {}) }
    });
    if (!res.ok) {
      const cuerpo = await res.text().catch(() => '');
      throw new Error(`ETAPI ${opciones.method || 'GET'} ${ruta} → ${res.status} ${cuerpo.slice(0, 200)}`);
    }
    return res;
  }

  return {
    async info() {
      return (await pedir('/app-info')).json();
    },
    async nota(id) {
      return (await pedir(`/notes/${id}`)).json();
    },
    async rama(id) {
      return (await pedir(`/branches/${id}`)).json();
    },
    async contenido(id) {
      return (await pedir(`/notes/${id}/content`)).text();
    },
    async subirContenido(id, texto) {
      await pedir(`/notes/${id}/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: texto
      });
    },

    // Recorre el árbol desde las raíces, en el orden de Trilium (notePosition).
    // Devuelve [{ nota, ruta, rutaIds, nivel, parte }] sin las notas ocultas ni
    // protegidas. `rutaIds` es lo que va en el href de un enlace (#root/…).
    async arbol(raices) {
      const salida = [];
      const visitar = async (id, ruta, rutaIds, nivel, parte) => {
        const nota = await this.nota(id);
        if (nota.isProtected || id.startsWith('_')) return;
        const titulo = nota.title;
        const rutaAqui = [...ruta, titulo];
        const idsAqui = [...rutaIds, id];
        salida.push({ nota, ruta: rutaAqui, rutaIds: idsAqui, nivel, parte: parte ?? titulo });
        const hijos = await Promise.all(
          (nota.childBranchIds || []).map(async (b) => this.rama(b))
        );
        hijos.sort((a, b) => a.notePosition - b.notePosition);
        for (const h of hijos) await visitar(h.noteId, rutaAqui, idsAqui, nivel + 1, parte ?? titulo);
      };
      for (const r of raices) await visitar(r, [], [], 0, null);
      return salida;
    }
  };
}
