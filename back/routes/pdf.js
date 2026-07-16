// routes/pdf.js
import express from 'express';
import PDFDocument from 'pdfkit';
import turndown from 'turndown';
import path from 'path';
import { fileURLToPath } from 'url';
import { NoteService } from '../services/noteService.js';
import { tokenizarLineaCodigo, envolverLineaTokens } from '../utils/tokensCodigo.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();
const noteService = new NoteService();
const fontsPath = path.join(__dirname, '..', '..', 'assets', 'fonts');

// Paleta
const COLOR_ACCENT = '#000000';
const COLOR_TEXT   = '#111111';
const COLOR_DIM    = '#888888';

// Notas de código (type=code en Trilium): tipografía y paleta de sintaxis
const FUENTE_MONO      = path.join(fontsPath, 'SpaceMono-Regular.ttf');
const FUENTE_MONO_BOLD = path.join(fontsPath, 'SpaceMono-Bold.ttf');
const COLOR_CODE_COMMENT = '#1a7f37'; // lenguaje natural dentro del formal
const COLOR_CODE_KEYWORD = '#cf222e';
const COLOR_CODE_NUMBER  = '#0550ae';
const COLOR_CODE_STRING  = '#0a3069';
const CODE_BG   = '#f4f4f0';
const CODE_SIZE = 8;
const CODE_GAP  = 3.2;  // interlineado adicional
const CODE_PAD  = 9;    // padding interno del bloque

// Geometría de página
const PAGE_W  = 595;
const PAGE_H  = 595;
const MARGIN  = 72;

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
       .fontSize(8)
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
    doc.fillColor(COLOR_ACCENT).font(fontPath).fontSize(8.5).text(label, { continued: true });
    doc.fillColor(COLOR_DIM).fontSize(8.5).text(caption, { lineGap: 2 });
  }

  doc.moveDown(1.2);
}

// ── Numeración de capítulos y secciones ──────────────────────────────────────
// Los hijos de cada Parte llevan el romano de su Parte como prefijo (I.1, II.3)
// y sus hijos un nivel más (I.2.1). Más profundo no se numera. Agradecimientos
// y Referencias quedan exentos por convención académica.
const TITULOS_SIN_NUMERO = new Set(['agradecimientos', 'referencias']);

function asignarNumeracion(root) {
  for (const parte of root.children || []) {
    const romano = parte.title?.match(/parte\s+([ivx]+)/i)?.[1]?.toUpperCase();
    if (!romano) continue;
    let nCap = 0;
    for (const capitulo of parte.children || []) {
      if (TITULOS_SIN_NUMERO.has(capitulo.title?.trim().toLowerCase())) continue;
      capitulo.numero = `${romano}.${++nCap}`;
      let nSec = 0;
      for (const seccion of capitulo.children || []) {
        seccion.numero = `${capitulo.numero}.${++nSec}`;
      }
    }
  }
}

function tituloConNumero(nodo) {
  return nodo.numero ? `${nodo.numero}  ${nodo.title}` : nodo.title;
}

// Recolectar entradas del índice desde el árbol (sin página, solo estructura)
function recolectarEntradasToc(nodo, nivel, omitirTitulo, resultado) {
  if (!nodo) return;
  if (!omitirTitulo && !nodo.title?.toLowerCase().includes('tres estudios')) {
    resultado.push({ title: tituloConNumero(nodo), nivel, pageIndex: 0 });
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
         .font(fontPath).fontSize(11)
         .text('ÍNDICE', { align: 'left', characterSpacing: 3 })
         .moveDown(0.5);
  tempDoc.moveDown(1);

  const colWidth = PAGE_W - MARGIN * 2;
  const pageCol  = 28;

  for (const entry of entradas) {
    const indent    = entry.nivel * 16;
    const textWidth = colWidth - indent - pageCol;
    const fontSize  = entry.nivel === 0 ? 11 : entry.nivel === 1 ? 10 : 9;
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
     .fontSize(11)
     .text('ÍNDICE', { align: 'left', characterSpacing: 3 })
     .moveDown(0.5);

  reglaTenue(doc, doc.y, COLOR_ACCENT, 0.5);
  doc.moveDown(1);

  for (const entry of tocCtx) {
    const fontSize  = entry.nivel === 0 ? 11 : entry.nivel === 1 ? 10 : 9;
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
       .text(entry.title, MARGIN + indent, y, {
         width: textWidth,
         lineBreak: false,
         goTo: entry.noteId || null
       });

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
// ── Render de markdown de contenido ──────────────────────────────────────────
// El contenido de una nota llega como markdown (vía turndown). Aquí se
// interpretan encabezados internos y negritas; el resto se imprime como cuerpo.
// Los enlaces [texto](url) quedan pendientes de tratamiento propio.

// turndown escapa caracteres literales (\* \# \[ ...) para que no se lean como
// markdown; se limpian al imprimir, después de detectar la estructura.
function desescaparMarkdown(texto) {
  return texto.replace(/\\([\\`*_{}[\]()#+\-.!>~=|])/g, '$1');
}

function renderizarEncabezadoInterno(doc, texto, nivelMd, fontPath) {
  // Encabezado dentro del contenido de una nota: siempre por debajo del
  // título del nodo que lo contiene (los títulos estructurales van de 18 a 10pt).
  const fontSize = nivelMd <= 2 ? 10.5 : 9.5;
  if (doc.y + fontSize * 4 > PAGE_H - MARGIN) doc.addPage();

  // En un encabezado el enlace se reduce a su texto (sin anotación)
  const textoPlano = desescaparMarkdown(texto.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'));

  doc.moveDown(0.6);
  doc.fillColor(COLOR_TEXT)
     .strokeColor(COLOR_TEXT)
     .lineWidth(0.3)
     .font(fontPath)
     .fontSize(fontSize)
     .text(textoPlano, {
       fill: true,
       stroke: true,
       characterSpacing: 0.5,
       paragraphGap: 4
     });
  doc.moveDown(0.15);
}

// Un enlace interno de Trilium tiene la forma #root/<id>/.../<idDestino>;
// el último segmento es el noteId de la nota referenciada.
function extraerNoteIdDeEnlace(url) {
  if (!url.startsWith('#root/')) return null;
  const segmentos = url.split('/').filter(Boolean);
  return segmentos[segmentos.length - 1];
}

function renderizarParrafo(doc, texto, fontPath, linkCtx) {
  // Cada párrafo (separado por línea en blanco) es una cadena `continued`
  // independiente: si la cadena cruza el salto de párrafo, pdfkit arrastra
  // la posición X del último fragmento y desplaza la primera línea siguiente.
  const parrafos = texto.split(/\n[ \t]*\n+/).map(p => p.trim()).filter(p => p.length > 0);

  parrafos.forEach((parrafo, idx) => {
    renderizarSegmentosInline(doc, parrafo, fontPath, linkCtx);
    if (idx < parrafos.length - 1) doc.moveDown(1);
  });
}

function renderizarSegmentosInline(doc, texto, fontPath, linkCtx) {
  // Además de negritas y enlaces markdown, las URLs sueltas (Referencias las
  // traen como texto con href vacío) se anotan como enlace URI.
  const segmentos = texto
    .split(/(\*\*[\s\S]+?\*\*|\[[^\]]+\]\([^)]+\)|https?:\/\/[^\s<>()[\]"]+[^\s<>()[\]".,;:])/g)
    .filter(s => s.length > 0);
  doc.font(fontPath).fontSize(10.5);

  segmentos.forEach((seg, i) => {
    // En texto `continued`, pdfkit hereda las opciones de la llamada anterior:
    // stroke/underline/goTo/link se fijan explícitamente en cada segmento.
    const opciones = {
      continued: i < segmentos.length - 1,
      fill: true,
      stroke: false,
      underline: false,
      goTo: null,
      link: null,
      paragraphGap: 6,
      lineGap: 4
    };

    const mEnlace = seg.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (mEnlace) {
      const textoEnlace = desescaparMarkdown(mEnlace[1].replace(/\*\*/g, ''));
      const url         = mEnlace[2];
      const idDestino   = extraerNoteIdDeEnlace(url);

      if (idDestino && linkCtx && linkCtx.ids.has(idDestino)) {
        opciones.goTo      = idDestino;
        opciones.underline = true;
      } else if (/^https?:/.test(url)) {
        opciones.link      = url;
        opciones.underline = true;
      }
      // Enlace interno a una nota fuera del árbol renderizado: queda solo el texto.

      doc.fillColor(COLOR_TEXT)
         .strokeColor(COLOR_TEXT)
         .lineWidth(0.3)
         .text(textoEnlace, opciones);
      return;
    }

    if (/^https?:\/\//.test(seg)) {
      const url = desescaparMarkdown(seg);
      opciones.link      = url;
      opciones.underline = true;
      doc.fillColor(COLOR_TEXT)
         .strokeColor(COLOR_TEXT)
         .lineWidth(0.3)
         .text(url, opciones);
      return;
    }

    const negrita = seg.startsWith('**') && seg.endsWith('**') && seg.length > 4;
    opciones.stroke = negrita;

    doc.fillColor(COLOR_TEXT)
       .strokeColor(COLOR_TEXT)
       .lineWidth(0.3)
       .text(desescaparMarkdown(negrita ? seg.slice(2, -2) : seg), opciones);
  });
}

// ── Render de notas de código ─────────────────────────────────────────────────
// Las notas type=code de Trilium guardan texto plano (no HTML): pasan directo
// al PDF sin turndown, en monoespaciada, con la indentación intacta y un
// resaltado mínimo pensado para el pseudocódigo de la tesis: comentarios //,
// encabezados de sección en MAYÚSCULAS, palabras clave, números y cadenas.
// La tokenización vive en utils/tokensCodigo.js (compartida con el
// renderizador de archivos comprimidos); aquí solo se mapea tipo → color.

const COLOR_POR_TIPO = {
  comentario: COLOR_CODE_COMMENT,
  keyword:    COLOR_CODE_KEYWORD,
  numero:     COLOR_CODE_NUMBER,
  cadena:     COLOR_CODE_STRING,
  encabezado: COLOR_TEXT,
  texto:      COLOR_TEXT,
};

function renderizarBloqueCodigo(doc, codigo, fontMono, fontMonoBold) {
  const lineasLogicas = codigo.replace(/\r\n/g, '\n').replace(/\t/g, '  ').split('\n');
  while (lineasLogicas.length && !lineasLogicas[0].trim()) lineasLogicas.shift();
  while (lineasLogicas.length && !lineasLogicas[lineasLogicas.length - 1].trim()) lineasLogicas.pop();
  if (!lineasLogicas.length) return null;

  doc.font(fontMono).fontSize(CODE_SIZE);
  const charW     = doc.widthOfString('M'); // monoespaciada: todo glifo mide igual
  const anchoCaja = PAGE_W - MARGIN * 2;
  const maxChars  = Math.floor((anchoCaja - CODE_PAD * 2) / charW);
  const lineH     = CODE_SIZE + CODE_GAP;
  const maxY      = PAGE_H - MARGIN - 18; // 18pt de zona de footer

  const visuales = [];
  for (const linea of lineasLogicas) {
    if (!linea.trim()) { visuales.push([]); continue; }
    for (const v of envolverLineaTokens(tokenizarLineaCodigo(linea), maxChars)) visuales.push(v);
  }

  // 0.5pt de solape para que las franjas no dejen costuras al rasterizar
  const fondo = (y, h) => doc.save().rect(MARGIN, y, anchoCaja, h + 0.5).fill(CODE_BG).restore();

  doc.moveDown(0.6);
  if (doc.y + CODE_PAD + lineH * 2 > maxY) doc.addPage();

  // Página donde arranca el bloque (para el índice de notas de código)
  const paginaInicio = doc.bufferedPageRange().count - 1;

  let y = doc.y;
  fondo(y, CODE_PAD);
  y += CODE_PAD;

  for (const tokens of visuales) {
    if (y + lineH + CODE_PAD > maxY) {
      fondo(y, CODE_PAD); // cierre inferior del bloque en esta página
      doc.addPage();
      y = doc.y;
      fondo(y, CODE_PAD);
      y += CODE_PAD;
    }
    fondo(y, lineH);
    let x = MARGIN + CODE_PAD;
    for (const t of tokens) {
      doc.font(t.tipo === 'encabezado' ? fontMonoBold : fontMono)
         .fontSize(CODE_SIZE)
         .fillColor(COLOR_POR_TIPO[t.tipo] || COLOR_TEXT)
         .text(t.texto, x, y + CODE_GAP / 2, { lineBreak: false });
      x += t.texto.length * charW;
    }
    y += lineH;
  }

  fondo(y, CODE_PAD);
  y += CODE_PAD;

  doc.x = MARGIN;
  doc.y = y;
  doc.fillColor(COLOR_TEXT);

  return paginaInicio;
}

function renderizarBloqueMarkdown(doc, markdown, fontPath, linkCtx) {
  const lineas = markdown.split('\n');
  let parrafo = [];

  const vaciarParrafo = () => {
    const texto = parrafo.join('\n').trim();
    if (texto) renderizarParrafo(doc, texto, fontPath, linkCtx);
    parrafo = [];
  };

  for (const linea of lineas) {
    const encabezado = linea.match(/^(#{1,6})\s+(.+)$/);
    if (encabezado) {
      vaciarParrafo();
      renderizarEncabezadoInterno(doc, encabezado[2], encabezado[1].length, fontPath);
    } else {
      parrafo.push(linea);
    }
  }
  vaciarParrafo();
}

async function renderizarConImagenes(doc, markdown, fontPath, noteService, figCtx, linkCtx) {
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
          const minUtil     = 200;
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
             .fontSize(8)
             .text(label, MARGIN, doc.y, { continued: !!caption, lineGap: 2 });

          if (caption) {
            doc.fillColor(COLOR_DIM)
               .fontSize(8)
               .text(`  ${caption}`, { lineGap: 2 });
          }

          doc.moveDown(1);
        }
      } catch (e) {
        console.error('Error insertando imagen adjunta:', e.message);
      }
    } else {
      const texto = parte.trim();
      if (texto) renderizarBloqueMarkdown(doc, texto, fontPath, linkCtx);
    }
  }
}

function insertarIndiceFiguras(doc, figCtx, fontPath, paginasNoNumeradas) {
  if (figCtx.figuras.length === 0) return;

  doc.addPage();

  doc.fillColor(COLOR_ACCENT)
     .font(fontPath)
     .fontSize(11)
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

    // Altura real de la entrada: el caption puede envolver a varias líneas
    doc.font(fontPath).fontSize(8.5);
    const alturaCaption = doc.heightOfString(fig.caption || '—', { width: capWidth, lineGap: 2 });

    // Salto de página si la entrada completa no cabe (evita que pdfkit
    // parta el caption solo, dejando Fig./página huérfanos arriba)
    if (doc.y + alturaCaption > PAGE_H - MARGIN - 18) {
      doc.addPage();
    }

    const y = doc.y;

    // Número de figura
    doc.fillColor(COLOR_ACCENT)
       .text(`Fig. ${fig.num}`, MARGIN, y, { width: numCol, lineBreak: false });

    // Caption (define la altura de la entrada)
    doc.fillColor(COLOR_TEXT)
       .text(fig.caption || '—', MARGIN + numCol, y, { width: capWidth, lineGap: 2 });
    const yFinCaption = doc.y;

    // Número de página (alineado a la derecha)
    doc.fillColor(COLOR_DIM)
       .text(String(pageNum), MARGIN + numCol + capWidth, y, {
         width: pageCol,
         align: 'right',
         lineBreak: false
       });

    // La siguiente entrada arranca debajo de la línea más baja de esta
    doc.y = Math.max(doc.y, yFinCaption);
    doc.moveDown(0.5);
  }
}

function insertarIndiceNotasCodigo(doc, codeCtx, fontPath, paginasNoNumeradas) {
  if (codeCtx.notas.length === 0) return;

  doc.addPage();

  doc.fillColor(COLOR_ACCENT)
     .font(fontPath)
     .fontSize(11)
     .text('ÍNDICE DE NOTAS DE CÓDIGO', { align: 'left', characterSpacing: 3 })
     .moveDown(0.5);

  reglaTenue(doc, doc.y, COLOR_ACCENT, 0.5);
  doc.moveDown(1);

  const colWidth  = PAGE_W - MARGIN * 2;
  const pageCol   = 28; // ancho reservado para el número de página
  const tituloCol = colWidth - pageCol;

  for (const nota of codeCtx.notas) {
    const pageNum = nota.pageIndex - paginasNoNumeradas + 1;

    // Altura real de la entrada: el título puede envolver a varias líneas
    doc.font(fontPath).fontSize(8.5);
    const alturaTitulo = doc.heightOfString(nota.titulo, { width: tituloCol, lineGap: 2 });

    if (doc.y + alturaTitulo > PAGE_H - MARGIN - 18) {
      doc.addPage();
    }

    const y = doc.y;

    // Título de la nota (define la altura de la entrada)
    doc.fillColor(COLOR_TEXT)
       .text(nota.titulo, MARGIN, y, { width: tituloCol, lineGap: 2 });
    const yFinTitulo = doc.y;

    // Número de página (alineado a la derecha)
    doc.fillColor(COLOR_DIM)
       .text(String(pageNum), MARGIN + tituloCol, y, {
         width: pageCol,
         align: 'right',
         lineBreak: false
       });

    doc.y = Math.max(doc.y, yFinTitulo);
    doc.moveDown(0.5);
  }
}

async function procesarContenidoJerarquico(doc, nodo, turndownService, nivel = 0, contadorPaginas, fontPath, omitirTitulo = false, noteSvc = null, figCtx = null, tocCtx = null, linkCtx = null, codeCtx = null) {
  if (!nodo) return contadorPaginas;

  let fontSize, isTitle;

  // Destino nombrado para que los enlaces internos #root/... salten a esta nota.
  // Se registra una sola vez por noteId (las notas clonadas aparecen más de una vez).
  const registrarDestino = () => {
    if (nodo.noteId && linkCtx && !linkCtx.destinos.has(nodo.noteId)) {
      doc.addNamedDestination(nodo.noteId, 'XYZ', null, doc.y, null);
      linkCtx.destinos.add(nodo.noteId);
    }
  };

  if (!omitirTitulo) {
    switch (nivel) {
      case 0:
        doc.addPage();
        fontSize = 18;
        isTitle  = true;

        registrarDestino();

        if (tocCtx && !nodo.title?.toLowerCase().includes('tres estudios')) {
          tocCtx.push({ title: nodo.title, nivel, pageIndex: doc.bufferedPageRange().count - 1, noteId: nodo.noteId });
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
        fontSize = 14;
        isTitle  = true;

        registrarDestino();

        if (tocCtx && !nodo.title?.toLowerCase().includes('tres estudios')) {
          tocCtx.push({ title: tituloConNumero(nodo), nivel, pageIndex: doc.bufferedPageRange().count - 1, noteId: nodo.noteId });
        }

        doc.fillColor(COLOR_ACCENT)
           .font(fontPath)
           .fontSize(fontSize)
           .text(tituloConNumero(nodo).toUpperCase(), { align: 'left', paragraphGap: 6, characterSpacing: 1 })
           .moveDown(0.4);

        reglaTenue(doc, doc.y, COLOR_ACCENT, 0.5);
        doc.moveDown(1);
        break;

      case 2:
        fontSize = 12;
        isTitle  = true;
        if (doc.y + fontSize * 5 > PAGE_H - MARGIN) doc.addPage();

        registrarDestino();

        if (tocCtx && !nodo.title?.toLowerCase().includes('tres estudios')) {
          tocCtx.push({ title: tituloConNumero(nodo), nivel, pageIndex: doc.bufferedPageRange().count - 1, noteId: nodo.noteId });
        }

        doc.moveDown(1);
        doc.fillColor(COLOR_TEXT)
           .font(fontPath)
           .fontSize(fontSize)
           .text(tituloConNumero(nodo).toUpperCase(), { characterSpacing: 2.5, paragraphGap: 4 })
           .moveDown(0.3);
        break;

      case 3:
        fontSize = 11;
        isTitle  = true;
        if (doc.y + fontSize * 4 > PAGE_H - MARGIN) doc.addPage();

        registrarDestino();

        if (tocCtx && !nodo.title?.toLowerCase().includes('tres estudios')) {
          tocCtx.push({ title: nodo.title, nivel, pageIndex: doc.bufferedPageRange().count - 1, noteId: nodo.noteId });
        }

        doc.moveDown(0.8);
        doc.fillColor(COLOR_TEXT)
           .font(fontPath)
           .fontSize(fontSize)
           .text(nodo.title, { paragraphGap: 4 })
           .moveDown(0.2);
        break;

      case 4:
        fontSize = 10;
        isTitle  = true;
        if (doc.y + fontSize * 4 > PAGE_H - MARGIN) doc.addPage();

        registrarDestino();

        if (tocCtx && !nodo.title?.toLowerCase().includes('tres estudios')) {
          tocCtx.push({ title: nodo.title, nivel, pageIndex: doc.bufferedPageRange().count - 1, noteId: nodo.noteId });
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

  // Notas sin título renderizado (nivel profundo o título omitido, p.ej. Referencias)
  registrarDestino();

  if (nodo.content && nodo.content.trim() !== '') {
    const content = Buffer.isBuffer(nodo.content) ? nodo.content.toString('utf8') : nodo.content;

    if (nodo.type === 'code') {
      // Nota de código: texto plano, directo al render monoespaciado
      const paginaBloque = renderizarBloqueCodigo(doc, content, FUENTE_MONO, FUENTE_MONO_BOLD);
      if (codeCtx && paginaBloque !== null) {
        codeCtx.notas.push({ titulo: tituloConNumero(nodo), pageIndex: paginaBloque });
      }
      doc.moveDown(0.4);
    } else {
      let markdown;
      try {
        markdown = turndownService.turndown(content);
      } catch (error) {
        console.error('Error procesando contenido:', error);
        markdown = '(error al procesar contenido)';
      }

      if (markdown.trim() !== '') {
        await renderizarConImagenes(doc, markdown, fontPath, noteSvc, figCtx, linkCtx);
        doc.moveDown(0.4);
      }
    }

    contadorPaginas++;
  }

  if (nodo.children && nodo.children.length > 0) {
    const esReferencias = nodo.title && nodo.title.trim().toLowerCase() === 'referencias';
    const omitirTituloHijos = omitirTitulo || esReferencias;
    for (const hijo of nodo.children) {
      contadorPaginas = await procesarContenidoJerarquico(
        doc, hijo, turndownService, nivel + 1, contadorPaginas, fontPath, omitirTituloHijos, noteSvc, figCtx, tocCtx, linkCtx, codeCtx
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
    asignarNumeracion(rootFiltrado);

    const doc = new PDFDocument({
      size: [PAGE_W, PAGE_H],
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      bufferPages: true
    });

    let contadorPaginas = 0;
    const figCtx  = { count: 0, figuras: [] };
    const codeCtx = { notas: [] };

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
       .fontSize(9)
       .text('UNIVERSIDAD NACIONAL AUTÓNOMA DE MÉXICO', { align: 'left' })
       .moveDown(0.5);

    doc.fillColor(COLOR_DIM)
       .font(fontPath)
       .fontSize(9)
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
       .fontSize(9)
       .text(
         'Escritura de código en Javascript para el performance audiovisual y la investigación artística',
         { align: 'left', lineGap: 4 }
       )
       .moveDown(1.5);

    doc.fillColor(COLOR_DIM)
       .font(fontPath)
       .fontSize(9)
       .text('Que para optar por el grado de', { align: 'left' })
       .moveDown(0.6);

    doc.fillColor(COLOR_TEXT)
       .font(fontPath)
       .fontSize(10.5)
       .text('Doctor en Música', { align: 'left' })
       .text('Tecnología Musical', { align: 'left' })
       .moveDown(0.6);

    doc.fillColor(COLOR_DIM)
       .font(fontPath)
       .fontSize(9)
       .text('Presenta', { align: 'left' })
       .moveDown(0.5);

    doc.fillColor(COLOR_TEXT)
       .font(fontPath)
       .fontSize(12)
       .text('Emilio Ocelotl Reyes', { align: 'left' })
       .moveDown(0.6);

    doc.fillColor(COLOR_DIM)
       .font(fontPath)
       .fontSize(9)
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

    // Enlaces internos #root/...: ids de las notas que entran al PDF
    // (los enlaces a notas fuera del árbol se imprimen como texto plano)
    const idsNotas = new Set();
    (function recolectarIds(n) {
      if (!n) return;
      if (n.noteId) idsNotas.add(n.noteId);
      (n.children || []).forEach(recolectarIds);
    })({ children: rootFiltrado.children });
    const linkCtx = { ids: idsNotas, destinos: new Set() };

    if (aclaracionesChapter) {
      contadorPaginas = await procesarContenidoJerarquico(
        doc, aclaracionesChapter, turndownService, 0, contadorPaginas, fontPath, false, noteService, figCtx, tocCtx, linkCtx, codeCtx
      );
    }

    for (const capitulo of remainingChapters) {
      contadorPaginas = await procesarContenidoJerarquico(
        doc, capitulo, turndownService, 0, contadorPaginas, fontPath, false, noteService, figCtx, tocCtx, linkCtx, codeCtx
      );
    }

    if (referencesNode) {
      contadorPaginas = await procesarContenidoJerarquico(
        doc, referencesNode, turndownService, 0, contadorPaginas, fontPath, false, noteService, figCtx, tocCtx, linkCtx, codeCtx
      );
    }

    // ── ÍNDICE (volver a las páginas placeholder y rellenar) ──────────────────
    insertarIndiceConPaginas(doc, tocCtx, fontPath, PAGINAS_NO_NUMERADAS, indicePageIndex, indicePagesCount);

    // Volver a la última página para continuar
    const lastPage = doc.bufferedPageRange().start + doc.bufferedPageRange().count - 1;
    doc.switchToPage(lastPage);

    // ── ÍNDICE DE FIGURAS ─────────────────────────────────────────────────────
    insertarIndiceFiguras(doc, figCtx, fontPath, PAGINAS_NO_NUMERADAS);

    // ── ÍNDICE DE NOTAS DE CÓDIGO ─────────────────────────────────────────────
    insertarIndiceNotasCodigo(doc, codeCtx, fontPath, PAGINAS_NO_NUMERADAS);

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
