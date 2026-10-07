import * as THREE from 'three';

const smooth = (a, b, x) => {const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);return t * t * (3 - 2 * t);};

// A closed stuffed sleeve replaces the two separate ellipsoid surfaces.
// Three render bones spread the bend across the sewn joint. All their poses
// come from the two physical bodies; the middle bone has no autonomous motion.
export function limbSurface(upper, lower, joint) {
  const leg = lower.id.startsWith('foot');
  const pose = spec => new THREE.Matrix4().compose(new THREE.Vector3(...spec.p),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...spec.rotation)), new THREE.Vector3(1, 1, 1));
  const upperPose = pose(upper), lowerPose = pose(lower);
  const anchor = new THREE.Vector3().copy(joint.pivotA).applyMatrix4(upperPose);
  const start = new THREE.Vector3(0, upper.size[1] * .96, 0).applyMatrix4(upperPose);
  const end = (leg ? new THREE.Vector3(0, 0, lower.size[2]) : new THREE.Vector3(0, -lower.size[1], 0)).applyMatrix4(lowerPose);
  const path = new THREE.CatmullRomCurve3([start, new THREE.Vector3(...upper.p), anchor, new THREE.Vector3(...lower.p), end], false, 'centripetal');
  let jointT = 0, nearest = Infinity;
  for (let i = 0; i <= 200; i++) {
    const distance = path.getPointAt(i / 200).distanceToSquared(anchor);
    if (distance < nearest) {nearest = distance;jointT = i / 200;}
  }
  const radius = t => {
    const blend = smooth(jointT - .18, jointT + .24, t);
    const x = THREE.MathUtils.lerp(upper.size[0], lower.size[0], blend);
    const z = THREE.MathUtils.lerp(upper.size[2], leg ? lower.size[1] : lower.size[2], blend);
    // Rounded end caps with a full, uninterrupted radius through the joint.
    const cap = t < .20 ? Math.sqrt(Math.max(0, 1 - (1 - t / .20) ** 2)) :
      t > .78 ? Math.sqrt(Math.max(0, 1 - ((t - .78) / .22) ** 2)) : 1;
    return [x * cap, z * cap];
  };
  const weights = t => {
    if (t <= jointT) {const blend = smooth(jointT - .24, jointT, t);return [1 - blend, blend, 0, 0];}
    const blend = smooth(jointT, jointT + .24, t);return [0, 1 - blend, blend, 0];
  };
  const center = new THREE.Vector3(), tangent = new THREE.Vector3(), across = new THREE.Vector3(), around = new THREE.Vector3();
  function sample(t, v, position, normal) {
    path.getPointAt(t, center);path.getTangentAt(t, tangent);
    across.set(1, 0, 0).addScaledVector(tangent, -tangent.x).normalize();around.crossVectors(tangent, across).normalize();
    const phi = v * Math.PI * 2, [rx, rz] = radius(t);
    position.copy(center).addScaledVector(across, rx * Math.cos(phi)).addScaledVector(around, rz * Math.sin(phi));
    // Include the rounded cap's axial slope in the fiber normals.
    const delta = .001, before = radius(Math.max(0, t - delta)), after = radius(Math.min(1, t + delta));
    const slope = ((after[0] - before[0]) * Math.cos(phi) ** 2 + (after[1] - before[1]) * Math.sin(phi) ** 2) / (2 * delta * path.getLength());
    normal.copy(across).multiplyScalar(Math.cos(phi)).addScaledVector(around, Math.sin(phi)).addScaledVector(tangent, -slope).normalize();
  }
  const rings = 52, sides = 32, positions = [], uv = [], indices = [], skinIndices = [], skinWeights = [];
  for (let ring = 0; ring <= rings; ring++) {
    const t = ring / rings;
    for (let side = 0; side <= sides; side++) {
      const position = new THREE.Vector3(), normal = new THREE.Vector3();sample(t, side / sides, position, normal);
      positions.push(...position.toArray());uv.push(side / sides, t);skinIndices.push(0, 1, 2, 0);skinWeights.push(...weights(t));
      if (ring < rings && side < sides) {
        const a = ring * (sides + 1) + side, b = a + sides + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
  geometry.setIndex(indices);geometry.computeVertexNormals();
  // UV duplication must not create a lighting crease along the cloth sleeve.
  const normals = geometry.getAttribute('normal'), seamNormal = new THREE.Vector3();
  for (let ring = 0; ring <= rings; ring++) {
    const first = ring * (sides + 1), last = first + sides;
    if (ring === 0 || ring === rings) {
      path.getTangentAt(ring / rings, seamNormal).multiplyScalar(ring === 0 ? -1 : 1);
      for (let side = 0; side <= sides; side++) normals.setXYZ(first + side, seamNormal.x, seamNormal.y, seamNormal.z);
    } else {
      seamNormal.fromBufferAttribute(normals, first).add(new THREE.Vector3().fromBufferAttribute(normals, last)).normalize();
      normals.setXYZ(first, seamNormal.x, seamNormal.y, seamNormal.z);normals.setXYZ(last, seamNormal.x, seamNormal.y, seamNormal.z);
    }
  }
  const upperRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(...upper.rotation));
  const lowerRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(...lower.rotation));
  const bones = [new THREE.Bone(), new THREE.Bone(), new THREE.Bone()];
  bones[0].position.set(...upper.p);bones[0].quaternion.copy(upperRotation);
  bones[1].position.copy(anchor);bones[1].quaternion.copy(upperRotation).slerp(lowerRotation, .5);
  bones[2].position.set(...lower.p);bones[2].quaternion.copy(lowerRotation);
  const root = new THREE.Group();root.add(...bones);root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);skeleton.calculateInverses();
  function mesh(geometry, material) {
    const result = new THREE.SkinnedMesh(geometry, material);root.add(result);result.bind(skeleton, new THREE.Matrix4());
    result.frustumCulled = false;return result;
  }
  const pivotA = new THREE.Vector3().copy(joint.pivotA), pivotB = new THREE.Vector3().copy(joint.pivotB);
  const anchorB = new THREE.Vector3();
  function update(a, b, squashA = 0, squashB = 0) {
    bones[0].position.copy(a.position);bones[0].quaternion.copy(a.quaternion);
    bones[2].position.copy(b.position);bones[2].quaternion.copy(b.quaternion);
    bones[1].position.copy(pivotA).applyQuaternion(bones[0].quaternion).add(bones[0].position);
    anchorB.copy(pivotB).applyQuaternion(bones[2].quaternion).add(bones[2].position);
    bones[1].position.add(anchorB).multiplyScalar(.5);bones[1].quaternion.copy(bones[0].quaternion).slerp(bones[2].quaternion, .5);
    for (const [index, value] of [[0, squashA], [1, (squashA + squashB) / 2], [2, squashB]]) bones[index].scale.set(1 + value * .22, 1 + value * .15, 1 - value);
    // Bounds used for raycasting must follow the current bent pose.
    for (const child of root.children) if (child.isSkinnedMesh) child.boundingSphere = null;
  }
  return {root, geometry, weights, sample, mesh, update, jointT,
    area: path.getLength() * Math.PI * (upper.size[0] + (leg ? lower.size[1] : lower.size[2]))};
}
