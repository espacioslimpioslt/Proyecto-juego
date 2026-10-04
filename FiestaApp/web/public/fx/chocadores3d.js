// Autos Chocadores en 3D: pista ovalada, autitos con paragolpes de goma,
// conos, aceite y turbos. La física del auto propio corre acá (sin demora);
// los demás autos llegan por el canal 'autos' y se dibujan suavizados.
//
// Control: giroscopio del celu (en vertical).
//   - Inclinación hacia atrás (levantar la parte de arriba): 0° plano = frena
//     hasta parar; 45° = acelera a fondo. En el medio, velocidad proporcional.
//   - Ladear a la izquierda / derecha: dobla.
// En una compu (sin giroscopio) se puede probar con las flechas o WASD.
//
// Los mismos números de la pista usa el servidor (server/roundTypes/chocadores.js).

import * as THREE from '../vendor/three.module.min.js';

// ---------- Geometría de la pista ("estadio": dos rectas y dos curvas) ----------
export function crearGeometria(pista) {
  const L = pista.largo; const R = pista.radio; const W = pista.ancho;
  const P = 2 * L + 2 * Math.PI * R;
  function punto(s) {
    let d = ((s % P) + P) % P + L / 2;
    if (d >= P) d -= P;
    if (d < L) return { x: -L / 2 + d, z: R, ang: 0 };
    d -= L;
    if (d < Math.PI * R) { const a = Math.PI / 2 - d / R; return { x: L / 2 + Math.cos(a) * R, z: Math.sin(a) * R, ang: -d / R }; }
    d -= Math.PI * R;
    if (d < L) return { x: L / 2 - d, z: -R, ang: Math.PI };
    d -= L;
    const a = -Math.PI / 2 - d / R;
    return { x: -L / 2 + Math.cos(a) * R, z: Math.sin(a) * R, ang: Math.PI - d / R };
  }
  // Metros recorridos desde la línea de llegada (x=0 en la recta de abajo).
  function progreso(x, z) {
    let u;
    if (Math.abs(x) <= L / 2) u = z > 0 ? x + L / 2 : L + Math.PI * R + (L / 2 - x);
    else if (x > L / 2) u = L + (Math.PI / 2 - Math.atan2(z, x - L / 2)) * R;
    else u = 2 * L + Math.PI * R + R * ((((-Math.PI / 2 - Math.atan2(z, x + L / 2)) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI));
    return (((u - L / 2) % P) + P) % P;
  }
  // Distancia al "eje" de la pista y dirección hacia afuera.
  function radial(x, z) {
    const cx = Math.max(-L / 2, Math.min(L / 2, x));
    const dx = x - cx; const dz = z;
    const d = Math.hypot(dx, dz) || 0.0001;
    return { d, nx: dx / d, nz: dz / d };
  }
  return { L, R, W, P, punto, progreso, radial };
}

// ---------- Control por giroscopio (y teclado para probar en la compu) ----------
export async function pedirPermisoGiroscopio() {
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      return (await DeviceOrientationEvent.requestPermission()) === 'granted';
    }
  } catch (e) { return false; }
  return true;
}

export function crearControl() {
  const c = { acel: 0, giro: 0, hayGiro: false, apaisado: false, beta: 0, gamma: 0, teclas: new Set() };
  let suaveA = 0; let suaveG = 0;
  const alInclinar = (e) => {
    if (e.beta === null || e.beta === undefined) return;
    c.hayGiro = true;
    const ang = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    c.apaisado = Math.abs(ang) === 90;
    c.beta = e.beta; c.gamma = e.gamma || 0;
    // Celu en vertical: beta = inclinación hacia atrás (0 = plano), gamma = ladeo.
    const pitch = Math.max(0, Math.min(90, e.beta));
    const a = Math.max(0, Math.min(1, (pitch - 5) / 40));
    let g = Math.max(-40, Math.min(40, c.gamma));
    g = Math.abs(g) < 4 ? 0 : (g - Math.sign(g) * 4) / 28;
    suaveA += (a - suaveA) * 0.35;
    suaveG += (Math.max(-1, Math.min(1, g)) - suaveG) * 0.35;
    c.acel = suaveA; c.giro = suaveG;
  };
  const abajo = (e) => { c.teclas.add(e.key.toLowerCase()); if (e.key.startsWith('Arrow')) e.preventDefault(); };
  const arriba = (e) => c.teclas.delete(e.key.toLowerCase());
  window.addEventListener('deviceorientation', alInclinar);
  window.addEventListener('keydown', abajo);
  window.addEventListener('keyup', arriba);
  c.leer = () => {
    const t = c.teclas;
    if (t.size) {
      const acel = t.has('arrowup') || t.has('w') ? 1 : 0;
      const giro = (t.has('arrowright') || t.has('d') ? 1 : 0) - (t.has('arrowleft') || t.has('a') ? 1 : 0);
      return { acel, giro };
    }
    return { acel: c.acel, giro: c.giro };
  };
  c.destruir = () => {
    window.removeEventListener('deviceorientation', alInclinar);
    window.removeEventListener('keydown', abajo);
    window.removeEventListener('keyup', arriba);
  };
  return c;
}

function vibrar(patron) {
  try { if (navigator.vibrate) navigator.vibrate(patron); } catch (e) { /* sin vibración */ }
}

function texturaNombre(texto, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(7,8,26,0.75)';
  g.beginPath(); g.roundRect(4, 8, 248, 48, 22); g.fill();
  g.strokeStyle = color; g.lineWidth = 4; g.stroke();
  g.fillStyle = '#fff';
  g.font = '700 30px Inter, system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(texto.slice(0, 14), 128, 33);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function texturaCuadros() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 32;
  const g = c.getContext('2d');
  for (let i = 0; i < 16; i++) for (let j = 0; j < 4; j++) { g.fillStyle = (i + j) % 2 ? '#111' : '#fff'; g.fillRect(i * 8, j * 8, 8, 8); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function texturaTurbo() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#ffd23f';
  for (let k = 0; k < 2; k++) {
    g.beginPath(); g.moveTo(10 + k * 24, 8); g.lineTo(34 + k * 24, 32); g.lineTo(10 + k * 24, 56); g.lineTo(2 + k * 24, 56); g.lineTo(26 + k * 24, 32); g.lineTo(2 + k * 24, 8); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function armarAuto(color, nombre) {
  const grupo = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, metalness: 0.3, roughness: 0.35, transparent: true });
  const cuerpo = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.55, 1.3), mat);
  cuerpo.position.y = 0.55;
  const cabina = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 1.0), new THREE.MeshStandardMaterial({ color: 0x1a1d3a, metalness: 0.5, roughness: 0.2, transparent: true }));
  cabina.position.set(-0.2, 1.05, 0);
  // Paragolpes de goma alrededor: el sello de los autitos chocadores.
  const goma = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.22, 8, 24), new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9, transparent: true }));
  goma.rotation.x = Math.PI / 2;
  goma.scale.set(1, 0.72, 1);
  goma.position.y = 0.35;
  const antena = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.6), new THREE.MeshBasicMaterial({ color: 0xcccccc }));
  antena.position.set(-0.7, 1.6, 0);
  const chispa = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), new THREE.MeshBasicMaterial({ color }));
  chispa.position.set(-0.7, 2.42, 0);
  grupo.add(cuerpo, cabina, goma, antena, chispa);
  const etiqueta = new THREE.Sprite(new THREE.SpriteMaterial({ map: texturaNombre(nombre, `#${new THREE.Color(color).getHexString()}`), depthTest: false }));
  etiqueta.scale.set(2.8, 0.7, 1);
  etiqueta.position.y = 3.1;
  grupo.add(etiqueta);
  grupo.userData.materiales = [mat, cabina.material, goma.material];
  return grupo;
}

const CAR_R = 1.3;

export function crearCarrera(contenedor, opts) {
  const { miId, pista, obst, velMax, choques, pilotos, colorDe } = opts;
  const geo = crearGeometria(pista);
  const control = opts.control;
  const fuerte = choques !== 'suaves';

  const canvas = document.createElement('canvas');
  canvas.className = 'gp-canvas';
  contenedor.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x24345f);
  scene.fog = new THREE.Fog(0x24345f, 80, 220);
  const camara = new THREE.PerspectiveCamera(60, 1, 0.1, 400);
  scene.add(new THREE.HemisphereLight(0xe4ecff, 0x3a5a3a, 1.5));
  const sol = new THREE.DirectionalLight(0xffffff, 1.4);
  sol.position.set(30, 60, 20);
  scene.add(sol);

  // Pasto, asfalto, cordones, línea de llegada.
  const pasto = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x2f7a45, roughness: 1 }));
  pasto.rotation.x = -Math.PI / 2;
  pasto.position.y = -0.02;
  scene.add(pasto);

  const N = 160;
  const afuera = []; const adentro = [];
  for (let i = 0; i < N; i++) {
    const p = geo.punto((i / N) * geo.P);
    const nx = -Math.sin(p.ang); const nz = Math.cos(p.ang);
    afuera.push(new THREE.Vector2(p.x + nx * geo.W, -(p.z + nz * geo.W)));
    adentro.push(new THREE.Vector2(p.x - nx * geo.W, -(p.z - nz * geo.W)));
  }
  const forma = new THREE.Shape(afuera);
  forma.holes.push(new THREE.Path(adentro));
  const asfalto = new THREE.Mesh(new THREE.ShapeGeometry(forma), new THREE.MeshStandardMaterial({ color: 0x474c63, roughness: 0.85 }));
  asfalto.rotation.x = -Math.PI / 2;
  scene.add(asfalto);

  const cantCordon = Math.floor(geo.P / 2);
  const cordones = new THREE.InstancedMesh(new THREE.BoxGeometry(2, 0.35, 0.7), new THREE.MeshStandardMaterial({ roughness: 0.6 }), cantCordon * 2);
  const m4 = new THREE.Matrix4(); const q = new THREE.Quaternion(); const col = new THREE.Color();
  for (let i = 0; i < cantCordon; i++) {
    const p = geo.punto(i * 2 + 1);
    const nx = -Math.sin(p.ang); const nz = Math.cos(p.ang);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -p.ang);
    [1, -1].forEach((lado, k) => {
      m4.compose(new THREE.Vector3(p.x + nx * (geo.W + 0.35) * lado, 0.17, p.z + nz * (geo.W + 0.35) * lado), q, new THREE.Vector3(1, 1, 1));
      cordones.setMatrixAt(i * 2 + k, m4);
      cordones.setColorAt(i * 2 + k, col.set(i % 2 ? 0xffffff : 0xff3344));
    });
  }
  scene.add(cordones);

  const llegada = new THREE.Mesh(new THREE.PlaneGeometry(geo.W * 2, 2.4), new THREE.MeshBasicMaterial({ map: texturaCuadros() }));
  llegada.rotation.x = -Math.PI / 2;
  llegada.rotation.z = Math.PI / 2;
  llegada.position.set(0, 0.02, geo.R);
  scene.add(llegada);

  // Obstáculos
  const conoMat = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.5 });
  const conos = (obst.conos || []).map((c) => {
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.3, 14), conoMat);
    m.position.set(c.x, 0.65, c.z);
    scene.add(m);
    return { ...c, mesh: m, mov: 0 };
  });
  (obst.aceite || []).forEach((a) => {
    const m = new THREE.Mesh(new THREE.CircleGeometry(a.r, 24), new THREE.MeshStandardMaterial({ color: 0x050508, metalness: 0.9, roughness: 0.15 }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(a.x, 0.03, a.z);
    m.scale.set(1, 0.75, 1);
    scene.add(m);
  });
  const texTurbo = texturaTurbo();
  const turbos = (obst.turbo || []).map((t) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2), new THREE.MeshBasicMaterial({ map: texTurbo, transparent: true }));
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = -t.ang;
    m.position.set(t.x, 0.04, t.z);
    scene.add(m);
    return { ...t, mesh: m };
  });

  // Autos
  const autos = new Map(); // id -> { grupo, red: {...}, vis: {x,z,a} }
  pilotos.forEach((p) => {
    const g = armarAuto(colorDe(p.entrant), p.name);
    scene.add(g);
    autos.set(p.id, { piloto: p, grupo: g, red: null, vis: null });
  });
  const yo = pilotos.find((p) => p.id === miId) || null;

  // Mi auto (física local)
  const mio = { x: 0, z: 0, a: 0, vx: 0, vz: 0, giro: 0, aceite: 0, turbo: 0, acum: 0, sPrev: 0, vueltas: 0 };
  function aLaGrilla() {
    if (!yo) return;
    const i = yo.grilla || 0;
    const s = -6 - Math.floor(i / 3) * 5.5;
    const p = geo.punto(s);
    const lado = ((i % 3) - 1) * 5;
    mio.x = p.x - Math.sin(p.ang) * lado;
    mio.z = p.z + Math.cos(p.ang) * lado;
    mio.a = p.ang; mio.vx = 0; mio.vz = 0; mio.giro = 0;
    mio.sPrev = geo.progreso(mio.x, mio.z);
    mio.acum = mio.sPrev > geo.P / 2 ? mio.sPrev - geo.P : mio.sPrev;
    mio.vueltas = 0;
  }
  aLaGrilla();

  let fase = 'calibrar';
  let vivo = true;
  let ultimoEnvio = 0;
  let ultimoHud = 0;
  const golpesAvisados = new Map(); // atacante -> ms
  let ultimoToque = 0;
  let reloj = performance.now();
  let tamCambio = true;

  function tam() {
    const w = contenedor.clientWidth || 360;
    const h = contenedor.clientHeight || Math.round(w * 1.25);
    renderer.setSize(w, h, false);
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    camara.aspect = w / h;
    camara.updateProjectionMatrix();
  }
  const alCambiar = () => { tamCambio = true; };
  window.addEventListener('resize', alCambiar);

  function fisica(dt) {
    const { acel, giro } = control.leer();
    const fx = Math.cos(mio.a); const fz = Math.sin(mio.a);
    let vF = mio.vx * fx + mio.vz * fz;
    const limite = velMax * (mio.turbo > 0 ? 1.5 : 1);
    if (mio.giro > 0) {
      // Trompo: gira solo y no responde por un momento.
      mio.giro -= dt;
      mio.a += 9 * dt;
      mio.vx *= 1 - Math.min(1, 1.6 * dt);
      mio.vz *= 1 - Math.min(1, 1.6 * dt);
    } else {
      const objetivo = limite * acel;
      if (vF < objetivo) vF = Math.min(objetivo, vF + (mio.turbo > 0 ? 40 : 16) * dt);
      else vF = Math.max(objetivo, vF - 26 * dt);
      const agarre = mio.aceite > 0 ? 0.6 : 7;
      const lat = { x: mio.vx - fx * (mio.vx * fx + mio.vz * fz), z: mio.vz - fz * (mio.vx * fx + mio.vz * fz) };
      const k = Math.min(1, agarre * dt);
      mio.vx = fx * vF + lat.x * (1 - k);
      mio.vz = fz * vF + lat.z * (1 - k);
      const respuesta = Math.max(-1, Math.min(1, vF / 7));
      const bamboleo = mio.aceite > 0 ? Math.sin(performance.now() / 90) * 0.8 : 0;
      mio.a += (giro + bamboleo) * 2.3 * dt * respuesta;
    }
    mio.aceite = Math.max(0, mio.aceite - dt);
    mio.turbo = Math.max(0, mio.turbo - dt);
    mio.x += mio.vx * dt;
    mio.z += mio.vz * dt;

    // Paredes (borde de afuera y de adentro).
    const r = geo.radial(mio.x, mio.z);
    const vn = mio.vx * r.nx + mio.vz * r.nz;
    if (r.d > geo.R + geo.W - CAR_R * 0.6) {
      const pen = r.d - (geo.R + geo.W - CAR_R * 0.6);
      mio.x -= r.nx * pen; mio.z -= r.nz * pen;
      if (vn > 0) { mio.vx -= 1.5 * vn * r.nx; mio.vz -= 1.5 * vn * r.nz; mio.vx *= 0.8; mio.vz *= 0.8; if (vn > 6) toque(40); }
    } else if (r.d < geo.R - geo.W + CAR_R * 0.6) {
      const pen = (geo.R - geo.W + CAR_R * 0.6) - r.d;
      mio.x += r.nx * pen; mio.z += r.nz * pen;
      if (vn < 0) { mio.vx -= 1.5 * vn * r.nx; mio.vz -= 1.5 * vn * r.nz; mio.vx *= 0.8; mio.vz *= 0.8; if (vn < -6) toque(40); }
    }

    // Conos: rebote y frenada.
    conos.forEach((c) => {
      const dx = mio.x - c.x; const dz = mio.z - c.z; const d = Math.hypot(dx, dz);
      if (d < CAR_R + 0.5 && d > 0.001) {
        const nx = dx / d; const nz = dz / d;
        mio.x = c.x + nx * (CAR_R + 0.5); mio.z = c.z + nz * (CAR_R + 0.5);
        const v = mio.vx * nx + mio.vz * nz;
        if (v < 0) { mio.vx -= 1.6 * v * nx; mio.vz -= 1.6 * v * nz; }
        mio.vx *= 0.5; mio.vz *= 0.5;
        c.mov = 1;
        toque(70);
      }
    });
    (obst.aceite || []).forEach((a) => { if (Math.hypot(mio.x - a.x, mio.z - a.z) < a.r) mio.aceite = 1.3; });
    turbos.forEach((t) => {
      if (Math.hypot(mio.x - t.x, mio.z - t.z) < 1.8 && mio.turbo <= 0) { mio.turbo = 1.6; if (opts.aviso) opts.aviso('🚀 ¡Turbo!'); }
    });

    // Choques con autos de OTROS equipos (los del mismo se atraviesan).
    const ahora = performance.now();
    autos.forEach((o, id) => {
      if (id === miId || !o.vis || o.piloto.entrant === yo.entrant) return;
      const dx = mio.x - o.vis.x; const dz = mio.z - o.vis.z; const d = Math.hypot(dx, dz);
      if (d >= CAR_R * 2 || d < 0.001) return;
      const nx = dx / d; const nz = dz / d;
      const solape = CAR_R * 2 - d;
      mio.x += nx * solape * 0.6; mio.z += nz * solape * 0.6;
      const ovx = (o.red && o.red.vx) || 0; const ovz = (o.red && o.red.vz) || 0;
      const vrel = (ovx - mio.vx) * nx + (ovz - mio.vz) * nz; // > 0: el otro viene hacia mí
      if (vrel > 0) {
        const f = fuerte ? 1.1 : 0.7;
        mio.vx += nx * vrel * f; mio.vz += nz * vrel * f;
      }
      const velOtro = Math.hypot(ovx, ovz); const velMia = Math.hypot(mio.vx, mio.vz);
      const umbral = fuerte ? 7 : 10;
      if (vrel > umbral && velOtro >= velMia * 0.8 && mio.giro <= 0) {
        // ¡Me dieron! Trompo, vibración fuerte y aviso al servidor.
        mio.giro = fuerte ? 1.0 : 0.6;
        vibrar([120, 60, 220]);
        if (!golpesAvisados.has(id) || ahora - golpesAvisados.get(id) > 1500) {
          golpesAvisados.set(id, ahora);
          if (opts.golpeado) opts.golpeado(id);
        }
      } else {
        toque(50);
      }
    });

    // Vueltas
    const s = geo.progreso(mio.x, mio.z);
    let ds = s - mio.sPrev;
    if (ds > geo.P / 2) ds -= geo.P;
    if (ds < -geo.P / 2) ds += geo.P;
    mio.acum += ds;
    mio.sPrev = s;
    const v = Math.floor(mio.acum / geo.P);
    if (v > mio.vueltas) { mio.vueltas = v; if (opts.vuelta) opts.vuelta(v); }
  }

  function toque(ms) {
    const ahora = performance.now();
    if (ahora - ultimoToque > 250) { ultimoToque = ahora; vibrar(ms); }
  }

  function dibujarAuto(o, x, z, a, giro) {
    o.grupo.position.set(x, 0, z);
    o.grupo.rotation.y = -a;
    o.grupo.children[4].position.y = 2.42 + Math.sin(performance.now() / 120) * (giro ? 0.25 : 0.04);
  }

  function cuadro(ahoraMs) {
    if (!vivo) return;
    requestAnimationFrame(cuadro);
    const dt = Math.min((ahoraMs - reloj) / 1000, 0.05);
    reloj = ahoraMs;
    if (document.hidden) return;
    if (tamCambio) { tam(); tamCambio = false; }

    if (yo && fase === 'carrera') fisica(dt);
    if (yo) {
      const o = autos.get(miId);
      o.vis = { x: mio.x, z: mio.z, a: mio.a };
      dibujarAuto(o, mio.x, mio.z, mio.a, mio.giro > 0);
      if ((fase === 'carrera' || fase === 'largada') && ahoraMs - ultimoEnvio > 100) {
        ultimoEnvio = ahoraMs;
        opts.enviar([+mio.x.toFixed(2), +mio.z.toFixed(2), +mio.a.toFixed(3), +mio.vx.toFixed(2), +mio.vz.toFixed(2), mio.vueltas, mio.giro > 0 ? 1 : 0]);
      }
    }
    // Los demás: posición recibida + un poco de predicción, suavizada.
    autos.forEach((o, id) => {
      if (id === miId || !o.red) { if (id !== miId) o.grupo.visible = !!o.red; return; }
      o.grupo.visible = true;
      const t = Math.min((ahoraMs - o.red.llego) / 1000, 0.25);
      const px = o.red.x + o.red.vx * t; const pz = o.red.z + o.red.vz * t;
      if (!o.vis) o.vis = { x: px, z: pz, a: o.red.a };
      const k = Math.min(1, dt * 12);
      o.vis.x += (px - o.vis.x) * k;
      o.vis.z += (pz - o.vis.z) * k;
      let da = o.red.a - o.vis.a;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      o.vis.a += da * k;
      dibujarAuto(o, o.vis.x, o.vis.z, o.vis.a, o.red.giro);
      // Compañeros de equipo: semitransparentes cuando están cerca (se atraviesan).
      const cerca = yo && o.piloto.entrant === yo.entrant && Math.hypot(o.vis.x - mio.x, o.vis.z - mio.z) < 5;
      o.grupo.userData.materiales.forEach((m) => { m.opacity = cerca ? 0.45 : 1; });
    });

    conos.forEach((c) => {
      if (c.mov > 0) { c.mov = Math.max(0, c.mov - dt * 2); c.mesh.rotation.z = Math.sin(c.mov * 20) * 0.4 * c.mov; }
    });
    turbos.forEach((t) => { t.mesh.material.opacity = 0.65 + Math.sin(ahoraMs / 150) * 0.35; });

    // Cámara: detrás de mi auto; si no corro, sigue al primero de la lista.
    let foco = yo ? { x: mio.x, z: mio.z, a: mio.a } : null;
    if (!foco) { const primero = [...autos.values()].find((o) => o.vis); foco = primero ? primero.vis : { x: 0, z: geo.R, a: 0 }; }
    const fx = Math.cos(foco.a); const fz = Math.sin(foco.a);
    const deseada = new THREE.Vector3(foco.x - fx * 12, 9, foco.z - fz * 12);
    camara.position.lerp(deseada, Math.min(1, dt * 5));
    camara.lookAt(foco.x + fx * 9, 0, foco.z + fz * 9);

    if (opts.hud && ahoraMs - ultimoHud > 120) {
      ultimoHud = ahoraMs;
      const c = control.leer();
      opts.hud({ vel: Math.hypot(mio.vx, mio.vz), velMax, acel: c.acel, giro: c.giro, vueltas: mio.vueltas, trompo: mio.giro > 0, turbo: mio.turbo > 0, aceite: mio.aceite > 0 });
    }
    renderer.render(scene, camara);
  }
  requestAnimationFrame(cuadro);

  return {
    // Estado del auto propio (lo usan las pruebas automáticas).
    propio: () => ({ ...mio }),
    geo,
    setFase(nueva) {
      if (nueva === fase) return;
      if (nueva === 'largada' || (nueva === 'calibrar')) aLaGrilla();
      fase = nueva;
    },
    recibir(pos) {
      const ahora = performance.now();
      (pos.autos || []).forEach(([id, x, z, a, vx, vz, giro]) => {
        if (id === miId) return;
        const o = autos.get(id);
        if (o) o.red = { x, z, a, vx, vz, giro: !!giro, llego: ahora };
      });
    },
    destruir() {
      vivo = false;
      window.removeEventListener('resize', alCambiar);
      renderer.dispose();
      canvas.remove();
    }
  };
}
