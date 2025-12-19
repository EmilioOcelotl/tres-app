// main.js - THREE.js Cyberpunk Note Explorer
// ===========================================

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { CopyShader } from 'three/examples/jsm/shaders/CopyShader.js';
import { LuminosityHighPassShader } from 'three/examples/jsm/shaders/LuminosityHighPassShader.js';

// Configuración global
const CONFIG = {
    apiBase: '/api/3d',
    colors: {
        background: 0x000000,
        mainChapter: 0x4e00ff, // Púrpura
        subChapter: 0x00c8ff,  // Cian
        note: 0x33ff00,        // Verde
        highlight: 0xffffff,
        connection: 0x00ffff,
        arrow: 0xff00ff
    },
    scene: {
        mainRadius: 25,
        secondaryRadius: 10,
        noteRadius: 4,
        fogDensity: 0.015
    }
};

// Estado de la aplicación
const AppState = {
    currentNote: null,
    loadedNotes: new Map(),
    allNoteObjects: [] // To store all Three.js note objects for raycasting
};

// THREE.js Variables
let scene, camera, renderer, controls, composer, bloomPass;
let raycaster, mouse;
let selectedObject = null;
const originalMaterials = new WeakMap();
const highlightMaterial = new THREE.MeshPhongMaterial({
    color: CONFIG.colors.highlight,
    emissive: CONFIG.colors.highlight,
    emissiveIntensity: 1.0,
    shininess: 100
});

// Layers for bloom effect
const BLOOM_LAYER = 1;
const bloomLayer = new THREE.Layers();
bloomLayer.set(BLOOM_LAYER);

// Groups for different types of buildings/notes
const mainBuildings = new THREE.Group();
const secondaryBuildings = new THREE.Group();
const noteBuildings = new THREE.Group();
const connections = new THREE.Group();
const connectionArrows = new THREE.Group();

// UI Elements
const loadingScreen = document.getElementById('loading-screen');
const noteDisplayOverlay = document.getElementById('note-display-overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayContent = document.getElementById('overlay-content');
const closeOverlayButton = document.getElementById('close-overlay');

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
// THREE.js Scene Setup
// ===========================================

function initThreeScene() {
    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(CONFIG.colors.background);
    scene.fog = new THREE.FogExp2(CONFIG.colors.background, CONFIG.scene.fogDensity);

    // Camera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 25, 60);
    camera.lookAt(0, 0, 0);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    document.getElementById('scene-container').appendChild(renderer.domElement);

    // Controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI * 0.9;

    // Lights
    const ambientLight = new THREE.AmbientLight(0x222244);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0x55aaff, 0.8);
    directionalLight.position.set(1, 1, 1);
    scene.add(directionalLight);

    // Post-processing (Bloom)
    const renderScene = new RenderPass(scene, camera);
    bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        1.5, // strength
        0.5, // radius
        0    // threshold
    );
    composer = new EffectComposer(renderer);
    composer.addPass(renderScene);
    composer.addPass(bloomPass);

    // Add groups to scene
    scene.add(mainBuildings);
    scene.add(secondaryBuildings);
    scene.add(noteBuildings);
    scene.add(connections);
    scene.add(connectionArrows);

    // Grid Helper
    const gridSize = 70;
    const gridDivisions = 35;
    const gridHelper = new THREE.GridHelper(gridSize, gridDivisions, 0x00ffff, 0x444477);
    gridHelper.position.y = 0.01;
    scene.add(gridHelper);

    // Raycaster for interaction
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    window.addEventListener('resize', onWindowResize, false);
    window.addEventListener('click', onClick, false);
    closeOverlayButton.addEventListener('click', hideNoteOverlay);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();

    // Update animated arrows (if any) - Placeholder for future animated connections
    connectionArrows.children.forEach(arrow => {
        if (arrow.userData.update) {
            arrow.userData.update();
        }
    });

    TWEEN.update(); // Update TWEEN animations
    composer.render();
}

// ===========================================
// 3D Note Visualization
// ===========================================

function createNoteObjects(tree) {
    // Clear existing objects
    mainBuildings.children = [];
    secondaryBuildings.children = [];
    noteBuildings.children = [];
    AppState.allNoteObjects = [];

    // This will be a recursive function to build the 3D city
    // For now, let's create a placeholder structure similar to viz.html
    // but using the actual tree data.

    const chapterColors = [
        new THREE.Color(0x4e00ff), // Púrpura
        new THREE.Color(0x00c8ff), // Cian
        new THREE.Color(0xff0077), // Rosa
        new THREE.Color(0x33ff00), // Verde
        new THREE.Color(0xffaa00), // Naranja
        new THREE.Color(0xaa00ff)  // Violeta
    ];

    // Assuming 'tree' is the root note/chapter
    // We'll treat its children as main chapters, their children as subchapters, and so on.
    // This is a simplified approach and might need refinement based on actual data structure.

    if (!tree || !tree.children) {
        console.warn("No tree data or children found to visualize.");
        return;
    }

    tree.children.forEach((mainChapterNode, i) => {
        const angle = (i / tree.children.length) * Math.PI * 2;
        const x = Math.cos(angle) * CONFIG.scene.mainRadius;
        const z = Math.sin(angle) * CONFIG.scene.mainRadius;

        const mainColor = chapterColors[i % chapterColors.length];
        const mainBuilding = createBuilding(mainChapterNode, new THREE.Vector3(x, 0, z), mainColor, "main");
        mainBuildings.add(mainBuilding);
        AppState.allNoteObjects.push(mainBuilding);

        if (mainChapterNode.children) {
            mainChapterNode.children.forEach((subChapterNode, j) => {
                const secondaryAngle = (j / mainChapterNode.children.length) * Math.PI * 2;
                const sX = x + Math.cos(secondaryAngle) * CONFIG.scene.secondaryRadius;
                const sZ = z + Math.sin(secondaryAngle) * CONFIG.scene.secondaryRadius;

                const subColor = mainColor.clone().offsetHSL(0, 0, 0.1); // Slightly lighter
                const subBuilding = createBuilding(subChapterNode, new THREE.Vector3(sX, 0, sZ), subColor, "secondary");
                secondaryBuildings.add(subBuilding);
                AppState.allNoteObjects.push(subBuilding);

                if (subChapterNode.children) {
                    subChapterNode.children.forEach((noteNode, k) => {
                        const noteAngle = (k / subChapterNode.children.length) * Math.PI * 2;
                        const nX = sX + Math.cos(noteAngle) * CONFIG.scene.noteRadius;
                        const nZ = sZ + Math.sin(noteAngle) * CONFIG.scene.noteRadius;

                        const noteColor = subColor.clone().offsetHSL(0, 0, 0.2); // Even lighter
                        const noteBuilding = createBuilding(noteNode, new THREE.Vector3(nX, 0, nZ), noteColor, "note");
                        noteBuildings.add(noteBuilding);
                        AppState.allNoteObjects.push(noteBuilding);
                    });
                }
            });
        }
    });

    // TODO: Implement connections if the note data provides relational information
}

function createBuilding(nodeData, position, color, type) {
    let height, width, depth;
    let emissiveIntensity, shininess;

    switch (type) {
        case "main":
            height = 6 + Math.random() * 2; // 6-8
            width = 3 + Math.random();      // 3-4
            depth = 3 + Math.random();      // 3-4
            emissiveIntensity = 0.6;
            shininess = 40;
            break;
        case "secondary":
            height = 3 + Math.random() * 2; // 3-5
            width = 1.8 + Math.random() * 0.6; // 1.8-2.4
            depth = 1.8 + Math.random() * 0.6; // 1.8-2.4
            emissiveIntensity = 0.4;
            shininess = 30;
            break;
        case "note":
            height = 1 + Math.random(); // 1-2
            width = 0.8 + Math.random() * 0.4; // 0.8-1.2
            depth = 0.8 + Math.random() * 0.4; // 0.8-1.2
            emissiveIntensity = 0.3;
            shininess = 20;
            break;
        default:
            height = 1; width = 1; depth = 1;
            emissiveIntensity = 0.2;
            shininess = 10;
    }

    const geometry = new THREE.BoxGeometry(width, height, depth);
    const material = new THREE.MeshPhongMaterial({
        color: color,
        emissive: color.clone().multiplyScalar(0.2),
        emissiveIntensity: emissiveIntensity,
        shininess: shininess
    });

    const building = new THREE.Mesh(geometry, material);
    building.position.set(position.x, height / 2, position.z);

    // Add wireframe
    const edges = new THREE.EdgesGeometry(geometry);
    const wireframe = new THREE.LineSegments(
        edges,
        new THREE.LineBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.1
        })
    );
    building.add(wireframe);

    // Store original material
    originalMaterials.set(building, material);

    // Attach note data to the 3D object
    building.userData = {
        type: type,
        id: nodeData.id,
        title: nodeData.title,
        color: color.getHex(),
        originalPosition: building.position.clone(),
        originalScale: building.scale.clone()
    };

    return building;
}

// ===========================================
// Interaction and Selection
// ===========================================

function onClick(event) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    const intersects = raycaster.intersectObjects(AppState.allNoteObjects, true);

    if (intersects.length > 0) {
        let object = intersects[0].object;
        // Find the parent mesh that has the userData (the actual building)
        while (object && !object.userData.id) {
            object = object.parent;
        }
        if (object && object.userData.id) {
            selectNoteObject(object);
        }
    } else {
        deselectNoteObject();
    }
}

async function selectNoteObject(object) {
    if (selectedObject === object) {
        // If the same object is clicked, deselect it
        deselectNoteObject();
        return;
    }

    // Restore previously selected object
    if (selectedObject) {
        deselectNoteObject();
    }

    // Select new object
    selectedObject = object;
    
    // Animate to front
    const targetPosition = new THREE.Vector3().copy(camera.position).add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(-10)); // 10 units in front of camera
    targetPosition.y = object.userData.originalPosition.y; // Keep original height
    
    // Scale up slightly
    new TWEEN.Tween(object.scale)
        .to({ x: object.userData.originalScale.x * 1.2, y: object.userData.originalScale.y * 1.2, z: object.userData.originalScale.z * 1.2 }, 500)
        .easing(TWEEN.Easing.Quadratic.Out)
        .start();

    new TWEEN.Tween(object.position)
        .to(targetPosition, 500)
        .easing(TWEEN.Easing.Quadratic.Out)
        .start();

    // Apply highlight material
    const originalMaterial = originalMaterials.get(selectedObject);
    if (originalMaterial) {
        selectedObject.material = highlightMaterial;
        selectedObject.layers.enable(BLOOM_LAYER);
    }
    highlightMaterial.color.setHex(object.userData.color); // Update highlight color

    // Display note content in overlay
    const noteData = await fetchNoteContent(object.userData.id);
    displayNoteInOverlay(noteData);
}

function deselectNoteObject() {
    if (selectedObject) {
        // Restore original material and position/scale
        const originalMaterial = originalMaterials.get(selectedObject);
        if (originalMaterial) {
            selectedObject.material = originalMaterial;
            selectedObject.layers.disable(BLOOM_LAYER);
        }
        
        new TWEEN.Tween(selectedObject.scale)
            .to(selectedObject.userData.originalScale, 500)
            .easing(TWEEN.Easing.Quadratic.Out)
            .start();

        new TWEEN.Tween(selectedObject.position)
            .to(selectedObject.userData.originalPosition, 500)
            .easing(TWEEN.Easing.Quadratic.Out)
            .start();

        selectedObject = null;
        hideNoteOverlay();
    }
}

// ===========================================
// UI Overlay Functions
// ===========================================

function displayNoteInOverlay(note) {
    overlayTitle.textContent = note.title;
    overlayContent.innerHTML = note.content.html || '<p>No hay contenido</p>';
    noteDisplayOverlay.style.display = 'block';
    // Add animation for appearance - will be handled by CSS
}

function hideNoteOverlay() {
    noteDisplayOverlay.style.display = 'none';
}

// ===========================================
// Initialization
// ===========================================

async function init() {
    loadingScreen.style.display = 'block'; // Show loading screen

    initThreeScene();
    animate(); // Start animation loop

    try {
        const tree = await fetchTree();
        createNoteObjects(tree);
        console.log('Aplicación inicializada correctamente');
    } catch (err) {
        console.error('Error inicializando:', err);
        overlayTitle.textContent = 'Error';
        overlayContent.innerHTML = '<p>No se pudo cargar la estructura de notas. Verifica la conexión al servidor.</p>';
        noteDisplayOverlay.style.display = 'block';
    } finally {
        loadingScreen.style.display = 'none'; // Hide loading screen
    }
}

// Add TWEEN.js for animations
// This requires a separate script tag in index.html or bundling.
// For now, let's assume it's loaded globally or add a CDN import.
// I will add it to index.html in the next step.
// For now, I'll mock TWEEN if it's not present to prevent errors during this step.
if (typeof TWEEN === 'undefined') {
    window.TWEEN = {
        Tween: function(object) {
            this._object = object;
            this._valuesStart = {};
            this._valuesEnd = {};
            this._duration = 1000;
            this._easingFunction = function(k) { return k; };
            this.to = function(properties, duration) {
                for (var prop in properties) {
                    this._valuesEnd[prop] = properties[prop];
                    this._valuesStart[prop] = this._object[prop];
                }
                this._duration = duration || this._duration;
                return this;
            };
            this.easing = function(easing) {
                this._easingFunction = easing;
                return this;
            };
            this.start = function() {
                var self = this;
                var startTime = performance.now();
                function update(currentTime) {
                    var elapsed = currentTime - startTime;
                    var progress = Math.min(1, elapsed / self._duration);
                    var easedProgress = self._easingFunction(progress);
                    for (var prop in self._valuesEnd) {
                        self._object[prop] = self._valuesStart[prop] + (self._valuesEnd[prop] - self._valuesStart[prop]) * easedProgress;
                    }
                    if (progress < 1) {
                        requestAnimationFrame(update);
                    }
                }
                requestAnimationFrame(update);
                return this;
            };
            this.update = function() {}; // Dummy update
        },
        Easing: {
            Quadratic: {
                Out: function(k) { return k * (2 - k); }
            }
        }
    };
}


// Start when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}