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

```git pull && cd back && npm install && cd .. && pm2 reload tres-app```

## Lectura

Para inspeccionar la base de datos:

```node inspect-db.mjs```

## Copia

Para copiar la base de datos: 

```docker cp identificador:/home/node/trilium-data/document.db /home/usuaio/trilium-backup.db```

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

