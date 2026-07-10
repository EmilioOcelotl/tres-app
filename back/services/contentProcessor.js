// services/contentProcessor.js
import turndown from 'turndown';

// Sintaxis del pseudocódigo — espejo de tokenizarLineaCodigo en routes/pdf.js:
// comentarios //, encabezados de sección en MAYÚSCULAS sin sangría, palabras
// clave, números y cadenas. Los colores los pone front/style.css (paleta del
// PDF adaptada a fondo oscuro).
const REGEX_TOKEN_CODIGO = /("[^"]*"|'[^']*'|“[^”]*”|\b\d+(?:[.,]\d+)?\b|\b(?:await|async|new|nuevo|function|funcion|función|return|const|let|var)\b)/g;

function claseTokenCodigo(parte) {
  if (/^(?:"[^"]*"|'[^']*'|“[^”]*”)$/.test(parte)) return 'tok-str';
  if (/^\d+(?:[.,]\d+)?$/.test(parte))             return 'tok-num';
  if (/^(?:await|async|new|nuevo|function|funcion|función|return|const|let|var)$/.test(parte)) return 'tok-kw';
  return '';
}

export class ContentProcessor {
  
  // Procesa HTML de Trilium para frontend (HTML seguro)
  static processForFrontend(htmlContent) {
    if (!htmlContent || typeof htmlContent !== 'string') {
      return '';
    }
    
    let processed = htmlContent;
    
    // 1. Convertir <i> a <em> y <b> a <strong> para HTML5
    processed = processed
      .replace(/<i\b([^>]*)>/gi, '<em$1>')
      .replace(/<\/i>/gi, '</em>')
      .replace(/<b\b([^>]*)>/gi, '<strong$1>')
      .replace(/<\/b>/gi, '</strong>');
    
    // 2. Procesar enlaces de referencia
    // Patrón: <a class="reference-link" href="#root/xxx/yyy">texto</a>
    // Extraemos yyy (el noteId real)
    processed = processed.replace(
      /<a class="reference-link" href="#root\/[^/]+\/([^"]+)">([^<]+)<\/a>/gi,
      (match, noteId, text) => {
        // Decodificar entidades HTML en el texto
        const decodedText = ContentProcessor.decodeHTMLEntities(text);
        
        return `<a class="ref-link" data-note-id="${noteId}" title="Ver referencia: ${decodedText}">${decodedText}</a>`;
      }
    );
    
    // 3. Manejar otras entidades HTML comunes
    processed = ContentProcessor.decodeHTMLEntities(processed);
    
    // 4. Asegurar formato básico
    processed = processed
      .replace(/<p>\s*<\/p>/gi, '') // Eliminar párrafos vacíos
      .replace(/\n\s*\n/g, '\n');   // Compactar líneas vacías múltiples
    
    // 5. Sanitización básica (prevención XSS)
    processed = ContentProcessor.sanitizeHTML(processed);
    
    return processed.trim();
  }
  
  // Procesa notas type=code de Trilium para frontend. Guardan texto plano
  // (no HTML): se escapa y se envuelve en <pre> para conservar indentación
  // y saltos de línea, sin pasar por processForFrontend (que los colapsa).
  // Cada línea lógica sale como bloque con sangría francesa: si el overlay
  // la envuelve, la continuación cae a indentación+4 — espejo de
  // envolverLineaTokens en routes/pdf.js.
  static processCodeForFrontend(content) {
    const crudo = (Buffer.isBuffer(content) ? content.toString('utf8') : (content || ''))
      .replace(/\r\n/g, '\n')
      .replace(/\t/g, '  ')
      .replace(/^(?:[ ]*\n)+/, '')
      .replace(/\s+$/, '');

    const escapar = (s) => s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    const lineas = crudo.split('\n').map(linea => {
      const texto = linea.replace(/\s+$/, '');
      if (!texto) return '<span class="code-line">&nbsp;</span>';
      const sangria = Math.min(texto.match(/^ */)[0].length + 4, 40);
      return `<span class="code-line" style="--h:${sangria}ch">${ContentProcessor.colorearLineaCodigo(texto, escapar)}</span>`;
    });

    return `<pre class="code-note">${lineas.join('')}</pre>`;
  }

  // Colorea una línea de pseudocódigo con las mismas reglas que el PDF
  static colorearLineaCodigo(linea, escapar) {
    const partes = [];

    // Comentario: primer "//" que no venga de un protocolo (https://)
    const iComentario = linea.search(/(?<!:)\/\//);
    let codigo       = iComentario >= 0 ? linea.slice(0, iComentario) : linea;
    const comentario = iComentario >= 0 ? linea.slice(iComentario) : '';

    // Encabezado de sección: palabras en MAYÚSCULAS al inicio de línea (se admite sangría)
    if (/^ *[A-ZÁÉÍÓÚÑÜ]{2,}/.test(codigo)) {
      const m = codigo.match(/^ *(?:[A-ZÁÉÍÓÚÑÜ0-9]+(?:\s+|$))+/);
      if (m) {
        partes.push(`<strong class="tok-header">${escapar(m[0])}</strong>`);
        codigo = codigo.slice(m[0].length);
      }
    }

    for (const parte of codigo.split(REGEX_TOKEN_CODIGO)) {
      if (!parte) continue;
      const clase = claseTokenCodigo(parte);
      partes.push(clase ? `<span class="${clase}">${escapar(parte)}</span>` : escapar(parte));
    }

    if (comentario) partes.push(`<span class="tok-comment">${escapar(comentario)}</span>`);

    return partes.join('');
  }

  // Procesa HTML de Trilium para PDF (Markdown mejorado)
  static processForPDF(htmlContent) {
    if (!htmlContent) return '';
    
    // Crear servicio Turndown con configuración personalizada
    const turndownService = new turndown({
      headingStyle: 'atx',
      bulletListMarker: '-',
      codeBlockStyle: 'fenced',
      emDelimiter: '*',
      strongDelimiter: '**',
      br: '\n',
      blankReplacement: (content, node) => {
        return node.isBlock ? '\n\n' : '';
      }
    });
    
    // Añadir reglas personalizadas para Trilium
    turndownService.addRule('referenceLink', {
      filter: (node) => {
        return node.nodeName === 'A' && 
               node.className === 'reference-link';
      },
      replacement: (content, node) => {
        // Para PDF, mantener el texto con formato de referencia
        return content.trim();
      }
    });
    
    turndownService.addRule('nonBreakingSpace', {
      filter: ['nbsp'],
      replacement: () => ' '
    });
    
    turndownService.addRule('paragraphs', {
      filter: 'p',
      replacement: (content, node) => {
        const trimmed = content.trim();
        return node.nextSibling ? `${trimmed}\n\n` : trimmed;
      }
    });
    
    turndownService.addRule('lists', {
      filter: ['ul', 'ol'],
      replacement: (content, node) => {
        return `\n${content.trim()}\n\n`;
      }
    });
    
    turndownService.addRule('listItems', {
      filter: 'li',
      replacement: (content, node) => {
        const prefix = node.parentNode.nodeName === 'OL' ? '1. ' : '- ';
        const lines = content.trim().split('\n');
        const indentedLines = lines.map((line, index) => {
          return index === 0 ? `${prefix}${line}` : `  ${line}`;
        });
        return indentedLines.join('\n');
      }
    });
    
    // Procesar el contenido
    const processedHTML = ContentProcessor.decodeHTMLEntities(htmlContent);
    return turndownService.turndown(processedHTML).trim();
  }
  
  // Extraer referencias del HTML
  static extractReferences(htmlContent) {
    if (!htmlContent) return [];
    
    const references = [];
    const contentStr = Buffer.isBuffer(htmlContent) ? htmlContent.toString('utf8') : htmlContent;
    const regex = /<a class="reference-link" href="#root\/[^/]+\/([^"]+)">([^<]+)<\/a>/gi;
    let match;
    
    while ((match = regex.exec(contentStr)) !== null) {
      const text = ContentProcessor.decodeHTMLEntities(match[2]);
      references.push({
        noteId: match[1],
        text: text,
        originalHref: match[0],
        displayText: text
      });
    }
    
    return references;
  }
  
  // Decodificar entidades HTML
  static decodeHTMLEntities(text) {
    if (!text) return '';
    
    return text
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&ldquo;/g, '"')
      .replace(/&rdquo;/g, '"')
      .replace(/&lsquo;/g, "'")
      .replace(/&rsquo;/g, "'");
  }
  
  // Sanitizar HTML básico (prevención XSS)
  static sanitizeHTML(html) {
    if (!html) return '';
    
    // Lista blanca de tags permitidos
    const allowedTags = [
      'p', 'br', 'em', 'strong', 'ul', 'ol', 'li',
      'a', 'blockquote', 'code', 'pre', 'span'
    ];
    
    const allowedAttributes = {
      'a': ['href', 'title', 'class', 'data-note-id'],
      'span': ['class']
    };
    
    // Implementación básica - remover scripts y eventos
    let sanitized = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/on\w+="[^"]*"/gi, '')
      .replace(/on\w+='[^']*'/gi, '')
      .replace(/javascript:/gi, '');
    
    // Remover tags no permitidas (implementación simplificada)
    // En producción usar una librería como DOMPurify
    const tagRegex = /<\/?([a-z][a-z0-9]*)\b[^>]*>/gi;
    sanitized = sanitized.replace(tagRegex, (match, tagName) => {
      if (allowedTags.includes(tagName.toLowerCase())) {
        return match;
      }
      return '';
    });
    
    return sanitized;
  }
  
  // Convertir referencia a formato de cita académica
  static formatAcademicCitation(referenceText, index) {
    // Ejemplo: (Raymond, 1996) → [1]
    return `[${index}]`;
  }
}