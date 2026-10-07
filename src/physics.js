import * as CANNON from 'cannon-es';

const DT = 1 / 120;
const v = a => new CANNON.Vec3(...a);
const part = (id, label, p, size, mass, rotation = [0, 0, 0]) => ({id, label, p, size, mass, rotation});

export const PARTS = [
  part('torso', '身體', [0, 1.02, 0], [.66, .83, .43], 1.8),
  part('head', '頭', [0, 2.11, 0], [.79, .71, .62], .72),
  part('earL', '左耳', [-.65, 2.70, -.025], [.29, .29, .17], .025, [0, 0, .12]),
  part('earR', '右耳', [.65, 2.70, -.025], [.29, .29, .17], .025, [0, 0, -.12]),
  part('upperArmL', '左手臂', [-.73, 1.14, 0], [.255, .405, .27], .23, [0, 0, -.30]),
  part('upperArmR', '右手臂', [.73, 1.14, 0], [.255, .405, .27], .23, [0, 0, .30]),
  part('handL', '左手掌', [-.89, .62, .035], [.285, .38, .29], .21, [0, 0, -.06]),
  part('handR', '右手掌', [.89, .62, .035], [.285, .38, .29], .21, [0, 0, .06]),
  part('thighL', '左腿', [-.36, .46, .27], [.30, .43, .31], .31, [-.85, 0, -.12]),
  part('thighR', '右腿', [.36, .46, .27], [.30, .43, .31], .31, [-.85, 0, .12]),
  part('footL', '左腳掌', [-.44, .29, .70], [.375, .285, .425], .27),
  part('footR', '右腳掌', [.44, .29, .70], [.375, .285, .425], .27)
];

// Outward-wound low-resolution ellipsoid hulls keep collisions close to the
// visible plush surface, including the flat ears and forward-facing feet.
function ellipsoid(size) {
  const [rx, ry, rz] = size, slices = 10, rings = 6;
  const vertices = [new CANNON.Vec3(0, ry, 0)];
  for (let i = 1; i < rings; i++) {
    const theta = Math.PI * i / rings;
    for (let j = 0; j < slices; j++) {
      const phi = 2 * Math.PI * j / slices;
      vertices.push(new CANNON.Vec3(rx * Math.sin(theta) * Math.cos(phi), ry * Math.cos(theta), rz * Math.sin(theta) * Math.sin(phi)));
    }
  }
  const bottom = vertices.length;
  vertices.push(new CANNON.Vec3(0, -ry, 0));
  const faces = [];
  for (let j = 0; j < slices; j++) faces.push([0, 1 + j, 1 + (j + 1) % slices]);
  for (let i = 0; i < rings - 2; i++) {
    for (let j = 0; j < slices; j++) {
      const a = 1 + i * slices + j, b = 1 + i * slices + (j + 1) % slices;
      faces.push([a, a + slices, b + slices, b]);
    }
  }
  const last = 1 + (rings - 2) * slices;
  for (let j = 0; j < slices; j++) faces.push([bottom, last + (j + 1) % slices, last + j]);
  for (const face of faces) {
    const a = vertices[face[0]], b = vertices[face[1]], c = vertices[face[2]];
    const normal = b.vsub(a).cross(c.vsub(a));
    const center = face.reduce((sum, index) => sum.vadd(vertices[index]), new CANNON.Vec3()).scale(1 / face.length);
    if (normal.dot(center) < 0) face.reverse();
  }
  return new CANNON.ConvexPolyhedron({vertices, faces});
}

export class TeddyWorld {
  constructor({onImpact = () => {}} = {}) {
    this.world = new CANNON.World({gravity: new CANNON.Vec3(0, -9.82, 0), allowSleep: true});
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.solver.iterations = 22;
    this.world.solver.tolerance = 1e-6;
    this.material = new CANNON.Material('plush');
    this.floorMaterial = new CANNON.Material('floor');
    this.world.addContactMaterial(new CANNON.ContactMaterial(this.material, this.floorMaterial, {
      friction: .65, restitution: .075, contactEquationStiffness: 2e5, contactEquationRelaxation: 5
    }));
    this.world.addContactMaterial(new CANNON.ContactMaterial(this.material, this.material, {
      friction: .38, restitution: .025, contactEquationStiffness: 1.5e5, contactEquationRelaxation: 5
    }));
    this.bodies = new Map();
    this.joints = [];
    this.grabs = new Map();
    this.presses = new Map();
    this.accumulator = 0;
    this.softness = .65;
    this.lastImpact = 0;
    this.time = 0;
    this.planes = {};
    const plane = (key, position, rotation) => {
      const body = new CANNON.Body({mass: 0, material: this.floorMaterial, shape: new CANNON.Plane()});
      body.position.copy(v(position));body.quaternion.setFromEuler(...rotation);
      this.world.addBody(body);this.planes[key] = body;
    };
    plane('floor', [0, 0, 0], [-Math.PI / 2, 0, 0]);
    plane('left', [-3.1, 0, 0], [0, Math.PI / 2, 0]);
    plane('right', [3.1, 0, 0], [0, -Math.PI / 2, 0]);
    plane('back', [0, 0, -1.35], [0, 0, 0]);
    plane('front', [0, 0, 1.55], [0, Math.PI, 0]);
    plane('ceiling', [0, 3.95, 0], [Math.PI / 2, 0, 0]);
    for (const spec of PARTS) {
      const body = new CANNON.Body({
        mass: spec.mass, material: this.material, shape: ellipsoid(spec.size),
        linearDamping: .18, angularDamping: .63, allowSleep: true,
        sleepSpeedLimit: .14, sleepTimeLimit: 1.2
      });
      body.position.copy(v(spec.p));body.quaternion.setFromEuler(...spec.rotation);
      if (spec.id === 'head') {
        body.addShape(ellipsoid([.345, .255, .232]), new CANNON.Vec3(0, -.18, .565));
        body.addShape(new CANNON.Sphere(.085), new CANNON.Vec3(0, -.135, .779));
      }
      body.plushId = spec.id;
      body.addEventListener('collide', event => {
        const speed = Math.abs(event.contact.getImpactVelocityAlongNormal());
        if (speed > .7 && this.time - this.lastImpact > .12) {
          this.lastImpact = this.time;onImpact(speed);
        }
      });
      this.bodies.set(spec.id, body);this.world.addBody(body);
    }
    this.connect('torso', 'head', [0, 1.63, 0], 1.02, .7, .55);
    this.connect('head', 'earL', [-.59, 2.57, -.015], .68, .45, .065);
    this.connect('head', 'earR', [.59, 2.57, -.015], .68, .45, .065);
    for (const side of ['L', 'R']) {
      const sign = side === 'L' ? -1 : 1;
      this.connect('torso', 'upperArm' + side, [sign * .56, 1.40, 0], 2.15, 1.8, .055);
      this.connect('upperArm' + side, 'hand' + side, [sign * .85, .85, .02], 1.6, 1.5, .025);
      this.connect('torso', 'thigh' + side, [sign * .33, .65, .075], 1.65, 1.4, .065);
      this.connect('thigh' + side, 'foot' + side, [sign * .40, .27, .52], 1.4, 1.2, .045);
    }
  }

  connect(idA, idB, at, angle, twistAngle, stiffness) {
    const a = this.bodies.get(idA), b = this.bodies.get(idB), point = v(at);
    const pivotA = a.pointToLocalFrame(point), pivotB = b.pointToLocalFrame(point);
    const commonAxis = new CANNON.Vec3(0, 1, 0);
    const axisA = a.vectorToLocalFrame(commonAxis), axisB = b.vectorToLocalFrame(commonAxis);
    const constraint = new CANNON.ConeTwistConstraint(a, b, {
      pivotA, pivotB, axisA, axisB, angle, twistAngle, maxForce: 1200, collideConnected: false
    });
    for (const equation of constraint.equations) equation.setSpookParams(2.8e5, 5, DT);
    this.world.addConstraint(constraint);
    const rest = a.quaternion.inverse().mult(b.quaternion);
    this.joints.push({a, b, pivotA, pivotB, rest, stiffness, constraint});
  }

  setBounds(width = 3.1, height = 3.95) {
    this.planes.left.position.x = -Math.max(1.7, width);
    this.planes.right.position.x = Math.max(1.7, width);
    this.planes.ceiling.position.y = Math.max(3.5, height);
    for (const body of Object.values(this.planes)) body.aabbNeedsUpdate = true;
  }

  wake() { for (const body of this.bodies.values()) body.wakeUp(); }

  beginGrab(id, point, pointer = 0) {
    if (!this.bodies.has(id) || this.grabs.has(pointer) || this.grabs.size >= 2) return false;
    this.wake();
    const body = this.bodies.get(id), hand = new CANNON.Body({mass: 0, type: CANNON.Body.KINEMATIC, collisionFilterGroup: 0, collisionFilterMask: 0});
    hand.position.copy(v(point));this.world.addBody(hand);
    const local = body.pointToLocalFrame(v(point));
    const constraint = new CANNON.PointToPointConstraint(body, local, hand, new CANNON.Vec3(), 150);
    for (const equation of constraint.equations) equation.setSpookParams(9e4, 6, DT);
    this.world.addConstraint(constraint);
    this.grabs.set(pointer, {body, hand, local, target: v(point), constraint});
    return true;
  }

  moveGrab(pointer, point) {
    const grab = this.grabs.get(pointer);
    if (!grab) return;
    grab.target.copy(v(point));
    grab.target.x = Math.max(this.planes.left.position.x + .15, Math.min(this.planes.right.position.x - .15, grab.target.x));
    grab.target.y = Math.max(.08, Math.min(this.planes.ceiling.position.y - .08, grab.target.y));
    grab.target.z = Math.max(-1.1, Math.min(1.25, grab.target.z));
  }

  release(pointer) {
    const grab = this.grabs.get(pointer);
    if (grab) {this.world.removeConstraint(grab.constraint);this.world.removeBody(grab.hand);this.grabs.delete(pointer);}
    this.presses.delete(pointer);
  }

  releaseAll() {for (const pointer of [...this.grabs.keys(), ...this.presses.keys()]) this.release(pointer);}

  press(id, point, direction, pointer = 0) {
    if (!this.bodies.has(id)) return false;
    this.wake();
    const body = this.bodies.get(id);
    this.presses.set(pointer, {body, local: body.pointToLocalFrame(v(point)), direction: v(direction)});
    return true;
  }

  impulse(kind = 'toss') {
    this.releaseAll();this.wake();
    for (const [id, body] of this.bodies) {
      if (kind === 'toss') body.velocity.set((id.includes('L') ? -.35 : id.includes('R') ? .35 : .1), 4.6, -.45);
      else body.velocity.set(.65, .1, -1.5);
      body.angularVelocity.set(kind === 'toss' ? -.5 : -1.1, .1, .4);
    }
  }

  reset() {
    this.releaseAll();this.accumulator = 0;
    for (const spec of PARTS) {
      const body = this.bodies.get(spec.id);
      body.position.copy(v(spec.p));body.quaternion.setFromEuler(...spec.rotation);
      body.previousPosition.copy(body.position);body.interpolatedPosition.copy(body.position);
      body.previousQuaternion.copy(body.quaternion);body.interpolatedQuaternion.copy(body.quaternion);
      body.velocity.setZero();body.angularVelocity.setZero();body.force.setZero();body.torque.setZero();
      body.aabbNeedsUpdate = true;body.wakeUp();
    }
  }

  // Weak passive torsion represents resistance of sewn fabric. Gravity and
  // contact forces dominate; there are no pose motors or idle animations.
  fabricTorques() {
    for (const joint of this.joints) {
      const {a, b, rest, stiffness} = joint;
      if (a.sleepState === CANNON.Body.SLEEPING && b.sleepState === CANNON.Body.SLEEPING) continue;
      const wanted = a.quaternion.mult(rest), error = wanted.mult(b.quaternion.inverse());
      if (error.w < 0) {error.x *= -1;error.y *= -1;error.z *= -1;error.w *= -1;}
      const torque = new CANNON.Vec3(error.x, error.y, error.z).scale(stiffness * (1.6 - this.softness));
      b.torque.vadd(torque, b.torque);a.torque.vsub(torque, a.torque);
    }
  }

  step(seconds) {
    this.accumulator = Math.min(this.accumulator + Math.max(0, Math.min(seconds, .06)), .075);
    while (this.accumulator >= DT) {
      for (const grab of this.grabs.values()) {
        const velocity = grab.target.vsub(grab.hand.position).scale(1 / DT);
        const speed = velocity.length();if (speed > 12) velocity.scale(12 / speed, velocity);
        grab.hand.velocity.copy(velocity);
      }
      for (const press of this.presses.values()) {
        const offset = press.body.vectorToWorldFrame(press.local);
        press.body.applyForce(press.direction.scale(8 + this.softness * 8), offset);
      }
      this.fabricTorques();
      this.world.step(DT);
      for (const body of this.bodies.values()) {
        const speed = body.velocity.length(), spin = body.angularVelocity.length();
        if (speed > 14) body.velocity.scale(14 / speed, body.velocity);
        if (spin > 18) body.angularVelocity.scale(18 / spin, body.angularVelocity);
      }
      this.time += DT;this.accumulator -= DT;
    }
  }

  jointErrors() {
    return this.joints.map(j => j.a.pointToWorldFrame(j.pivotA).distanceTo(j.b.pointToWorldFrame(j.pivotB)));
  }

  snapshot() {
    return [...this.bodies].map(([id, body]) => ({
      id, position: body.position.toArray(), quaternion: body.quaternion.toArray(),
      velocity: body.velocity.toArray(), sleeping: body.sleepState === CANNON.Body.SLEEPING
    }));
  }
}
