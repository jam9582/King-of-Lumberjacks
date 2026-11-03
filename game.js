import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ===== 밸런스 설정 (여기 숫자만 바꾸면 됨) =====
const CONFIG = {
  duration: 60,          // 한 판 시간(초)
  cooldown: 0.25,        // 도끼 연타 제한(초)
  damage: { weak: 5, normal: 10, crit: 30 },
  damageRandom: 0.1,     // ±10% 랜덤
  baseHp: 100,           // 첫 나무 체력
  hpPerTree: 20,         // 한 그루마다 늘어나는 체력
};

const params = new URLSearchParams(location.search);
if (params.has('dur')) CONFIG.duration = Number(params.get('dur'));
if (params.has('hp')) { CONFIG.baseHp = Number(params.get('hp')); CONFIG.hpPerTree = 0; }

const SURVIVAL = 'assets/kenney_survival-kit/Models/GLB%20format/';
const TREE_FILES = ['tree.glb', 'tree-tall.glb', 'tree-autumn.glb', 'tree-autumn-tall.glb'];
const DECOR_FILES = ['rock-a.glb', 'rock-b.glb', 'rock-c.glb', 'grass.glb', 'grass-large.glb', 'tree-log.glb', 'resource-wood.glb', 'grass.glb', 'grass-large.glb'];
const TREE_SCALE = 3.4;
const AXE_SCALE = 11;
const HIT_HEIGHT = 0.73;   // 나무 기둥 높이 (모델 0.215 x TREE_SCALE)

// ===== 기본 씬 =====
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fd6e8);
scene.fog = new THREE.Fog(0x9fd6e8, 18, 34);

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 100);
const CAM_BASE = new THREE.Vector3(0, 11.5, 6.6);
const CAM_TARGET = new THREE.Vector3(0, 1.2, 0);
const CAM_POS = CAM_BASE.clone();
// 세로로 긴 화면(폰)이면 카메라를 뒤로 빼서 나무와 도끼가 다 보이게 함
function fitCamera() {
  camera.aspect = innerWidth / innerHeight;
  const k = Math.max(1, 0.85 / camera.aspect);
  CAM_POS.copy(CAM_BASE).sub(CAM_TARGET).multiplyScalar(k).add(CAM_TARGET);
  scene.fog.near = 18 * k;
  scene.fog.far = 34 * k;
  camera.updateProjectionMatrix();
}
fitCamera();
camera.position.copy(CAM_POS);
camera.lookAt(CAM_TARGET);

scene.add(new THREE.HemisphereLight(0xffffff, 0x6a8a4a, 1.4));
const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
sun.position.set(6, 12, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 40 });
sun.shadow.bias = -0.0005;
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.CylinderGeometry(9, 9.6, 1, 10),
  new THREE.MeshStandardMaterial({ color: 0x7cc35a, flatShading: true })
);
ground.position.y = -0.5;
ground.receiveShadow = true;
scene.add(ground);

// 나무 주변 흙바닥
const dirt = new THREE.Mesh(
  new THREE.CircleGeometry(1.5, 8),
  new THREE.MeshStandardMaterial({ color: 0xa57a4f, flatShading: true })
);
dirt.rotation.x = -Math.PI / 2;
dirt.position.y = 0.01;
dirt.receiveShadow = true;
scene.add(dirt);

// ===== 에셋 불러오기 (실패하면 기본 도형으로 대체) =====
const loader = new GLTFLoader();
function loadModel(file) {
  return new Promise((resolve) => {
    loader.load(SURVIVAL + file, (g) => {
      g.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      resolve(g.scene);
    }, undefined, () => { console.warn('로딩 실패:', file); resolve(null); });
  });
}

function fallbackTree() {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.4, 6), new THREE.MeshStandardMaterial({ color: 0x8a5a33, flatShading: true }));
  trunk.position.y = 0.2;
  const leaves = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.1, 7), new THREE.MeshStandardMaterial({ color: 0x3f9a5a, flatShading: true }));
  leaves.position.y = 0.85;
  g.add(trunk, leaves);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

function fallbackAxe() {
  const g = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.26, 0.02), new THREE.MeshStandardMaterial({ color: 0xc0703a, flatShading: true }));
  handle.position.y = 0.13;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.02), new THREE.MeshStandardMaterial({ color: 0x8890a8, flatShading: true }));
  head.position.set(-0.03, 0.22, 0);
  g.add(handle, head);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

let treeTemplates = [];

// ===== 효과음 (Web Audio, 파일 없음) =====
let actx = null, noiseBuf = null;
function initAudio() {
  if (actx) { actx.resume(); return; }
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch { actx = null; }
}

function tone(freq, dur, { type = 'sine', vol = 0.2, to = null, delay = 0 } = {}) {
  if (!actx) return;
  const t = actx.currentTime + delay;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(actx.destination);
  o.start(t); o.stop(t + dur + 0.02);
}

function noise(dur, { freq = 1000, q = 1, vol = 0.3, to = null, filter = 'bandpass', delay = 0 } = {}) {
  if (!actx) return;
  const t = actx.currentTime + delay;
  const src = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
  src.buffer = noiseBuf;
  f.type = filter; f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(actx.destination);
  src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
}

const sfx = {
  whoosh() { noise(0.1, { freq: 600, to: 2400, q: 0.8, vol: 0.08 }); },
  weak() { noise(0.06, { freq: 500, q: 2, vol: 0.25 }); tone(220, 0.12, { type: 'triangle', vol: 0.15, to: 160 }); },
  normal() { noise(0.09, { freq: 1100, q: 1.2, vol: 0.45 }); tone(150, 0.12, { vol: 0.35, to: 70 }); },
  crit() {
    noise(0.14, { freq: 1500, q: 0.8, vol: 0.55 }); tone(120, 0.2, { vol: 0.45, to: 50 });
    tone(1320, 0.35, { type: 'triangle', vol: 0.12, delay: 0.02 }); tone(1980, 0.4, { type: 'triangle', vol: 0.08, delay: 0.06 });
  },
  fall() { noise(0.7, { freq: 900, to: 150, filter: 'lowpass', vol: 0.3 }); },
  log() { tone(260, 0.12, { type: 'triangle', vol: 0.25, to: 150 }); noise(0.08, { freq: 700, q: 2, vol: 0.2 }); },
  thud() { tone(90, 0.35, { vol: 0.5, to: 40 }); noise(0.3, { freq: 300, filter: 'lowpass', vol: 0.4 }); },
  pop() { tone(320, 0.14, { vol: 0.2, to: 900 }); tone(1200, 0.12, { type: 'triangle', vol: 0.06, delay: 0.08 }); },
  tick() { tone(1050, 0.06, { type: 'square', vol: 0.06 }); },
  start() { [523, 659, 784].forEach((f, i) => tone(f, 0.18, { type: 'triangle', vol: 0.15, delay: i * 0.09 })); },
  end() { [784, 659, 523, 392].forEach((f, i) => tone(f, 0.3, { type: 'triangle', vol: 0.16, delay: i * 0.13 })); },
  best() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.3, { type: 'triangle', vol: 0.15, delay: 0.6 + i * 0.1 })); },
};

// ===== 파티클 =====
const particleGeo = {
  chip: new THREE.BoxGeometry(1, 0.5, 0.35),
  leaf: new THREE.PlaneGeometry(1, 0.6),
  spark: new THREE.OctahedronGeometry(0.5, 0),
  dust: new THREE.IcosahedronGeometry(0.5, 0),
};
const matCache = new Map();
function particleMat(color, basic) {
  const key = color + (basic ? 'b' : 's');
  if (!matCache.has(key)) {
    matCache.set(key, basic
      ? new THREE.MeshBasicMaterial({ color })
      : new THREE.MeshStandardMaterial({ color, flatShading: true, side: THREE.DoubleSide }));
  }
  return matCache.get(key);
}

const particles = [];
const MAX_PARTICLES = 500;
const _tmp = new THREE.Vector3();

// 옵션: count, pos, dir(쏠림 방향), spread, speed[min,max], up, gravity, drag, life[min,max], size[min,max], colors, geo, basic, flutter
function burst(o) {
  for (let i = 0; i < o.count; i++) {
    if (particles.length >= MAX_PARTICLES) particles.shift().mesh.removeFromParent();
    const color = o.colors[Math.floor(Math.random() * o.colors.length)];
    const mesh = new THREE.Mesh(particleGeo[o.geo || 'chip'], particleMat(color, o.basic));
    mesh.castShadow = !o.basic && o.geo !== 'dust';
    const p = o.posFn ? o.posFn() : o.pos;
    mesh.position.copy(p);
    const rnd = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
    const v = o.dir ? o.dir.clone().normalize().multiplyScalar(1 - (o.spread ?? 0.5)).add(rnd.multiplyScalar(o.spread ?? 0.5)).normalize() : rnd;
    const sp = THREE.MathUtils.lerp(o.speed[0], o.speed[1], Math.random());
    v.multiplyScalar(sp);
    v.y += o.up ?? 0;
    const size = THREE.MathUtils.lerp(o.size[0], o.size[1], Math.random());
    mesh.scale.setScalar(size);
    mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    const life = THREE.MathUtils.lerp(o.life[0], o.life[1], Math.random());
    scene.add(mesh);
    particles.push({
      mesh, v, size, life, age: 0,
      gravity: o.gravity ?? 14, drag: o.drag ?? 0.5, flutter: o.flutter || 0,
      spin: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(o.spinAmt ?? 15),
      grow: o.grow || 0,
    });
  }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.age += dt;
    if (p.age >= p.life) { p.mesh.removeFromParent(); particles.splice(i, 1); continue; }
    p.v.y -= p.gravity * dt;
    p.v.multiplyScalar(Math.exp(-p.drag * dt));
    if (p.flutter) { p.v.x += Math.sin(p.age * 9 + i) * p.flutter * dt; p.v.z += Math.cos(p.age * 7 + i) * p.flutter * dt; }
    p.mesh.position.addScaledVector(p.v, dt);
    if (p.mesh.position.y < 0.05) { // 바닥에 닿으면 튕기고 멈춤
      p.mesh.position.y = 0.05;
      p.v.y *= -0.3; p.v.x *= 0.6; p.v.z *= 0.6;
      p.spin.multiplyScalar(0.5);
    }
    p.mesh.rotation.x += p.spin.x * dt;
    p.mesh.rotation.y += p.spin.y * dt;
    p.mesh.rotation.z += p.spin.z * dt;
    const k = p.age / p.life;
    const s = p.size * (1 + p.grow * k) * (k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1);
    p.mesh.scale.setScalar(Math.max(0.001, s));
  }
}

// 바닥에 퍼지는 링
const rings = [];
function shockRing(pos, color, maxR = 3, life = 0.45) {
  const mesh = new THREE.Mesh(
    new THREE.RingGeometry(0.8, 1, 24),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.copy(pos);
  scene.add(mesh);
  rings.push({ mesh, age: 0, life, maxR });
}
function updateRings(dt) {
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i];
    r.age += dt;
    const k = r.age / r.life;
    if (k >= 1) { r.mesh.removeFromParent(); r.mesh.geometry.dispose(); r.mesh.material.dispose(); rings.splice(i, 1); continue; }
    r.mesh.scale.setScalar(0.2 + r.maxR * (1 - (1 - k) * (1 - k)));
    r.mesh.material.opacity = 0.9 * (1 - k);
  }
}

const WOOD = [0xc8935a, 0xe3b98a, 0x9b6a3c, 0xf1d3a8];
const SPARK = [0xffe066, 0xffc233, 0xfff3b0, 0xffffff];
const DUST = [0xd9c4a0, 0xc8b089, 0xe8dcc4];
const CONFETTI = [0xff6b6b, 0xffd93d, 0x6bcB77, 0x4d96ff, 0xc77dff];

// ===== 도끼 =====
// axeRig: 나무 중심에서 회전 (rotation.y = 조준 각도). 로컬 +X 방향이 찍는 방향.
// axePivot: 손잡이 끝(손 위치). 여기를 Y축으로 돌려서 옆으로 후려침.
const axeRig = new THREE.Group();
const axePivot = new THREE.Group();
axePivot.position.set(1.15, HIT_HEIGHT, 2.4);
axeRig.add(axePivot);
scene.add(axeRig);
const AXE_REST = -0.9;   // 들고 있는 각도
axePivot.rotation.y = AXE_REST;

// 조준 표시 (바닥의 화살표)
const aimMarker = new THREE.Mesh(
  new THREE.ConeGeometry(0.22, 0.5, 3),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 })
);
aimMarker.rotation.set(0, 0, Math.PI / 2);
aimMarker.position.set(1.85, 0.05, 0);
axeRig.add(aimMarker);

// ===== 나무 =====
let tree = null;          // { obj, hp, maxHp, weak, crit, state, mats }
const fallingTrees = [];

function spawnTree() {
  const tpl = treeTemplates[Math.floor(Math.random() * treeTemplates.length)];
  const obj = tpl ? tpl.clone() : fallbackTree();
  // 맞을 때 하얗게 번쩍이도록 재질을 나무마다 복사
  const mats = [];
  obj.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); mats.push(o.material); } });
  const holder = new THREE.Group();
  holder.add(obj);
  holder.scale.setScalar(0.01);
  holder.rotation.y = Math.random() * Math.PI * 2;
  scene.add(holder);
  const maxHp = CONFIG.baseHp + CONFIG.hpPerTree * game.trees;
  const weak = Math.floor(Math.random() * 8);
  tree = { obj: holder, mats, autumn: !!obj.userData.autumn, hp: maxHp, maxHp, weak, crit: (weak + 4) % 8, state: 'pop', t: 0, shake: 0, flash: 0 };
  updateHpBar();

  sfx.pop();
  shockRing(new THREE.Vector3(0, 0.04, 0), 0xffffff, 2.5, 0.4);
  burst({ count: 14, pos: new THREE.Vector3(0, 0.2, 0), dir: new THREE.Vector3(0, 1, 0), spread: 0.9, speed: [3, 6], gravity: 10, life: [0.4, 0.8], size: [0.12, 0.22], colors: SPARK, geo: 'spark', basic: true });
  burst({ count: 10, posFn: () => new THREE.Vector3((Math.random() - 0.5) * 1.6, 0.1, (Math.random() - 0.5) * 1.6), speed: [0.5, 1.5], up: 1.5, gravity: 1, drag: 3, life: [0.5, 0.9], size: [0.25, 0.45], colors: DUST, geo: 'dust', grow: 1 });
}

function setTreeFlash(t, v) {
  for (const m of t.mats) { if (m.emissive) { m.emissive.setRGB(v, v * 0.95, v * 0.85); } }
}

// ===== 게임 상태 =====
const game = { running: false, paused: false, remaining: 0, time: CONFIG.duration, endAt: 0, trees: 0, damage: 0, lastTick: 99 };
let aimAngle = 0, targetAngle = 0;
let swingT = -1;          // -1이면 휘두르는 중 아님
let swingHitDone = false;
let lastSwing = -99;
let timeScale = 1, slowUntil = 0;   // 크리티컬 슬로모션
let shake = 0;                      // 화면 흔들림 세기

const $ = (id) => document.getElementById(id);

// 최고 기록 = 한 판의 { 나무 수, 데미지 }. 예전 기록(숫자만 저장)도 읽을 수 있게 처리
function readBest() {
  try {
    const raw = localStorage.getItem('lumberBest');
    if (!raw) return { trees: 0, damage: 0 };
    const v = JSON.parse(raw);
    return typeof v === 'number' ? { trees: v, damage: 0 } : { trees: v.trees || 0, damage: v.damage || 0 };
  } catch { return { trees: 0, damage: 0 }; }
}
function writeBest(v) { try { localStorage.setItem('lumberBest', JSON.stringify(v)); } catch {} }

function startGame() {
  initAudio();
  sfx.start();
  game.running = true;
  game.paused = false;
  game.endAt = performance.now() / 1000 + CONFIG.duration;
  game.time = CONFIG.duration;
  game.trees = 0;
  game.damage = 0;
  game.lastTick = 99;
  if (tree) scene.remove(tree.obj);
  for (const t of fallingTrees) scene.remove(t.obj);
  fallingTrees.length = 0;
  clearPile();
  tree = null;
  spawnTree();
  $('startScreen').classList.add('hidden');
  $('resultScreen').classList.add('hidden');
  $('pauseScreen').classList.add('hidden');
  $('pauseBtn').classList.remove('hidden');
  updateHud();
}

// ===== 일시정지 =====
// 남은 시간을 저장해두고, 다시 시작할 때 종료 시각을 그만큼 뒤로 미룸
function pauseGame() {
  if (!game.running || game.paused) return;
  game.paused = true;
  game.remaining = game.endAt - performance.now() / 1000;
  if (actx) actx.suspend();
  $('pauseScreen').classList.remove('hidden');
}

function resumeGame() {
  if (!game.paused) return;
  game.paused = false;
  game.endAt = performance.now() / 1000 + game.remaining;
  if (actx) actx.resume();
  $('pauseScreen').classList.add('hidden');
}

// 그만두기: 판을 정리하고 시작(설명) 화면으로 돌아감. 기록은 저장하지 않음
function quitGame() {
  game.running = false;
  game.paused = false;
  if (actx) actx.resume();
  if (tree) scene.remove(tree.obj);
  tree = null;
  for (const t of fallingTrees) scene.remove(t.obj);
  fallingTrees.length = 0;
  clearPile();
  swingT = -1;
  axePivot.rotation.y = AXE_REST;
  game.time = CONFIG.duration;
  game.trees = 0;
  game.damage = 0;
  updateHud();
  updateHpBar();
  $('pauseScreen').classList.add('hidden');
  $('pauseBtn').classList.add('hidden');
  $('startScreen').classList.remove('hidden');
}

function endGame() {
  game.running = false;
  $('pauseBtn').classList.add('hidden');
  const best = readBest();   // 이번 판 전까지의 기록
  // 나무를 더 많이 쓰러트렸거나, 같으면 데미지가 더 높을 때 갱신
  const isNew = game.trees > 0 && (game.trees > best.trees || (game.trees === best.trees && game.damage > best.damage));
  if (isNew) writeBest({ trees: game.trees, damage: game.damage });
  $('rTrees').textContent = game.trees + '그루';
  $('rDmg').textContent = game.damage.toLocaleString();
  // 결과 화면엔 '기존' 최고 기록을 보여줌. 기록이 없으면 '-' (예전 버전 기록은 데미지가 없어서 '-')
  $('rBest').textContent = best.trees ? best.trees + '그루' : '-';
  $('rBestDmg').textContent = best.damage ? best.damage.toLocaleString() : '-';
  $('newbest').textContent = isNew ? '🎉 최고 기록 갱신!' : '';
  sfx.end();
  if (isNew) {
    sfx.best();
    for (let i = 0; i < 4; i++) {
      setTimeout(() => burst({ count: 40, pos: new THREE.Vector3((Math.random() - 0.5) * 6, 0.5, (Math.random() - 0.5) * 4), dir: new THREE.Vector3(0, 1, 0), spread: 0.6, speed: [6, 11], gravity: 9, drag: 1.5, flutter: 6, life: [1.5, 2.5], size: [0.12, 0.22], colors: CONFETTI, geo: 'leaf' }), i * 250);
    }
  }
  // 결과창은 살짝 늦게 띄워서 마지막 연출을 볼 수 있게
  setTimeout(() => $('resultScreen').classList.remove('hidden'), 500);
}

function bump(id) {
  const el = $(id);
  el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
}

function updateHud() {
  $('timeVal').textContent = Math.max(0, game.time).toFixed(1);
  $('time').classList.toggle('low', game.time <= 10);
  $('treesVal').textContent = game.trees;
  $('dmgVal').textContent = game.damage.toLocaleString();
}

function updateHpBar() {
  const r = tree ? Math.max(0, tree.hp) / tree.maxHp : 0;
  $('hpfill').style.width = (r * 100) + '%';
  $('hptext').textContent = tree ? `${Math.max(0, Math.ceil(tree.hp))} / ${tree.maxHp}` : '';
}

// ===== 입력 =====
const raycaster = new THREE.Raycaster();
const aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -HIT_HEIGHT);
const mouse = new THREE.Vector2();
const hitPoint = new THREE.Vector3();

function aimAt(clientX, clientY) {
  mouse.set((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(mouse, camera);
  if (raycaster.ray.intersectPlane(aimPlane, hitPoint)) {
    targetAngle = Math.atan2(-hitPoint.z, hitPoint.x);
  }
}
addEventListener('pointermove', (e) => aimAt(e.clientX, e.clientY));
addEventListener('pointerdown', (e) => {
  if (e.target.closest('button')) return;
  aimAt(e.clientX, e.clientY);
  // 터치는 미리 조준할 수 없으니 누른 방향으로 도끼를 바로 돌림
  if (e.pointerType !== 'mouse' && swingT < 0) aimAngle = targetAngle;
  trySwing();
});

function trySwing() {
  if (!game.running || game.paused) return;
  const now = performance.now() / 1000;
  if (now - lastSwing < CONFIG.cooldown) return;
  lastSwing = now;
  swingT = 0;
  swingHitDone = false;
  sfx.whoosh();
}

// 8방향 중 어느 칸인지 (0~7)
function sectorOf(angle) {
  const a = ((angle + Math.PI / 8) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
  return Math.floor(a / (Math.PI / 4)) % 8;
}

function onAxeContact() {
  if (!game.running || !tree || tree.state !== 'stand') return;
  const sector = sectorOf(aimAngle);
  const kind = sector === tree.weak ? 'weak' : sector === tree.crit ? 'crit' : 'normal';
  const base = CONFIG.damage[kind];
  const dmg = Math.max(1, Math.round(base * (1 + (Math.random() * 2 - 1) * CONFIG.damageRandom)));
  tree.hp -= dmg;
  tree.shake = kind === 'weak' ? 0.4 : kind === 'crit' ? 1.6 : 1;
  tree.flash = kind === 'weak' ? 0.25 : kind === 'crit' ? 0.9 : 0.5;
  game.damage += dmg;

  const out = new THREE.Vector3(Math.cos(aimAngle), 0, -Math.sin(aimAngle));
  const contact = out.clone().multiplyScalar(0.45).setY(HIT_HEIGHT);
  const axeTop = out.clone().multiplyScalar(1.7).setY(HIT_HEIGHT + 1.8);
  showFloat(axeTop, '!'.repeat(kind === 'weak' ? 1 : kind === 'normal' ? 2 : 3), kind);
  showFloat(out.clone().multiplyScalar(0.6).setY(HIT_HEIGHT + 3.2), String(dmg), kind, true);
  hitEffects(kind, contact, out);

  updateHpBar();
  updateHud();
  bump('dmgVal');
  if (tree.hp <= 0) fellTree();
}

function hitEffects(kind, contact, out) {
  // 잎이 떨어지는 위치 (나무 윗부분 주변)
  const leafPos = () => new THREE.Vector3((Math.random() - 0.5) * 1.6, 1.8 + Math.random() * 2, (Math.random() - 0.5) * 1.6);
  const leafColors = leafColorsOf(tree);

  if (kind === 'weak') {
    sfx.weak();
    burst({ count: 6, pos: contact, dir: out, spread: 0.6, speed: [3, 5], up: 2, gravity: 12, life: [0.2, 0.35], size: [0.06, 0.1], colors: [0xdddddd, 0xffffff], geo: 'spark', basic: true });
    burst({ count: 3, pos: contact, dir: out, spread: 0.5, speed: [1.5, 3], up: 2, life: [0.6, 0.9], size: [0.08, 0.12], colors: WOOD });
    shake = Math.max(shake, 0.04);
    return;
  }
  if (kind === 'normal') {
    sfx.normal();
    burst({ count: 12, pos: contact, dir: out, spread: 0.55, speed: [4, 8], up: 3, gravity: 16, life: [0.7, 1.1], size: [0.1, 0.2], colors: WOOD });
    burst({ count: 5, posFn: leafPos, speed: [0.3, 1], gravity: 1.2, drag: 2.5, flutter: 4, life: [1.2, 1.8], size: [0.15, 0.25], colors: leafColors, geo: 'leaf', spinAmt: 6 });
    shake = Math.max(shake, 0.1);
    return;
  }
  // 크리티컬
  sfx.crit();
  burst({ count: 26, pos: contact, dir: out, spread: 0.7, speed: [6, 12], up: 4, gravity: 16, life: [0.8, 1.3], size: [0.12, 0.26], colors: WOOD });
  burst({ count: 30, pos: contact, dir: out, spread: 0.9, speed: [5, 11], up: 2, gravity: 6, drag: 2, life: [0.4, 0.8], size: [0.08, 0.16], colors: SPARK, geo: 'spark', basic: true });
  burst({ count: 14, posFn: leafPos, speed: [1, 3], gravity: 1.2, drag: 2, flutter: 5, life: [1.4, 2.2], size: [0.16, 0.28], colors: leafColors, geo: 'leaf', spinAmt: 8 });
  shockRing(new THREE.Vector3(0, 0.06, 0), 0xffd23a, 3.5, 0.5);
  shockRing(contact.clone().setY(0.07), 0xffffff, 1.6, 0.3);
  shake = Math.max(shake, 0.32);
  slowUntil = performance.now() / 1000 + 0.12;
  const fl = $('flash');
  fl.classList.remove('on'); void fl.offsetWidth; fl.classList.add('on');
}

// 나무 종류에 맞는 잎 색
function leafColorsOf(t) {
  return t.autumn ? [0xf2a33a, 0xe8743b, 0xf6c445] : [0x3f9a5a, 0x5bb86b, 0x2f7d4a];
}

function fellTree() {
  game.trees++;
  updateHud();
  bump('treesVal');
  const t = tree;
  t.state = 'fall';
  t.t = 0;
  t.landed = false;
  t.pileIndex = game.trees - 1;
  setTreeFlash(t, 0);
  // 맞은 반대쪽으로 쓰러짐
  t.fallDir = new THREE.Vector3(-Math.cos(aimAngle), 0, Math.sin(aimAngle));
  t.fallAxis = new THREE.Vector3(0, 1, 0).cross(t.fallDir).normalize();
  t.startQuat = t.obj.quaternion.clone();
  fallingTrees.push(t);
  tree = null;
  updateHpBar();
  sfx.fall();
  setTimeout(() => { if (game.running) spawnTree(); }, 450);
}

function onTreeLanded(t) {
  sfx.thud();
  shake = Math.max(shake, 0.25);
  const lc = leafColorsOf(t);
  const along = () => t.fallDir.clone().multiplyScalar(1 + Math.random() * 4).add(new THREE.Vector3((Math.random() - 0.5) * 1.2, 0.3, (Math.random() - 0.5) * 1.2));
  burst({ count: 30, posFn: along, speed: [1, 3], up: 1.5, gravity: 1.5, drag: 2.5, flutter: 5, life: [1.2, 2], size: [0.18, 0.3], colors: lc, geo: 'leaf', spinAmt: 8 });
  burst({ count: 18, posFn: along, speed: [0.5, 1.5], up: 1, gravity: 0.5, drag: 3, life: [0.6, 1.1], size: [0.35, 0.6], colors: DUST, geo: 'dust', grow: 1.2 });
  burst({ count: 10, posFn: along, dir: new THREE.Vector3(0, 1, 0), spread: 0.8, speed: [3, 6], gravity: 14, life: [0.6, 1], size: [0.1, 0.18], colors: WOOD });
  shockRing(t.fallDir.clone().multiplyScalar(2.5).setY(0.05), 0xf3e6c8, 3, 0.5);
}

// ===== 떠오르는 글자 =====
const _v = new THREE.Vector3();
function showFloat(worldPos, text, kind, isNumber = false) {
  _v.copy(worldPos).project(camera);
  const el = document.createElement('div');
  el.className = 'float' + (kind === 'crit' ? ' crit' : '');
  el.textContent = text;
  const colors = { weak: '#c9d1d9', normal: '#ffffff', crit: '#ffd23a' };
  el.style.color = colors[kind];
  el.style.fontSize = (isNumber ? (kind === 'crit' ? 52 : kind === 'weak' ? 22 : 32) : (kind === 'crit' ? 48 : kind === 'weak' ? 26 : 34)) + 'px';
  el.style.left = ((_v.x + 1) / 2 * innerWidth + (Math.random() - 0.5) * 20) + 'px';
  el.style.top = ((1 - _v.y) / 2 * innerHeight) + 'px';
  $('floats').appendChild(el);
  const big = kind === 'crit' ? 1.5 : 1.15;
  el.animate([
    { transform: 'translate(-50%,-50%) scale(0.3)', opacity: 1 },
    { transform: `translate(-50%,-90%) scale(${big})`, opacity: 1, offset: 0.2 },
    { transform: 'translate(-50%,-110%) scale(1)', opacity: 1, offset: 0.55 },
    { transform: 'translate(-50%,-200%) scale(0.9)', opacity: 0 },
  ], { duration: kind === 'crit' ? 1000 : 750, easing: 'ease-out' }).onfinish = () => el.remove();
}

// ===== 장식 =====
function placeDecor(templates) {
  // 매번 같은 배치가 나오도록 고정 시드
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const list = templates.filter(Boolean);
  if (!list.length) return;
  for (let i = 0; i < 40; i++) {
    const tpl = list[Math.floor(rnd() * list.length)];
    const a = rnd() * Math.PI * 2;
    const r = 4.6 + rnd() * 3.8;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.abs(x) < 5.8 && z < -1.8 && z > -6.4) continue;   // 통나무 더미 자리는 비워둠
    const o = tpl.clone();
    o.position.set(x, 0, z);
    o.rotation.y = rnd() * Math.PI * 2;
    o.scale.setScalar(1.4 + rnd() * 0.8);
    if (o.getObjectByProperty('isMesh', true)) {
      const box = new THREE.Box3().setFromObject(o);
      if (box.min.y < 0) o.position.y -= box.min.y;  // 통나무처럼 땅 아래로 파묻힌 모델 보정
    }
    scene.add(o);
  }
}

// ===== 통나무 더미 (쓰러트린 나무 수만큼 쌓임) =====
const PILE_Z = -3.8;              // 나무 뒤쪽(화면 위쪽)
const PILE_XS = [-3.3, 3.3, 0];   // 나무에 가리지 않게 왼쪽 뒤부터. 꽉 차면 오른쪽, 가운데 순
const PILE_ROWS = 5;              // 맨 아래 5개, 위로 갈수록 1개씩 줄어서 한 더미에 15개
const PER_PILE = PILE_ROWS * (PILE_ROWS + 1) / 2;
const LOG_SCALE = 2.2;
const LOG_W = 0.6;                // 통나무 지름 (모델 0.26 x LOG_SCALE + 여유)
let logTemplate = null;
const pileLogs = [];

function fallbackLog() {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1, 7), new THREE.MeshStandardMaterial({ color: 0xa8683a, flatShading: true }));
  m.rotation.x = Math.PI / 2;
  m.castShadow = true;
  g.add(m);
  return g;
}

// n번째 통나무가 놓일 자리
function pileSlot(n) {
  const p = Math.floor(n / PER_PILE);
  if (p >= PILE_XS.length) return null;   // 45개 넘으면 더 안 쌓음
  let i = n % PER_PILE, row = 0;
  while (i >= PILE_ROWS - row) { i -= PILE_ROWS - row; row++; }
  const count = PILE_ROWS - row;
  // 통나무는 화면 가로로 눕히고, 앞뒤(z)로 나란히 쌓음
  return new THREE.Vector3(PILE_XS[p], 0.11 * LOG_SCALE + row * LOG_W * 0.85, PILE_Z + (i - (count - 1) / 2) * LOG_W);
}

function sendLogToPile(index, from) {
  const to = pileSlot(index);
  if (!to) return;
  const obj = logTemplate ? logTemplate.clone() : fallbackLog();
  obj.scale.setScalar(LOG_SCALE);
  obj.position.copy(from);
  scene.add(obj);
  pileLogs.push({ obj, from: from.clone(), to, yaw: (Math.random() - 0.5) * 0.15, t: 0, landed: false });
}

function clearPile() {
  for (const l of pileLogs) scene.remove(l.obj);
  pileLogs.length = 0;
}

const FLY_TIME = 0.55;
function updateLogs(dt) {
  for (const l of pileLogs) {
    if (l.t > FLY_TIME + 0.3) continue;   // 다 쌓인 통나무는 그대로
    l.t += dt;
    const k = Math.min(1, l.t / FLY_TIME);
    // 포물선으로 날아가며 빙글빙글
    l.obj.position.lerpVectors(l.from, l.to, k);
    l.obj.position.y += Math.sin(k * Math.PI) * 2.5;
    l.obj.rotation.set((1 - k) * Math.PI * 2, Math.PI / 2 + l.yaw + (1 - k) * Math.PI, 0);
    if (k >= 1) {
      if (!l.landed) {
        l.landed = true;
        sfx.log();
        shake = Math.max(shake, 0.06);
        burst({ count: 8, pos: l.to, speed: [0.5, 1.5], up: 1, gravity: 0.5, drag: 3, life: [0.4, 0.8], size: [0.2, 0.35], colors: DUST, geo: 'dust', grow: 1 });
        burst({ count: 6, pos: l.to, dir: new THREE.Vector3(0, 1, 0), spread: 0.8, speed: [2, 4], gravity: 12, life: [0.4, 0.7], size: [0.08, 0.14], colors: WOOD });
        showFloat(l.to.clone().setY(l.to.y + 1), '+1', 'normal', true);
      }
      // 착지할 때 살짝 찌그러졌다 돌아옴
      const b = (l.t - FLY_TIME) / 0.3;
      const sq = Math.sin(Math.min(1, b) * Math.PI) * 0.18;
      l.obj.scale.set(LOG_SCALE * (1 + sq), LOG_SCALE * (1 - sq), LOG_SCALE * (1 + sq * 0.3));
    }
  }
}

// ===== 메인 루프 =====
const clock = new THREE.Clock();
const SWING_DOWN = 0.06, SWING_BACK = 0.16;

function shortestAngle(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function tick() {
  const realDt = Math.min(clock.getDelta(), 0.05);
  // 일시정지 중엔 화면만 그대로 그리고 움직임은 멈춤
  if (game.paused) { renderer.render(scene, camera); requestAnimationFrame(tick); return; }
  const now = performance.now() / 1000;
  timeScale = now < slowUntil ? 0.2 : Math.min(1, timeScale + realDt * 6);
  const dt = realDt * timeScale;

  // 남은 시간은 실제 시계 기준 (느린 컴퓨터나 슬로모션에도 정확)
  if (game.running) {
    game.time = game.endAt - now;
    const sec = Math.ceil(game.time);
    if (sec <= 5 && sec < game.lastTick && sec > 0) { game.lastTick = sec; sfx.tick(); bump('timeVal'); }
    if (game.time <= 0) { game.time = 0; updateHud(); endGame(); }
    else updateHud();
  }

  // 도끼 방향 (휘두르는 중엔 고정)
  if (swingT < 0) aimAngle += shortestAngle(aimAngle, targetAngle) * (1 - Math.exp(-18 * realDt));
  axeRig.rotation.y = aimAngle;
  aimMarker.material.opacity = 0.5 + Math.sin(now * 6) * 0.25;

  // 휘두르기
  if (swingT >= 0) {
    swingT += dt;
    if (swingT < SWING_DOWN) {
      const k = swingT / SWING_DOWN;
      axePivot.rotation.y = AXE_REST * (1 - k * k);
    } else {
      if (!swingHitDone) { swingHitDone = true; onAxeContact(); }
      const k = Math.min(1, (swingT - SWING_DOWN) / SWING_BACK);
      axePivot.rotation.y = AXE_REST * (k * k * (3 - 2 * k));
      if (k >= 1) swingT = -1;
    }
  } else {
    // 대기 중엔 살짝 흔들흔들
    axePivot.rotation.y = AXE_REST + Math.sin(now * 3) * 0.04;
  }

  // 나무 등장/흔들림/번쩍임
  if (tree) {
    tree.t += dt;
    if (tree.state === 'pop') {
      const k = Math.min(1, tree.t / 0.4);
      // 탄성 있게 튀어나오는 곡선
      const s = k >= 1 ? 1 : 1 - Math.pow(2, -10 * k) * Math.cos(k * Math.PI * 3);
      tree.obj.scale.setScalar(TREE_SCALE * Math.max(0.01, s));
      if (k >= 1) { tree.obj.scale.setScalar(TREE_SCALE); tree.state = 'stand'; }
    }
    if (tree.shake > 0) {
      tree.shake = Math.max(0, tree.shake - dt * 4);
      const w = Math.sin(tree.t * 50) * 0.07 * tree.shake;
      tree.obj.rotation.x = w;
      tree.obj.rotation.z = w * 0.6;
      // 맞을 때 살짝 찌그러짐
      if (tree.state === 'stand') tree.obj.scale.set(TREE_SCALE * (1 + 0.06 * tree.shake), TREE_SCALE * (1 - 0.05 * tree.shake), TREE_SCALE * (1 + 0.06 * tree.shake));
    }
    if (tree.flash > 0) {
      tree.flash = Math.max(0, tree.flash - realDt * 4);
      setTreeFlash(tree, tree.flash);
    }
  }

  for (let i = fallingTrees.length - 1; i >= 0; i--) {
    const t = fallingTrees[i];
    t.t += dt;
    const k = Math.min(1, t.t / 0.7);
    // 가속하며 쓰러지고 땅에 닿으면 살짝 튕김
    let ang = (Math.PI / 2) * k * k;
    if (k >= 1) {
      if (!t.landed) { t.landed = true; onTreeLanded(t); }
      ang = Math.PI / 2 - Math.abs(Math.sin((t.t - 0.7) * 14)) * 0.08 * Math.max(0, 1 - (t.t - 0.7) * 3);
    }
    t.obj.quaternion.copy(t.startQuat).premultiply(new THREE.Quaternion().setFromAxisAngle(t.fallAxis, ang));
    if (t.t > 1.3) {
      // 줄어들기 시작할 때 통나무가 더미로 날아감
      if (!t.logSent) { t.logSent = true; sendLogToPile(t.pileIndex, t.fallDir.clone().multiplyScalar(2).setY(0.6)); }
      t.obj.scale.multiplyScalar(Math.exp(-8 * dt));
      t.obj.position.y -= dt * 0.8;
    }
    if (t.t > 1.9) { scene.remove(t.obj); fallingTrees.splice(i, 1); }
  }

  updateParticles(dt);
  updateRings(dt);
  updateLogs(dt);

  // 화면 흔들림
  shake = Math.max(0, shake - realDt * 1.2);
  camera.position.copy(CAM_POS).add(_tmp.set((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake));
  camera.lookAt(CAM_TARGET);

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

addEventListener('resize', () => {
  fitCamera();
  renderer.setSize(innerWidth, innerHeight);
});

$('startBtn').addEventListener('click', startGame);
$('retryBtn').addEventListener('click', startGame);
$('pauseBtn').addEventListener('click', pauseGame);
$('resumeBtn').addEventListener('click', resumeGame);
$('restartBtn').addEventListener('click', startGame);
$('quitBtn').addEventListener('click', quitGame);
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') game.paused ? resumeGame() : pauseGame();
});
// 다른 탭으로 가거나 창을 내리면 자동으로 일시정지
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });

// ===== 시작 =====
const [axeModel, decor, ...trees] = await Promise.all([
  loadModel('tool-axe.glb'),
  Promise.all(DECOR_FILES.map(loadModel)),
  ...TREE_FILES.map(loadModel),
]);
trees.forEach((t, i) => { if (t) t.userData.autumn = TREE_FILES[i].includes('autumn'); });
treeTemplates = trees.filter(Boolean);
placeDecor(decor);
logTemplate = decor[DECOR_FILES.indexOf('tree-log.glb')];
const axe = axeModel || fallbackAxe();
// 모델은 손잡이가 +Y로 서 있고 날이 -X쪽. 눕혀서 손잡이가 -Z(나무 옆)로 향하게 함
axe.scale.setScalar(AXE_SCALE);
axe.rotation.x = -Math.PI / 2;
axePivot.add(axe);

$('startBtn').disabled = false;
$('startBtn').textContent = '시작하기';
tick();

// 테스트용: ?autotest 붙이면 자동으로 시작해서 계속 찍음
if (params.has('autotest')) {
  startGame();
  let a = 0;
  setInterval(() => { a += 0.7; targetAngle = a; trySwing(); }, 300);
}
