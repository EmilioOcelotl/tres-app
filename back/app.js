// app.js - Servidor completo con front y API
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { pdfRoutes, threejsRoutes } from './routes/index.js';
import { generarSnapshot } from './utils/mdSnapshot.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 8081;

app.use(cors());

// Servir archivos estáticos del front (index.html, main.js, style.css)
app.use(express.static(path.resolve(__dirname, '../front')));

// Servir assets generales (fonts, img, snd, data)
app.use('/assets', express.static(path.resolve(__dirname, '../assets')));

// Ruta de presentación para PDF
app.get('/pdf', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <title>Tres Estudios Abiertos — PDF</title>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Space+Mono&display=swap" rel="stylesheet">
      <style>
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        html, body {
          height: 100%;
          background: #060608;
          color: #d0d8e0;
          font-family: 'Space Mono', monospace;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .container {
          width: 320px;
          border: 1px solid rgba(0, 180, 180, 0.2);
          padding: 36px 32px;
        }

        .title {
          color: #00b4b4;
          font-size: 0.72em;
          letter-spacing: 0.25em;
          text-transform: uppercase;
          margin-bottom: 24px;
        }

        .rule {
          height: 1px;
          background: rgba(0, 180, 180, 0.2);
          margin-bottom: 24px;
        }

        .label {
          font-size: 0.68em;
          letter-spacing: 0.15em;
          text-transform: uppercase;
          color: rgba(208, 216, 224, 0.45);
          margin-bottom: 10px;
        }

        .status {
          font-size: 0.75em;
          color: rgba(208, 216, 224, 0.7);
          min-height: 1.4em;
        }

        .status.done {
          color: #00b4b4;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="title">Tres Estudios Abiertos</div>
        <div class="rule"></div>
        <div class="label">documento</div>
        <div class="status" id="status">generando</div>
      </div>
      <script>
        const status = document.getElementById('status');
        let dots = 0;
        const interval = setInterval(() => {
          dots = (dots + 1) % 4;
          status.textContent = 'generando' + '.'.repeat(dots);
        }, 500);

        setTimeout(() => {
          clearInterval(interval);
          status.textContent = 'descarga iniciada';
          status.className = 'status done';
        }, 1500);

        setTimeout(() => {
          window.location.href = '/api/pdf';
        }, 2000);
      </script>
    </body>
    </html>
  `);
});

// Montar rutas de API
app.use('/api/pdf', pdfRoutes);
app.use('/api/3d', threejsRoutes);

// Health check
app.get('/health', (req,res) => {
  res.json({
    status: 'OK',
    service: 'Tres Estudios Abiertos API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    endpoints: {
      pdf: '/api/pdf',
      threejs: '/api/3d',
      health: '/health'
    }
  });
});

// Ruta de bienvenida
app.get('/', (req,res) => {
  res.sendFile(path.resolve(__dirname, '../front/index.html'));
});

// Rutas no encontradas
app.use('*', (req,res) => {
  res.status(404).json({
    error: 'Ruta no encontrada',
    path: req.originalUrl
  });
});

// Manejo global de errores
app.use((err, req,res,next) => {
  console.error('Error global:', err);
  res.status(500).json({ error: 'Error interno del servidor', message: err.message });
});

app.listen(port, () => {
  generarSnapshot();
  console.log(`=`.repeat(60));
  console.log(`🚀 Servidor corriendo!`);
  console.log(`📍 http://localhost:${port}`);
  console.log(`📄 PDF: http://localhost:${port}/pdf`);
  console.log(`🎮 Front: http://localhost:${port}/`);
  console.log(`🎮 Three.js: http://localhost:${port}/api/3d/structure`);
  console.log(`=`.repeat(60));
});
