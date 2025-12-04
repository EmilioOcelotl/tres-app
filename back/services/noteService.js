// services/noteService.js
import { getDatabase } from '../config/database.js';
import { buildTree, findNodeByTitle, filtrarHiddenNotes, findNodeById } from '../utils/treeBuilder.js';

export class NoteService {
  async getNotesAndBranches() {
    const db = getDatabase();
    
    return new Promise((resolve, reject) => {
      db.serialize(() => {
        db.all(`
          SELECT n.noteId, n.title, b.content
          FROM notes n
          LEFT JOIN blobs b ON n.blobId = b.blobId
          WHERE n.isDeleted = 0
        `, [], (err, notes) => {
          if (err) {
            console.error('Error en consulta de notas:', err);
            return reject(err);
          }

          console.log(`Encontradas ${notes.length} notas`);

          db.all(`SELECT branchId, noteId, parentNoteId, notePosition FROM branches WHERE isDeleted = 0`, [], (err, branches) => {
            if (err) {
              console.error('Error en consulta de branches:', err);
              return reject(err);
            }

            console.log(`Encontradas ${branches.length} ramas`);
            resolve({ notes, branches });
            
            // Cerrar la conexión después de usar
            db.close((closeErr) => {
              if (closeErr) console.error('Error cerrando BD:', closeErr);
            });
          });
        });
      });
    });
  }

  async getCompleteTree() {
    try {
      const { notes, branches } = await this.getNotesAndBranches();
      
      console.log('Construyendo árbol...');
      const tree = buildTree(notes, branches);
      
      // Buscar la raíz
      let root = findNodeByTitle(tree, 'Tres');
      
      if (!root) {
        // Si no encuentra "Tres", intenta con otros nombres posibles
        root = findNodeByTitle(tree, 'Tres Estudios Abiertos') || 
               findNodeByTitle(tree, 'TRES ESTUDIOS ABIERTOS') ||
               findNodeByTitle(tree, 'tres estudios abiertos');
      }

      if (!root) {
        console.log('No se encontró la raíz. Nodos disponibles:');
        if (Array.isArray(tree)) {
          tree.forEach(node => console.log('-', node.title));
        } else {
          console.log('-', tree.title);
        }
        throw new Error('No se encontró la nota raíz "Tres"');
      }

      console.log(`Raíz encontrada: "${root.title}" con ${root.children?.length || 0} hijos`);

      // FILTRAR HIDDEN NOTES ANTES DE PROCESAR - FILTRAR LOS HIJOS DEL ROOT
      const childrenFiltrados = root.children
        ? root.children.map(child => filtrarHiddenNotes(child)).filter(child => child !== null)
        : [];
      
      const rootFiltrado = {
        ...root,
        children: childrenFiltrados
      };

      console.log(`Después de filtrar: ${rootFiltrado.children?.length || 0} hijos`);
      
      return rootFiltrado;
      
    } catch (error) {
      console.error('Error en getCompleteTree:', error);
      throw error;
    }
  }

  // NUEVO MÉTODO: Obtener contenido de una nota específica por ID
  async getNoteContent(noteId) {
    try {
      const { notes } = await this.getNotesAndBranches();
      
      // Buscar la nota por ID
      const note = notes.find(n => n.noteId === noteId);
      
      if (!note) {
        console.log(`Nota no encontrada por ID: ${noteId}`);
        return null;
      }

      console.log(`Nota encontrada: "${note.title}" (ID: ${noteId})`);
      
      // Devolver el contenido completo de la nota
      return {
        id: note.noteId,
        noteId: note.noteId, // Mantener compatibilidad
        title: note.title,
        content: note.content || ''
      };
      
    } catch (error) {
      console.error(`Error obteniendo contenido de nota ${noteId}:`, error);
      throw error;
    }
  }

  // Método para obtener múltiples notas por IDs (útil para referencias)
  async getNotesByIds(noteIds) {
    try {
      const { notes } = await this.getNotesAndBranches();
      
      return noteIds.map(id => {
        const note = notes.find(n => n.noteId === id);
        return note ? {
          id: note.noteId,
          noteId: note.noteId,
          title: note.title,
          content: note.content || ''
        } : null;
      }).filter(note => note !== null);
      
    } catch (error) {
      console.error(`Error obteniendo múltiples notas:`, error);
      throw error;
    }
  }

  // NUEVO MÉTODO: Buscar nota por título (case-insensitive)
  async findNoteByTitle(title) {
    try {
      const { notes } = await this.getNotesAndBranches();
      
      const lowerTitle = title.toLowerCase();
      const note = notes.find(n => n.title.toLowerCase().includes(lowerTitle));
      
      return note ? {
        id: note.noteId,
        noteId: note.noteId,
        title: note.title,
        content: note.content || ''
      } : null;
      
    } catch (error) {
      console.error(`Error buscando nota por título "${title}":`, error);
      throw error;
    }
  }

  // Método específico para Three.js (existente)
  async getStructureForThreeJS() {
    const root = await this.getCompleteTree();
    
    // Transformar el árbol a formato optimizado para 3D
    return this.transformToThreeJSStructure(root);
  }
  
  transformToThreeJSStructure(node, level = 0) {
    const nodeType = this.determineNodeType(level);
    
    return {
      id: node.noteId,
      noteId: node.noteId, // Mantener compatibilidad
      title: node.title,
      type: nodeType,
      content: node.content ? this.extractContentPreview(node.content) : '',
      children: node.children?.map(child => 
        this.transformToThreeJSStructure(child, level + 1)
      ) || []
    };
  }
  
  determineNodeType(level) {
    const types = ['chapter', 'subchapter', 'note'];
    return types[level] || 'note';
  }
  
  extractContentPreview(content) {
    // Convertir el contenido a string si es un Buffer
    const contentStr = Buffer.isBuffer(content) ? content.toString('utf8') : content;
    
    // Extraer un preview del contenido (primeros 200 caracteres)
    return contentStr.substring(0, 200) + (contentStr.length > 200 ? '...' : '');
  }

  // NUEVO MÉTODO: Resolver referencias en contenido
  async resolveReferences(content) {
    if (!content) return { content: '', references: [] };
    
    const references = [];
    const contentStr = Buffer.isBuffer(content) ? content.toString('utf8') : content;
    
    // Extraer referencias usando regex
    const referenceRegex = /<a class="reference-link" href="#root\/[^/]+\/([^"]+)">([^<]+)<\/a>/gi;
    let match;
    
    while ((match = referenceRegex.exec(contentStr)) !== null) {
      references.push({
        noteId: match[1],
        text: match[2].replace(/&nbsp;/g, ' '),
        originalHref: match[0]
      });
    }
    
    return {
      content: contentStr,
      references: references
    };
  }
}