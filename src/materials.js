import * as THREE from 'three';

function random(seed) {
  let n = seed >>> 0;
  return () => {n = (1664525 * n + 1013904223) >>> 0;return n / 4294967296;};
}

let clothTextures;
function cloth() {
  if (clothTextures) return clothTextures;
  const canvas = document.createElement('canvas');canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d'), rand = random(307);
  ctx.fillStyle = '#e5e0d7';ctx.fillRect(0, 0, 512, 512);
  // Small overlapping tufts, rather than independent evenly spaced scratches.
  // Wrap each tuft at the edges so the cloth has no visible texture seam.
  for (let i = 0; i < 1100; i++) {
    const x = rand() * 512, y = rand() * 512, angle = rand() * Math.PI * 2;
    const radius = 4 + rand() * 7, shade = 155 + Math.floor(rand() * 42);
    const offsets = Array.from({length: 13}, () => rand() * 2);
    for (const dx of [-512, 0, 512]) for (const dy of [-512, 0, 512]) {
      if (x + dx < -16 || x + dx > 528 || y + dy < -16 || y + dy > 528) continue;
      ctx.save();ctx.translate(x + dx, y + dy);ctx.rotate(angle);
      for (let strand = 0; strand < 13; strand++) {
        const spread = (strand / 12 - .5) * radius, offset = offsets[strand];
        ctx.strokeStyle = `rgba(${shade},${shade - 4},${shade - 10},.34)`;ctx.lineWidth = 1.4;
        ctx.beginPath();ctx.moveTo(spread, radius * .5 + offset);
        ctx.bezierCurveTo(spread - radius * .35, 0, spread + radius * .7, -radius * .65, spread * .5, -radius);ctx.stroke();
        ctx.strokeStyle = 'rgba(255,252,240,.48)';ctx.lineWidth = .65;ctx.stroke();
      }
      ctx.restore();
    }
  }
  const map = new THREE.CanvasTexture(canvas);map.colorSpace = THREE.SRGBColorSpace;
  const bump = new THREE.CanvasTexture(canvas);
  for (const texture of [map, bump]) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;texture.repeat.set(2, 2);
  }
  clothTextures = {map, bump};return clothTextures;
}

export function plushMaterial(color = '#c8aa7f') {
  const textures = cloth();
  return new THREE.MeshPhysicalMaterial({color, map: textures.map, roughness: .98, metalness: 0,
    sheen: 1, sheenRoughness: .88, sheenColor: new THREE.Color('#d8c3a1'), bumpMap: textures.bump, bumpScale: .018});
}

// A spatial field gives nearby strands a shared direction and curl, producing
// little brushed clumps without animating the fur or introducing wind.
function tuft(point) {
  const {x, y, z} = point;
  return Math.sin(x * 37 + Math.sin(z * 23) * 1.8) * .52 + Math.cos(y * 31 + z * 19) * .48;
}

// Actual curved tapered fibers extend beyond each ellipsoid's silhouette.
// The geometry is created once; it follows the physics body without wind,
// breathing, blinking or any other autonomous animation.
export function fiberGeometry(surface, {color, density, seed, length}) {
  const rand = random(seed), count = Math.max(180, Math.round(surface.area * density));
  const steps = 5, verticesPerHair = (steps + 1) * 2;
  const positions = new Float32Array(count * verticesPerHair * 3);
  const normals = new Float32Array(positions.length), colors = new Float32Array(positions.length);
  const indices = new Uint32Array(count * steps * 6);
  const skinIndices = surface.weights ? new Uint16Array(count * verticesPerHair * 4) : null;
  const skinWeights = surface.weights ? new Float32Array(skinIndices.length) : null;
  const baseColor = new THREE.Color(color), normal = new THREE.Vector3(), root = new THREE.Vector3();
  const tangent = new THREE.Vector3(), binormal = new THREE.Vector3(), side = new THREE.Vector3(), point = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0), right = new THREE.Vector3(1, 0, 0);
  for (let hair = 0; hair < count; hair++) {
    const u = rand(), v = rand();surface.sample(u, v, root, normal);
    tangent.crossVectors(normal, Math.abs(normal.y) > .9 ? right : up).normalize();
    binormal.crossVectors(normal, tangent).normalize();
    const cluster = tuft(root), angle = cluster * Math.PI * 2 + (rand() - .5) * .75;
    const curl = .55 + .25 * cluster + rand() * .25, hairLength = length * (.75 + cluster * .2 + rand() * .5);
    const lean = .35 + cluster * .2, width = .0014 + rand() * .0011, shade = .91 + cluster * .055 + rand() * .09;
    const weights = surface.weights?.(u);
    side.copy(tangent).multiplyScalar(-Math.sin(angle)).addScaledVector(binormal, Math.cos(angle));
    for (let step = 0; step <= steps; step++) {
      const t = step / steps, bend = Math.sin(t * Math.PI * 1.6) * curl * hairLength + lean * t * hairLength;
      point.copy(root).addScaledVector(normal, hairLength * t * (1 - .32 * t));
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
        if (weights) {
          const at = (hair * verticesPerHair + step * 2 + edge) * 4;
          skinIndices.set([0, 1, 2, 0], at);skinWeights.set(weights, at);
        }
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
  if (skinIndices) {
    geometry.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndices, 4));
    geometry.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeights, 4));
  }
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));geometry.computeBoundingSphere();
  geometry.userData.fiberCount = count;
  return geometry;
}

export const furMaterial = new THREE.MeshPhysicalMaterial({
  color: 0xffffff, vertexColors: true, roughness: .96, metalness: 0,
  side: THREE.DoubleSide, sheen: 1, sheenRoughness: .88, sheenColor: new THREE.Color('#d6c2a0')
});
// Both faces of a ribbon represent the same round fiber. Its radial normals
// should not flip to black when viewed from the back of the thin ribbon.
furMaterial.onBeforeCompile = shader => {
  shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>',
    THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''));
};
furMaterial.customProgramCacheKey = () => 'plush-fiber-radial-normals-v1';

export function makePlush(size, {color = '#c8aa7f', density = 1000, seed = 1, length = .052, pickable = true} = {}) {
  const root = new THREE.Group();
  const core = new THREE.Mesh(new THREE.SphereGeometry(1, 36, 24), plushMaterial(color));
  core.scale.set(...size);core.castShadow = true;core.receiveShadow = true;
  root.add(core);root.userData.core = core;root.userData.pickable = pickable;root.userData.fiberCount = 0;
  if (density > 0) {
    const [rx, ry, rz] = size;
    const surface = {
      area: 4 * Math.PI * Math.pow(((rx * ry) ** 1.6075 + (rx * rz) ** 1.6075 + (ry * rz) ** 1.6075) / 3, 1 / 1.6075),
      sample(u, v, position, normal) {
        const y = u * 2 - 1, phi = v * Math.PI * 2, radial = Math.sqrt(1 - y * y);
        position.set(rx * radial * Math.cos(phi), ry * y, rz * radial * Math.sin(phi));
        normal.set(position.x / (rx * rx), position.y / (ry * ry), position.z / (rz * rz)).normalize();
      }
    };
    const fur = new THREE.Mesh(fiberGeometry(surface, {color, density, seed, length}), furMaterial);
    fur.receiveShadow = false;fur.castShadow = false;root.add(fur);root.userData.fiberCount = fur.geometry.userData.fiberCount;
  }
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
