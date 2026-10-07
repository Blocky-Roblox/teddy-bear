import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PARTS, TeddyWorld } from './physics.js';
import { makePlush, stitches, thread } from './materials.js';

const $ = id => document.getElementById(id);
const stage = $('stage'), canvas = $('world');
let audio = null, soundEnabled = false, lastSound = 0;

function thud(speed) {
  if (!soundEnabled || performance.now() - lastSound < 140) return;
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume().catch(() => {});
    const duration = .15, buffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * duration), audio.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / samples.length, 2);
    const source = audio.createBufferSource(), filter = audio.createBiquadFilter(), gain = audio.createGain();
    source.buffer = buffer;filter.type = 'lowpass';filter.frequency.value = 220 + Math.min(speed, 6) * 40;
    gain.gain.value = Math.min(.35, .035 + speed * .027);
    source.connect(filter);filter.connect(gain);gain.connect(audio.destination);source.start();lastSound = performance.now();
  } catch {soundEnabled = false;setSoundLabel();}
}
function setSoundLabel() {
  $('sound-button').setAttribute('aria-pressed', String(soundEnabled));
  $('sound-button').setAttribute('aria-label', soundEnabled ? '關閉碰撞音效' : '開啟碰撞音效');
  $('sound-label').textContent = soundEnabled ? '音效開啟' : '音效關閉';
}
$('sound-button').addEventListener('click', () => {soundEnabled = !soundEnabled;setSoundLabel();if (soundEnabled) thud(1.5);});

function start() {
  const renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: true, powerPreference: 'high-performance'});
  const mobile = matchMedia('(pointer: coarse)').matches;
  const gl = renderer.getContext(), adapter = gl.getExtension('WEBGL_debug_renderer_info');
  const adapterName = adapter ? String(gl.getParameter(adapter.UNMASKED_RENDERER_WEBGL)) : '';
  const software = /swiftshader|llvmpipe|softpipe|software rasterizer/i.test(adapterName);
  renderer.setPixelRatio(Math.min(devicePixelRatio, software ? 1 : mobile ? 1.5 : 2));
  renderer.shadowMap.enabled = true;renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;renderer.toneMappingExposure = 1.02;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#fff8e7', '#b0a58e', 1.9));
  const key = new THREE.DirectionalLight('#fff3db', 3.2);key.position.set(-3.5, 6.5, 5);
  const shadowSize = software ? 256 : mobile ? 512 : 1024;
  key.castShadow = true;key.shadow.mapSize.set(shadowSize, shadowSize);
  key.shadow.camera.left = -4;key.shadow.camera.right = 4;key.shadow.camera.top = 4;key.shadow.camera.bottom = -4;
  key.shadow.camera.near = .1;key.shadow.camera.far = 14;key.shadow.normalBias = .035;key.shadow.bias = -.00015;key.shadow.radius = 4;
  scene.add(key);scene.add(key.target);
  const fill = new THREE.DirectionalLight('#f5f3e8', 1.3);fill.position.set(4, 3, 3);scene.add(fill);
  const rim = new THREE.DirectionalLight('#fff7e7', 1.8);rim.position.set(2, 4, -3);scene.add(rim);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({color: '#e9e4d8', roughness: 1}));
  floor.rotation.x = -Math.PI / 2;floor.receiveShadow = true;floor.position.y = -.015;scene.add(floor);
  const camera = new THREE.OrthographicCamera(-3.5, 3.5, 2.2, -2.2, .1, 40);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 1.22, 0);controls.enablePan = false;controls.enableDamping = false;
  controls.minPolarAngle = .5;controls.maxPolarAngle = Math.PI / 2 - .07;
  controls.minZoom = .75;controls.maxZoom = 1.45;controls.enabled = false;
  let dirty = true, mode = 'grab', lastFrame = 0, contextLost = false;
  controls.addEventListener('change', () => {dirty = true;});
  const models = new Map(), pickables = [], compression = new Map(), impacts = new Map();
  const density = software ? 260 : mobile ? 1000 : 1800;
  const physics = new TeddyWorld({onImpact: (speed, id) => {thud(speed);impacts.set(id, Math.min(.06, speed * .009));}});

  for (let index = 0; index < PARTS.length; index++) {
    const spec = PARTS[index], root = new THREE.Group();
    const visual = makePlush(spec.size, {density, seed: 81 + index * 311, length: spec.id.startsWith('ear') ? .027 : .036});
    visual.userData.core.userData.plushId = spec.id;root.add(visual);scene.add(root);
    root.position.set(...spec.p);root.quaternion.setFromEuler(new THREE.Euler(...spec.rotation));
    models.set(spec.id, {root, visual});pickables.push(visual.userData.core);
    compression.set(spec.id, {value: 0, velocity: 0});
  }

  function patch(id, position, size, color = '#dfc9a2', seed = 400) {
    const mesh = makePlush(size, {color, density: density * .85, seed, length: .019, pickable: false});
    mesh.position.set(...position);models.get(id).visual.add(mesh);
    mesh.add(stitches(...size));return mesh;
  }
  patch('torso', [0, -.075, .365], [.425, .535, .175], '#e3ceaa', 840);
  patch('head', [0, -.18, .565], [.345, .255, .232], '#e6d2b0', 899);
  patch('earL', [0, 0, .113], [.183, .183, .062], '#c8a983', 915);
  patch('earR', [0, 0, .113], [.183, .183, .062], '#c8a983', 918);
  patch('handL', [0, -.13, .236], [.183, .18, .089], '#d2b38a', 982);
  patch('handR', [0, -.13, .236], [.183, .18, .089], '#d2b38a', 983);
  patch('footL', [0, -.015, .335], [.252, .193, .117], '#dbc4a0', 950);
  patch('footR', [0, -.015, .335], [.252, .193, .117], '#dbc4a0', 959);
  const head = models.get('head').visual;
  const eyeMaterial = new THREE.MeshPhysicalMaterial({color: '#241a13', roughness: .11, metalness: 0, clearcoat: 1, clearcoatRoughness: .03});
  for (const sign of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(.074, 20, 14), eyeMaterial);
    eye.position.set(sign * .272, .05, .594);eye.scale.z = .67;head.add(eye);
    const stitch = thread([[sign * .272 - .025, .028, .583], [sign * .272, .008, .593], [sign * .272 + .025, .028, .583]], .006, '#765338');head.add(stitch);
  }
  const nose = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 18), new THREE.MeshPhysicalMaterial({color: '#593c26', roughness: .5, sheen: .4}));
  nose.scale.set(.133, .09, .072);nose.position.set(0, -.135, .779);head.add(nose);
  head.add(thread([[0, -.203, .794], [0, -.256, .786], [0, -.298, .77]], .009));
  head.add(thread([[-.115, -.30, .772], [-.072, -.337, .752], [0, -.30, .772], [.072, -.337, .752], [.115, -.30, .772]], .008));
  const ribbonMaterial = new THREE.MeshStandardMaterial({color: '#6d7854', roughness: .93});
  const torso = models.get('torso').visual;
  for (const sign of [-1, 1]) {
    const loop = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 16), ribbonMaterial);
    loop.scale.set(.19, .13, .055);loop.position.set(sign * .16, .565, .329);loop.rotation.z = sign * .18;torso.add(loop);
    const tail = new THREE.Mesh(new THREE.PlaneGeometry(.105, .26), new THREE.MeshStandardMaterial({color: '#6d7854', roughness: 1, side: THREE.DoubleSide}));
    tail.position.set(sign * .063, .395, .368);tail.rotation.z = sign * .25;torso.add(tail);
  }
  const knot = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 12), ribbonMaterial);knot.scale.set(.064, .084, .064);knot.position.set(0, .57, .378);torso.add(knot);

  const pointers = new Map(), raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2(), hitPoint = new THREE.Vector3();
  function ray(event) {
    const rect = canvas.getBoundingClientRect();ndc.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(ndc, camera);return raycaster;
  }
  function syncInfo() {
    const names = [...pointers.values()].map(p => PARTS.find(spec => spec.id === p.part).label);
    stage.dataset.held = [...pointers.values()].map(p => p.part).join(',');
    $('hold-info').textContent = names.length ? (mode === 'press' ? '按壓：' : '拿著：') + names.join('、') : mode === 'view' ? '轉動視角' : '已放下';
  }
  function release(pointer) {
    if (!pointers.has(pointer)) return;
    physics.release(pointer);pointers.delete(pointer);syncInfo();dirty = true;
    if (canvas.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer);
  }
  function releaseAll() {for (const id of [...pointers.keys()]) release(id);physics.releaseAll();}
  function setMode(next) {
    releaseAll();mode = next;stage.dataset.mode = mode;controls.enabled = mode === 'view';
    document.querySelectorAll('.mode-button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
    $('interaction-hint').textContent = {grab:'抓住任何部位，拖一拖，再放手。',press:'按住布偶，輕輕往下、往後推。',view:'拖曳轉動視角，滾輪或雙指可以縮放。'}[mode];syncInfo();dirty = true;
  }
  function frontView() {camera.position.set(0, 3.1, 7.8);camera.zoom = 1;controls.target.set(0, 1.22, 0);controls.update();camera.updateProjectionMatrix();dirty = true;}
  function reset() {releaseAll();physics.reset();frontView();setMode('grab');for (const d of compression.values()) {d.value = d.velocity = 0;}impacts.clear();dirty = true;}
  function action(kind) {
    releaseAll();
    if (kind === 'reset') reset();
    else if (kind === 'view') {
      const offset = camera.position.clone().sub(controls.target);offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4);
      camera.position.copy(controls.target).add(offset);controls.update();dirty = true;
    } else {physics.impulse(kind);dirty = true;}
  }
  canvas.addEventListener('pointerdown', event => {
    if (mode === 'view' || event.button !== 0 || pointers.size >= 2) return;
    scene.updateMatrixWorld(true);
    const hit = ray(event).intersectObjects(pickables, false)[0];if (!hit) return;
    const part = hit.object.userData.plushId, direction = camera.getWorldDirection(new THREE.Vector3());
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(direction, hit.point);
    const accepted = mode === 'grab' ? physics.beginGrab(part, hit.point.toArray(), event.pointerId) : physics.press(part, hit.point.toArray(), direction.toArray(), event.pointerId);
    if (!accepted) return;
    event.preventDefault();canvas.setPointerCapture(event.pointerId);pointers.set(event.pointerId, {part, plane});syncInfo();dirty = true;
  });
  canvas.addEventListener('pointermove', event => {
    const pointer = pointers.get(event.pointerId);if (!pointer) return;
    event.preventDefault();
    if (ray(event).ray.intersectPlane(pointer.plane, hitPoint) && mode === 'grab') physics.moveGrab(event.pointerId, hitPoint.toArray());
    dirty = true;
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(name, event => release(event.pointerId));
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => {if (document.hidden) {releaseAll();lastFrame = 0;}});
  canvas.addEventListener('webglcontextlost', event => {event.preventDefault();contextLost = true;$('unavailable').hidden = false;stage.dataset.ready = 'false';});
  canvas.addEventListener('webglcontextrestored', () => {contextLost = false;$('unavailable').hidden = true;stage.dataset.ready = 'true';dirty = true;});
  document.querySelectorAll('.mode-button').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));
  document.querySelectorAll('.action-card').forEach(button => button.addEventListener('click', () => action(button.dataset.action)));
  $('reset-button').addEventListener('click', reset);
  $('softness').addEventListener('input', event => {
    physics.softness = Number(event.target.value) / 100;physics.wake();dirty = true;
    $('softness-label').textContent = physics.softness < .45 ? '紮實' : physics.softness > .8 ? '鬆軟' : '柔軟';
  });
  const help = $('help-dialog');$('help-button').addEventListener('click', () => {releaseAll();help.showModal();});$('help-close').addEventListener('click', () => help.close());
  help.addEventListener('click', event => {
    if (event.target !== help) return;const rect = help.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) help.close();
  });
  document.addEventListener('keydown', event => {
    if (help.open || event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.target.closest('input,textarea,select,[contenteditable]')) return;
    const modes = {'1':'grab','2':'press','3':'view'};
    if (modes[event.key]) setMode(modes[event.key]);
    else if (event.code === 'Space' && !event.target.closest('button,a')) {event.preventDefault();action('toss');}
    else if (event.key.toLowerCase() === 'r') reset();
  });
  function resize() {
    releaseAll();const rect = stage.getBoundingClientRect(), aspect = rect.width / rect.height;
    const height = Math.max(4.35, 3.7 / aspect);
    camera.left = -height * aspect / 2;camera.right = -camera.left;camera.top = height / 2;camera.bottom = -height / 2;
    camera.updateProjectionMatrix();renderer.setSize(rect.width, rect.height, false);
    physics.setBounds(Math.min(3.1, height * aspect / 2 - .1), 3.95);dirty = true;
  }
  new ResizeObserver(resize).observe(stage);frontView();resize();
  // Read-only observations help validate articulated poses and pointer picking
  // without adding test-only forces, poses, clocks, or animation shortcuts.
  canvas.getPlushState = () => physics.snapshot();
  canvas.projectPart = (id, offset = [0, 0, 0]) => {
    const model = models.get(id);if (!model) return null;
    const point = model.root.localToWorld(new THREE.Vector3(...offset)).project(camera), rect = canvas.getBoundingClientRect();
    return {x:rect.left + (point.x + 1) * rect.width / 2, y:rect.top + (1 - point.y) * rect.height / 2};
  };
  canvas.getPlushDetails = () => ({bodyCount:physics.bodies.size, jointCount:physics.joints.length, renderQuality:software?'software':mobile?'mobile':'full', fiberCount:[...models.values()].reduce((n,m)=>n+m.visual.userData.fiberCount,0), jointErrors:physics.jointErrors(), camera:camera.position.toArray()});
  let firstPaint = true;
  function frame(now) {
    requestAnimationFrame(frame);if (document.hidden || contextLost) {lastFrame = 0;return;}
    const dt = Math.min(.05, Math.max(0, (now - (lastFrame || now)) / 1000));lastFrame = now;
    const moving = [...physics.bodies.values()].some(body => body.sleepState !== 2);
    if (moving || pointers.size) {physics.step(dt);dirty = true;}
    let deforming = false;
    for (const spec of PARTS) {
      const body = physics.bodies.get(spec.id), model = models.get(spec.id), spring = compression.get(spec.id);
      const pressing = [...physics.presses.values()].some(press => press.body === body), impact = impacts.get(spec.id) || 0;
      const target = pressing ? .06 + physics.softness * .04 : impact;
      spring.velocity += (target - spring.value) * 150 * dt;spring.velocity *= Math.exp(-16 * dt);spring.value += spring.velocity * dt;
      impacts.set(spec.id, impact * Math.exp(-15 * dt));
      if (Math.abs(spring.value) + Math.abs(spring.velocity) > .0001) deforming = true;
      model.root.position.copy(body.position);model.root.quaternion.copy(body.quaternion);
      model.visual.scale.set(1 + spring.value * .22, 1 + spring.value * .15, 1 - spring.value);
    }
    if (dirty || deforming || firstPaint) {
      renderer.render(scene, camera);dirty = false;
      if (firstPaint) {firstPaint = false;$('loading').hidden = true;stage.dataset.ready = 'true';}
    }
  }
  requestAnimationFrame(frame);
}

requestAnimationFrame(() => setTimeout(() => {
  try {start();} catch (error) {console.error(error);$('loading').hidden = true;$('unavailable').hidden = false;stage.dataset.ready = 'false';}
}, 0));
