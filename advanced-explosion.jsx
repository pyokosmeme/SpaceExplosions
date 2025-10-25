import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { clampTimeScale, computeSimulationDelta, resolveTimeStep } from './simulation-utils.js';

const PHYS_SCALE = 14.43; // m/s per current sim velocity unit

export default function AdvancedExplosionSimulator() {
  const mountRef = useRef(null);
  const [selectedShape, setSelectedShape] = useState('sphere');
  const [comVelocity, setComVelocity] = useState({ x: 0, y: 0, z: 0 });
  const [explosionSpeed, setExplosionSpeed] = useState(10);
  const [isExploded, setIsExploded] = useState(false);
  const [randomSeed, setRandomSeed] = useState(12345);
  const [useRandomSeed, setUseRandomSeed] = useState(false);
  const [enableGas, setEnableGas] = useState(true);
  const [frameIsCoM, setFrameIsCoM] = useState(true);
  const [followCameraStatus, setFollowCameraStatus] = useState(true);
  const [timeScale, setTimeScale] = useState(1);
  const [isPlaying, setIsPlaying] = useState(true);

  const timeScaleRef = useRef(timeScale);
  const isPlayingRef = useRef(isPlaying);

  useEffect(() => {
    timeScaleRef.current = timeScale;
  }, [timeScale]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  const applyTimeScale = useCallback((value) => {
    const numeric = Number(value);
    const sanitized = clampTimeScale(Number.isFinite(numeric) ? numeric : 0);
    timeScaleRef.current = sanitized;
    setTimeScale(sanitized);
  }, []);

  const togglePlayback = useCallback(() => {
    setIsPlaying((prev) => {
      const next = !prev;
      isPlayingRef.current = next;
      return next;
    });
  }, []);

  // Sync React comVelocity state with Three.js scene
  useEffect(() => {
    if (window.simulatorControls?.updateVelocity) {
      window.simulatorControls.updateVelocity(comVelocity.x, comVelocity.y, comVelocity.z);
    }
  }, [comVelocity]);

  // Sync camera lock setting with Three.js
  useEffect(() => {
    if (window.simulatorControls?.setCameraLock) {
      window.simulatorControls.setCameraLock(frameIsCoM);
    }
  }, [frameIsCoM]);

  useEffect(() => {
    if (!mountRef.current) return;

    // Scene setup
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    camera.position.set(0, 0, 30);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    mountRef.current.appendChild(renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x404040, 2);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(5, 5, 5);
    scene.add(directionalLight);

    // Starfield
    const starsGeometry = new THREE.BufferGeometry();
    const starsMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.5,
    });
    const starsVertices = [];
    for (let i = 0; i < 3000; i++) {
      const x = (Math.random() - 0.5) * 500;
      const y = (Math.random() - 0.5) * 500;
      const z = (Math.random() - 0.5) * 500;
      starsVertices.push(x, y, z);
    }
    starsGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(starsVertices, 3)
    );
    const starField = new THREE.Points(starsGeometry, starsMaterial);
    scene.add(starField);

    // Grid for reference
    const gridHelper = new THREE.GridHelper(50, 50, 0x444444, 0x222222);
    gridHelper.position.y = -10;
    scene.add(gridHelper);

    // Velocity vector arrow
    let velocityArrow = null;

    // Seeded random number generator (LCG)
    class SeededRandom {
      constructor(seed) {
        this.seed = seed;
      }
      
      next() {
        this.seed = (this.seed * 1664525 + 1013904223) % 4294967296;
        return this.seed / 4294967296;
      }
      
      reset(seed) {
        this.seed = seed;
      }
    }
    
    let rng = new SeededRandom(randomSeed);

    // Maxwell-Boltzmann velocity distribution (simplified)
    function maxwellBoltzmannSpeed(temperature) {
      // Box-Muller transform for normal distribution
      const u1 = useRandomSeed ? rng.next() : Math.random();
      const u2 = useRandomSeed ? rng.next() : Math.random();
      const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      const z1 = Math.sqrt(-2 * Math.log(u1)) * Math.sin(2 * Math.PI * u2);
      
      const u3 = useRandomSeed ? rng.next() : Math.random();
      const u4 = useRandomSeed ? rng.next() : Math.random();
      const z2 = Math.sqrt(-2 * Math.log(u3)) * Math.cos(2 * Math.PI * u4);
      
      // Speed from 3D Maxwell-Boltzmann
      const speed = Math.sqrt(z0 * z0 + z1 * z1 + z2 * z2) * temperature;
      return speed;
    }

    // Create shape chunks - ACTUAL geometric pieces that compose the shape
    function createShapeChunks(shapeType) {
      const chunks = [];
      const colors = [0x4488ff, 0x44ff88, 0xff4488, 0xffaa44, 0xaa44ff, 0x44ffff];

      switch (shapeType) {
        case 'cube': {
          // Break cube into 6x6x6 = 216 smaller cubes that perfectly tile
          const divisions = 6;
          const totalSize = 8;
          const pieceSize = totalSize / divisions;
          const offset = -totalSize / 2 + pieceSize / 2;
          
          for (let x = 0; x < divisions; x++) {
            for (let y = 0; y < divisions; y++) {
              for (let z = 0; z < divisions; z++) {
                const geometry = new THREE.BoxGeometry(pieceSize * 0.98, pieceSize * 0.98, pieceSize * 0.98);
                const material = new THREE.MeshPhongMaterial({
                  color: colors[(x + y + z) % colors.length],
                  shininess: 30,
                });
                const mesh = new THREE.Mesh(geometry, material);
                
                const posX = offset + x * pieceSize;
                const posY = offset + y * pieceSize;
                const posZ = offset + z * pieceSize;
                
                mesh.position.set(posX, posY, posZ);
                
                // Calculate mass from bounding box volume
                const bbox = new THREE.Box3().setFromObject(mesh);
                const size = new THREE.Vector3();
                bbox.getSize(size);
                const approxVolume = size.x * size.y * size.z;
                const density = 1.0; // arbitrary units
                const calculatedMass = approxVolume * density;
                
                chunks.push({
                  mesh,
                  initialPos: new THREE.Vector3(posX, posY, posZ),
                  mass: calculatedMass,
                  velocity: new THREE.Vector3(0, 0, 0),
                });
              }
            }
          }
          break;
        }

        case 'sphere': {
          // Break sphere into 72 wedge pieces (like an orange)
          const radius = 5;
          const latSegments = 6; // vertical divisions
          const lonSegments = 12; // horizontal divisions
          
          for (let lat = 0; lat < latSegments; lat++) {
            const phi1 = (lat / latSegments) * Math.PI;
            const phi2 = ((lat + 1) / latSegments) * Math.PI;
            
            for (let lon = 0; lon < lonSegments; lon++) {
              const theta1 = (lon / lonSegments) * Math.PI * 2;
              const theta2 = ((lon + 1) / lonSegments) * Math.PI * 2;
              
              // Create a wedge piece
              const geometry = new THREE.BufferGeometry();
              const vertices = [];
              const indices = [];
              
              // Center point for this wedge
              const centerPhi = (phi1 + phi2) / 2;
              const centerTheta = (theta1 + theta2) / 2;
              
              // Create simplified wedge (8 vertices forming a rough piece)
              const r1 = radius * 0.98;
              const r2 = radius * 0.5;
              
              // Outer layer (4 corners)
              vertices.push(
                r1 * Math.sin(phi1) * Math.cos(theta1), r1 * Math.cos(phi1), r1 * Math.sin(phi1) * Math.sin(theta1),
                r1 * Math.sin(phi1) * Math.cos(theta2), r1 * Math.cos(phi1), r1 * Math.sin(phi1) * Math.sin(theta2),
                r1 * Math.sin(phi2) * Math.cos(theta1), r1 * Math.cos(phi2), r1 * Math.sin(phi2) * Math.sin(theta1),
                r1 * Math.sin(phi2) * Math.cos(theta2), r1 * Math.cos(phi2), r1 * Math.sin(phi2) * Math.sin(theta2)
              );
              
              // Inner layer (4 corners)
              vertices.push(
                r2 * Math.sin(phi1) * Math.cos(theta1), r2 * Math.cos(phi1), r2 * Math.sin(phi1) * Math.sin(theta1),
                r2 * Math.sin(phi1) * Math.cos(theta2), r2 * Math.cos(phi1), r2 * Math.sin(phi1) * Math.sin(theta2),
                r2 * Math.sin(phi2) * Math.cos(theta1), r2 * Math.cos(phi2), r2 * Math.sin(phi2) * Math.sin(theta1),
                r2 * Math.sin(phi2) * Math.cos(theta2), r2 * Math.cos(phi2), r2 * Math.sin(phi2) * Math.sin(theta2)
              );
              
              // Create faces
              const faces = [
                [0,2,3], [0,3,1], // outer
                [4,5,7], [4,7,6], // inner
                [0,1,5], [0,5,4], // side 1
                [2,6,7], [2,7,3], // side 2
                [0,4,6], [0,6,2], // side 3
                [1,3,7], [1,7,5], // side 4
              ];
              
              faces.forEach(face => {
                indices.push(face[0], face[1], face[2]);
              });
              
              geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
              geometry.setIndex(indices);
              geometry.computeVertexNormals();
              
              const centroidX = r1 * 0.65 * Math.sin(centerPhi) * Math.cos(centerTheta);
              const centroidY = r1 * 0.65 * Math.cos(centerPhi);
              const centroidZ = r1 * 0.65 * Math.sin(centerPhi) * Math.sin(centerTheta);
              
              // Translate geometry so it's centered at origin
              geometry.translate(-centroidX, -centroidY, -centroidZ);
              
              const material = new THREE.MeshPhongMaterial({
                color: colors[(lat + lon) % colors.length],
                shininess: 30,
              });
              const mesh = new THREE.Mesh(geometry, material);
              
              // Set mesh position so geometry appears in correct location
              mesh.position.set(centroidX, centroidY, centroidZ);
              
              // Calculate mass from bounding box volume
              const bbox = new THREE.Box3().setFromObject(mesh);
              const size = new THREE.Vector3();
              bbox.getSize(size);
              const approxVolume = size.x * size.y * size.z;
              const density = 1.0;
              const calculatedMass = approxVolume * density;
              
              chunks.push({
                mesh,
                initialPos: new THREE.Vector3(centroidX, centroidY, centroidZ),
                mass: calculatedMass,
                velocity: new THREE.Vector3(0, 0, 0),
              });
            }
          }
          break;
        }

        case 'cone': {
          // Break cone into 60 pieces (10 vertical layers × 6 radial segments)
          const height = 10;
          const baseRadius = 5;
          const layers = 10;
          const segments = 6;
          
          for (let layer = 0; layer < layers; layer++) {
            const y1 = -height / 2 + (layer / layers) * height;
            const y2 = -height / 2 + ((layer + 1) / layers) * height;
            const r1 = baseRadius * (1 - layer / layers);
            const r2 = baseRadius * (1 - (layer + 1) / layers);
            
            for (let seg = 0; seg < segments; seg++) {
              const theta1 = (seg / segments) * Math.PI * 2;
              const theta2 = ((seg + 1) / segments) * Math.PI * 2;
              
              // Create frustum segment
              const geometry = new THREE.BufferGeometry();
              const vertices = [];
              const indices = [];
              
              // Bottom ring
              vertices.push(
                r1 * Math.cos(theta1), y1, r1 * Math.sin(theta1),
                r1 * Math.cos(theta2), y1, r1 * Math.sin(theta2)
              );
              
              // Top ring (smaller)
              vertices.push(
                r2 * Math.cos(theta1), y2, r2 * Math.sin(theta1),
                r2 * Math.cos(theta2), y2, r2 * Math.sin(theta2)
              );
              
              // Inner points (create thickness)
              const innerScale = 0.8;
              vertices.push(
                r1 * innerScale * Math.cos(theta1), y1, r1 * innerScale * Math.sin(theta1),
                r1 * innerScale * Math.cos(theta2), y1, r1 * innerScale * Math.sin(theta2),
                r2 * innerScale * Math.cos(theta1), y2, r2 * innerScale * Math.sin(theta1),
                r2 * innerScale * Math.cos(theta2), y2, r2 * innerScale * Math.sin(theta2)
              );
              
              // Create faces
              indices.push(
                0,1,3, 0,3,2,  // outer
                4,6,7, 4,7,5,  // inner
                0,2,6, 0,6,4,  // side 1
                1,5,7, 1,7,3,  // side 2
              );
              
              geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
              geometry.setIndex(indices);
              geometry.computeVertexNormals();
              
              const centerTheta = (theta1 + theta2) / 2;
              const centerR = (r1 + r2) / 2;
              const centerY = (y1 + y2) / 2;
              
              const posX = centerR * 0.9 * Math.cos(centerTheta);
              const posY = centerY;
              const posZ = centerR * 0.9 * Math.sin(centerTheta);
              
              // Translate geometry so it's centered at origin
              geometry.translate(-posX, -posY, -posZ);
              
              const material = new THREE.MeshPhongMaterial({
                color: colors[(layer + seg) % colors.length],
                shininess: 30,
              });
              const mesh = new THREE.Mesh(geometry, material);
              
              // Set mesh position so geometry appears in correct location
              mesh.position.set(posX, posY, posZ);
              
              // Calculate mass from bounding box volume
              const bbox = new THREE.Box3().setFromObject(mesh);
              const size = new THREE.Vector3();
              bbox.getSize(size);
              const approxVolume = size.x * size.y * size.z;
              const density = 1.0;
              const calculatedMass = approxVolume * density;
              
              chunks.push({
                mesh,
                initialPos: new THREE.Vector3(posX, posY, posZ),
                mass: calculatedMass,
                velocity: new THREE.Vector3(0, 0, 0),
              });
            }
          }
          break;
        }

        case 'cylinder': {
          // Break cylinder into 80 pieces (10 layers × 8 radial segments)
          const height = 10;
          const radius = 4;
          const layers = 10;
          const segments = 8;
          
          for (let layer = 0; layer < layers; layer++) {
            const y1 = -height / 2 + (layer / layers) * height;
            const y2 = -height / 2 + ((layer + 1) / layers) * height;
            
            for (let seg = 0; seg < segments; seg++) {
              const theta1 = (seg / segments) * Math.PI * 2;
              const theta2 = ((seg + 1) / segments) * Math.PI * 2;
              
              // Create cylindrical segment
              const geometry = new THREE.BufferGeometry();
              const vertices = [];
              const indices = [];
              
              const outerR = radius * 0.98;
              const innerR = radius * 0.6;
              
              // Outer ring bottom
              vertices.push(
                outerR * Math.cos(theta1), y1, outerR * Math.sin(theta1),
                outerR * Math.cos(theta2), y1, outerR * Math.sin(theta2)
              );
              
              // Outer ring top
              vertices.push(
                outerR * Math.cos(theta1), y2, outerR * Math.sin(theta1),
                outerR * Math.cos(theta2), y2, outerR * Math.sin(theta2)
              );
              
              // Inner ring bottom
              vertices.push(
                innerR * Math.cos(theta1), y1, innerR * Math.sin(theta1),
                innerR * Math.cos(theta2), y1, innerR * Math.sin(theta2)
              );
              
              // Inner ring top
              vertices.push(
                innerR * Math.cos(theta1), y2, innerR * Math.sin(theta1),
                innerR * Math.cos(theta2), y2, innerR * Math.sin(theta2)
              );
              
              // Create faces
              indices.push(
                0,1,3, 0,3,2,  // outer surface
                4,6,7, 4,7,5,  // inner surface
                0,2,6, 0,6,4,  // side 1
                1,5,7, 1,7,3,  // side 2
                0,4,5, 0,5,1,  // bottom
                2,3,7, 2,7,6,  // top
              );
              
              geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
              geometry.setIndex(indices);
              geometry.computeVertexNormals();
              
              const centerTheta = (theta1 + theta2) / 2;
              const centerR = (outerR + innerR) / 2;
              const centerY = (y1 + y2) / 2;
              
              const posX = centerR * Math.cos(centerTheta);
              const posY = centerY;
              const posZ = centerR * Math.sin(centerTheta);
              
              // Translate geometry so it's centered at origin
              geometry.translate(-posX, -posY, -posZ);
              
              const material = new THREE.MeshPhongMaterial({
                color: colors[(layer + seg) % colors.length],
                shininess: 30,
              });
              const mesh = new THREE.Mesh(geometry, material);
              
              // Set mesh position so geometry appears in correct location
              mesh.position.set(posX, posY, posZ);
              
              // Calculate mass from bounding box volume
              const bbox = new THREE.Box3().setFromObject(mesh);
              const size = new THREE.Vector3();
              bbox.getSize(size);
              const approxVolume = size.x * size.y * size.z;
              const density = 1.0;
              const calculatedMass = approxVolume * density;
              
              chunks.push({
                mesh,
                initialPos: new THREE.Vector3(posX, posY, posZ),
                mass: calculatedMass,
                velocity: new THREE.Vector3(0, 0, 0),
              });
            }
          }
          break;
        }

        case 'ring': {
          // Break torus into 96 pieces (6 around minor × 16 around major)
          // TorusGeometry is oriented in XZ plane (ring horizontal), so chunks must match
          const majorRadius = 5;
          const minorRadius = 1.5;
          const majorSegments = 16;
          const minorSegments = 6;
          
          for (let maj = 0; maj < majorSegments; maj++) {
            const majorAngle1 = (maj / majorSegments) * Math.PI * 2;
            const majorAngle2 = ((maj + 1) / majorSegments) * Math.PI * 2;
            
            for (let min = 0; min < minorSegments; min++) {
              const minorAngle1 = (min / minorSegments) * Math.PI * 2;
              const minorAngle2 = ((min + 1) / minorSegments) * Math.PI * 2;
              
              // Create torus segment
              const geometry = new THREE.BufferGeometry();
              const vertices = [];
              const indices = [];
              
              // Generate vertices for this segment
              // Torus in XZ plane: x = (R + r*cos(v)) * cos(u), y = r*sin(v), z = (R + r*cos(v)) * sin(u)
              const angles = [
                [majorAngle1, minorAngle1],
                [majorAngle1, minorAngle2],
                [majorAngle2, minorAngle1],
                [majorAngle2, minorAngle2],
              ];
              
              angles.forEach(([majA, minA]) => {
                const x = (majorRadius + minorRadius * Math.cos(minA)) * Math.cos(majA);
                const y = minorRadius * Math.sin(minA);
                const z = (majorRadius + minorRadius * Math.cos(minA)) * Math.sin(majA);
                vertices.push(x, y, z);
                
                // Inner vertices (create thickness)
                const innerMinR = minorRadius * 0.6;
                const x2 = (majorRadius + innerMinR * Math.cos(minA)) * Math.cos(majA);
                const y2 = innerMinR * Math.sin(minA);
                const z2 = (majorRadius + innerMinR * Math.cos(minA)) * Math.sin(majA);
                vertices.push(x2, y2, z2);
              });
              
              // Create faces (simplified)
              indices.push(
                0,2,4, 0,4,6,  // outer 1
                1,5,3, 3,5,7,  // outer 2
                0,1,3, 0,3,2,  // side 1
                4,6,7, 4,7,5,  // side 2
              );
              
              geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
              geometry.setIndex(indices);
              geometry.computeVertexNormals();
              
              const centerMajorAngle = (majorAngle1 + majorAngle2) / 2;
              const centerMinorAngle = (minorAngle1 + minorAngle2) / 2;
              const centerX = (majorRadius + minorRadius * 0.8 * Math.cos(centerMinorAngle)) * Math.cos(centerMajorAngle);
              const centerY = minorRadius * 0.8 * Math.sin(centerMinorAngle);
              const centerZ = (majorRadius + minorRadius * 0.8 * Math.cos(centerMinorAngle)) * Math.sin(centerMajorAngle);
              
              // Translate geometry so it's centered at origin
              geometry.translate(-centerX, -centerY, -centerZ);
              
              const material = new THREE.MeshPhongMaterial({
                color: colors[(maj + min) % colors.length],
                shininess: 30,
              });
              const mesh = new THREE.Mesh(geometry, material);
              
              // Set mesh position so geometry appears in correct location
              mesh.position.set(centerX, centerY, centerZ);
              
              // Calculate mass from bounding box volume
              const bbox = new THREE.Box3().setFromObject(mesh);
              const size = new THREE.Vector3();
              bbox.getSize(size);
              const approxVolume = size.x * size.y * size.z;
              const density = 1.0;
              const calculatedMass = approxVolume * density;
              
              chunks.push({
                mesh,
                initialPos: new THREE.Vector3(centerX, centerY, centerZ),
                mass: calculatedMass,
                velocity: new THREE.Vector3(0, 0, 0),
              });
            }
          }
          break;
        }
      }

      return chunks;
    }

    // State
    let currentObject = null;
    let explosionChunks = [];
    let preCreatedChunks = []; // Store pre-created chunks
    let gasParticles = null;
    let centerOfMass = new THREE.Vector3(0, 0, 0);
    let comVel = new THREE.Vector3(0, 0, 0);
    let isMouseDragging = false;
    let previousMousePosition = { x: 0, y: 0 };
    let cameraDistance = 30;
    let targetCameraDistance = 100;
    let touchStartDistance = 0;
    let hasManuallyMovedCamera = false;
    let frameIsCoMSetting = frameIsCoM;
    let followCOMCamera = frameIsCoM;

    // Create initial object
    function createObject(shapeType) {
      // Clear existing
      if (currentObject) {
        scene.remove(currentObject);
      }
      explosionChunks.forEach(chunk => scene.remove(chunk.mesh));
      explosionChunks = [];
      
      // Remove pre-created chunks from scene
      preCreatedChunks.forEach(chunk => {
        if (chunk.mesh.parent) {
          scene.remove(chunk.mesh);
        }
      });
      
      // Remove gas particles
      if (gasParticles) {
        scene.remove(gasParticles);
        gasParticles = null;
      }

      // Don't reset camera or CoM velocity when changing shapes anymore

      const material = new THREE.MeshPhongMaterial({
        color: 0x4488ff,
        shininess: 30,
      });

      let geometry;
      switch (shapeType) {
        case 'cube':
          geometry = new THREE.BoxGeometry(8, 8, 8);
          break;
        case 'sphere':
          geometry = new THREE.SphereGeometry(5, 32, 32);
          break;
        case 'cone':
          geometry = new THREE.ConeGeometry(5, 10, 32);
          break;
        case 'cylinder':
          geometry = new THREE.CylinderGeometry(4, 4, 10, 32);
          break;
        case 'ring':
          geometry = new THREE.TorusGeometry(5, 1.5, 16, 32);
          break;
      }

      currentObject = new THREE.Mesh(geometry, material);
      scene.add(currentObject);
      
      // Pre-create chunks (but don't add to scene yet)
      preCreatedChunks = createShapeChunks(shapeType);
      // Add chunks to scene but make them invisible
      preCreatedChunks.forEach(chunk => {
        chunk.mesh.visible = false;
        scene.add(chunk.mesh);
      });
      
      setIsExploded(false);
    }

    createObject(selectedShape);

    // Update velocity arrow
    function updateVelocityArrow() {
      if (velocityArrow) {
        scene.remove(velocityArrow);
        velocityArrow = null;
      }

      const vel = new THREE.Vector3(comVel.x, comVel.y, comVel.z);
      const length = vel.length();
      
      // Show arrow if velocity is set (non-zero)
      if (length > 0.01) {
        const dir = vel.clone().normalize();
        const origin = centerOfMass.clone();
        const arrowLength = Math.max(5, Math.min(length * 3, 20));
        const headLength = arrowLength * 0.25;
        const headWidth = arrowLength * 0.15;
        
        velocityArrow = new THREE.ArrowHelper(
          dir,
          origin,
          arrowLength,
          0xff0000,
          headLength,
          headWidth
        );
        scene.add(velocityArrow);
      }
    }

    // Explode object
    function explodeObject() {
      if (!currentObject || isExploded) return;

      // Reset RNG if using seed
      if (useRandomSeed) {
        rng.reset(randomSeed);
      }

      followCOMCamera = frameIsCoMSetting;
      setFollowCameraStatus(followCOMCamera && !hasManuallyMovedCamera);

      // Hide the solid object
      currentObject.visible = false;
      
      // Use pre-created chunks
      explosionChunks = preCreatedChunks;
      
      // Make chunks visible and ensure they're at initial positions
      explosionChunks.forEach(chunk => {
        chunk.mesh.position.copy(chunk.initialPos);
        chunk.mesh.rotation.set(0, 0, 0);
        chunk.mesh.visible = true;
      });

      // Calculate total mass
      const totalMass = explosionChunks.reduce((sum, chunk) => sum + chunk.mass, 0);

      // Temperature parameter for Maxwell-Boltzmann
      const temperature = explosionSpeed;

      // Generate chunk velocities with Maxwell-Boltzmann distribution
      const chunkVelocities = [];
      for (let i = 0; i < explosionChunks.length; i++) {
        const speed = maxwellBoltzmannSpeed(temperature);
        const theta = (useRandomSeed ? rng.next() : Math.random()) * Math.PI * 2;
        const phi = Math.acos(2 * (useRandomSeed ? rng.next() : Math.random()) - 1);

        const vx = speed * Math.sin(phi) * Math.cos(theta);
        const vy = speed * Math.sin(phi) * Math.sin(theta);
        const vz = speed * Math.cos(phi);

        chunkVelocities.push(new THREE.Vector3(vx, vy, vz));
      }

      for (let i = 0; i < chunkVelocities.length; i++) {
        chunkVelocities[i].multiplyScalar(PHYS_SCALE);
      }

      // Generate gas if enabled
      let gasVelocities = [];
      let gasPositions = [];
      let gasColors = [];
      let gasCount = 0;
      
      if (enableGas) {
        gasCount = 10000;
        const gasTemperature = temperature * 2; // Gas is hotter
        const whiteHotColor = new THREE.Color(0xffffff);

        for (let i = 0; i < gasCount; i++) {
          // Spawn gas from random chunk surface instead of origin
          const randomChunkIdx = Math.floor((useRandomSeed ? rng.next() : Math.random()) * explosionChunks.length);
          const chunkPos = explosionChunks[randomChunkIdx].initialPos;
          
          // Add small jitter around chunk position
          const jitterScale = 0.5;
          const jitterX = ((useRandomSeed ? rng.next() : Math.random()) - 0.5) * jitterScale;
          const jitterY = ((useRandomSeed ? rng.next() : Math.random()) - 0.5) * jitterScale;
          const jitterZ = ((useRandomSeed ? rng.next() : Math.random()) - 0.5) * jitterScale;
          
          gasPositions.push(
            chunkPos.x + jitterX,
            chunkPos.y + jitterY,
            chunkPos.z + jitterZ
          );

          // Ultra-bright colors
          const color = new THREE.Color();
          const temp = useRandomSeed ? rng.next() : Math.random();
          const brightnessRoll = useRandomSeed ? rng.next() : Math.random();
          if (temp < 0.3) {
            color.setHSL(0.08, 1, 0.88 + brightnessRoll * 0.12);
          } else if (temp < 0.6) {
            color.setHSL(0.12, 1, 0.9 + brightnessRoll * 0.1);
          } else {
            color.setHSL(0.02, 0.3, 0.98 + brightnessRoll * 0.02);
          }
          color.lerp(whiteHotColor, 0.25);
          color.multiplyScalar(1.15);
          color.r = Math.min(1, Math.max(0, color.r));
          color.g = Math.min(1, Math.max(0, color.g));
          color.b = Math.min(1, Math.max(0, color.b));
          gasColors.push(color.r, color.g, color.b);
          
          // Gas velocities from Maxwell-Boltzmann
          const speed = maxwellBoltzmannSpeed(gasTemperature);
          const theta = (useRandomSeed ? rng.next() : Math.random()) * Math.PI * 2;
          const phi = Math.acos(2 * (useRandomSeed ? rng.next() : Math.random()) - 1);
          
          const vx = speed * Math.sin(phi) * Math.cos(theta);
          const vy = speed * Math.sin(phi) * Math.sin(theta);
          const vz = speed * Math.cos(phi);
          
          gasVelocities.push(new THREE.Vector3(vx, vy, vz));
        }
      }

      for (let i = 0; i < gasVelocities.length; i++) {
        gasVelocities[i].multiplyScalar(PHYS_SCALE);
      }

      // GLOBAL MOMENTUM CORRECTION
      // Calculate total momentum from all particles (chunks + gas)
      let totalMomentum = new THREE.Vector3(0, 0, 0);
      
      // Chunk contribution
      explosionChunks.forEach((chunk, i) => {
        totalMomentum.add(chunkVelocities[i].clone().multiplyScalar(chunk.mass));
      });
      
      // Gas contribution (assume gas particles have negligible mass compared to chunks)
      const gasParticleMass = 0.001; // Very small mass per gas particle
      gasVelocities.forEach(vel => {
        totalMomentum.add(vel.clone().multiplyScalar(gasParticleMass));
      });
      
      // Total system mass
      const totalSystemMass = totalMass + gasCount * gasParticleMass;
      
      // Target momentum depends on selected frame:
      // - CoM frame: Stay in CoM frame, target momentum = 0
      // - Lab frame: CoM boosted, target momentum = CoM velocity × mass
      const targetMomentum = frameIsCoMSetting
        ? new THREE.Vector3(0, 0, 0)  // CoM frame
        : comVel.clone().multiplyScalar(totalSystemMass);  // Lab frame
      
      // Global correction
      const momentumCorrection = targetMomentum.sub(totalMomentum).divideScalar(totalSystemMass);
      
      // Apply correction and CoM boost to chunks
      explosionChunks.forEach((chunk, i) => {
        chunk.velocity = chunkVelocities[i].clone().add(momentumCorrection);
      });
      
      // Debug: Log first chunk velocity to verify
      if (explosionChunks.length > 0) {
        console.log('Frame is CoM:', frameIsCoMSetting);
        console.log('CoM Velocity:', comVel.x, comVel.y, comVel.z);
        console.log('Momentum Correction:', momentumCorrection.x, momentumCorrection.y, momentumCorrection.z);
        console.log('First chunk velocity:', explosionChunks[0].velocity.x, explosionChunks[0].velocity.y, explosionChunks[0].velocity.z);
        if (frameIsCoMSetting) {
          console.log('→ Staying in CoM frame (no boost)');
        } else {
          console.log('→ Lab frame with CoM boost of', comVel.x, 'm/s');
        }
      }
      
      // Apply correction to gas and create gas particle system
      if (enableGas) {
        const gasGeometry = new THREE.BufferGeometry();
        gasGeometry.setAttribute('position', new THREE.Float32BufferAttribute(gasPositions, 3));
        gasGeometry.setAttribute('color', new THREE.Float32BufferAttribute(gasColors, 3));
        
        const gasMaterial = new THREE.PointsMaterial({
          size: 0.45,
          vertexColors: true,
          transparent: true,
          opacity: 1.0,
          blending: THREE.AdditiveBlending,
        });

        gasParticles = new THREE.Points(gasGeometry, gasMaterial);
        
        // Store corrected velocities as flat array for gas
        const flatGasVelocities = [];
        gasVelocities.forEach(vel => {
          vel.add(momentumCorrection);
          flatGasVelocities.push(vel.x, vel.y, vel.z);
        });
        
        gasParticles.userData.velocities = flatGasVelocities;
        gasParticles.userData.age = 0;
        gasParticles.userData.maxAge = 2.5;
        
        scene.add(gasParticles);
      }

      setIsExploded(true);
    }

    // Mouse controls
    const onMouseDown = (e) => {
      if (e.button === 0) { // Left click
        isMouseDragging = true;
        hasManuallyMovedCamera = true;
        setFollowCameraStatus(false);
        previousMousePosition = { x: e.clientX, y: e.clientY };
      }
    };

    const onMouseMove = (e) => {
      if (!isMouseDragging) return;

      const deltaX = e.clientX - previousMousePosition.x;
      const deltaY = e.clientY - previousMousePosition.y;

      // Rotate camera around center of mass
      const sensitivity = 0.005;
      const radius = cameraDistance;
      
      // Spherical coordinates
      const offset = camera.position.clone().sub(centerOfMass);
      let theta = Math.atan2(offset.x, offset.z);
      let phi = Math.acos(offset.y / radius);
      
      theta -= deltaX * sensitivity;
      phi -= deltaY * sensitivity;
      phi = Math.max(0.1, Math.min(Math.PI - 0.1, phi));
      
      camera.position.x = centerOfMass.x + radius * Math.sin(phi) * Math.sin(theta);
      camera.position.y = centerOfMass.y + radius * Math.cos(phi);
      camera.position.z = centerOfMass.z + radius * Math.sin(phi) * Math.cos(theta);
      
      camera.lookAt(centerOfMass);

      previousMousePosition = { x: e.clientX, y: e.clientY };
    };

    const onMouseUp = () => {
      isMouseDragging = false;
    };

    const onWheel = (e) => {
      e.preventDefault();

      hasManuallyMovedCamera = true;
      setFollowCameraStatus(false);

      // Zoom in/out with mouse wheel
      const zoomSpeed = 0.001;
      const delta = e.deltaY;
      
      targetCameraDistance += delta * zoomSpeed * targetCameraDistance;
      targetCameraDistance = Math.max(5, Math.min(200, targetCameraDistance));
    };

    // Helper function to get distance between two touch points
    const getTouchDistance = (touches) => {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    const onTouchStart = (e) => {
      hasManuallyMovedCamera = true;
      setFollowCameraStatus(false);

      if (e.touches.length === 2) {
        // Pinch zoom start
        touchStartDistance = getTouchDistance(e.touches);
      } else if (e.touches.length === 1) {
        // Single touch for rotation
        isMouseDragging = true;
        previousMousePosition = { 
          x: e.touches[0].clientX, 
          y: e.touches[0].clientY 
        };
      }
    };

    const onTouchMove = (e) => {
      e.preventDefault();
      
      if (e.touches.length === 2) {
        // Pinch zoom
        const currentDistance = getTouchDistance(e.touches);
        if (touchStartDistance > 0) {
          const zoomFactor = currentDistance / touchStartDistance;
          targetCameraDistance = Math.max(5, Math.min(200, cameraDistance / zoomFactor));
        }
        touchStartDistance = currentDistance;
      } else if (e.touches.length === 1 && isMouseDragging) {
        // Single touch rotation
        const deltaX = e.touches[0].clientX - previousMousePosition.x;
        const deltaY = e.touches[0].clientY - previousMousePosition.y;

        // Rotate camera around center of mass
        const sensitivity = 0.005;
        const radius = cameraDistance;
        
        // Spherical coordinates
        const offset = camera.position.clone().sub(centerOfMass);
        let theta = Math.atan2(offset.x, offset.z);
        let phi = Math.acos(offset.y / radius);
        
        theta -= deltaX * sensitivity;
        phi -= deltaY * sensitivity;
        phi = Math.max(0.1, Math.min(Math.PI - 0.1, phi));
        
        camera.position.x = centerOfMass.x + radius * Math.sin(phi) * Math.sin(theta);
        camera.position.y = centerOfMass.y + radius * Math.cos(phi);
        camera.position.z = centerOfMass.z + radius * Math.sin(phi) * Math.cos(theta);
        
        camera.lookAt(centerOfMass);

        previousMousePosition = { 
          x: e.touches[0].clientX, 
          y: e.touches[0].clientY 
        };
      }
    };

    const onTouchEnd = (e) => {
      if (e.touches.length < 2) {
        touchStartDistance = 0;
      }
      if (e.touches.length === 0) {
        isMouseDragging = false;
      }
    };

    renderer.domElement.addEventListener('mousedown', onMouseDown);
    renderer.domElement.addEventListener('mousemove', onMouseMove);
    renderer.domElement.addEventListener('mouseup', onMouseUp);
    renderer.domElement.addEventListener('mouseleave', onMouseUp);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });
    renderer.domElement.addEventListener('touchstart', onTouchStart, { passive: false });
    renderer.domElement.addEventListener('touchmove', onTouchMove, { passive: false });
    renderer.domElement.addEventListener('touchend', onTouchEnd);

    // Handle window resize
    const onWindowResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', onWindowResize);

    // Animation loop
    const clock = new THREE.Clock();
    const animate = () => {
      requestAnimationFrame(animate);

      const rawDelta = clock.getDelta();
      const simulationDelta = computeSimulationDelta(
        rawDelta,
        timeScaleRef.current,
        isPlayingRef.current
      );
      const lerpDelta = resolveTimeStep(
        isPlayingRef.current,
        simulationDelta,
        rawDelta
      );

      // Update center of mass
      if (explosionChunks.length > 0) {
        const totalMass = explosionChunks.reduce((sum, c) => sum + c.mass, 0);
        centerOfMass.set(0, 0, 0);
        
        explosionChunks.forEach(chunk => {
          centerOfMass.add(chunk.mesh.position.clone().multiplyScalar(chunk.mass));
        });
        centerOfMass.divideScalar(totalMass);

        // Update chunks
        explosionChunks.forEach(chunk => {
          // Update position (constant velocity, no forces)
          chunk.mesh.position.add(chunk.velocity.clone().multiplyScalar(simulationDelta));

          // Add rotation for visual effect
          chunk.mesh.rotation.x += chunk.velocity.length() * simulationDelta * 0.1;
          chunk.mesh.rotation.y += chunk.velocity.length() * simulationDelta * 0.15;
        });
        
        // Update gas particles
        if (gasParticles) {
          gasParticles.userData.age += simulationDelta;
          const positions = gasParticles.geometry.attributes.position.array;
          const velocities = gasParticles.userData.velocities;

          for (let i = 0; i < positions.length; i += 3) {
            positions[i] += velocities[i] * simulationDelta * 10;
            positions[i + 1] += velocities[i + 1] * simulationDelta * 10;
            positions[i + 2] += velocities[i + 2] * simulationDelta * 10;
          }
          
          gasParticles.geometry.attributes.position.needsUpdate = true;
          
          // Fade out gas over time
          const gasProgress = gasParticles.userData.age / gasParticles.userData.maxAge;
          gasParticles.material.opacity = Math.max(0, 1.0 * (1 - gasProgress)); // Start at 1.0
          gasParticles.material.size = 0.45 * (1 + gasProgress * 2); // Expand
          
          // Remove gas when fully faded
          if (gasProgress >= 1) {
            scene.remove(gasParticles);
            gasParticles.geometry.dispose();
            gasParticles.material.dispose();
            gasParticles = null;
          }
        }
      } else if (currentObject) {
        centerOfMass.set(0, 0, 0);
        // Keep intact object static (no rotation)
      }

      // Update camera to follow CoM (only if not manually controlled)
      if (
        followCOMCamera &&
        !hasManuallyMovedCamera &&
        !isMouseDragging
      ) {
        const targetPos = centerOfMass.clone().add(new THREE.Vector3(0, 5, cameraDistance));
        camera.position.lerp(targetPos, lerpDelta * 2);
        camera.lookAt(centerOfMass);
      } else {
        // In lab frame or after manual input, keep camera in world coordinates.
      }

      // Smooth zoom interpolation
      cameraDistance += (targetCameraDistance - cameraDistance) * lerpDelta * 8;
      
      // Update camera distance while maintaining direction (only if manually moved)
      if (hasManuallyMovedCamera && Math.abs(cameraDistance - targetCameraDistance) > 0.01) {
        const direction = camera.position.clone().sub(centerOfMass).normalize();
        camera.position.copy(centerOfMass).add(direction.multiplyScalar(cameraDistance));
      }

      // Always update velocity arrow
      updateVelocityArrow();

      renderer.render(scene, camera);
    };

    animate();

    // External control handlers
    const handleExplode = () => {
      // comVel is already kept in sync by handleVelocityChange via useEffect
      explodeObject();
    };

    const handleReset = () => {
      // Show the intact object again
      if (currentObject) {
        currentObject.visible = true;
      }
      
      // Reset all chunks to their initial positions and hide them
      preCreatedChunks.forEach(chunk => {
        chunk.mesh.position.copy(chunk.initialPos);
        chunk.mesh.rotation.set(0, 0, 0);
        chunk.mesh.visible = false;
      });
      explosionChunks = [];
      
      // Remove gas particles
      if (gasParticles) {
        scene.remove(gasParticles);
        gasParticles.geometry.dispose();
        gasParticles.material.dispose();
        gasParticles = null;
      }
      
      // Reset center of mass
      centerOfMass.set(0, 0, 0);
      
      // Keep camera position and CoM velocity as they are
      setIsExploded(false);
    };

    const handleResetCamera = () => {
      hasManuallyMovedCamera = false;
      cameraDistance = 30;
      targetCameraDistance = 30;
      camera.position.set(0, 0, 30);
      camera.lookAt(centerOfMass);
      setFollowCameraStatus(followCOMCamera && !hasManuallyMovedCamera);
    };

    const handleResetCoM = () => {
      comVel.set(0, 0, 0);
      if (velocityArrow) {
        scene.remove(velocityArrow);
        velocityArrow = null;
      }
    };

    const handleShapeChange = (shape) => {
      createObject(shape);
      centerOfMass.set(0, 0, 0);
      // Don't reset comVel or camera anymore
    };

    const handleVelocityChange = (x, y, z) => {
      comVel.set(x, y, z);
    };

    const handleCameraLockChange = (shouldLock) => {
      frameIsCoMSetting = shouldLock;
      followCOMCamera = shouldLock;
      setFollowCameraStatus(followCOMCamera && !hasManuallyMovedCamera);
    };

    // Expose functions to React
    window.simulatorControls = {
      explode: handleExplode,
      reset: handleReset,
      resetCamera: handleResetCamera,
      resetCoM: handleResetCoM,
      changeShape: handleShapeChange,
      updateVelocity: handleVelocityChange,
      setCameraLock: handleCameraLockChange,
    };

    // Cleanup
    return () => {
      window.removeEventListener('resize', onWindowResize);
      renderer.domElement.removeEventListener('mousedown', onMouseDown);
      renderer.domElement.removeEventListener('mousemove', onMouseMove);
      renderer.domElement.removeEventListener('mouseup', onMouseUp);
      renderer.domElement.removeEventListener('mouseleave', onMouseUp);
      renderer.domElement.removeEventListener('wheel', onWheel);
      renderer.domElement.removeEventListener('touchstart', onTouchStart);
      renderer.domElement.removeEventListener('touchmove', onTouchMove);
      renderer.domElement.removeEventListener('touchend', onTouchEnd);
      
      explosionChunks.forEach((chunk) => {
        if (chunk.mesh.geometry) chunk.mesh.geometry.dispose();
        if (chunk.mesh.material) chunk.mesh.material.dispose();
      });
      preCreatedChunks.forEach((chunk) => {
        if (chunk.mesh.geometry) chunk.mesh.geometry.dispose();
        if (chunk.mesh.material) chunk.mesh.material.dispose();
      });
      if (gasParticles) {
        gasParticles.geometry.dispose();
        gasParticles.material.dispose();
      }
      if (velocityArrow) {
        scene.remove(velocityArrow);
      }
      
      mountRef.current?.removeChild(renderer.domElement);
      renderer.dispose();
    };
  }, []);

  const handleExplode = () => {
    if (window.simulatorControls) {
      window.simulatorControls.explode();
    }
  };

  const handleReset = () => {
    // Don't reset comVelocity state anymore
    if (window.simulatorControls) {
      window.simulatorControls.reset();
    }
  };

  const handleResetCamera = () => {
    if (window.simulatorControls) {
      window.simulatorControls.resetCamera();
    }
  };

  const handleResetCoM = () => {
    setComVelocity({ x: 0, y: 0, z: 0 });
    if (window.simulatorControls) {
      window.simulatorControls.resetCoM();
    }
  };

  const handleShapeChange = (shape) => {
    setSelectedShape(shape);
    // Don't reset comVelocity anymore
    if (window.simulatorControls) {
      window.simulatorControls.changeShape(shape);
    }
  };

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden">
      <div ref={mountRef} className="w-full h-full" />
      
      {/* Control Panel */}
      <div className="absolute top-4 left-4 bg-gray-900 bg-opacity-90 text-white p-4 rounded-lg shadow-lg font-mono text-sm max-w-md">
        <h1 className="text-xl font-bold mb-3 text-blue-400">Physics-Based Explosion Simulator</h1>
        
        {isExploded && (
          <div className="mb-3 p-2 bg-blue-900 bg-opacity-50 rounded border border-blue-500">
            <p className="text-xs font-bold text-blue-300">DEBUG INFO:</p>
            <p className="text-xs">Physical Frame: {frameIsCoM ? 'CoM (total p = 0)' : 'Lab (CoM boosted)'}</p>
            <p className="text-xs">CoM Bulk Velocity: {comVelocity.x} m/s (X-axis)</p>
            <p className="text-xs">Camera Follows CoM: {followCameraStatus ? 'Yes' : 'No (world frame)'}</p>
            <p className="text-xs">Gas thermal RMS ≈ {(50 * explosionSpeed).toFixed(0)} m/s</p>
          </div>
        )}
        
        <div className="mb-3">
          <label className="block mb-1 font-semibold">Shape:</label>
          <div className="flex flex-wrap gap-2">
            {[
              { name: 'cube', pieces: 216 },
              { name: 'sphere', pieces: 72 },
              { name: 'cone', pieces: 60 },
              { name: 'cylinder', pieces: 80 },
              { name: 'ring', pieces: 96 }
            ].map(shape => (
              <button
                key={shape.name}
                onClick={() => handleShapeChange(shape.name)}
                className={`px-3 py-1 rounded ${
                  selectedShape === shape.name 
                    ? 'bg-blue-600 text-white' 
                    : 'bg-gray-700 hover:bg-gray-600'
                }`}
                title={`${shape.pieces} pieces`}
              >
                {shape.name}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-1">
            {selectedShape === 'cube' && '216 cubic pieces (6×6×6)'}
            {selectedShape === 'sphere' && '72 wedge pieces (6 lat × 12 lon)'}
            {selectedShape === 'cone' && '60 frustum segments (10 layers × 6 radial)'}
            {selectedShape === 'cylinder' && '80 cylindrical segments (10 layers × 8 radial)'}
            {selectedShape === 'ring' && '96 torus segments (16 major × 6 minor)'}
          </p>
        </div>

        <div className="mb-3 p-2 bg-gray-800 rounded">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={enableGas}
              onChange={(e) => setEnableGas(e.target.checked)}
              className="w-4 h-4"
            />
            <span className="font-semibold">Gas Escape</span>
          </label>
          <p className="text-xs text-gray-400 mt-1">
            {enableGas ? '🔥 10k ultra-bright particles spawned from surface (2× faster)' : '❌ No gas particles'}
          </p>
        </div>

        <div className="mb-3 p-2 bg-gray-800 rounded">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={frameIsCoM}
              onChange={(e) => setFrameIsCoM(e.target.checked)}
              className="w-4 h-4"
            />
            <span className="font-semibold">CoM Reference Frame</span>
          </label>
          <p className="text-xs text-gray-400 mt-1">
            {frameIsCoM ? '📍 CoM frame: total momentum zero, camera rides CoM' : '🚀 Lab frame: CoM boosted, camera stays in world frame'}
          </p>
        </div>

        <div className="mb-3">
          <label className="block mb-1 font-semibold">
            CoM Velocity - X axis: {comVelocity.x} m/s
          </label>
          <input
            type="range"
            min="-10000"
            max="10000"
            step="100"
            value={comVelocity.x}
            onChange={(e) => setComVelocity({x: parseFloat(e.target.value), y: 0, z: 0})}
            className="w-full"
          />
          <input
            type="number"
            value={comVelocity.x}
            onChange={(e) => setComVelocity({x: parseFloat(e.target.value) || 0, y: 0, z: 0})}
            className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white mt-2"
            step="100"
            placeholder="Enter velocity in m/s"
          />
          <p className="text-xs text-gray-400 mt-1">
            ISS: ~7,700 m/s | Escape velocity: ~11,200 m/s
          </p>
          <div className="flex gap-1 mt-2">
            <button
              onClick={() => setComVelocity({ x: 0, y: 0, z: 0 })}
              className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-1 px-2 rounded text-xs"
            >
              0
            </button>
            <button
              onClick={() => setComVelocity({ x: 1000, y: 0, z: 0 })}
              className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-1 px-2 rounded text-xs"
            >
              1 km/s
            </button>
            <button
              onClick={() => setComVelocity({ x: 5000, y: 0, z: 0 })}
              className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-1 px-2 rounded text-xs"
            >
              5 km/s
            </button>
            <button
              onClick={() => setComVelocity({ x: 7700, y: 0, z: 0 })}
              className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-1 px-2 rounded text-xs"
            >
              ISS
            </button>
          </div>
        </div>

        <div className="mb-3">
          <label className="block mb-1 font-semibold">
            Blast Intensity: {explosionSpeed.toFixed(1)}
          </label>
          <input
            type="range"
            min="1"
            max="30"
            step="0.5"
            value={explosionSpeed}
            onChange={(e) => setExplosionSpeed(parseFloat(e.target.value))}
            className="w-full"
          />
          <p className="text-xs text-gray-400 mt-1">
            Temperature parameter for velocity distribution
          </p>
          <p className="text-xs text-gray-400">
            Gas thermal RMS ≈ {(50 * explosionSpeed).toFixed(0)} m/s
          </p>
        </div>

        <div className="mb-3 p-2 bg-gray-800 rounded">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={useRandomSeed}
              onChange={(e) => setUseRandomSeed(e.target.checked)}
              className="w-4 h-4"
            />
            <span className="font-semibold">Reproducible Explosions</span>
          </label>
          {useRandomSeed && (
            <div className="mt-2">
              <label className="text-xs text-gray-400">Random Seed:</label>
              <input
                type="number"
                value={randomSeed}
                onChange={(e) => setRandomSeed(parseInt(e.target.value) || 12345)}
                className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-white mt-1"
              />
              <p className="text-xs text-gray-400 mt-1">
                ✅ Same seed = identical explosion every time
              </p>
            </div>
          )}
          {!useRandomSeed && (
            <p className="text-xs text-gray-400 mt-1">
              🎲 Each explosion is unique (random)
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <button
            onClick={handleExplode}
            disabled={isExploded}
            className={`w-full py-2 rounded font-bold ${
              isExploded
                ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                : 'bg-red-600 hover:bg-red-700 text-white'
            }`}
          >
            💥 EXPLODE
          </button>
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={handleReset}
              className="bg-green-600 hover:bg-green-700 text-white py-2 rounded font-bold text-sm"
              title="Reset object (keep camera & CoM)"
            >
              🔄 Reset
            </button>
            <button
              onClick={handleResetCamera}
              className="bg-blue-600 hover:bg-blue-700 text-white py-2 rounded font-bold text-sm"
              title="Reset camera position"
            >
              📷 Camera
            </button>
            <button
              onClick={handleResetCoM}
              className="bg-purple-600 hover:bg-purple-700 text-white py-2 rounded font-bold text-sm"
              title="Reset CoM velocity"
            >
              🎯 CoM
            </button>
          </div>
        </div>

        <div className="mt-3 pt-3 border-t border-gray-700 text-xs text-gray-400">
          <p>🖱️ <strong>Drag</strong>: Rotate camera around CoM</p>
          <p>🖱️ <strong>Mouse wheel</strong>: Zoom in/out</p>
          <p>📱 <strong>Pinch</strong>: Zoom on mobile</p>
          <p>📍 <strong>CoM Frame</strong>: Toggle between CoM/Lab reference frames</p>
          <p>🔄 <strong>Reset</strong>: Restore object (keeps camera & CoM)</p>
          <p>📷 <strong>Camera</strong>: Reset camera to default view</p>
          <p>🎯 <strong>CoM</strong>: Clear CoM velocity</p>
          <p>🔴 <strong>Red arrow</strong>: CoM velocity vector</p>
          <p>✅ <strong>Global momentum conserved</strong> (chunks + gas)</p>
          <p>📊 <strong>Maxwell-Boltzmann PDF</strong> for all particles</p>
          <p>⚖️ <strong>Mass from geometry volume</strong> (realistic chunks)</p>
          <p>🎨 <strong>Color-coded pieces</strong> show pre-fractured structure</p>
          <p>🔥 <strong>Gas</strong>: 10k particles from surface, 2× faster</p>
        </div>
      </div>

      {/* Time Controls */}
      <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 w-full max-w-xl px-4">
        <div className="bg-gray-900/80 text-white px-4 py-3 rounded-lg shadow-lg backdrop-blur">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <button
              onClick={togglePlayback}
              className={`w-full md:w-32 px-4 py-2 rounded font-semibold transition-colors ${
                isPlaying ? 'bg-yellow-500 hover:bg-yellow-400 text-black' : 'bg-green-500 hover:bg-green-400 text-black'
              }`}
            >
              {isPlaying ? '⏸ Pause' : '▶️ Play'}
            </button>

            <div className="flex-1">
              <div className="flex items-center justify-between text-xs uppercase tracking-wide text-gray-400">
                <span>Time Scale</span>
                <span>{timeScale.toFixed(2)}×</span>
              </div>
              <input
                type="range"
                min="0.001"
                max="3"
                step="0.05"
                value={timeScale}
                onChange={(e) => applyTimeScale(e.target.value)}
                className="w-full"
              />
              <div className="flex justify-between text-[10px] text-gray-500 mt-1">
                <span>Slow</span>
                <span>Fast</span>
              </div>
            </div>

            <button
              onClick={() => applyTimeScale(1)}
              className="w-full md:w-24 px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 font-semibold"
            >
              Reset 1×
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
