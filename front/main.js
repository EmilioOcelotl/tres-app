// main.js — Grafo force-directed 3D para la estructura de notas
// ==============================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import {
    forceSimulation,
    forceLink,
    forceManyBody,
    forceCenter,
    forceX,
    forceY
} from 'd3-force-3d';

const CONFIG = {
    apiBase: '/api/3d',
    colors: {
        background: 0x020308,
        root: 0xffffff,
        part1: 0x00ddff,
        part2: 0xff3388,
        part3: 0xaa55ff,
        refs: 0xddeeff
    },
    levelRadii: [2.6, 1.9, 1.25, 0.85, 0.55, 0.4, 0.3],
    linkDistances: [26, 20, 14, 9, 6, 5, 4],
    charge: -160,
    hemisphereOffset: 45,
    hemisphereStrength: 0.2,
    refsLiftTarget: 28,
    refsLiftStrength: 0.12,
    bloom: {
        strength: 0.95,
        radius: 0.55,
        threshold: 0
    },
    labels: {
        near: 25,
        far: 130
    },
    cameraStart: new THREE.Vector3(0, 35, 145)
};

// ========================================
// Estado
// ========================================

const AppState = {
    nodes: [],
    links: [],
    nodesById: new Map(),
    loadedNotes: new Map(),
    simulation: null,
    referencesVisible: true,
    selectedNode: null
};

let scene, camera, renderer, labelRenderer, controls, composer, bloomPass;
let raycaster, mouse;
let linksObject = null;

const groups = {
    halos: new THREE.Group(),
    cores: new THREE.Group(),
    links: new THREE.Group()
};

const loadingScreen = document.getElementById('loading-screen');
const noteDisplayOverlay = document.getElementById('note-display-overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayContent = document.getElementById('overlay-content');
const closeOverlayButton = document.getElementById('close-overlay');

// ========================================
// API
// ========================================

async function fetchTree() {
    const res = await fetch(`${CONFIG.apiBase}/structure`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!json.success) throw new Error('Error al obtener estructura');
    console.log(`Árbol cargado: ${json.metadata.totalNodes} nodos`);
    return json.data;
}

async function fetchNoteContent(noteId, useCache = true) {
    if (useCache && AppState.loadedNotes.has(noteId)) return AppState.loadedNotes.get(noteId);
    const res = await fetch(`${CONFIG.apiBase}/note/${noteId}/content`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!json.success) throw new Error('Error al obtener contenido de la nota');
    AppState.loadedNotes.set(noteId, json.data);
    return json.data;
}

async function searchNote(query) {
    const res = await fetch(`${CONFIG.apiBase}/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return json.success ? json.data.results : [];
}

// ========================================
// Árbol → nodos planos + enlaces
// ========================================

function classifyPart(title) {
    const t = (title || '').toLowerCase();
    if (t.includes('referencias')) return 'refs';
    if (t.startsWith('parte iii') || t.includes('archivos comprimidos')) return 'part3';
    if (t.startsWith('parte ii') || t.includes('transversal')) return 'part2';
    if (t.startsWith('parte i') || t.includes('archivo principal')) return 'part1';
    return null;
}

function flattenTree(root) {
    const nodes = [];
    const links = [];
    function walk(n, level, parentId, inheritedPart) {
        const detected = classifyPart(n.title);
        const part = inheritedPart || detected || 'root';
        nodes.push({
            id: n.id,
            title: n.title,
            level,
            parentId,
            part,
            x: (Math.random() - 0.5) * 60,
            y: (Math.random() - 0.5) * 30,
            z: (Math.random() - 0.5) * 60
        });
        if (parentId) links.push({ source: parentId, target: n.id });
        const childPart = level === 0 ? null : part;
        (n.children || []).forEach(c => walk(c, level + 1, n.id, childPart));
    }
    walk(root, 0, null, null);
    return { nodes, links };
}

// ========================================
// Helpers
// ========================================

function getRadius(level) {
    const a = CONFIG.levelRadii;
    return a[Math.min(level, a.length - 1)];
}

function getColor(part) {
    return CONFIG.colors[part] ?? CONFIG.colors.root;
}

function getLinkDistance(level) {
    const a = CONFIG.linkDistances;
    return a[Math.min(level, a.length - 1)];
}

// ========================================
// Three.js setup
// ========================================

function initScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(CONFIG.colors.background);
    scene.fog = new THREE.FogExp2(CONFIG.colors.background, 0.0065);

    camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 800);
    camera.position.copy(CONFIG.cameraStart);
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    document.getElementById('scene-container').appendChild(renderer.domElement);

    labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.domElement.style.position = 'absolute';
    labelRenderer.domElement.style.top = '0';
    labelRenderer.domElement.style.left = '0';
    labelRenderer.domElement.style.pointerEvents = 'none';
    labelRenderer.domElement.style.zIndex = '50';
    document.getElementById('scene-container').appendChild(labelRenderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;

    const renderPass = new RenderPass(scene, camera);
    bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        CONFIG.bloom.strength,
        CONFIG.bloom.radius,
        CONFIG.bloom.threshold
    );
    composer = new EffectComposer(renderer);
    composer.addPass(renderPass);
    composer.addPass(bloomPass);

    scene.add(groups.links);
    scene.add(groups.halos);
    scene.add(groups.cores);

    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    window.addEventListener('resize', onWindowResize);
    renderer.domElement.addEventListener('click', onClick);
    window.addEventListener('keydown', e => {
        if (e.key === 'r' || e.key === 'R') toggleReferences();
    });
    closeOverlayButton.addEventListener('click', deselectNode);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
}

// ========================================
// Construcción del grafo
// ========================================

function buildGraph(tree) {
    const { nodes, links } = flattenTree(tree);
    AppState.nodes = nodes;
    AppState.links = links;
    AppState.nodesById.clear();
    nodes.forEach(n => AppState.nodesById.set(n.id, n));

    nodes.forEach(n => buildNodeMeshes(n));
    buildLinksGeometry();
}

function buildNodeMeshes(node) {
    const radius = getRadius(node.level);
    const color = getColor(node.part);

    const coreGeo = new THREE.SphereGeometry(radius, 20, 16);
    const coreMat = new THREE.MeshBasicMaterial({ color });
    const core = new THREE.Mesh(coreGeo, coreMat);
    core.userData = { id: node.id, title: node.title, part: node.part, level: node.level };
    groups.cores.add(core);

    const haloGeo = new THREE.SphereGeometry(radius * 2.4, 16, 12);
    const haloMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.12,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    groups.halos.add(halo);

    const div = document.createElement('div');
    div.className = `node-label node-label--${node.part} node-label--l${Math.min(node.level, 6)}`;
    div.textContent = node.title;
    const label = new CSS2DObject(div);
    label.position.set(0, radius + 1.4, 0);
    core.add(label);

    node.core = core;
    node.halo = halo;
    node.labelDiv = div;
    node.label = label;
    node.baseHaloOpacity = 0.12;
}

function buildLinksGeometry() {
    const n = AppState.links.length;
    const positions = new Float32Array(n * 2 * 3);
    const colors = new Float32Array(n * 2 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.22,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    linksObject = new THREE.LineSegments(geo, mat);
    groups.links.add(linksObject);

    const cArr = geo.attributes.color.array;
    AppState.links.forEach((l, i) => {
        const s = AppState.nodesById.get(l.source);
        const t = AppState.nodesById.get(l.target);
        if (!s || !t) return;
        const sc = new THREE.Color(getColor(s.part));
        const tc = new THREE.Color(getColor(t.part));
        cArr[i * 6 + 0] = sc.r; cArr[i * 6 + 1] = sc.g; cArr[i * 6 + 2] = sc.b;
        cArr[i * 6 + 3] = tc.r; cArr[i * 6 + 4] = tc.g; cArr[i * 6 + 5] = tc.b;
    });
    geo.attributes.color.needsUpdate = true;
}

function updateLinkPositions() {
    if (!linksObject) return;
    const arr = linksObject.geometry.attributes.position.array;
    AppState.links.forEach((l, i) => {
        const s = typeof l.source === 'object' ? l.source : AppState.nodesById.get(l.source);
        const t = typeof l.target === 'object' ? l.target : AppState.nodesById.get(l.target);
        if (!s || !t) return;
        arr[i * 6 + 0] = s.x; arr[i * 6 + 1] = s.y; arr[i * 6 + 2] = s.z;
        arr[i * 6 + 3] = t.x; arr[i * 6 + 4] = t.y; arr[i * 6 + 5] = t.z;
    });
    linksObject.geometry.attributes.position.needsUpdate = true;
}

// ========================================
// Simulación d3-force-3d
// ========================================

function startSimulation() {
    AppState.simulation = forceSimulation(AppState.nodes, 3)
        .force('link', forceLink(AppState.links).id(d => d.id).distance(l => {
            const target = typeof l.target === 'object' ? l.target : AppState.nodesById.get(l.target);
            return getLinkDistance(target?.level ?? 3);
        }).strength(0.55))
        .force('charge', forceManyBody().strength(CONFIG.charge).distanceMax(220))
        .force('center', forceCenter(0, 0, 0).strength(0.02))
        .force('hemisphere', forceX(n => {
            if (n.part === 'part1') return -CONFIG.hemisphereOffset;
            if (n.part === 'part2') return CONFIG.hemisphereOffset;
            return 0;
        }).strength(CONFIG.hemisphereStrength))
        .force('refs-lift', forceY(n => n.part === 'refs' ? CONFIG.refsLiftTarget : 0).strength(CONFIG.refsLiftStrength))
        .velocityDecay(0.35)
        .alphaDecay(0.008);
}

// ========================================
// Loop
// ========================================

function animate() {
    requestAnimationFrame(animate);
    if (AppState.simulation) AppState.simulation.tick();
    for (const n of AppState.nodes) {
        if (n.core) n.core.position.set(n.x, n.y, n.z);
        if (n.halo) n.halo.position.set(n.x, n.y, n.z);
    }
    updateLinkPositions();
    updateLabelOpacity();
    controls.update();
    composer.render();
    labelRenderer.render(scene, camera);
}

const _tmpVec = new THREE.Vector3();
function updateLabelOpacity() {
    const camPos = camera.position;
    for (const n of AppState.nodes) {
        if (!n.labelDiv) continue;
        _tmpVec.set(n.x, n.y, n.z);
        const dist = _tmpVec.distanceTo(camPos);
        let opacity;
        if (n.level <= 1) {
            opacity = Math.max(0.45, Math.min(1, (CONFIG.labels.far + 60 - dist) / 140));
        } else if (n.level === 2) {
            opacity = Math.max(0, Math.min(1, (CONFIG.labels.far - dist) / (CONFIG.labels.far - CONFIG.labels.near)));
        } else {
            const near = CONFIG.labels.near * 0.5;
            const far = CONFIG.labels.far * 0.55;
            opacity = Math.max(0, Math.min(1, (far - dist) / (far - near)));
        }
        n.labelDiv.style.opacity = opacity.toFixed(2);
    }
}

// ========================================
// Interacción
// ========================================

function onClick(e) {
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(groups.cores.children, false);
    if (hits.length > 0) {
        selectNode(hits[0].object.userData.id);
    } else {
        deselectNode();
    }
}

async function selectNode(id) {
    if (AppState.selectedNode && AppState.selectedNode.id === id) {
        deselectNode();
        return;
    }
    if (AppState.selectedNode) deselectNode();
    const node = AppState.nodesById.get(id);
    if (!node) return;
    AppState.selectedNode = node;
    node.core.scale.setScalar(1.4);
    node.halo.scale.setScalar(1.5);
    node.halo.material.opacity = 0.32;
    if (node.labelDiv) node.labelDiv.classList.add('node-label--selected');
    try {
        const data = await fetchNoteContent(id);
        displayNoteInOverlay(data);
    } catch (err) {
        console.error('Error cargando nota:', err);
    }
}

function deselectNode() {
    const s = AppState.selectedNode;
    if (!s) return;
    s.core.scale.setScalar(1);
    s.halo.scale.setScalar(1);
    s.halo.material.opacity = s.baseHaloOpacity;
    if (s.labelDiv) s.labelDiv.classList.remove('node-label--selected');
    AppState.selectedNode = null;
    hideNoteOverlay();
}

function toggleReferences() {
    AppState.referencesVisible = !AppState.referencesVisible;
    for (const n of AppState.nodes) {
        if (n.part !== 'refs') continue;
        if (n.core) n.core.visible = AppState.referencesVisible;
        if (n.halo) n.halo.visible = AppState.referencesVisible;
    }
    const btn = document.getElementById('toggle-references');
    if (btn) btn.textContent = AppState.referencesVisible ? 'REFS: ON' : 'REFS: OFF';
}

// ========================================
// Overlay
// ========================================

function displayNoteInOverlay(note) {
    overlayTitle.textContent = note.title;
    overlayContent.innerHTML = note.content.html || '<p>No hay contenido</p>';
    noteDisplayOverlay.style.display = 'flex';
}

function hideNoteOverlay() {
    noteDisplayOverlay.style.display = 'none';
}

// ========================================
// Welcome modal
// ========================================

function matchChildTitle(title, segment) {
    if (!title) return false;
    const t = title.toLowerCase();
    const s = segment.toLowerCase();
    const partMatch = s.match(/^parte (i{1,3})$/);
    if (partMatch) {
        const re = new RegExp(`^parte ${partMatch[1]}(\\s|—|-|$)`, 'i');
        return re.test(t);
    }
    return t.includes(s);
}

function findNoteByPath(root, pathSegments) {
    let current = root;
    for (const segment of pathSegments) {
        if (!current || !current.children) return null;
        current = current.children.find(c => matchChildTitle(c.title, segment));
        if (!current) return null;
    }
    return current;
}

function findAncestors(node, targetId, path = []) {
    if (node.id === targetId) return path;
    for (const child of (node.children || [])) {
        const found = findAncestors(child, targetId, [...path, node.title]);
        if (found) return found;
    }
    return null;
}

async function showWelcomeModal(tree) {
    const modal = document.getElementById('welcome-modal');
    const contentEl = document.getElementById('welcome-content');
    const enterBtn = document.getElementById('welcome-enter');

    try {
        const byPath =
            findNoteByPath(tree, ['parte i', 'introducci', 'léeme']) ||
            findNoteByPath(tree, ['parte i', 'introducci', 'leeme']) ||
            findNoteByPath(tree, ['parte i', 'léeme']);

        let leemeId = byPath?.id || null;

        if (!leemeId) {
            const results = await searchNote('léeme');
            console.log('Búsqueda "léeme":', results);
            for (const r of results) {
                const ancestors = findAncestors(tree, r.id);
                if (ancestors && ancestors.some(a => a.toLowerCase().includes('introducci'))) {
                    leemeId = r.id;
                    break;
                }
            }
            if (!leemeId && results.length === 1) leemeId = results[0].id;
        }

        if (leemeId) {
            const noteData = await fetchNoteContent(leemeId, false);
            console.log('Léeme noteData:', noteData);
            const html = noteData.content?.html?.trim();
            const raw = noteData.content?.raw?.trim();
            const plain = noteData.content?.plain?.trim();
            if (html) contentEl.innerHTML = html;
            else if (raw) contentEl.innerHTML = raw;
            else if (plain) contentEl.textContent = plain;
            else contentEl.innerHTML = '<p>Sin contenido</p>';
        } else {
            contentEl.innerHTML = '<p>Nota de bienvenida no encontrada.</p>';
        }
    } catch (err) {
        console.error('Error en modal de bienvenida:', err);
        contentEl.innerHTML = '<p>No se pudo cargar el contenido.</p>';
    }

    return new Promise(resolve => {
        enterBtn.addEventListener('click', () => {
            modal.style.display = 'none';
            resolve();
        }, { once: true });
    });
}

// ========================================
// Init
// ========================================

async function init() {
    loadingScreen.style.display = 'flex';
    document.getElementById('toggle-references').addEventListener('click', toggleReferences);
    initScene();
    animate();

    try {
        const tree = await fetchTree();
        loadingScreen.style.display = 'none';
        await showWelcomeModal(tree);
        buildGraph(tree);
        startSimulation();
        console.log(`Grafo creado: ${AppState.nodes.length} nodos, ${AppState.links.length} enlaces`);
    } catch (err) {
        console.error('Error inicializando:', err);
        overlayTitle.textContent = 'Error';
        overlayContent.innerHTML = '<p>No se pudo cargar la estructura de notas.</p>';
        noteDisplayOverlay.style.display = 'flex';
        document.getElementById('welcome-modal').style.display = 'none';
    } finally {
        loadingScreen.style.display = 'none';
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
