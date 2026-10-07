import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PARTS, TeddyWorld } from '../src/physics.js';
import { limbSurface } from '../src/limbs.js';

function vertices(mesh) {
  return Array.from({length: mesh.geometry.getAttribute('position').count}, (_, index) => mesh.getVertexPosition(index, new THREE.Vector3()));
}

// Weld the UV seam and the cap poles, then inspect the actual triangle edges.
// A sleeve must remain one closed surface, including after a physical bend.
function assertClosed(mesh) {
  const points = vertices(mesh), welded = new Map(), edges = new Map();
  const ids = points.map(point => {
    assert.ok(point.toArray().every(Number.isFinite));
    const key = point.toArray().map(value => Math.round(value * 1e6)).join(',');
    if (!welded.has(key)) welded.set(key, welded.size);
    return welded.get(key);
  });
  const index = mesh.geometry.index.array;
  for (let i = 0; i < index.length; i += 3) {
    const face = [ids[index[i]], ids[index[i + 1]], ids[index[i + 2]]];
    if (new Set(face).size < 3) continue;
    for (let edge = 0; edge < 3; edge++) {
      const a = face[edge], b = face[(edge + 1) % 3], key = a < b ? `${a},${b}` : `${b},${a}`;
      edges.set(key, (edges.get(key) || 0) + 1);
    }
  }
  assert.ok(edges.size > 1000);
  assert.ok([...edges.values()].every(count => count === 2), 'No exposed edges at the joint, UV seam, or caps');
}

test('each continuous limb stays closed and retains its joint thickness while physically bent', () => {
  for (const [upperId, lowerId] of [['upperArmL', 'handL'], ['upperArmR', 'handR'], ['thighL', 'footL'], ['thighR', 'footR']]) {
    const world = new TeddyWorld();
    const joint = world.joints.find(j => j.a.plushId === upperId && j.b.plushId === lowerId);
    const sleeve = limbSurface(PARTS.find(p => p.id === upperId), PARTS.find(p => p.id === lowerId), joint);
    const mesh = sleeve.mesh(sleeve.geometry, new THREE.MeshBasicMaterial());
    sleeve.root.updateMatrixWorld(true);assertClosed(mesh);
    const lower = world.bodies.get(lowerId), upper = world.bodies.get(upperId), initial = lower.position.clone();
    world.beginGrab(lowerId, initial.toArray(), 1);
    world.moveGrab(1, [initial.x + (initial.x < 0 ? -.65 : .65), initial.y + 1.5, initial.z - .35]);
    for (let frame = 0; frame < 150; frame++) world.step(1 / 120);
    sleeve.update(upper, lower);sleeve.root.updateMatrixWorld(true);
    assertClosed(mesh);
    assert.ok(lower.position.distanceTo(initial) > .5, 'The lower limb moved through its physical joint');
    const ring = Math.round(sleeve.jointT * 52), points = vertices(mesh).slice(ring * 33, ring * 33 + 32);
    const center = points.reduce((sum, p) => sum.add(p), new THREE.Vector3()).multiplyScalar(1 / points.length);
    assert.ok(Math.min(...points.map(p => p.distanceTo(center))) > .16, 'The bend retains a padded cross section instead of pinching into a hinge');
    assert.ok(Math.max(...world.jointErrors()) < .1);
    world.releaseAll();mesh.geometry.dispose();mesh.material.dispose();
  }
});
