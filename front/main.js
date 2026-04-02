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
        background: 0x060608,
        mainChapter: 0x007777,
        subChapter: 0x009999,
        note: 0x006688,
        highlight: 0xd0d8e0,
        connection: 0x004444,
        arrow: 0x006666
    },
    scene: {
        mainRadius: 25,
        secondaryRadius: 10,
        noteRadius: 4,
        subNoteRadius: 2,
        subSubNoteRadius: 1,
        fogDensity: 0.015
    },
    references: {
        orbitRadius: 40,
        orbitHeight: 22,
        orbitSpeed: 0.0003,
        color: 0x00b4b4
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
    emissiveIntensity: 0.5,
    shininess: 60
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
const referencesGroup = new THREE.Group();
let referencesVisible = true;

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
    const ambientLight = new THREE.AmbientLight(0x0a1a1a);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0x6699aa, 0.5);
    directionalLight.position.set(1, 1, 1);
    scene.add(directionalLight);

    // Post-processing (Bloom)
    const renderScene = new RenderPass(scene, camera);
    bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        0.5, // strength
        0.4, // radius
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
    scene.add(referencesGroup);

    // Grid Helper
    const gridSize = 70;
    const gridDivisions = 35;
    const gridHelper = new THREE.GridHelper(gridSize, gridDivisions, 0x002a2a, 0x001818);
    gridHelper.position.y = 0.01;
    scene.add(gridHelper);

    // Raycaster for interaction
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    window.addEventListener('resize', onWindowResize, false);
    window.addEventListener('click', onClick, false);
    window.addEventListener('keydown', (e) => {
        if (e.key === 'r' || e.key === 'R') toggleReferences();
    });
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

    // Orbit references satellites
    referencesGroup.rotation.y += CONFIG.references.orbitSpeed;

    TWEEN.update(); // Update TWEEN animations
    composer.render();
}

// ===========================================
// 3D Note Visualization
// ===========================================

const LEVEL_RADII = [
    CONFIG.scene.mainRadius,
    CONFIG.scene.secondaryRadius,
    CONFIG.scene.noteRadius,
    CONFIG.scene.subNoteRadius,
    CONFIG.scene.subSubNoteRadius
];

const LEVEL_TYPES = ['main', 'secondary', 'note', 'subnote', 'subsubnote'];

function placeChildren(parentNode, parentPos, parentColor, level) {
    if (!parentNode.children || parentNode.children.length === 0) return;

    const radius = LEVEL_RADII[level] ?? 0.5;
    const type = LEVEL_TYPES[level] ?? 'subsubnote';
    const group = level === 1 ? secondaryBuildings : noteBuildings;
    const hslOffset = 0.08;

    const nonRefChildren = parentNode.children.filter(n => n.title !== 'Referencias');
    const refChild = parentNode.children.find(n => n.title === 'Referencias');

    nonRefChildren.forEach((child, j) => {
        const angle = (j / nonRefChildren.length) * Math.PI * 2;
        const x = parentPos.x + Math.cos(angle) * radius;
        const z = parentPos.z + Math.sin(angle) * radius;
        const pos = new THREE.Vector3(x, 0, z);

        const color = parentColor.clone().offsetHSL(0, 0, hslOffset);
        const building = createBuilding(child, pos, color, type);
        group.add(building);
        AppState.allNoteObjects.push(building);

        placeChildren(child, pos, color, level + 1);
    });

    if (refChild) {
        placeReferenceSatellites(refChild);
    }
}

function createNoteObjects(tree) {
    mainBuildings.children = [];
    secondaryBuildings.children = [];
    noteBuildings.children = [];
    AppState.allNoteObjects = [];

    if (!tree || !tree.children) {
        console.warn("No tree data or children found to visualize.");
        return;
    }

    const chapterColors = [
        new THREE.Color(0x007777),
        new THREE.Color(0x009999),
        new THREE.Color(0x00aaaa),
        new THREE.Color(0x006688),
        new THREE.Color(0x337788),
        new THREE.Color(0x005577)
    ];

    const nonRefChildren = tree.children.filter(n => n.title !== 'Referencias');
    const refChild = tree.children.find(n => n.title === 'Referencias');

    nonRefChildren.forEach((mainChapterNode, i) => {
        const angle = (i / nonRefChildren.length) * Math.PI * 2;
        const x = Math.cos(angle) * CONFIG.scene.mainRadius;
        const z = Math.sin(angle) * CONFIG.scene.mainRadius;
        const pos = new THREE.Vector3(x, 0, z);

        const mainColor = chapterColors[i % chapterColors.length];
        const mainBuilding = createBuilding(mainChapterNode, pos, mainColor, 'main');
        mainBuildings.add(mainBuilding);
        AppState.allNoteObjects.push(mainBuilding);

        placeChildren(mainChapterNode, pos, mainColor, 1);
    });

    if (refChild) {
        placeReferenceSatellites(refChild);
    }
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
        case "subnote":
            height = 0.5 + Math.random() * 0.5; // 0.5-1
            width = 0.4 + Math.random() * 0.2;  // 0.4-0.6
            depth = 0.4 + Math.random() * 0.2;
            emissiveIntensity = 0.25;
            shininess = 15;
            break;
        case "subsubnote":
            height = 0.3 + Math.random() * 0.3; // 0.3-0.6
            width = 0.25 + Math.random() * 0.15;
            depth = 0.25 + Math.random() * 0.15;
            emissiveIntensity = 0.2;
            shininess = 10;
            break;
        default:
            height = 0.3; width = 0.2; depth = 0.2;
            emissiveIntensity = 0.15;
            shininess = 8;
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

function createReferenceObject(nodeData, position, color) {
    const geometry = new THREE.SphereGeometry(0.35, 10, 8);
    const material = new THREE.MeshPhongMaterial({
        color: color,
        emissive: color.clone().multiplyScalar(0.4),
        emissiveIntensity: 0.5,
        shininess: 60
    });
    const sphere = new THREE.Mesh(geometry, material);
    sphere.position.copy(position);
    originalMaterials.set(sphere, material);
    sphere.userData = {
        type: 'reference',
        id: nodeData.id,
        title: nodeData.title,
        color: color.getHex(),
        originalPosition: position.clone(),
        originalScale: sphere.scale.clone()
    };
    return sphere;
}

function placeReferenceSatellites(referencesNode) {
    const refColor = new THREE.Color(CONFIG.references.color);
    const { orbitRadius, orbitHeight } = CONFIG.references;

    // Anillo orbital decorativo (toro tenue)
    const torusGeo = new THREE.TorusGeometry(orbitRadius, 0.12, 8, 96);
    const torusMat = new THREE.MeshPhongMaterial({
        color: refColor,
        emissive: refColor.clone().multiplyScalar(0.3),
        transparent: true,
        opacity: 0.35
    });
    const orbitRing = new THREE.Mesh(torusGeo, torusMat);
    orbitRing.rotation.x = Math.PI / 2;
    orbitRing.position.y = orbitHeight;
    referencesGroup.add(orbitRing);

    // Nodo padre "Referencias" como octaedro en el centro del plano orbital
    const markerGeo = new THREE.OctahedronGeometry(1.4);
    const markerMat = new THREE.MeshPhongMaterial({
        color: refColor,
        emissive: refColor.clone().multiplyScalar(0.5),
        emissiveIntensity: 0.8,
        shininess: 80
    });
    const marker = new THREE.Mesh(markerGeo, markerMat);
    marker.position.set(0, orbitHeight, 0);
    originalMaterials.set(marker, markerMat);
    marker.userData = {
        type: 'reference',
        id: referencesNode.id,
        title: referencesNode.title,
        color: refColor.getHex(),
        originalPosition: new THREE.Vector3(0, orbitHeight, 0),
        originalScale: marker.scale.clone()
    };
    referencesGroup.add(marker);
    AppState.allNoteObjects.push(marker);

    // Satélites — hijos de Referencias distribuidos en el anillo
    if (referencesNode.children && referencesNode.children.length > 0) {
        referencesNode.children.forEach((child, i) => {
            const angle = (i / referencesNode.children.length) * Math.PI * 2;
            const x = Math.cos(angle) * orbitRadius;
            const z = Math.sin(angle) * orbitRadius;
            const pos = new THREE.Vector3(x, orbitHeight, z);
            const childColor = refColor.clone().offsetHSL(0, 0, (i % 5) * 0.04 - 0.08);
            const sat = createReferenceObject(child, pos, childColor);
            referencesGroup.add(sat);
            AppState.allNoteObjects.push(sat);
        });
    }
}

function toggleReferences() {
    referencesVisible = !referencesVisible;
    referencesGroup.visible = referencesVisible;
    const btn = document.getElementById('toggle-references');
    if (btn) btn.textContent = referencesVisible ? 'REFS: ON' : 'REFS: OFF';
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
    
    // Scale up and move — skip for reference satellites (orbiting in group space)
    if (object.userData.type !== 'reference') {
        new TWEEN.Tween(object.scale)
            .to({ x: object.userData.originalScale.x * 1.2, y: object.userData.originalScale.y * 1.2, z: object.userData.originalScale.z * 1.2 }, 500)
            .easing(TWEEN.Easing.Quadratic.Out)
            .start();

        new TWEEN.Tween(object.position)
            .to(targetPosition, 500)
            .easing(TWEEN.Easing.Quadratic.Out)
            .start();
    }

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
        
        if (selectedObject.userData.type !== 'reference') {
            new TWEEN.Tween(selectedObject.scale)
                .to(selectedObject.userData.originalScale, 500)
                .easing(TWEEN.Easing.Quadratic.Out)
                .start();

            new TWEEN.Tween(selectedObject.position)
                .to(selectedObject.userData.originalPosition, 500)
                .easing(TWEEN.Easing.Quadratic.Out)
                .start();
        }

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

    document.getElementById('toggle-references').addEventListener('click', toggleReferences);

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