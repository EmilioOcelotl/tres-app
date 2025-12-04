// routes/threejs.js - VERSIÓN COMPLETA MODIFICADA
import express from 'express';
import { NoteService } from '../services/noteService.js';
import { findNodeById } from '../utils/treeBuilder.js';
import { ContentProcessor } from '../services/contentProcessor.js';

const router = express.Router();
const noteService = new NoteService();

// Función auxiliar para contar nodos (para logs)
function countNodes(node) {
  if (!node) return 0;
  let count = 1;
  if (node.children && node.children.length > 0) {
    node.children.forEach(child => {
      count += countNodes(child);
    });
  }
  return count;
}

// 1️⃣ Endpoint principal para Three.js - estructura completa
router.get('/structure', async (req, res) => {
  try {
    console.log('Solicitando estructura para Three.js...');
    const structure = await noteService.getStructureForThreeJS();
    console.log(`Estructura generada: ${countNodes(structure)} nodos`);

    // Limpiar estructura para frontend
    const cleanStructure = (node) => {
      if (!node) return null;
      
      return {
        id: node.id || node.noteId,
        title: node.title || 'Sin título',
        children: node.children ? node.children.map(cleanStructure) : []
      };
    };

    const cleanedStructure = cleanStructure(structure);

    res.json({
      success: true,
      data: cleanedStructure,
      metadata: {
        totalNodes: countNodes(cleanedStructure),
        generatedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Error getting 3D structure:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener la estructura 3D',
      details: error.message
    });
  }
});

// 2️⃣ Endpoint para contenido de nota individual - MODIFICADO
router.get('/note/:id/content', async (req, res) => {
  try {
    const noteId = req.params.id;
    console.log(`Solicitando contenido para nota: ${noteId}`);

    // OPCIÓN A: Usar NoteService.getNoteContent (más eficiente)
    const note = await noteService.getNoteContent(noteId);
    
    if (!note) {
      // OPCIÓN B: Buscar en el árbol completo (fallback)
      console.log(`Nota no encontrada directamente, buscando en árbol...`);
      const tree = await noteService.getCompleteTree();
      const node = findNodeById(tree, noteId);
      
      if (!node) {
        return res.status(404).json({
          success: false,
          error: 'Nota no encontrada'
        });
      }
      
      // Usar el nodo del árbol
      note = {
        id: node.noteId,
        noteId: node.noteId,
        title: node.title,
        content: node.content || ''
      };
    }

    console.log(`Nota encontrada: "${note.title}"`);

    // Procesar el contenido para frontend
    const htmlContent = ContentProcessor.processForFrontend(note.content);
    const references = ContentProcessor.extractReferences(note.content);
    
    // Extraer texto plano (sin HTML)
    const plainText = ContentProcessor.decodeHTMLEntities(
      (note.content || '').replace(/<[^>]*>/g, '')
    ).replace(/\s+/g, ' ').trim();

    // Devolver múltiples formatos
    res.json({
      success: true,
      data: {
        id: note.id,
        noteId: note.noteId,
        title: note.title,
        content: {
          raw: note.content || '',           // Original de Trilium
          html: htmlContent,                 // HTML procesado para frontend
          plain: plainText,                  // Texto plano limpio
          markdown: ContentProcessor.processForPDF(note.content) // Para futuro uso
        },
        metadata: {
          references: references,           // Para futura navegación
          referenceCount: references.length,
          type: 'note',
          lastModified: new Date().toISOString(),
          wordCount: plainText.split(/\s+/).filter(word => word.length > 0).length
        }
      }
    });

  } catch (error) {
    console.error('Error getting note content:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener el contenido de la nota',
      details: error.message
    });
  }
});

// 3️⃣ NUEVO: Endpoint para resolver referencias
router.get('/note/:id/references', async (req, res) => {
  try {
    const noteId = req.params.id;
    console.log(`Solicitando referencias para nota: ${noteId}`);

    const note = await noteService.getNoteContent(noteId);
    
    if (!note) {
      return res.status(404).json({
        success: false,
        error: 'Nota no encontrada'
      });
    }

    const references = ContentProcessor.extractReferences(note.content);
    
    // Resolver detalles de las notas referenciadas
    const resolvedReferences = await Promise.all(
      references.map(async (ref) => {
        try {
          const referencedNote = await noteService.getNoteContent(ref.noteId);
          return {
            ...ref,
            resolved: referencedNote ? {
              title: referencedNote.title,
              exists: true
            } : {
              title: 'Nota no encontrada',
              exists: false
            }
          };
        } catch (error) {
          return {
            ...ref,
            resolved: {
              title: 'Error al cargar',
              exists: false,
              error: error.message
            }
          };
        }
      })
    );

    res.json({
      success: true,
      data: {
        noteId: noteId,
        noteTitle: note.title,
        references: resolvedReferences,
        count: resolvedReferences.length
      }
    });

  } catch (error) {
    console.error('Error getting references:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener referencias',
      details: error.message
    });
  }
});

// 4️⃣ NUEVO: Endpoint para buscar y cargar múltiples notas
router.post('/notes/batch', async (req, res) => {
  try {
    const { noteIds } = req.body;
    
    if (!Array.isArray(noteIds) || noteIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Se requiere un array de noteIds'
      });
    }

    console.log(`Solicitando batch de ${noteIds.length} notas`);
    
    const notes = await Promise.all(
      noteIds.map(async (noteId) => {
        try {
          const note = await noteService.getNoteContent(noteId);
          if (note) {
            const htmlContent = ContentProcessor.processForFrontend(note.content);
            return {
              id: note.id,
              title: note.title,
              content: {
                html: htmlContent,
                plain: ContentProcessor.decodeHTMLEntities(
                  (note.content || '').replace(/<[^>]*>/g, '')
                ).trim()
              }
            };
          }
          return null;
        } catch (error) {
          console.error(`Error cargando nota ${noteId}:`, error);
          return null;
        }
      })
    );

    const validNotes = notes.filter(note => note !== null);

    res.json({
      success: true,
      data: {
        notes: validNotes,
        requested: noteIds.length,
        loaded: validNotes.length,
        failed: noteIds.length - validNotes.length
      }
    });

  } catch (error) {
    console.error('Error in batch request:', error);
    res.status(500).json({
      success: false,
      error: 'Error al cargar notas en batch',
      details: error.message
    });
  }
});

// 5️⃣ Búsqueda para Three.js por título (case-insensitive)
router.get('/search', async (req, res) => {
  try {
    const query = req.query.q?.toLowerCase();
    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Parámetro de búsqueda requerido'
      });
    }

    const tree = await noteService.getCompleteTree();
    const results = [];

    function searchNode(node) {
      if (node.title && node.title.toLowerCase().includes(query)) {
        results.push({
          id: node.noteId,
          title: node.title,
          type: 'note',
          preview: node.content ? 
            ContentProcessor.decodeHTMLEntities(
              (node.content || '').replace(/<[^>]*>/g, '')
            ).substring(0, 100) + '...' : ''
        });
      }
      if (node.children && node.children.length > 0) {
        node.children.forEach(searchNode);
      }
    }

    searchNode(tree);

    res.json({
      success: true,
      data: {
        query,
        results,
        count: results.length
      }
    });

  } catch (error) {
    console.error('Error en búsqueda:', error);
    res.status(500).json({
      success: false,
      error: 'Error en la búsqueda',
      details: error.message
    });
  }
});

// 6️⃣ Health check específico para Three.js
router.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'Three.js API',
    status: 'OK',
    version: '2.0',
    features: [
      'html-processing',
      'reference-extraction',
      'batch-loading'
    ],
    timestamp: new Date().toISOString()
  });
});

// 7️⃣ NUEVO: Endpoint para estadísticas
router.get('/stats', async (req, res) => {
  try {
    const tree = await noteService.getCompleteTree();
    const stats = {
      totalNotes: countNodes(tree),
      chapters: 0,
      subchapters: 0,
      notes: 0,
      lastUpdated: new Date().toISOString()
    };

    function countByLevel(node, level = 0) {
      if (level === 0) stats.chapters++;
      else if (level === 1) stats.subchapters++;
      else stats.notes++;

      if (node.children && node.children.length > 0) {
        node.children.forEach(child => countByLevel(child, level + 1));
      }
    }

    countByLevel(tree);

    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    console.error('Error getting stats:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener estadísticas',
      details: error.message
    });
  }
});

export default router;