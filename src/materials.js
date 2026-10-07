import * as THREE from 'three';

function random(seed) {
  let n = seed >>> 0;
  return () => {n = (1664525 * n + 1013904223) >>> 0;return n / 4294967296;};
}

let clothTexture;
function cloth() {
  if (clothTexture) return clothTexture;
  const canvas = document.createElement('canvas');canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d'), rand = random(307);
  ctx.fillStyle = '#888';ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 11000; i++) {
    const x = rand() * 256, y = rand() * 256, shade = 90 + Math.floor(rand() * 90);
    ctx.strokeStyle = `rgb(${shade},${shade},${shade})`;ctx.lineWidth = .7;
    ctx.beginPath();ctx.moveTo(x, y);ctx.quadraticCurveTo(x + 2, y - 3, x + rand() * 4 - 2, y - 5);ctx.stroke();
  }
  clothTexture = new THREE.CanvasTexture(canvas);
  clothTexture.wrapS = clothTexture.wrapT = THREE.RepeatWrapping;
  clothTexture.repeat.set(3, 3);
  return clothTexture;
}

// Actual curved tapered fibers extend beyond each ellipsoid's silhouette.
// The geometry is created once; it follows the physics body without wind,
// breathing, blinking or any other autonomous animation.
function fibers(size, color, density, seed, length) {
  const rand = random(seed), [rx, ry, rz] = size;
  const area = 4 * Math.PI * Math.pow((Math.pow(rx * ry, 1.6075) + Math.pow(rx * rz, 1.6075) + Math.pow(ry * rz, 1.6075)) / 3, 1 / 1.6075);
  const count = Math.max(180, Math.round(area * density));
  const steps = 4, verticesPerHair = (steps + 1) * 2;
  const positions = new Float32Array(count * verticesPerHair * 3);
  const normals = new Float32Array(positions.length), colors = new Float32Array(positions.length);
  const indices = new Uint32Array(count * steps * 6);
  const baseColor = new THREE.Color(color), normal = new THREE.Vector3(), root = new THREE.Vector3();
  const tangent = new THREE.Vector3(), binormal = new THREE.Vector3(), side = new THREE.Vector3(), point = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0), right = new THREE.Vector3(1, 0, 0);
  for (let hair = 0; hair < count; hair++) {
    const y = rand() * 2 - 1, phi = rand() * Math.PI * 2, radial = Math.sqrt(1 - y * y);
    root.set(rx * radial * Math.cos(phi), ry * y, rz * radial * Math.sin(phi));
    normal.set(root.x / (rx * rx), root.y / (ry * ry), root.z / (rz * rz)).normalize();
    tangent.crossVectors(normal, Math.abs(normal.y) > .9 ? right : up).normalize();
    binormal.crossVectors(normal, tangent).normalize();
    const angle = rand() * Math.PI * 2, curl = .3 + rand() * .5, hairLength = length * (.55 + rand() * .8);
    const lean = (rand() - .5) * .5, width = .0026 + rand() * .0019, shade = .94 + rand() * .15;
    side.copy(tangent).multiplyScalar(-Math.sin(angle)).addScaledVector(binormal, Math.cos(angle));
    for (let step = 0; step <= steps; step++) {
      const t = step / steps, bend = Math.sin(t * Math.PI * 1.2) * curl * hairLength + lean * t * hairLength;
      point.copy(root).addScaledVector(normal, hairLength * t * (1 - .17 * t));
      point.addScaledVector(tangent, Math.cos(angle) * bend).addScaledVector(binormal, Math.sin(angle) * bend);
      const w = width * (1 - .92 * t);
      for (let edge = 0; edge < 2; edge++) {
        const index = (hair * verticesPerHair + step * 2 + edge) * 3, sign = edge ? 1 : -1;
        positions[index] = point.x + side.x * w * sign;
        positions[index + 1] = point.y + side.y * w * sign;
        positions[index + 2] = point.z + side.z * w * sign;
        normals[index] = normal.x;normals[index + 1] = normal.y;normals[index + 2] = normal.z;
        const brightness = shade * (.92 + t * .13);
        colors[index] = baseColor.r * brightness;colors[index + 1] = baseColor.g * brightness;colors[index + 2] = baseColor.b * brightness;
      }
      if (step < steps) {
        const a = hair * verticesPerHair + step * 2, offset = (hair * steps + step) * 6;
        indices.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], offset);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));geometry.computeBoundingSphere();
  return geometry;
}

const furMaterial = new THREE.MeshPhysicalMaterial({
  color: 0xffffff, vertexColors: true, roughness: .96, metalness: 0,
  side: THREE.DoubleSide, sheen: 1, sheenRoughness: .85, sheenColor: new THREE.Color('#baa88d')
});
// Both faces of a ribbon represent the same round fiber. Its radial normals
// should not flip to black when viewed from the back of the thin ribbon.
furMaterial.onBeforeCompile = shader => {
  shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>',
    THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''));
};
furMaterial.customProgramCacheKey = () => 'plush-fiber-radial-normals-v1';

export function makePlush(size, {color = '#b78b5f', density = 1000, seed = 1, length = .036, pickable = true} = {}) {
  const root = new THREE.Group();
  const core = new THREE.Mesh(new THREE.SphereGeometry(1, 36, 24), new THREE.MeshPhysicalMaterial({
    color, roughness: .98, metalness: 0, sheen: 1, sheenRoughness: .85,
    sheenColor: new THREE.Color('#c1a680'), bumpMap: cloth(), bumpScale: .012
  }));
  core.scale.set(...size);core.castShadow = true;core.receiveShadow = true;
  const fur = new THREE.Mesh(fibers(size, color, density, seed, length), furMaterial);
  fur.receiveShadow = false;fur.castShadow = false;
  root.add(core, fur);root.userData.core = core;root.userData.pickable = pickable;
  root.userData.fiberCount = fur.geometry.getAttribute('position').count / 10;
  return root;
}

export function stitches(rx, ry, rz, color = '#937650') {
  const points = [];
  for (let i = 0; i < 48; i++) {
    const a = i / 48 * Math.PI * 2, b = a + .048;
    for (const t of [a, b]) points.push(Math.cos(t) * rx * .88, Math.sin(t) * ry * .88, rz * Math.sqrt(1 - .88 * .88) + .003);
  }
  const geometry = new THREE.BufferGeometry();geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({color}));
}

export function thread(points, radius = .009, color = '#65472e') {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
  return new THREE.Mesh(new THREE.TubeGeometry(curve, 20, radius, 5, false), new THREE.MeshStandardMaterial({color, roughness: .94}));
}
