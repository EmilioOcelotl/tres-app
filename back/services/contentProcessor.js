// services/contentProcessor.js
import turndown from 'turndown';

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