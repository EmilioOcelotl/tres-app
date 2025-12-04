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

