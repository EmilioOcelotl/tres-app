// main.js - VERSIÓN CON BOTÓN DE VOLVER
// ===========================================
// Configuración global
const CONFIG = {
  apiBase: '/api/3d',
  colors: {
    primary: '#2c3e50',
    secondary: '#3498db',
    accent: '#e74c3c',
    reference: '#d35400',
    background: '#f9f9f9'
  }
};

// Estado de la aplicación
const AppState = {
  currentNote: null,
  noteHistory: [],
  historyIndex: -1,
  loadedNotes: new Map()
};

// ===========================================
// Funciones de API
// ===========================================

async function fetchTree() {
  try {
    const res = await fetch(`${CONFIG.apiBase}/structure`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    
    const json = await res.json();
    if (!json.success) throw new Error('Error al obtener estructura');
    
    console.log(`Árbol cargado: ${json.metadata.totalNodes} nodos`);
    return json.data;
    
  } catch (error) {
    console.error('Error en fetchTree:', error);
    throw error;
  }
}

async function fetchNoteContent(noteId, useCache = true) {
  if (useCache && AppState.loadedNotes.has(noteId)) {
    console.log(`Usando cache para nota: ${noteId}`);
    return AppState.loadedNotes.get(noteId);
  }
  
  try {
    const res = await fetch(`${CONFIG.apiBase}/note/${noteId}/content`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    
    const json = await res.json();
    if (!json.success) throw new Error('Error al obtener contenido de la nota');
    
    console.log(`Nota cargada: "${json.data.title}" (ID: ${noteId})`);
    
    AppState.loadedNotes.set(noteId, json.data);
    return json.data;
    
  } catch (error) {
    console.error(`Error cargando nota ${noteId}:`, error);
    throw error;
  }
}

// ===========================================
// Funciones de UI - Árbol de navegación
// ===========================================

function createTreeNode(node, depth = 0) {
  const li = document.createElement('li');
  li.className = 'tree-node';
  li.dataset.noteId = node.id;
  li.dataset.depth = depth;
  
  // Contenedor del título con ícono
  const titleContainer = document.createElement('div');
  titleContainer.className = 'tree-node-title';
  
  // Ícono de expansión si tiene hijos
  if (node.children && node.children.length > 0) {
    const expandIcon = document.createElement('span');
    expandIcon.className = 'expand-icon';
    expandIcon.textContent = '▶';
    titleContainer.appendChild(expandIcon);
  }
  
  const titleText = document.createElement('span');
  titleText.textContent = node.title;
  titleContainer.appendChild(titleText);
  
  li.appendChild(titleContainer);
  
  // Click en el nodo
  li.addEventListener('click', async (e) => {
    e.stopPropagation();
    
    // Manejar expansión si se hace clic en el ícono
    if (e.target.classList.contains('expand-icon')) {
      const ul = li.querySelector('ul');
      if (ul) {
        const isCollapsed = ul.style.display === 'none';
        ul.style.display = isCollapsed ? 'block' : 'none';
        e.target.textContent = isCollapsed ? '▼' : '▶';
        e.target.style.transform = isCollapsed ? 'rotate(90deg)' : 'rotate(0deg)';
      }
      return;
    }
    
    await loadAndDisplayNote(node.id);
    
    // Añadir al historial
    addToHistory(node.id);
  });
  
  // Crear hijos si existen
  if (node.children && node.children.length > 0) {
    const ul = document.createElement('ul');
    ul.style.cssText = `
      padding-left: ${20 + (depth * 10)}px;
      margin: 4px 0;
      display: ${depth < 2 ? 'block' : 'none'};
    `;
    
    node.children.forEach(child => {
      ul.appendChild(createTreeNode(child, depth + 1));
    });
    
    // Configurar ícono de expansión inicial
    if (depth < 2) {
      const icon = li.querySelector('.expand-icon');
      if (icon) {
        icon.textContent = '▼';
        icon.style.transform = 'rotate(90deg)';
      }
    }
    
    li.appendChild(ul);
  }
  
  return li;
}

// ===========================================
// Funciones de UI - Visualización de notas
// ===========================================

async function loadAndDisplayNote(noteId) {
  try {
    const note = await fetchNoteContent(noteId);
    displayNoteContent(note);
    
    // Actualizar estado
    AppState.currentNote = note;
    
    // Resaltar nodo activo
    highlightActiveNode(noteId);
    
  } catch (error) {
    console.error('Error cargando nota:', error);
    alert(`No se pudo cargar la nota: ${error.message}`);
  }
}

function displayNoteContent(note) {
  const titleEl = document.getElementById('note-title');
  const contentEl = document.getElementById('note-content');

  // Actualizar título
  titleEl.textContent = note.title;
  
  // Mostrar contenido HTML procesado
  contentEl.innerHTML = note.content.html || '<p>No hay contenido</p>';
  
  // Aplicar funcionalidad a los enlaces de referencia
  processReferenceLinks(contentEl);
  
  // Aplicar estilos básicos al contenido
  applyContentStyles(contentEl);
}

function processReferenceLinks(container) {
  container.querySelectorAll('a.ref-link').forEach(link => {
    const noteId = link.getAttribute('data-note-id');
    
    // Añadir clase CSS para estilos
    link.classList.add('ref-link');
    
    // Tooltip
    link.title = `Clic para cargar esta referencia`;
    
    // Evento click
    link.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      try {
        await loadAndDisplayNote(noteId);
        
        // Añadir al historial
        addToHistory(noteId);
        
      } catch (err) {
        console.error('Error cargando nota referenciada:', err);
        alert(`No se pudo cargar la nota referenciada: ${noteId}`);
      }
    });
  });
}

function applyContentStyles(container) {
  // Estilos para elementos HTML básicos
  container.querySelectorAll('em, i').forEach(el => {
    el.style.fontStyle = 'italic';
  });
  
  container.querySelectorAll('strong, b').forEach(el => {
    el.style.fontWeight = 'bold';
  });
  
  container.querySelectorAll('ul, ol').forEach(el => {
    el.style.marginLeft = '24px';
    el.style.marginBottom = '16px';
  });
  
  container.querySelectorAll('li').forEach(el => {
    el.style.marginBottom = '8px';
  });
  
  container.querySelectorAll('p').forEach(el => {
    el.style.marginBottom = '16px';
    el.style.lineHeight = '1.6';
  });
}

function highlightActiveNode(noteId) {
  // Remover activo de todos los nodos
  document.querySelectorAll('#tree-root .tree-node').forEach(node => {
    node.classList.remove('active');
  });
  
  // Aplicar activo al nodo actual
  const activeNode = document.querySelector(`#tree-root .tree-node[data-note-id="${noteId}"]`);
  if (activeNode) {
    activeNode.classList.add('active');
    
    // Asegurar que todos los padres estén expandidos
    let parent = activeNode.parentElement;
    while (parent && parent.tagName === 'UL') {
      const parentLi = parent.parentElement;
      const expandIcon = parentLi?.querySelector('.expand-icon');
      if (expandIcon) {
        expandIcon.textContent = '▼';
        expandIcon.style.transform = 'rotate(90deg)';
      }
      parent.style.display = 'block';
      parent = parentLi?.parentElement;
    }
  }
}

// ===========================================
// Historial de navegación
// ===========================================

function addToHistory(noteId) {
  // Evitar duplicados consecutivos
  if (AppState.historyIndex >= 0 && AppState.noteHistory[AppState.historyIndex] === noteId) {
    return;
  }
  
  // Si estamos en medio del historial, cortar el futuro
  if (AppState.historyIndex < AppState.noteHistory.length - 1) {
    AppState.noteHistory = AppState.noteHistory.slice(0, AppState.historyIndex + 1);
  }
  
  AppState.noteHistory.push(noteId);
  AppState.historyIndex = AppState.noteHistory.length - 1;
  
  updateNavigationControls();
}

function goBack() {
  if (AppState.historyIndex > 0) {
    AppState.historyIndex--;
    loadAndDisplayNote(AppState.noteHistory[AppState.historyIndex]);
    updateNavigationControls();
  }
}

function goForward() {
  if (AppState.historyIndex < AppState.noteHistory.length - 1) {
    AppState.historyIndex++;
    loadAndDisplayNote(AppState.noteHistory[AppState.historyIndex]);
    updateNavigationControls();
  }
}

function updateNavigationControls() {
  const backBtn = document.getElementById('btn-back');
  const forwardBtn = document.getElementById('btn-forward');
  
  if (backBtn) {
    backBtn.disabled = AppState.historyIndex <= 0;
    backBtn.style.opacity = AppState.historyIndex <= 0 ? '0.5' : '1';
    backBtn.style.cursor = AppState.historyIndex <= 0 ? 'not-allowed' : 'pointer';
  }
  
  if (forwardBtn) {
    forwardBtn.disabled = AppState.historyIndex >= AppState.noteHistory.length - 1;
    forwardBtn.style.opacity = AppState.historyIndex >= AppState.noteHistory.length - 1 ? '0.5' : '1';
    forwardBtn.style.cursor = AppState.historyIndex >= AppState.noteHistory.length - 1 ? 'not-allowed' : 'pointer';
  }
}

// ===========================================
// Controles de navegación UI
// ===========================================

function createNavigationControls() {
  // Crear contenedor de controles
  const navContainer = document.createElement('div');
  navContainer.id = 'navigation-controls';
  navContainer.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    display: flex;
    gap: 8px;
    z-index: 100;
    background: white;
    padding: 8px 12px;
    border-radius: 6px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    border: 1px solid #e0e0e0;
  `;
  
  navContainer.innerHTML = `
    <button id="btn-back" style="
      padding: 6px 12px;
      background: ${CONFIG.colors.primary};
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 14px;
      transition: all 0.2s;
    ">
      <span style="font-size: 16px;">←</span>
      Volver
    </button>
    <button id="btn-forward" style="
      padding: 6px 12px;
      background: ${CONFIG.colors.primary};
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 14px;
      transition: all 0.2s;
    ">
      Adelante
      <span style="font-size: 16px;">→</span>
    </button>
  `;
  
  document.body.appendChild(navContainer);
  
  // Eventos de navegación
  document.getElementById('btn-back').addEventListener('click', goBack);
  document.getElementById('btn-forward').addEventListener('click', goForward);
  
  // Atajos de teclado
  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.key === 'ArrowLeft') {
      e.preventDefault();
      goBack();
    } else if (e.altKey && e.key === 'ArrowRight') {
      e.preventDefault();
      goForward();
    }
  });
}

// ===========================================
// CSS adicional dinámico
// ===========================================

function addDynamicStyles() {
  const style = document.createElement('style');
  style.textContent = `
    /* Animaciones */
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    
    #note-content {
      animation: fadeIn 0.5s;
    }
    
    /* Encabezados en el contenido */
    #note-content h1, #note-content h2, #note-content h3, #note-content h4 {
      color: #2c3e50;
      margin-top: 24px;
      margin-bottom: 16px;
    }
    
    #note-content h1 {
      font-size: 1.8em;
      border-bottom: 2px solid #eee;
      padding-bottom: 8px;
    }
    
    #note-content h2 {
      font-size: 1.5em;
    }
    
    #note-content h3 {
      font-size: 1.3em;
    }
    
    /* Citas y código */
    #note-content blockquote {
      border-left: 4px solid #ddd;
      margin: 16px 0;
      padding: 8px 16px;
      background-color: #f9f9f9;
      color: #666;
    }
    
    #note-content code {
      background-color: #f5f5f5;
      padding: 2px 6px;
      border-radius: 3px;
      font-family: 'Courier New', monospace;
      font-size: 0.9em;
    }
    
    #note-content pre {
      background-color: #f5f5f5;
      padding: 16px;
      border-radius: 6px;
      overflow-x: auto;
      margin: 16px 0;
    }
    
    #note-content pre code {
      background-color: transparent;
      padding: 0;
    }
    
    /* Estados de los botones */
    #btn-back:disabled,
    #btn-forward:disabled {
      background: #bdc3c7 !important;
      cursor: not-allowed !important;
    }
    
    #btn-back:not(:disabled):hover,
    #btn-forward:not(:disabled):hover {
      background: #2980b9 !important;
      transform: translateY(-1px);
      box-shadow: 0 3px 6px rgba(0,0,0,0.1);
    }
    
    #btn-back:not(:disabled):active,
    #btn-forward:not(:disabled):active {
      transform: translateY(0);
    }
    
    /* Indicador de historial */
    .history-indicator {
      font-size: 12px;
      color: #7f8c8d;
      margin-top: 4px;
      text-align: center;
    }
  `;
  document.head.appendChild(style);
}

// ===========================================
// Inicialización
// ===========================================

async function init() {
  try {
    // Añadir estilos dinámicos
    addDynamicStyles();
    
    // Crear controles de navegación
    createNavigationControls();
    
    // Cargar estructura del árbol
    const tree = await fetchTree();
    const rootUl = document.getElementById('tree-root');
    rootUl.innerHTML = '';
    rootUl.appendChild(createTreeNode(tree));
    
    // Cargar primera nota automáticamente
    if (tree.id) {
      await loadAndDisplayNote(tree.id);
      addToHistory(tree.id);
    }
    
    console.log('Aplicación inicializada correctamente');
    
  } catch (err) {
    console.error('Error inicializando:', err);
    document.getElementById('tree-root').innerHTML = 
      '<li style="color: #e74c3c; padding: 16px;">Error al cargar las notas.</li>';
    document.getElementById('note-title').textContent = 'Error';
    document.getElementById('note-content').innerHTML = 
      '<p>No se pudo cargar la estructura de notas. Verifica la conexión al servidor.</p>';
  }
}

// Iniciar cuando el DOM esté listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Para depuración (opcional)
window.App = {
  state: AppState,
  goBack,
  goForward,
  getHistory: () => AppState.noteHistory,
  getCurrentIndex: () => AppState.historyIndex
};