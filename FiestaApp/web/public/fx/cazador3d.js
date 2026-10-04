// El Cazador en 3D: la casa (o la mansión) con sus muebles, vista en primera
// persona. El cazador camina a oscuras con una linterna; los escondidos ven
// con poca luz y a la silueta del cazador con su linterna acercándose.
//
// Controles (celu): mitad izquierda de la pantalla = joystick para caminar;
// mitad derecha = arrastrar para mirar. En una compu: WASD/flechas.
// La física (choques con paredes y muebles) corre acá; el servidor recibe la
// posición y decide todo lo demás.

import * as THREE from '../vendor/three.module.min.js';

export const LUGAR = {
  cama: 'debajo de la cama', armario: 'adentro del armario', cortina: 'detrás de la cortina',
  mesa: 'debajo de la mesa', sillon: 'detrás del sillón', banera: 'en la bañera', cajas: 'entre las cajas'
};
const R = 0.35; // radio del jugador
const ALCANCE = 1.3;
const OJOS = 1.6;

function madera(c = 0x6b4226) { return new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 }); }
function tela(c) { return new THREE.MeshStandardMaterial({ color: c, roughness: 0.95, side: THREE.DoubleSide }); }

function caja(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

// Cada mueble se arma con piezas simples. (0,0) = centro del mueble en el piso.
function armarMueble(m) {
  const g = new THREE.Group();
  const { w, d } = m;
  switch (m.tipo) {
    case 'cama': {
      g.add(caja(w, 0.35, d, madera(), 0, 0.42, 0));
      g.add(caja(w * 0.96, 0.18, d * 0.96, tela(0xf2efe6), 0, 0.68, 0));
      g.add(caja(w * 0.7, 0.14, 0.45, tela(0xffffff), 0, 0.84, -d / 2 + 0.35));
      // Colcha que cae hasta casi el piso: abajo se puede esconder alguien.
      const colcha = tela([0x8a2b3a, 0x2b4f8a, 0x3a7a4a][Math.abs(m.id.length) % 3]);
      g.add(caja(w + 0.08, 0.08, d * 0.75, colcha, 0, 0.8, d * 0.12));
      g.add(caja(0.04, 0.68, d * 0.75, colcha, w / 2 + 0.04, 0.44, d * 0.12));
      g.add(caja(0.04, 0.68, d * 0.75, colcha, -w / 2 - 0.04, 0.44, d * 0.12));
      g.add(caja(w + 0.08, 1.1, 0.12, madera(0x4a2a16), 0, 0.85, -d / 2));
      break;
    }
    case 'armario': {
      const ancho = Math.max(w, d); const fondo = Math.min(w, d);
      const cuerpo = caja(ancho, 2.1, fondo, madera(0x5a3418), 0, 1.05, 0);
      g.add(cuerpo);
      g.add(caja(0.02, 1.9, fondo + 0.02, madera(0x2a1608), 0, 1.05, 0));
      [-0.12, 0.12].forEach((x) => g.add(caja(0.04, 0.2, fondo + 0.06, new THREE.MeshStandardMaterial({ color: 0xd9b45a, metalness: 0.8, roughness: 0.3 }), x, 1.05, 0)));
      if (w < d) g.rotation.y = Math.PI / 2;
      break;
    }
    case 'cortina': {
      const ancho = Math.max(w, d);
      const geo = new THREE.PlaneGeometry(ancho, 2.5, 24, 1);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) * 9) * 0.07);
      geo.computeVertexNormals();
      const c = new THREE.Mesh(geo, tela(0x7a1426));
      c.position.y = 1.3;
      g.add(c);
      g.add(caja(ancho + 0.3, 0.05, 0.05, new THREE.MeshStandardMaterial({ color: 0xd9b45a, metalness: 0.8 }), 0, 2.58, 0));
      if (w < d) g.rotation.y = Math.PI / 2;
      break;
    }
    case 'mesa': {
      g.add(caja(w, 0.07, d, madera(0x7a5230), 0, 0.76, 0));
      // Mantel largo: tapa lo que hay abajo.
      const mantel = tela(0xe8e0c8);
      g.add(caja(w + 0.12, 0.02, d + 0.12, mantel, 0, 0.8, 0));
      g.add(caja(w + 0.12, 0.62, 0.02, mantel, 0, 0.5, d / 2 + 0.06));
      g.add(caja(w + 0.12, 0.62, 0.02, mantel, 0, 0.5, -d / 2 - 0.06));
      g.add(caja(0.02, 0.62, d + 0.12, mantel, w / 2 + 0.06, 0.5, 0));
      g.add(caja(0.02, 0.62, d + 0.12, mantel, -w / 2 - 0.06, 0.5, 0));
      break;
    }
    case 'sillon': {
      const c = tela(0x5a4a7a);
      g.add(caja(w, 0.45, d, c, 0, 0.25, 0));
      g.add(caja(w, 0.75, 0.25, c, 0, 0.75, -d / 2 + 0.12));
      g.add(caja(0.25, 0.6, d, c, w / 2 - 0.12, 0.5, 0));
      g.add(caja(0.25, 0.6, d, c, -w / 2 + 0.12, 0.5, 0));
      break;
    }
    case 'heladera':
      g.add(caja(w, 1.9, d, new THREE.MeshStandardMaterial({ color: 0xe8ecef, metalness: 0.4, roughness: 0.3 }), 0, 0.95, 0));
      g.add(caja(0.04, 0.5, 0.04, new THREE.MeshStandardMaterial({ color: 0x888888 }), w / 2 - 0.1, 1.3, d / 2 + 0.02));
      break;
    case 'banera': {
      const blanco = new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.2 });
      g.add(caja(w, 0.55, d, blanco, 0, 0.28, 0));
      g.add(caja(w * 0.9, 0.05, d * 0.75, new THREE.MeshStandardMaterial({ color: 0x9fd0e0 }), 0, 0.5, 0));
      const cortina = new THREE.Mesh(new THREE.PlaneGeometry(w, 1.8, 16, 1), tela(0xe0f0f4));
      const p = cortina.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 10) * 0.05);
      cortina.position.set(0, 1.45, -d / 2 + 0.1);
      g.add(cortina);
      break;
    }
    case 'cajas': {
      const carton = new THREE.MeshStandardMaterial({ color: 0xb08a5a, roughness: 0.9 });
      g.add(caja(w * 0.6, 0.6, d * 0.7, carton, -w * 0.18, 0.3, 0));
      g.add(caja(w * 0.45, 0.5, d * 0.6, carton, w * 0.27, 0.25, d * 0.1));
      g.add(caja(w * 0.4, 0.4, d * 0.5, carton, -w * 0.1, 0.8, 0.05));
      break;
    }
    default:
      g.add(caja(w, 1, d, madera(), 0, 0.5, 0));
  }
  g.position.set(m.x, 0, m.z);
  return g;
}

function texturaNombre(texto, color) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(7,8,26,0.7)'; g.fillRect(8, 10, 240, 44);
  g.fillStyle = color; g.fillRect(8, 10, 8, 44);
  g.fillStyle = '#fff'; g.font = '700 28px Inter, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(texto).slice(0, 14), 132, 33);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function texturaMancha(color) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'); g.fillStyle = color;
  for (let i = 0; i < 14; i++) { g.beginPath(); g.arc(64 + (Math.random() - 0.5) * 70, 64 + (Math.random() - 0.5) * 70, 6 + Math.random() * 22, 0, Math.PI * 2); g.fill(); }
  g.beginPath(); g.arc(64, 64, 34, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function armarAvatar(color, nombre, cazador) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
  const cuerpo = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 1.1, 16), mat);
  cuerpo.position.y = 0.75;
  const cabeza = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), new THREE.MeshStandardMaterial({ color: 0xf0c8a0 }));
  cabeza.position.y = 1.5;
  g.add(cuerpo, cabeza);
  if (cazador) {
    // Linterna con su haz de luz (lo ven los escondidos).
    const haz = new THREE.Mesh(new THREE.ConeGeometry(1.6, 6, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
    haz.rotation.z = Math.PI / 2;
    haz.position.set(3.2, 1.3, 0);
    g.add(haz);
    const luz = new THREE.SpotLight(0xfff2c0, 25, 14, 0.5, 0.5, 1.2);
    luz.position.set(0.2, 1.3, 0);
    luz.target.position.set(4, 1.0, 0);
    g.add(luz, luz.target);
  }
  const et = new THREE.Sprite(new THREE.SpriteMaterial({ map: texturaNombre(nombre, `#${new THREE.Color(color).getHexString()}`), depthTest: false }));
  et.scale.set(1.6, 0.4, 1); et.position.y = 2.1;
  g.add(et);
  return g;
}

export function crearCaza(contenedor, opts) {
  const { mapa, miId } = opts;
  const canvas = document.createElement('canvas');
  canvas.className = 'cz-canvas';
  contenedor.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020205);
  const camara = new THREE.PerspectiveCamera(70, 1, 0.05, 60);

  const ambiente = new THREE.HemisphereLight(0xc8d0ff, 0x302020, 0.5);
  scene.add(ambiente);
  const lamparas = [];
  mapa.ambientes.forEach((a) => {
    const piso = new THREE.Mesh(new THREE.PlaneGeometry(a.w, a.d), new THREE.MeshStandardMaterial({ color: a.color, roughness: 0.9 }));
    piso.rotation.x = -Math.PI / 2;
    piso.position.set(a.x + a.w / 2, 0, a.z + a.d / 2);
    scene.add(piso);
    const techo = new THREE.Mesh(new THREE.PlaneGeometry(a.w, a.d), new THREE.MeshStandardMaterial({ color: 0x3a3632, roughness: 1 }));
    techo.rotation.x = Math.PI / 2;
    techo.position.set(a.x + a.w / 2, 2.7, a.z + a.d / 2);
    scene.add(techo);
    const l = new THREE.PointLight(0xffd9a0, 6, Math.max(a.w, a.d) * 1.2, 1.6);
    l.position.set(a.x + a.w / 2, 2.4, a.z + a.d / 2);
    scene.add(l);
    lamparas.push(l);
  });
  const matPared = new THREE.MeshStandardMaterial({ color: 0xcfc4b0, roughness: 0.95 });
  mapa.paredes.forEach(([x1, z1, x2, z2]) => {
    const largo = Math.hypot(x2 - x1, z2 - z1);
    const p = new THREE.Mesh(new THREE.BoxGeometry(largo + 0.18, 2.7, 0.18), matPared);
    p.position.set((x1 + x2) / 2, 1.35, (z1 + z2) / 2);
    p.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
    scene.add(p);
  });
  const muebles = mapa.muebles.map((m) => { const g = armarMueble(m); scene.add(g); return { m, g }; });

  // Jugadores
  const avatares = new Map(); // id -> { g, vis, red }
  let soyCazador = false;
  let cazadorId = null;
  function avatarDe(id) {
    if (!avatares.has(id)) {
      const esCaz = id === cazadorId;
      const g = armarAvatar(esCaz ? 0xc0202a : opts.colorDe(id), opts.nombreDe(id), esCaz);
      g.visible = false;
      scene.add(g);
      avatares.set(id, { g, vis: null, red: null, esCaz });
    }
    return avatares.get(id);
  }
  function limpiarAvatares() {
    avatares.forEach((a) => scene.remove(a.g));
    avatares.clear();
  }

  // Manchas de pintura (sprites de color donde pegó cada disparo)
  const manchas = [];
  function ponerManchas(lista) {
    while (manchas.length < lista.length) {
      const m = lista[manchas.length];
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: texturaMancha(m.color), transparent: true }));
      s.position.set(m.x, 1.1, m.z);
      s.scale.set(0.9, 0.9, 1);
      scene.add(s);
      manchas.push(s);
    }
  }
  function limpiarManchas() { manchas.forEach((s) => scene.remove(s)); manchas.length = 0; }

  // Mi personaje
  const yo = { x: 0, z: 0, a: 0, mirarY: -0.05 };
  let fase = 'esconder';
  let escondite = null;
  let atrapado = false;
  let vivo = true;
  const mov = { x: 0, z: 0 }; // joystick
  const teclas = new Set();

  // ---------- Controles táctiles ----------
  const toques = new Map();
  const joy = document.createElement('div');
  joy.className = 'cz-joy hidden';
  joy.innerHTML = '<i></i>';
  contenedor.appendChild(joy);
  function alTocar(e) {
    for (const t of e.changedTouches || [e]) {
      const r = contenedor.getBoundingClientRect();
      const x = t.clientX - r.left; const y = t.clientY - r.top;
      if (y < 60) continue; // la barra de arriba
      const izq = x < r.width / 2;
      toques.set(t.identifier ?? 'm', { izq, x0: x, y0: y, x, y });
      if (izq) { joy.classList.remove('hidden'); joy.style.left = `${x}px`; joy.style.top = `${y}px`; }
    }
  }
  function alMover(e) {
    for (const t of e.changedTouches || [e]) {
      const k = toques.get(t.identifier ?? 'm');
      if (!k) continue;
      const r = contenedor.getBoundingClientRect();
      const x = t.clientX - r.left; const y = t.clientY - r.top;
      if (k.izq) {
        let dx = (x - k.x0) / 50; let dy = (y - k.y0) / 50;
        const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
        mov.x = dx; mov.z = dy;
        joy.querySelector('i').style.transform = `translate(${dx * 28}px, ${dy * 28}px)`;
      } else {
        yo.a += (x - k.x) * 0.008;
        yo.mirarY = Math.max(-0.9, Math.min(0.6, yo.mirarY - (y - k.y) * 0.004));
      }
      k.x = x; k.y = y;
    }
    if (e.cancelable) e.preventDefault();
  }
  function alSoltar(e) {
    for (const t of e.changedTouches || [e]) {
      const k = toques.get(t.identifier ?? 'm');
      if (k && k.izq) { mov.x = 0; mov.z = 0; joy.classList.add('hidden'); joy.querySelector('i').style.transform = ''; }
      toques.delete(t.identifier ?? 'm');
    }
  }
  contenedor.addEventListener('touchstart', alTocar, { passive: true });
  contenedor.addEventListener('touchmove', alMover, { passive: false });
  contenedor.addEventListener('touchend', alSoltar);
  contenedor.addEventListener('touchcancel', alSoltar);
  const abajo = (e) => { teclas.add(e.key.toLowerCase()); if (e.key.startsWith('Arrow')) e.preventDefault(); };
  const arriba = (e) => teclas.delete(e.key.toLowerCase());
  window.addEventListener('keydown', abajo);
  window.addEventListener('keyup', arriba);

  // ---------- Física simple ----------
  function chocar() {
    mapa.paredes.forEach(([x1, z1, x2, z2]) => {
      const vx = x2 - x1; const vz = z2 - z1; const l2 = vx * vx + vz * vz;
      let t = ((yo.x - x1) * vx + (yo.z - z1) * vz) / l2; t = Math.max(0, Math.min(1, t));
      const px = x1 + vx * t; const pz = z1 + vz * t;
      const dx = yo.x - px; const dz = yo.z - pz; const d = Math.hypot(dx, dz);
      const min = R + 0.09;
      if (d < min && d > 1e-6) { yo.x = px + (dx / d) * min; yo.z = pz + (dz / d) * min; }
    });
    mapa.muebles.forEach((m) => {
      if (m.tipo === 'cortina') return;
      const x0 = m.x - m.w / 2 - R; const x1 = m.x + m.w / 2 + R; const z0 = m.z - m.d / 2 - R; const z1 = m.z + m.d / 2 + R;
      if (yo.x > x0 && yo.x < x1 && yo.z > z0 && yo.z < z1) {
        const opciones = [[yo.x - x0, -1, 0], [x1 - yo.x, 1, 0], [yo.z - z0, 0, -1], [z1 - yo.z, 0, 1]].sort((a, b) => a[0] - b[0]);
        const [pen, sx, sz] = opciones[0];
        yo.x += sx * pen; yo.z += sz * pen;
      }
    });
    yo.x = Math.max(R, Math.min(mapa.ancho - R, yo.x));
    yo.z = Math.max(R, Math.min(mapa.largo - R, yo.z));
  }

  function puedeMoverse() {
    if (atrapado || escondite) return false;
    if (soyCazador) return fase === 'cazar';
    return fase === 'esconder' || fase === 'cazar';
  }

  // Mueble más cercano al alcance (para esconderse o revisar).
  function muebleCerca() {
    let mejor = null;
    mapa.muebles.forEach((m) => {
      if (!soyCazador && !m.cupo) return;
      const dx = Math.max(m.x - m.w / 2 - yo.x, 0, yo.x - m.x - m.w / 2);
      const dz = Math.max(m.z - m.d / 2 - yo.z, 0, yo.z - m.z - m.d / 2);
      const d = Math.hypot(dx, dz);
      if (d <= ALCANCE && (!mejor || d < mejor.d)) mejor = { m, d };
    });
    return mejor ? mejor.m : null;
  }

  // Dónde va la cámara si estoy escondido.
  function camaraEscondido() {
    const m = mapa.muebles.find((x) => x.id === escondite);
    if (!m) return null;
    const alto = { cama: 0.22, mesa: 0.35, armario: 1.5, cortina: 1.5, sillon: 0.55, banera: 0.55, cajas: 0.6 }[m.tipo] || 0.6;
    return { x: m.x, y: alto, z: m.z };
  }

  // ---------- Sonido de pasos (para el cazador) ----------
  let actx = null;
  const oidos = new Set();
  function paso(rx, rz, fuerte) {
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      const dx = rx - yo.x; const dz = rz - yo.z; const d = Math.hypot(dx, dz);
      const rel = Math.atan2(dz, dx) - yo.a;
      const pan = actx.createStereoPanner();
      pan.pan.value = Math.max(-1, Math.min(1, Math.sin(rel)));
      const g = actx.createGain();
      const vol = Math.min(1, 2.2 / (1 + d * 0.45)) * (fuerte ? 1.4 : 1);
      const t = actx.currentTime;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol * 0.6, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      const o = actx.createOscillator(); o.type = 'triangle';
      o.frequency.setValueAtTime(fuerte ? 110 : 85, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      const buf = actx.createBuffer(1, actx.sampleRate * 0.08, actx.sampleRate);
      const dat = buf.getChannelData(0); for (let i = 0; i < dat.length; i++) dat[i] = (Math.random() * 2 - 1) * (1 - i / dat.length);
      const ruido = actx.createBufferSource(); ruido.buffer = buf;
      const f = actx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900 - Math.min(d * 40, 600);
      o.connect(g); ruido.connect(f).connect(g); g.connect(pan).connect(actx.destination);
      o.start(t); o.stop(t + 0.2); ruido.start(t);
    } catch (e) { /* sin audio */ }
  }

  // Latido para los escondidos: más rápido cuanto más cerca está el cazador.
  let proximoLatido = 0;
  let distCazador = 99;
  function latir(ahora) {
    if (soyCazador || atrapado || fase !== 'cazar' || distCazador > 11) return;
    if (ahora < proximoLatido) return;
    const intervalo = 350 + Math.min(distCazador, 11) * 90;
    proximoLatido = ahora + intervalo;
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      const t = actx.currentTime;
      [0, 0.16].forEach((dt, i) => {
        const o = actx.createOscillator(); const g = actx.createGain();
        o.frequency.setValueAtTime(60, t + dt); o.frequency.exponentialRampToValueAtTime(35, t + dt + 0.12);
        g.gain.setValueAtTime(0.0001, t + dt); g.gain.exponentialRampToValueAtTime((i ? 0.35 : 0.55) * (1 - distCazador / 12), t + dt + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.15);
        o.connect(g).connect(actx.destination); o.start(t + dt); o.stop(t + dt + 0.2);
      });
    } catch (e) { /* sin audio */ }
    if (distCazador < 4 && navigator.vibrate) { try { navigator.vibrate([40, 120, 30]); } catch (e) { /* sin vibración */ } }
  }

  // ---------- Bucle ----------
  let reloj = performance.now();
  let ultimoEnvio = 0;
  let tamCambio = true;
  const alCambiar = () => { tamCambio = true; };
  window.addEventListener('resize', alCambiar);
  function tam() {
    const w = contenedor.clientWidth || 360; const h = contenedor.clientHeight || 600;
    renderer.setSize(w, h, false); canvas.style.width = '100%'; canvas.style.height = '100%';
    camara.aspect = w / h; camara.updateProjectionMatrix();
  }
  const linterna = new THREE.SpotLight(0xfff4d0, 40, 16, 0.55, 0.45, 1.1);
  scene.add(linterna, linterna.target);

  function cuadro(ahora) {
    if (!vivo) return;
    requestAnimationFrame(cuadro);
    const dt = Math.min((ahora - reloj) / 1000, 0.05);
    reloj = ahora;
    if (document.hidden) return;
    if (tamCambio) { tam(); tamCambio = false; }

    // Teclado
    let mx = mov.x; let mz = mov.z;
    if (teclas.size) {
      mz = (teclas.has('s') || teclas.has('arrowdown') ? 1 : 0) - (teclas.has('w') || teclas.has('arrowup') ? 1 : 0);
      mx = (teclas.has('d') ? 1 : 0) - (teclas.has('a') ? 1 : 0);
      if (teclas.has('arrowleft')) yo.a -= 2.2 * dt;
      if (teclas.has('arrowright')) yo.a += 2.2 * dt;
    }
    if (puedeMoverse() && (mx || mz)) {
      const vel = 3.2 * Math.min(1, Math.hypot(mx, mz)) * (Math.hypot(mx, mz) > 0.85 ? 1.35 : 1);
      const fx = Math.cos(yo.a); const fz = Math.sin(yo.a);
      // Adelante = -mz; costado = mx.
      const ax = fx * -mz + -fz * mx; const az = fz * -mz + fx * mx;
      const l = Math.hypot(ax, az) || 1;
      yo.x += (ax / l) * vel * dt; yo.z += (az / l) * vel * dt;
      chocar();
    }
    if (puedeMoverse() && ahora - ultimoEnvio > 100) {
      ultimoEnvio = ahora;
      opts.enviar([+yo.x.toFixed(2), +yo.z.toFixed(2), +yo.a.toFixed(3)]);
    }

    // Cámara
    const esc = escondite ? camaraEscondido() : null;
    if (esc) camara.position.set(esc.x, esc.y, esc.z);
    else camara.position.set(yo.x, OJOS, yo.z);
    camara.lookAt(camara.position.x + Math.cos(yo.a), camara.position.y + yo.mirarY, camara.position.z + Math.sin(yo.a));

    // Linterna del cazador (sale de la cámara)
    linterna.visible = soyCazador && fase === 'cazar';
    if (linterna.visible) {
      linterna.position.copy(camara.position);
      linterna.target.position.set(camara.position.x + Math.cos(yo.a) * 5, camara.position.y + yo.mirarY * 5 - 0.3, camara.position.z + Math.sin(yo.a) * 5);
    }
    // Los demás, suavizados
    avatares.forEach((av) => {
      if (!av.red) { av.g.visible = false; return; }
      av.g.visible = !av.red.escondido;
      if (!av.vis) av.vis = { x: av.red.x, z: av.red.z, a: av.red.a };
      const k = Math.min(1, dt * 10);
      av.vis.x += (av.red.x - av.vis.x) * k; av.vis.z += (av.red.z - av.vis.z) * k;
      let da = av.red.a - av.vis.a; da = Math.atan2(Math.sin(da), Math.cos(da)); av.vis.a += da * k;
      av.g.position.set(av.vis.x, 0, av.vis.z);
      av.g.rotation.y = -av.vis.a;
    });
    latir(ahora);
    renderer.render(scene, camara);
  }
  requestAnimationFrame(cuadro);

  return {
    // Cambia de turno / fase (con lo que manda la sala).
    setEstado(round, privado) {
      const nuevoTurno = round.cazadorId !== cazadorId || round.serie !== this._serieTurno;
      if (round.cazadorId !== cazadorId) { cazadorId = round.cazadorId; limpiarAvatares(); limpiarManchas(); }
      soyCazador = cazadorId === miId;
      const antes = fase;
      fase = round.fase;
      escondite = privado && privado.escondite;
      const yoJ = (round.jugadores || []).find((j) => j.id === miId);
      atrapado = !!(yoJ && yoJ.atrapado);
      // Al empezar cada fase, el servidor dice dónde arranco.
      if (privado && privado.pos && (antes !== fase || nuevoTurno)) {
        const [x, z, a] = privado.pos;
        if (antes !== fase || Math.hypot(x - yo.x, z - yo.z) > 2) { yo.x = x; yo.z = z; if (antes !== fase) yo.a = a || 0; }
      }
      this._serieTurno = round.serie;
      // Luz: el cazador caza a oscuras; los escondidos ven con luz tenue.
      const oscuro = soyCazador && fase === 'cazar';
      ambiente.intensity = oscuro ? 0.06 : 0.45;
      lamparas.forEach((l) => { l.intensity = oscuro ? 0 : 5; });
    },
    // Lo que llega ~10 veces por segundo por el canal 'caza'.
    recibir(v) {
      const vistos = new Set();
      (v.jugadores || []).forEach(([id, x, z, a, esc]) => {
        vistos.add(id);
        const av = avatarDe(id);
        av.red = { x, z, a, escondido: !!esc };
      });
      avatares.forEach((av, id) => { if (!vistos.has(id)) av.red = null; });
      if (v.cazador && !soyCazador) {
        vistos.add(cazadorId);
        const av = avatarDe(cazadorId);
        av.red = { x: v.cazador[0], z: v.cazador[1], a: v.cazador[2], escondido: false };
        const px = escondite ? (mapa.muebles.find((m) => m.id === escondite) || yo).x : yo.x;
        const pz = escondite ? (mapa.muebles.find((m) => m.id === escondite) || yo).z : yo.z;
        distCazador = Math.hypot(v.cazador[0] - px, v.cazador[1] - pz);
      }
      if (soyCazador) {
        (v.ruidos || []).forEach(([x, z, fuerte, t]) => {
          const k = `${t}-${x}-${z}`;
          if (oidos.has(k)) return;
          oidos.add(k);
          paso(x, z, fuerte);
        });
        if (oidos.size > 400) oidos.clear();
      }
      ponerManchas(v.manchas || []);
    },
    muebleCerca,
    propio: () => ({ ...yo }),
    // Solo para pruebas automáticas: ubicar al personaje (sin chocar paredes).
    _ubicar(x, z, a) { yo.x = x; yo.z = z; if (a !== undefined) yo.a = a; },
    angulo: () => yo.a,
    get escondite() { return escondite; },
    destruir() {
      vivo = false;
      window.removeEventListener('resize', alCambiar);
      window.removeEventListener('keydown', abajo);
      window.removeEventListener('keyup', arriba);
      renderer.dispose();
      canvas.remove();
      joy.remove();
    }
  };
}
