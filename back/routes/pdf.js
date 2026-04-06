// routes/pdf.js
import express from 'express';
import PDFDocument from 'pdfkit';
import turndown from 'turndown';
import path from 'path';
import { fileURLToPath } from 'url';
import { NoteService } from '../services/noteService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();
const noteService = new NoteService();
const fontsPath = path.join(__dirname, '..', '..', 'assets', 'fonts');

// Paleta
const COLOR_ACCENT = '#00b4b4';
const COLOR_TEXT   = '#111111';
const COLOR_DIM    = '#888888';

// Geometría de página
const PAGE_W  = 595;
const PAGE_H  = 595;
const MARGIN  = 54;

// Regla horizontal fina
function reglaTenue(doc, y, color = '#dddddd', grosor = 0.4) {
  doc.save()
     .moveTo(MARGIN, y)
     .lineTo(PAGE_W - MARGIN, y)
     .strokeColor(color)
     .lineWidth(grosor)
     .stroke()
     .restore();
}

// Footers con número de página — se llama antes de doc.end()
function insertarFooters(doc, fontPath, primeraPaginaContenido) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    if (i < primeraPaginaContenido) continue;
    doc.switchToPage(range.start + i);

    // Suspender el margen inferior para poder dibujar en esa zona
    // Sin esto, doc.text() detecta y > maxY y abre una página nueva en blanco
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    const pageNum = i - primeraPaginaContenido + 1;
    const ruleY   = PAGE_H - savedBottom + 8;
    const numY    = ruleY + 6;

    reglaTenue(doc, ruleY, '#e0e0e0', 0.3);
    doc.fillColor(COLOR_DIM)
       .font(fontPath)
       .fontSize(7.5)
       .text(String(pageNum), MARGIN, numY, {
         width: PAGE_W - MARGIN * 2,
         align: 'center',
         lineBreak: false
       });

    doc.page.margins.bottom = savedBottom;
  }
}

// Insertar imagen con caption — lista para capturas de pantalla
function insertarImagen(doc, rutaImagen, caption, fontPath, figNum) {
  const maxWidth = PAGE_W - MARGIN * 2;
  const espacioMin = 180;

  if (doc.y + espacioMin > PAGE_H - MARGIN) {
    doc.addPage();
  }

  doc.moveDown(0.8);

  try {
    doc.image(rutaImagen, MARGIN, doc.y, { fit: [maxWidth, 260], align: 'center' });
  } catch (e) {
    doc.fillColor(COLOR_DIM)
       .font(fontPath)
       .fontSize(8)
       .text(`[imagen: ${rutaImagen}]`);
  }

  doc.moveDown(0.5);

  if (caption) {
    const label = figNum ? `Fig. ${figNum}  ` : '—  ';
    doc.fillColor(COLOR_ACCENT).font(fontPath).fontSize(8).text(label, { continued: true });
    doc.fillColor(COLOR_DIM).fontSize(8).text(caption, { lineGap: 2 });
  }

  doc.moveDown(1.2);
}

function insertarIndice(doc, capitulos, fontPath) {
  doc.addPage();

  doc.fillColor(COLOR_ACCENT)
     .font(fontPath)
     .fontSize(10)
     .text('ÍNDICE', { align: 'left', characterSpacing: 3 })
     .moveDown(0.5);

  reglaTenue(doc, doc.y, COLOR_ACCENT, 0.5);
  doc.moveDown(1);

  for (const capitulo of capitulos) {
    insertarNodoIndice(doc, capitulo, fontPath, 0);
  }

  doc.moveDown(2);
}

function insertarNodoIndice(doc, nodo, fontPath, nivel) {
  const indent = nivel * 16;

  let fontSize;
  switch (nivel) {
    case 0:  fontSize = 10; break;
    case 1:  fontSize = 9.5; break;
    default: fontSize = 9;
  }

  doc.fillColor(nivel === 0 ? COLOR_ACCENT : COLOR_TEXT)
     .font(fontPath)
     .fontSize(fontSize)
     .text(nodo.title, { indent });

  doc.moveDown(nivel === 0 ? 0.4 : 0.2);

  if (nodo.title && nodo.title.toLowerCase() === 'referencias') return;

  if (nodo.children && nodo.children.length > 0) {
    for (const hijo of nodo.children) {
      insertarNodoIndice(doc, hijo, fontPath, nivel + 1);
    }
  }
}

// Renderizar segmentos de texto e imagen en el doc
async function renderizarConImagenes(doc, markdown, fontPath, noteService) {
  const partes = markdown.split(/(\[\[IMAGEN:[^\]]+\]\])/g);

  for (const parte of partes) {
    const mImagen = parte.match(/^\[\[IMAGEN:([^|\]]+)(?:\|([^\]]*))?\]\]$/);

    if (mImagen) {
      const attachmentId = mImagen[1];
      const caption      = mImagen[2] ? mImagen[2].trim() : '';
      try {
        const adjunto = await noteService.getAttachmentBlob(attachmentId);
        if (adjunto && adjunto.content) {
          const imgBuffer = Buffer.isBuffer(adjunto.content)
            ? adjunto.content
            : Buffer.from(adjunto.content);

          const maxWidth    = PAGE_W - MARGIN * 2;
          const maxHeight   = 240;
          const minUtil     = 120;
          const footerBuf   = 18;
          const captionH    = caption ? 20 : 0;

          const disponible = PAGE_H - MARGIN - footerBuf - doc.y - 8 - captionH;
          const fitHeight  = disponible >= minUtil
            ? Math.min(disponible, maxHeight)
            : maxHeight;

          if (disponible < minUtil) doc.addPage();

          doc.moveDown(0.5);
          doc.image(imgBuffer, MARGIN, doc.y, { fit: [maxWidth, fitHeight], align: 'center' });
          doc.moveDown(0.6);

          if (caption) {
            doc.fillColor(COLOR_DIM)
               .font(fontPath)
               .fontSize(7.5)
               .text(caption, MARGIN, doc.y, {
                 width: maxWidth,
                 align: 'left',
                 lineGap: 2
               });
          }

          doc.moveDown(1);
        }
      } catch (e) {
        console.error('Error insertando imagen adjunta:', e.message);
      }
    } else {
      const texto = parte.trim();
      if (texto) {
        doc.fillColor(COLOR_TEXT)
           .font(fontPath)
           .fontSize(9.5)
           .text(texto, { paragraphGap: 4, lineGap: 3 });
      }
    }
  }
}

async function procesarContenidoJerarquico(doc, nodo, turndownService, nivel = 0, contadorPaginas, fontPath, omitirTitulo = false, noteSvc = null) {
  if (!nodo) return contadorPaginas;

  let fontSize, isTitle;

  if (!omitirTitulo) {
    switch (nivel) {
      case 0:
        doc.addPage();
        fontSize = 15;
        isTitle  = true;

        doc.fillColor(COLOR_ACCENT)
           .font(fontPath)
           .fontSize(fontSize)
           .text(nodo.title.toUpperCase(), { align: 'left', paragraphGap: 6, characterSpacing: 1 })
           .moveDown(0.4);

        reglaTenue(doc, doc.y, COLOR_ACCENT, 0.5);
        doc.moveDown(1);
        break;

      case 1:
        fontSize = 12;
        isTitle  = true;
        if (doc.y + fontSize * 3 > PAGE_H - MARGIN) doc.addPage();

        doc.fillColor(COLOR_TEXT)
           .font(fontPath)
           .fontSize(fontSize)
           .text(nodo.title, { paragraphGap: 5 })
           .moveDown(0.4);
        break;

      case 2:
        fontSize = 10.5;
        isTitle  = true;
        if (doc.y + fontSize * 3 > PAGE_H - MARGIN) doc.addPage();

        doc.fillColor(COLOR_TEXT)
           .font(fontPath)
           .fontSize(fontSize)
           .text(nodo.title, { paragraphGap: 4 })
           .moveDown(0.3);
        break;

      case 3:
        fontSize = 10;
        isTitle  = true;
        if (doc.y + fontSize * 3 > PAGE_H - MARGIN) doc.addPage();

        doc.fillColor(COLOR_TEXT)
           .font(fontPath)
           .fontSize(fontSize)
           .text(nodo.title, { paragraphGap: 4 })
           .moveDown(0.25);
        break;

      case 4:
        fontSize = 10;
        isTitle  = true;
        if (doc.y + fontSize * 3 > PAGE_H - MARGIN) doc.addPage();

        doc.fillColor(COLOR_TEXT)
           .font(fontPath)
           .fontSize(fontSize)
           .text(nodo.title, { paragraphGap: 4 })
           .moveDown(0.2);
        break;

      default:
        fontSize = 9;
        isTitle  = false;
    }
  }

  if (nodo.content && nodo.content.trim() !== '') {
    let markdown;
    try {
      const content = Buffer.isBuffer(nodo.content) ? nodo.content.toString('utf8') : nodo.content;
      markdown = turndownService.turndown(content);
    } catch (error) {
      console.error('Error procesando contenido:', error);
      markdown = '(error al procesar contenido)';
    }

    if (markdown.trim() !== '') {
      await renderizarConImagenes(doc, markdown, fontPath, noteSvc);
      doc.moveDown(0.4);
    }

    contadorPaginas++;
  }

  if (nodo.children && nodo.children.length > 0) {
    const esReferencias = nodo.title && nodo.title.trim().toLowerCase() === 'referencias';
    const omitirTituloHijos = omitirTitulo || esReferencias;
    for (const hijo of nodo.children) {
      contadorPaginas = await procesarContenidoJerarquico(
        doc, hijo, turndownService, nivel + 1, contadorPaginas, fontPath, omitirTituloHijos, noteSvc
      );
    }
  }

  return contadorPaginas;
}

router.get('/', async (req, res) => {
  try {
    const fontPath = path.join(fontsPath, 'SpaceGrotesk.ttf');
    console.log('Usando fuente en:', fontPath);

    const fs = await import('fs');
    if (!fs.existsSync(fontPath)) {
      throw new Error(`No se encuentra la fuente: ${fontPath}`);
    }

    const rootFiltrado = await noteService.getCompleteTree();

    const doc = new PDFDocument({
      size: [PAGE_W, PAGE_H],
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      bufferPages: true
    });

    let contadorPaginas = 0;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="TEA.pdf"');
    doc.pipe(res);

    const turndownService = turndown({
      headingStyle: 'atx',
      bulletListMarker: '-',
      codeBlockStyle: 'fenced'
    });

    turndownService.addRule('nbsp', {
      filter: ['nbsp'],
      replacement: () => ' '
    });

    turndownService.addRule('triliumFigure', {
      filter: (node) => {
        return node.nodeName === 'FIGURE' &&
               node.className && node.className.includes('image');
      },
      replacement: (content, node) => {
        const img = node.querySelector('img');
        if (!img) return '';
        const src = img.getAttribute('src') || '';
        const match = src.match(/api\/attachments\/([^/]+)\//);
        if (!match) return '';
        const figcaption = node.querySelector('figcaption');
        const caption = figcaption ? figcaption.textContent.trim() : '';
        return `\n\n[[IMAGEN:${match[1]}|${caption}]]\n\n`;
      }
    });

    // ── PORTADA ──────────────────────────────────────────────────────────────
    doc.moveDown(2.5);

    doc.fillColor(COLOR_DIM)
       .font(fontPath)
       .fontSize(8.5)
       .text('UNIVERSIDAD NACIONAL AUTÓNOMA DE MÉXICO', { align: 'right' })
       .moveDown(0.5);

    doc.fillColor(COLOR_DIM)
       .font(fontPath)
       .fontSize(8.5)
       .text('Programa de Maestría y Doctorado en Música', { align: 'right' })
       .text('Facultad de Música', { align: 'right' })
       .text('Instituto de Ciencias Aplicadas y Tecnología', { align: 'right' })
       .text('Instituto de Investigaciones Antropológicas', { align: 'right' })
       .moveDown(2);

    reglaTenue(doc, doc.y, '#cccccc', 0.4);
    doc.moveDown(2);

    doc.fillColor(COLOR_ACCENT)
       .font(fontPath)
       .fontSize(18)
       .text('TRES ESTUDIOS ABIERTOS', { align: 'right', characterSpacing: 1 })
       .moveDown(0.5);

    doc.fillColor(COLOR_DIM)
       .font(fontPath)
       .fontSize(8.5)
       .text(
         'Escritura de código en Javascript para el performance audiovisual y la investigación artística',
         { align: 'right', lineGap: 4 }
       )
       .moveDown(1.5);

    doc.fillColor(COLOR_DIM)
       .font(fontPath)
       .fontSize(8.5)
       .text('Que para optar por el grado de', { align: 'right' })
       .moveDown(0.6);

    doc.fillColor(COLOR_TEXT)
       .font(fontPath)
       .fontSize(10)
       .text('Doctor en Música', { align: 'right' })
       .text('Tecnología Musical', { align: 'right' })
       .moveDown(0.6);

    doc.fillColor(COLOR_DIM)
       .font(fontPath)
       .fontSize(8.5)
       .text('Presenta', { align: 'right' })
       .moveDown(0.5);

    doc.fillColor(COLOR_TEXT)
       .font(fontPath)
       .fontSize(12)
       .text('Emilio Ocelotl Reyes', { align: 'right' })
       .moveDown(0.6);

    doc.fillColor(COLOR_DIM)
       .font(fontPath)
       .fontSize(8.5)
       .text('Tutor Principal: Hugo Solís', { align: 'right' })
       .text('Comité tutor: Iracema de Andrade y Fernando Monreal', { align: 'right' });

    // Página en blanco antes del índice
    doc.addPage();

    // ── CAPÍTULOS ─────────────────────────────────────────────────────────────
    const aclaracionesChapter = rootFiltrado.children?.find(ch =>
      ch.title && ch.title.trim().toLowerCase().includes('aclaraciones')
    );
    let remainingChapters = rootFiltrado.children?.filter(
      ch => ch !== aclaracionesChapter && ch.title && ch.title.toLowerCase() !== 'referencias'
    ) || [];
    let referencesNode = rootFiltrado.children?.find(
      ch => ch.title && ch.title.toLowerCase() === 'referencias'
    );

    const capitulosParaIndice = [];
    if (aclaracionesChapter) capitulosParaIndice.push(aclaracionesChapter);
    capitulosParaIndice.push(...remainingChapters);
    if (referencesNode) capitulosParaIndice.push(referencesNode);

    const capitulosFiltrados = capitulosParaIndice.filter(
      c => !c.title?.toLowerCase().includes('tres estudios')
    );

    console.log('Capítulos en índice:', capitulosFiltrados.map(c => c.title));

    // Página 0: portada / Página 1: en blanco / Página 2: índice → no numeradas
    insertarIndice(doc, capitulosFiltrados, fontPath);
    const PAGINAS_NO_NUMERADAS = 3;

    if (aclaracionesChapter) {
      contadorPaginas = await procesarContenidoJerarquico(
        doc, aclaracionesChapter, turndownService, 0, contadorPaginas, fontPath, false, noteService
      );
    }

    for (const capitulo of remainingChapters) {
      contadorPaginas = await procesarContenidoJerarquico(
        doc, capitulo, turndownService, 0, contadorPaginas, fontPath, false, noteService
      );
    }

    if (referencesNode) {
      contadorPaginas = await procesarContenidoJerarquico(
        doc, referencesNode, turndownService, 0, contadorPaginas, fontPath, false, noteService
      );
    }

    // ── FOOTERS ───────────────────────────────────────────────────────────────
    insertarFooters(doc, fontPath, PAGINAS_NO_NUMERADAS);

    doc.end();
    console.log('PDF generado exitosamente');

  } catch (err) {
    console.error('Error generando PDF:', err);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Error al generar el PDF',
        details: err.message
      });
    }
  }
});

export default router;
