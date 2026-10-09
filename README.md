# tres-app

Plataforma integral para la tesis "Tres Estudios Abiertos" - gestión, visualización 3D y exportación PDF de notas desde Trilium Notes.

## Back

API Node.js que lee la base de datos de Trilium Notes y genera: PDF de la tesis completa + estructura JSON para visualización 3D.

## Front

Archivos estáticos en la carpeta `front/` para visualización de notas sin Three.js:

* index.html
* main.js
* style.css

Permite ver la estructura de notas, desplegar hijos y consultar contenido de cada nota.

### Mockup: citas como fuerza en el grafo 3D

`front/mockup-orbitas.html` — mockup autónomo (datos sintéticos, no requiere la BD)
para decidir la distribución de Referencias y Parte II en el grafo. Se sirve como
cualquier estático (`npm start` y abrir `/mockup-orbitas.html`). Panel de variantes
en vivo; cualquier parámetro puede fijarse por URL (`?citeStrength=0.4`), `?ff=N`
adelanta N ticks de simulación (capturas headless), `?top` vista superior, `?debug`
imprime métricas de la nube.

**Decisión aprobada (2026-07-13):** Referencias funciona como Parte II — nube libre
sin forma impuesta, deformada por los vínculos de cita reales del documento. Las
refs citadas se descuelgan hacia sus notas citantes; las huérfanas quedan sueltas
(la visualización registra el avance de la escritura). Parámetros: fuerza cita 0.4,
distancia 24, arcos siempre visibles con opacidad 0.5 (0.85 al seleccionar).
El modo anillo orbital quedó descartado pero disponible en el mockup.

**Plan de port al front real:**

1. **Back** — `/api/3d/structure` agrega `crossLinks: [{source, target}]`: escanear
   el contenido de todas las notas del árbol por hrefs `#root/.../<noteId>` (último
   segmento = id, como `extraerNoteIdDeEnlace` en `back/routes/pdf.js`), filtrar a
   ids del árbol. Las citas desde Parte II entran igual (Norman 2013 se cita desde
   ambas Partes y queda tensada entre las dos).
2. **Front** (`main.js`) — `forceLink` de citas (0.4/24); arcos Bezier con degradado
   origen→destino (opacidad 0.5, brillo en selección); refs citadas brillantes vs
   huérfanas atenuadas; y los tres ajustes de física del mockup: carga de refs -50
   (con -160 el sistema se estira en pesa), `velocityDecay 0.5` + `alphaDecay 0.004`
   (el acople de citas crea un vaivén que con la curva original se congela a media
   fase), inicialización de refs arriba (el eje refs↔cuerpo es bistable). Sesgo
   vertical de refs sube a 40/0.2. De paso: fix del toggle REFS (ocultar también
   líneas y arcos, no solo esferas).

## Uso

Instalar dependencias:

```npm install```

Ejecutar la aplicación:

```npm start```

Con nodemon:

```npm run dev```

O usar pm2:

```pm2 start back/app.js --name "tres-app"```

Actualizar todo en el servidor:

```git pull && npm install && pm2 reload tres-app```

El `npm install` va en la **raíz**, no en `back/`. Las dependencias que el arranque
importa de forma eager (`jpeg-js`, `pngjs`, vía `comprimidos/riso.js`) sólo están
declaradas en el `package.json` de la raíz; si se instala desde `back/` se crea
`back/node_modules`, Node deja de subir a resolverlas y el proceso muere con
`ERR_MODULE_NOT_FOUND` antes de `app.listen()`. Cualquier commit que agregue
dependencias exige `npm install` en el deploy.

## Lectura

Para inspeccionar la base de datos:

```node inspect-db.mjs```

## Copia

Para copiar la base de datos desde el contenedor:

```docker cp identificador:/home/node/trilium-data/document.db /home/usuario/trilium-backup.db```

### Traer la última versión de la base al repo local

```./back/scripts/traer-db.sh```

Deja la base en `back/database/document.db`, borra los `-wal`/`-shm` locales e
imprime la última modificación registrada para cotejarla.

El script espera dos variables, en el entorno o en un `.env` en la raíz (no versionado):

```
TRILIUM_SSH_HOST=<alias-de-ssh-config>
TRILIUM_REMOTE_DB=/ruta/en/el/servidor/trilium-data/document.db
```

Equivalente a mano:

```
ssh "$TRILIUM_SSH_HOST" "sqlite3 '$TRILIUM_REMOTE_DB' \".backup '/tmp/tres-snapshot.db'\"" \
  && scp "$TRILIUM_SSH_HOST:/tmp/tres-snapshot.db" back/database/document.db \
  && rm -f back/database/document.db-wal back/database/document.db-shm
```

**No usar `scp` directo sobre `document.db`.** Trilium corre en `journal_mode=wal`:
las escrituras recientes viven en `document.db-wal` hasta el siguiente checkpoint,
así que una copia directa se trae el estado del último checkpoint y no lo que se ve
en la interfaz. El fallo es silencioso — llegan los cambios viejos, faltan los de las
últimas horas. `sqlite3 .backup` pide el snapshot con el WAL ya incorporado; es el
mismo mecanismo que usa el script de sync de producción. Para confirmar una sospecha:

```
sqlite3 back/database/document.db "select max(utcDateModified) from notes;"   # UTC
ls -la back/database/document.db                                              # mtime local
```

Si el primero queda muy por detrás del segundo (ojo: UTC contra CST/UTC−6), falta WAL.

## Sincronización 

Para copiar la base de datos con un script y se ejecuta con cron cada cierto tiempo.

```
#!/bin/bash

# ==============================
# Configuración
# ==============================

SOURCE_DB="/ruta/a/base_origen/document.db"
DESTINATION_DB="/ruta/a/base_destino/document.db"
TEMP_DB="/tmp/document_backup.db"

# ==============================
# Backup seguro usando sqlite
# ==============================

sqlite3 "$SOURCE_DB" ".backup '$TEMP_DB'"

# ==============================
# Reemplazar base destino
# ==============================

mv "$TEMP_DB" "$DESTINATION_DB"

echo "Sincronización completada: $(date)"
```

Dar permisos de ejecución: 

```chmod +x /ruta/del/script/sync_sqlite_db.sh```

Programar ejecución: 

```crontab -e```

Agregar la tarea: 

```0 2 * * * /ruta/del/script/sync_sqlite_db.sh```

### Qué base se lee

El destino del script tiene que caer en `back/database/`. La app resuelve la ruta así
(`back/config/database.js`):

1. Si existe la variable de entorno `TRILIUM_DB`, usa esa ruta y no busca más.
2. Si no, toma el archivo `.db` **más reciente** de `back/database/`.

Dentro del contenedor de Trilium el archivo siempre se llama `document.db`; el nombre del
destino lo decide el script de sync. La regla del más reciente existe porque en desarrollo
conviven copias con nombres distintos.

Dos cosas que conviene tener presentes:

- **La ruta se resuelve una sola vez, al cargar el módulo.** El contenido sí se relee en cada
  consulta, así que el cron actualiza los datos sin reiniciar; pero si cambia el *nombre* del
  archivo hay que reiniciar el proceso.
- **Si hay más de un `.db` en el directorio gana el mtime más nuevo, sin avisar.** En producción
  conviene fijar la ruta explícita para que no dependa de la heurística:

```pm2 set tres-app:TRILIUM_DB /ruta/al/repo/back/database/<archivo>.db```

## Corpus sonoro

El material que suena en el grafo y en el visor de comprimidos vive en
`assets/snd/corpus/`: 19 fragmentos de 45 s, mono, normalizados a −20 LUFS.
Están **versionados**, así que un `git pull` los trae y en producción no hay nada
que construir.

Reconstruirlos (sólo en la máquina del autor):

```
npm run corpus                  todos
npm run corpus -- --solo=metro-cdmx
npm run corpus -- --dry         sólo mide, no escribe audio
```

**Ojo con `--solo`:** reescribe `catalogo.json` sólo con ese material y borra las
fichas de los demás. Sirve para probar un tramo; para agregar o cambiar un
material hay que reconstruir con `npm run corpus` (los mp3 que no cambiaron
salen idénticos).

Las grabaciones fuente **no están en el repo** —son de campo, pesan gigas y no
todas pertenecen a este proyecto—, así que `npm run corpus` sólo funciona donde
existan las rutas que declara `assets/snd/fuentes.json`, relativas a `$HOME`. Ese
archivo dice de qué grabación sale cada fragmento, desde qué segundo y con qué
criterio; `assets/snd/catalogo.json` guarda la ficha medida de cada uno
(sonoridad, pico, ganancia aplicada, quietud, centroide) con un bloque
`_medicion` que explica los descriptores.

Requiere `ffmpeg` en el PATH.

## Escribir desde la terminal

`npm run escribir` permite escribir las notas de la tesis en `emacs -nw` y
devolverlas a Trilium. Sólo `bajar` y `subir` necesitan red; escribir, no.

```
npm run escribir -- bajar       trae las notas a la copia local
npm run escribir                lista → número → emacs; sesiones de 30 min
npm run escribir -- --minutos 45 --descanso 5
npm run escribir -- estado      qué cambió localmente
npm run escribir -- subir       manda a Trilium lo que cambió
```

**Configuración, una vez.** En Trilium: Opciones → ETAPI → crear token. Guardarlo
fuera del repo:

```
mkdir -p ~/.config/escribir
echo '{ "token": "…" }' > ~/.config/escribir/config.json
chmod 600 ~/.config/escribir/config.json
```

Por defecto se conecta por SSH al host `ocelotl` y al Trilium del puerto 8085 del
servidor (contenedor `trilium-tesis`). `bajar` y `subir` abren un túnel sólo
mientras trabajan y piden la contraseña de SSH. Si ya hay uno abierto en el
puerto local, lo usan sin pedir nada:

```ssh -N -L 37840:localhost:8085 ocelotl```

Todo se puede cambiar en el mismo `config.json` (`ssh.host`, `ssh.puertoRemoto`,
`ssh.puertoLocal`, `carpeta`, `raices`, `minutos`, `descanso`, `editor`).

**En la copia local** (`~/.local/share/escribir/tres-app/`) cada nota de texto es
un `.md`. Las figuras aparecen como `<!-- trilium:bloque N · figura: … -->`:
se pueden mover o borrar, pero no editar por dentro. Los enlaces internos son
`[[título]]`.

**En emacs:**
- `@` busca una nota por nombre e inserta el enlace. En pantalla se ve sólo el
  título, en azul. Un retroceso justo después lo borra entero. `C-g` cancela y
  escribe una `@` normal.
- El tiempo del bloque aparece en la línea de modo (`⏱ 32:10`). Al cumplirse
  sólo avisa; `M-x escribir-mas` lo alarga.
- Ortografía siempre encendida, en español e inglés a la vez (paquete `jinx` de
  GNU ELPA; pide `libenchant-2-dev`). `M-$` corrige; en sus opciones,
  `@palabra` la agrega a `back/escribir/palabras.txt` (versionado) y
  `+palabra` la acepta sólo por la sesión. Sin `jinx` instalado, emacs abre
  igual, sin revisión.
- Al cerrar emacs, el programa dice cuántas palabras cambió la nota y vuelve a
  la lista. Con el bloque cumplido ofrece el descanso.

**Al subir**, cada nota se compara con la versión que se bajó. Si cambió en
Trilium mientras tanto, no se sube y la versión del servidor queda en
`remotos/` para comparar. Una nota con un `[[enlace]]` que no apunta a ninguna
nota tampoco se sube.

## Endpoints

- GET / - Documentación de la API y endpoints disponibles
- GET /health - Estado del servicio
- GET /pdf - Interfaz web para generación de PDF
- GET /api/pdf - Descarga directa del PDF completo de la tesis
- GET /api/3d/structure - Estructura jerárquica de notas para visualización 3D
- GET /api/3d/note/:id/content - Contenido específico de una nota (HTML/Markdown)
- GET /api/3d/search?q=query - Búsqueda de notas por término (case-insensitive)
- GET /api/3d/health - Estado específico de la API 3D

## Contexto Técnico

- Base de datos: SQLite de Trilium Notes (tablas: notes, branches, blobs)
- Estructura: Árbol jerárquico con parentNoteId y notePosition
- Raíz: Nota "Tres" o "Tres Estudios Abiertos"
- Filtros: Excluye automáticamente notas con título "Hidden Notes" y sus hijos
- Procesamiento: HTML a Markdown para PDF, JSON optimizado para Three.js
- Arquitectura: Modular (routes/services/utils) con NoteService como núcleo principal

