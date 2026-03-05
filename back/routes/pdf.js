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

// Función para generar índice solo con primer nivel (capítulos principales)
function insertarIndice(doc, capitulos, fontPath) {
  doc.addPage();

  doc.font(fontPath)
    .fontSize(16)
    .text('ÍNDICE', {
      align: 'center',
      underline: true
    })
    .moveDown(1.5);

  for (const capitulo of capitulos) {
    insertarNodoIndice(doc, capitulo, fontPath, 0);
  }

  doc.moveDown(2);
}

function insertarNodoIndice(doc, nodo, fontPath, nivel) {
  const indent = nivel * 20;

  let fontSize;

  switch (nivel) {
    case 0:
      fontSize = 12;
      break;
    case 1:
      fontSize = 11;
      break;
    default:
      fontSize = 10;
  }

  doc.font(fontPath)
    .fontSize(fontSize)
    .text(nodo.title, {
      indent: indent
    });

  doc.moveDown(0.3);

  if (nodo.title && nodo.title.toLowerCase() === 'referencias') {
    return;
  }

  if (nodo.children && nodo.children.length > 0) {
    for (const hijo of nodo.children) {
      insertarNodoIndice(doc, hijo, fontPath, nivel + 1);
    }
  }
}

// Función para procesar contenido jerárquico completo
function procesarContenidoJerarquico(doc, nodo, turndownService, nivel = 0, contadorPaginas, fontPath) {
  if (!nodo) return contadorPaginas;

  // Configurar estilos según el nivel
  let fontSize, indent, isTitle;
  
  switch (nivel) {
    case 0: // Capítulo principal - NUEVA PÁGINA
      doc.addPage(); // SOLO los capítulos principales tienen nueva página
      fontSize = 18;
      indent = 0;
      isTitle = true;
      
      // Título del capítulo en mayúsculas y centrado
      doc.font(fontPath)
        .fontSize(fontSize)
        .text(nodo.title.toUpperCase(), {
          align: 'center',
          paragraphGap: 20
        })
        .moveDown(1);
      break;
      
    case 1: // Subcapítulo - SIN SALTO DE PÁGINA
      fontSize = 14;
      indent = 20;
      isTitle = true;
      
      // Verificar si hay espacio suficiente en la página actual
      const alturaNecesaria = fontSize * 3; // Espacio aproximado para el título
      if (doc.y + alturaNecesaria > doc.page.height - 72) { // 72 = margen inferior
        doc.addPage();
      }
      
      doc.font(fontPath)
        .fontSize(fontSize)
        .text(nodo.title, {
          indent: indent,
          paragraphGap: 10
        })
        .moveDown(0.5);
      break;
      
    case 2: // Tercer nivel - SIN SALTO DE PÁGINA
      fontSize = 12;
      indent = 40;
      isTitle = true;
      
      // Verificar si hay espacio suficiente en la página actual
      const alturaNecesaria2 = fontSize * 3;
      if (doc.y + alturaNecesaria2 > doc.page.height - 72) {
        doc.addPage();
      }
      
      doc.font(fontPath)
        .fontSize(fontSize)
        .text(nodo.title, {
          indent: indent,
          paragraphGap: 5
        })
        .moveDown(0.3);
      break;
      
    default: // Contenido normal - SIN SALTO DE PÁGINA
      fontSize = 11;
      indent = nivel * 20;
      isTitle = false;
  }

  // Procesar contenido si existe
  if (nodo.content && nodo.content.trim() !== '') {
    let markdown;
    try {
      // Convertir el contenido a string si es un Buffer
      const content = Buffer.isBuffer(nodo.content) ? nodo.content.toString('utf8') : nodo.content;
      markdown = turndownService.turndown(content);
    } catch (error) {
      console.error('Error procesando contenido:', error);
      markdown = '(error al procesar contenido)';
    }

    // Para contenido que no es título, aplicar el formato normal
    if (!isTitle) {
      doc.font(fontPath)
        .fontSize(fontSize)
        .text(markdown, {
          indent: indent,
          paragraphGap: 5,
          lineGap: 3
        })
        .moveDown(0.3);
    } else {
      // Para títulos, el contenido va después con indentación adicional
      if (markdown.trim() !== '') {
        doc.font(fontPath)
          .fontSize(11)
          .text(markdown, {
            indent: indent + 10,
            paragraphGap: 5,
            lineGap: 3
          })
          .moveDown(0.3);
      }
    }
    
    contadorPaginas++;
  }

  // Procesar hijos recursivamente (ya filtrados)
  if (nodo.children && nodo.children.length > 0) {
    for (const hijo of nodo.children) {
      contadorPaginas = procesarContenidoJerarquico(
        doc, 
        hijo, 
        turndownService, 
        nivel + 1, 
        contadorPaginas,
        fontPath
      );
    }
  }

  return contadorPaginas;
}

router.get('/', async (req, res) => {
  try {
    // Ruta de la fuente
    const fontPath = path.join(fontsPath, 'SpaceGrotesk.ttf');
    console.log('Usando fuente en:', fontPath);

    // Verificar que existe la fuente
    const fs = await import('fs');
    if (!fs.existsSync(fontPath)) {
      throw new Error(`No se encuentra la fuente: ${fontPath}`);
    }

    // Obtener el árbol completo usando el servicio
    const rootFiltrado = await noteService.getCompleteTree();

    // Configuración del PDF
    const doc = new PDFDocument({
      size: [595, 595],
      margins: {
        top: 54,
        bottom: 54,
        left: 54,
        right: 54,
      },
      bufferPages: true
    });

    let contadorPaginas = 0;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="TEA.pdf"');
    doc.pipe(res);

    // Configurar Turndown
    const turndownService = turndown({
      headingStyle: 'atx',
      bulletListMarker: '-',
      codeBlockStyle: 'fenced'
    });

    turndownService.addRule('nbsp', {
      filter: ['nbsp'],
      replacement: () => ' '
    });

    // PORTADA COMPLETA
    doc.moveDown(3);

    doc.font(fontPath)
      .fontSize(18)
      .text('UNIVERSIDAD NACIONAL AUTÓNOMA DE MÉXICO', {
        align: 'right',
        paragraphGap: 10
      })
      .moveDown(1);

    doc.font(fontPath)
      .fontSize(11)
      .text('Programa de Maestría y Doctorado en Música', { align: 'right' })
      .text('Facultad de Música', { align: 'right' })
      .text('Instituto de Ciencias Aplicadas y Tecnología', { align: 'right' })
      .text('Instituto de Investigaciones Antropológicas', { align: 'right' })
      .moveDown(1);

    doc.font(fontPath)
      .fontSize(18)
      .text('TRES ESTUDIOS ABIERTOS', { align: 'right' })
      .moveDown(0.5);

    doc.font(fontPath)
      .fontSize(11)
      .text('Escritura de código en Javascript para el performance audiovisual y la investigación artística', {
        align: 'right',
        lineGap: 5
      })
      .moveDown(1);

    doc.font(fontPath)
      .fontSize(11)
      .text('Que para optar por el grado de', { align: 'right' })
      .moveDown(1);

    doc.font(fontPath)
      .fontSize(11)
      .text('Doctor en Música', { align: 'right' })
      .font(fontPath)
      .fontSize(11)
      .text('(Tecnología Musical)', { align: 'right' })
      .moveDown(1);

    doc.font(fontPath)
      .fontSize(11)
      .text('Presenta', { align: 'right' })
      .moveDown(1);

    doc.font(fontPath)
      .fontSize(14)
      .text('Emilio Ocelotl Reyes', { align: 'right' })
      .moveDown(1);

    doc.font(fontPath)
      .fontSize(12)
      .text('Tutor Principal: Hugo Solís', { align: 'right' })
      .text('Comité tutor: Iracema de Andrade y Fernando Monreal', { align: 'right' });

    // Añadir página nueva para el contenido
    doc.addPage();

    // Separar capítulos (usando el root filtrado)
    const aclaracionesChapter = rootFiltrado.children?.find(ch =>
      ch.title && ch.title.trim().toLowerCase().includes('aclaraciones')
    );
    let remainingChapters = rootFiltrado.children?.filter(ch => ch !== aclaracionesChapter && ch.title && ch.title.toLowerCase() !== 'referencias') || [];
    let referencesNode = rootFiltrado.children?.find(ch => ch.title && ch.title.toLowerCase() === 'referencias');

    // ÍNDICE - Solo con capítulos principales
    const capitulosParaIndice = [];

    if (aclaracionesChapter) {
      capitulosParaIndice.push(aclaracionesChapter);
    }
    capitulosParaIndice.push(...remainingChapters);
    if (referencesNode) {
      capitulosParaIndice.push(referencesNode);
    }

    const capitulosFiltrados = capitulosParaIndice.filter(
  c => !c.title?.toLowerCase().includes('tres estudios')
);

    console.log(`Capítulos para índice: ${capitulosParaIndice.length}`);
    console.log('Capítulos en índice:', capitulosParaIndice.map(c => c.title));
    
insertarIndice(doc, capitulosFiltrados, fontPath);
    // PROCESAR CONTENIDO JERÁRQUICO COMPLETO (usando el root filtrado)
    
    // Procesar aclaraciones primero si existe
    if (aclaracionesChapter) {
      console.log(`Procesando aclaraciones: ${aclaracionesChapter.title}`);
      contadorPaginas = procesarContenidoJerarquico(
        doc,
        aclaracionesChapter,
        turndownService,
        0, // nivel 0 (capítulo)
        contadorPaginas,
        fontPath
      );
    }

    // Procesar los demás capítulos
    for (const capitulo of remainingChapters) {
      console.log(`Procesando capítulo: ${capitulo.title}`);
      contadorPaginas = procesarContenidoJerarquico(
        doc,
        capitulo,
        turndownService,
        0, // nivel 0 (capítulo)
        contadorPaginas,
        fontPath
      );
    }

    // REFERENCIAS al final
    if (referencesNode) {
      console.log(`Procesando referencias: ${referencesNode.title}`);
      contadorPaginas = procesarContenidoJerarquico(
        doc,
        referencesNode,
        turndownService,
        0, // nivel 0 (capítulo)
        contadorPaginas,
        fontPath
      );
    }

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