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

// Recolectar entradas del índice desde el árbol (sin página, solo estructura)
function recolectarEntradasToc(nodo, nivel, omitirTitulo, resultado) {
  if (!nodo) return;
  if (!omitirTitulo && !nodo.title?.toLowerCase().includes('tres estudios')) {
    resultado.push({ title: nodo.title, nivel, pageIndex: 0 });
  }
  if (nodo.children) {
    const esReferencias = nodo.title?.trim().toLowerCase() === 'referencias';
    const omitirHijos = omitirTitulo || esReferencias;
    for (const hijo of nodo.children) {
      recolectarEntradasToc(hijo, nivel + 1, omitirHijos, resultado);
    }
  }
}

// Pre-renderizar el índice a stream nulo para contar cuántas páginas necesita
async function contarPaginasIndice(entradas, fontPath) {
  const { Writable } = await import('stream');
  const nullStream = new Writable({ write(chunk, enc, cb) { cb(); } });
  const tempDoc = new PDFDocument({
    size: [PAGE_W, PAGE_H],
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    bufferPages: true
  });
  tempDoc.pipe(nullStream);

  tempDoc.fillColor(COLOR_ACCENT)
         .font(fontPath).fontSize(10)
         .text('ÍNDICE', { align: 'left', characterSpacing: 3 })
         .moveDown(0.5);
  tempDoc.moveDown(1);

  const colWidth = PAGE_W - MARGIN * 2;
  const pageCol  = 28;

  for (const entry of entradas) {
    const indent    = entry.nivel * 16;
    const textWidth = colWidth - indent - pageCol;
    const fontSize  = entry.nivel === 0 ? 10 : entry.nivel === 1 ? 9.5 : 9;
    const y = tempDoc.y;
    tempDoc.font(fontPath).fontSize(fontSize)
           .text(entry.title, MARGIN + indent, y, { width: textWidth, lineBreak: false });
    tempDoc.fillColor(COLOR_DIM)
           .text('–', MARGIN + indent + textWidth, y, { width: pageCol, align: 'right', lineBreak: false });
    tempDoc.fillColor(COLOR_TEXT).moveDown(entry.nivel === 0 ? 0.4 : 0.2);
  }

  const count = tempDoc.bufferedPageRange().count;
  tempDoc.end();
  return count;
}

function insertarIndiceConPaginas(doc, tocCtx, fontPath, paginasNoNumeradas, indicePageStart, indicePagesCount) {
  const colWidth    = PAGE_W - MARGIN * 2;
  const pageCol     = 28;
  const bottomLimit = PAGE_H - MARGIN - 18; // 18pt reservados para footer

  let paginaActual = 0;

  const irAPagina = (offset) => {
    paginaActual = offset;
    doc.switchToPage(indicePageStart + offset);
    doc.y = MARGIN;
  };

  irAPagina(0);

  doc.fillColor(COLOR_ACCENT)
     .font(fontPath)
     .fontSize(10)
     .text('ÍNDICE', { align: 'left', characterSpacing: 3 })
     .moveDown(0.5);

  reglaTenue(doc, doc.y, COLOR_ACCENT, 0.5);
  doc.moveDown(1);

  for (const entry of tocCtx) {
    const fontSize  = entry.nivel === 0 ? 10 : entry.nivel === 1 ? 9.5 : 9;
    const alturaEst = fontSize * 2; // estimación conservadora por entrada

    // Salto manual de página si no cabe la entrada
    if (doc.y + alturaEst > bottomLimit && paginaActual < indicePagesCount - 1) {
      irAPagina(paginaActual + 1);
    }

    const indent    = entry.nivel * 16;
    const textWidth = colWidth - indent - pageCol;
    const pageNum   = entry.pageIndex - paginasNoNumeradas + 1;
    const y         = doc.y;

    doc.fillColor(entry.nivel === 0 ? COLOR_ACCENT : COLOR_TEXT)
       .font(fontPath)
       .fontSize(fontSize)
       .text(entry.title, MARGIN + indent, y, { width: textWidth, lineBreak: false });

    doc.fillColor(COLOR_DIM)
       .fontSize(fontSize)
       .text(String(pageNum), MARGIN + indent + textWidth, y, {
         width: pageCol,
         align: 'right',
         lineBreak: false
       });

    doc.moveDown(entry.nivel === 0 ? 0.4 : 0.2);
  }
}

// Renderizar segmentos de texto e imagen en el doc
async function renderizarConImagenes(doc, markdown, fontPath, noteService, figCtx) {
  const partes = markdown.split(/(\[\[IMAGEN:[^\]]+\]\])/g);

  for (const parte of partes) {
    const mImagen = parte.match(/^\[\[IMAGEN:([^|\]]+)(?:\|([^\]]*))?\]\]$/);

    if (mImagen) {
      const attachmentId = mImagen[1];
      const caption      = mImagen[2] ? mImagen[2].trim() : '';

      figCtx.count++;
      const numFig    = figCtx.count;
      const pageIndex = doc.bufferedPageRange().count - 1;
      figCtx.figuras.push({ num: numFig, caption, pageIndex });

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
          const captionH    = 20;

          const disponible = PAGE_H - MARGIN - footerBuf - doc.y - 8 - captionH;
          const fitHeight  = disponible >= minUtil
            ? Math.min(disponible, maxHeight)
            : maxHeight;

          if (disponible < minUtil) doc.addPage();

          doc.moveDown(0.5);
          doc.image(imgBuffer, MARGIN, doc.y, { fit: [maxWidth, fitHeight], align: 'center' });
          doc.moveDown(0.6);

          // Etiqueta de figura + caption
          const label = `Fig. ${numFig}`;
          doc.fillColor(COLOR_ACCENT)
             .font(fontPath)
             .fontSize(7.5)
             .text(label, MARGIN, doc.y, { continued: !!caption, lineGap: 2 });

          if (caption) {
            doc.fillColor(COLOR_DIM)
               .fontSize(7.5)
               .text(`  ${caption}`, { lineGap: 2 });
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

function insertarIndiceFiguras(doc, figCtx, fontPath, paginasNoNumeradas) {
  if (figCtx.figuras.length === 0) return;

  doc.addPage();

  doc.fillColor(COLOR_ACCENT)
     .font(fontPath)
     .fontSize(10)
     .text('ÍNDICE DE FIGURAS', { align: 'left', characterSpacing: 3 })
     .moveDown(0.5);

  reglaTenue(doc, doc.y, COLOR_ACCENT, 0.5);
  doc.moveDown(1);

  const colWidth = PAGE_W - MARGIN * 2;
  const numCol   = 36; // ancho reservado para "Fig. N"
  const pageCol  = 28; // ancho reservado para el número de página
  const capWidth = colWidth - numCol - pageCol;

  for (const fig of figCtx.figuras) {
    const pageNum = fig.pageIndex - paginasNoNumeradas + 1;
    const y = doc.y;

    // Número de figura
    doc.fillColor(COLOR_ACCENT)
       .font(fontPath)
       .fontSize(8.5)
       .text(`Fig. ${fig.num}`, MARGIN, y, { width: numCol, lineBreak: false });

    // Caption
    doc.fillColor(COLOR_TEXT)
       .fontSize(8.5)
       .text(fig.caption || '—', MARGIN + numCol, y, { width: capWidth, lineGap: 2 });

    // Número de página (alineado a la derecha)
    doc.fillColor(COLOR_DIM)
       .fontSize(8.5)
       .text(String(pageNum), MARGIN + numCol + capWidth, y, {
         width: pageCol,
         align: 'right',
         lineBreak: false
       });

    doc.moveDown(0.5);
  }
}

async function procesarContenidoJerarquico(doc, nodo, turndownService, nivel = 0, contadorPaginas, fontPath, omitirTitulo = false, noteSvc = null, figCtx = null, tocCtx = null) {
  if (!nodo) return contadorPaginas;

  let fontSize, isTitle;

  if (!omitirTitulo) {
    switch (nivel) {
      case 0:
        doc.addPage();
        fontSize = 18;
        isTitle  = true;

        if (tocCtx && !nodo.title?.toLowerCase().includes('tres estudios')) {
          tocCtx.push({ title: nodo.title, nivel, pageIndex: doc.bufferedPageRange().count - 1 });
        }

        {
          const titleY = (PAGE_H - fontSize) / 2;
          reglaTenue(doc, titleY - 24, COLOR_ACCENT, 0.5);
          doc.fillColor(COLOR_ACCENT)
             .font(fontPath)
             .fontSize(fontSize)
             .text(nodo.title.toUpperCase(), MARGIN, titleY, {
               width: PAGE_W - MARGIN * 2,
               align: 'center',
               characterSpacing: 1
             });
          reglaTenue(doc, titleY + fontSize * 1.6, COLOR_ACCENT, 0.5);
        }
        doc.addPage();
        break;

      case 1:
        doc.addPage();
        fontSize = 15;
        isTitle  = true;

        if (tocCtx && !nodo.title?.toLowerCase().includes('tres estudios')) {
          tocCtx.push({ title: nodo.title, nivel, pageIndex: doc.bufferedPageRange().count - 1 });
        }

        doc.fillColor(COLOR_ACCENT)
           .font(fontPath)
           .fontSize(fontSize)
           .text(nodo.title.toUpperCase(), { align: 'left', paragraphGap: 6, characterSpacing: 1 })
           .moveDown(0.4);

        reglaTenue(doc, doc.y, COLOR_ACCENT, 0.5);
        doc.moveDown(1);
        break;

      case 2:
        fontSize = 9.5;
        isTitle  = true;
        if (doc.y + fontSize * 5 > PAGE_H - MARGIN) doc.addPage();

        if (tocCtx && !nodo.title?.toLowerCase().includes('tres estudios')) {
          tocCtx.push({ title: nodo.title, nivel, pageIndex: doc.bufferedPageRange().count - 1 });
        }

        doc.moveDown(1);
        doc.fillColor(COLOR_TEXT)
           .font(fontPath)
           .fontSize(fontSize)
           .text(nodo.title.toUpperCase(), { characterSpacing: 2.5, paragraphGap: 4 })
           .moveDown(0.3);
        break;

      case 3:
        fontSize = 9.5;
        isTitle  = true;
        if (doc.y + fontSize * 4 > PAGE_H - MARGIN) doc.addPage();

        if (tocCtx && !nodo.title?.toLowerCase().includes('tres estudios')) {
          tocCtx.push({ title: nodo.title, nivel, pageIndex: doc.bufferedPageRange().count - 1 });
        }

        doc.moveDown(0.8);
        doc.fillColor(COLOR_TEXT)
           .font(fontPath)
           .fontSize(fontSize)
           .text(nodo.title, { paragraphGap: 4 })
           .moveDown(0.2);
        break;

      case 4:
        fontSize = 9;
        isTitle  = true;
        if (doc.y + fontSize * 4 > PAGE_H - MARGIN) doc.addPage();

        if (tocCtx && !nodo.title?.toLowerCase().includes('tres estudios')) {
          tocCtx.push({ title: nodo.title, nivel, pageIndex: doc.bufferedPageRange().count - 1 });
        }

        doc.moveDown(0.4);
        doc.fillColor(COLOR_DIM)
           .font(fontPath)
           .fontSize(fontSize)
           .text(nodo.title, { paragraphGap: 4 })
           .moveDown(0.15);
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
      await renderizarConImagenes(doc, markdown, fontPath, noteSvc, figCtx);
      doc.moveDown(0.4);
    }

    contadorPaginas++;
  }

  if (nodo.children && nodo.children.length > 0) {
    const esReferencias = nodo.title && nodo.title.trim().toLowerCase() === 'referencias';
    const omitirTituloHijos = omitirTitulo || esReferencias;
    for (const hijo of nodo.children) {
      contadorPaginas = await procesarContenidoJerarquico(
        doc, hijo, turndownService, nivel + 1, contadorPaginas, fontPath, omitirTituloHijos, noteSvc, figCtx, tocCtx
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
    const figCtx = { count: 0, figuras: [] };

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
       .text('UNIVERSIDAD NACIONAL AUTÓNOMA DE MÉXICO', { align: 'left' })
       .moveDown(0.5);

    doc.fillColor(COLOR_DIM)
       .font(fontPath)
       .fontSize(8.5)
       .text('Programa de Maestría y Doctorado en Música', { align: 'left' })
       .text('Facultad de Música', { align: 'left' })
       .text('Instituto de Ciencias Aplicadas y Tecnología', { align: 'left' })
       .text('Instituto de Investigaciones Antropológicas', { align: 'left' })
       .moveDown(2);

    reglaTenue(doc, doc.y, '#cccccc', 0.4);
    doc.moveDown(2);

    doc.fillColor(COLOR_ACCENT)
       .font(fontPath)
       .fontSize(18)
       .text('TRES ESTUDIOS ABIERTOS', { align: 'left', characterSpacing: 1 })
       .moveDown(0.5);

    doc.fillColor(COLOR_DIM)
       .font(fontPath)
       .fontSize(8.5)
       .text(
         'Escritura de código en Javascript para el performance audiovisual y la investigación artística',
         { align: 'left', lineGap: 4 }
       )
       .moveDown(1.5);

    doc.fillColor(COLOR_DIM)
       .font(fontPath)
       .fontSize(8.5)
       .text('Que para optar por el grado de', { align: 'left' })
       .moveDown(0.6);

    doc.fillColor(COLOR_TEXT)
       .font(fontPath)
       .fontSize(10)
       .text('Doctor en Música', { align: 'left' })
       .text('Tecnología Musical', { align: 'left' })
       .moveDown(0.6);

    doc.fillColor(COLOR_DIM)
       .font(fontPath)
       .fontSize(8.5)
       .text('Presenta', { align: 'left' })
       .moveDown(0.5);

    doc.fillColor(COLOR_TEXT)
       .font(fontPath)
       .fontSize(12)
       .text('Emilio Ocelotl Reyes', { align: 'left' })
       .moveDown(0.6);

    doc.fillColor(COLOR_DIM)
       .font(fontPath)
       .fontSize(8.5)
       .text('Tutor Principal: Hugo Solís', { align: 'left' })
       .text('Comité tutor: Iracema de Andrade y Fernando Monreal', { align: 'left' });

    // Página en blanco (página 1)
    doc.addPage();

    // ── CAPÍTULOS ─────────────────────────────────────────────────────────────
    const aclaracionesChapter = rootFiltrado.children?.find(ch =>
      ch.title && ch.title.trim().toLowerCase().includes('aclaraciones')
    );
    const remainingChapters = rootFiltrado.children?.filter(
      ch => ch !== aclaracionesChapter && ch.title && ch.title.toLowerCase() !== 'referencias'
    ) || [];
    const referencesNode = rootFiltrado.children?.find(
      ch => ch.title && ch.title.toLowerCase() === 'referencias'
    );

    // Pre-calcular páginas que necesita el índice
    const entradasTocVacio = [];
    if (aclaracionesChapter) recolectarEntradasToc(aclaracionesChapter, 0, false, entradasTocVacio);
    for (const cap of remainingChapters) recolectarEntradasToc(cap, 0, false, entradasTocVacio);
    if (referencesNode) recolectarEntradasToc(referencesNode, 0, false, entradasTocVacio);

    const indicePagesCount = await contarPaginasIndice(entradasTocVacio, fontPath);
    console.log(`Índice necesita ${indicePagesCount} páginas`);

    // Reservar exactamente esas páginas como placeholder
    const indicePageIndex = 2;
    for (let i = 0; i < indicePagesCount; i++) doc.addPage();

    // Página 0: portada / Página 1: en blanco / Páginas 2..(2+N-1): índice
    const PAGINAS_NO_NUMERADAS = 2 + indicePagesCount;

    const tocCtx = [];

    if (aclaracionesChapter) {
      contadorPaginas = await procesarContenidoJerarquico(
        doc, aclaracionesChapter, turndownService, 0, contadorPaginas, fontPath, false, noteService, figCtx, tocCtx
      );
    }

    for (const capitulo of remainingChapters) {
      contadorPaginas = await procesarContenidoJerarquico(
        doc, capitulo, turndownService, 0, contadorPaginas, fontPath, false, noteService, figCtx, tocCtx
      );
    }

    if (referencesNode) {
      contadorPaginas = await procesarContenidoJerarquico(
        doc, referencesNode, turndownService, 0, contadorPaginas, fontPath, false, noteService, figCtx, tocCtx
      );
    }

    // ── ÍNDICE (volver a las páginas placeholder y rellenar) ──────────────────
    insertarIndiceConPaginas(doc, tocCtx, fontPath, PAGINAS_NO_NUMERADAS, indicePageIndex, indicePagesCount);

    // Volver a la última página para continuar
    const lastPage = doc.bufferedPageRange().start + doc.bufferedPageRange().count - 1;
    doc.switchToPage(lastPage);

    // ── ÍNDICE DE FIGURAS ─────────────────────────────────────────────────────
    insertarIndiceFiguras(doc, figCtx, fontPath, PAGINAS_NO_NUMERADAS);

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
