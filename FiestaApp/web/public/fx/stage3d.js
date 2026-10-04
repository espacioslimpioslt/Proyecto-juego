// Escenario 3D de la portada: un estudio de TV con reflectores que barren,
// paneles de luces al fondo, piso brillante y, en el centro, el objeto
// "firma" del Programa destacado (el rosco girando, las torres del duelo,
// las cartas del impostor). Cambia de objeto cuando la portada rota de
// Programa.
//
// Hecho con Three.js (public/vendor/three.module.min.js), sin texturas ni
// modelos descargados: todo se arma con geometría simple y colores, así pesa
// poco y anda en celus de gama media. Si el celu no tiene WebGL, o pidió
// "reducir movimiento", app.js ni siquiera carga este archivo y queda el
// fondo animado en CSS.

import * as THREE from '../vendor/three.module.min.js';

const COLORES = {
  ambar: 0xffb23f,
  rosa: 0xff3d7f,
  cian: 0x3de6ff,
  violeta: 0x8b5cff,
  verde: 0x3ddc84,
  rojo: 0xff4d5e,
  equipoA: 0x5b8dd6,
  equipoB: 0xe0637a
};

// Textura con una letra o un texto, dibujada en un canvas (sin archivos).
function texturaTexto(texto, { fondo = '#14173a', color = '#ffffff', size = 128, fuente = 800 } = {}) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = fondo;
  g.beginPath();
  g.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = color;
  g.font = `${fuente} ${size * 0.55}px Unbounded, system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(texto, size / 2, size / 2 + size * 0.03);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function texturaCarta(cara, etiqueta, fondo) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 360;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 256, 360);
  grad.addColorStop(0, fondo[0]);
  grad.addColorStop(1, fondo[1]);
  g.fillStyle = grad;
  g.beginPath();
  g.roundRect(4, 4, 248, 352, 28);
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.lineWidth = 6;
  g.stroke();
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '150px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
  g.fillText(cara, 128, 160);
  g.font = '700 30px Unbounded, system-ui, sans-serif';
  g.fillText(etiqueta, 128, 300);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Halo de luz (un círculo difuso que suma brillo): reemplaza el "bloom" sin
// tener que cargar post-procesado.
let texturaHalo = null;
function halo(color, escala) {
  if (!texturaHalo) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.25)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    texturaHalo = new THREE.CanvasTexture(c);
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texturaHalo, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
  }));
  s.scale.setScalar(escala);
  return s;
}

// ---------- Objetos "firma" de cada Programa ----------

function armarRosco() {
  const grupo = new THREE.Group();
  const letras = 'ABCDEFGHIJLMNOPRSTUV'.split('');
  const radio = 2.1;
  const discos = letras.map((l, i) => {
    const mat = new THREE.MeshStandardMaterial({
      map: texturaTexto(l), emissive: 0x000000, emissiveIntensity: 1, roughness: 0.35, metalness: 0.2
    });
    const disco = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.12, 32), [
      new THREE.MeshStandardMaterial({ color: 0x2a2f6e, roughness: 0.4, metalness: 0.5 }), mat, mat
    ]);
    const ang = (i / letras.length) * Math.PI * 2;
    disco.position.set(Math.cos(ang) * radio, Math.sin(ang) * radio, 0);
    disco.rotation.x = Math.PI / 2;
    grupo.add(disco);
    return { disco, mat, i };
  });
  // Reloj en el centro
  const centro = new THREE.Mesh(
    new THREE.CircleGeometry(0.95, 48),
    new THREE.MeshBasicMaterial({ map: texturaTexto('1:15', { fondo: '#0b0d24', color: '#ffb23f', fuente: 900, size: 256 }), transparent: true })
  );
  grupo.add(centro);
  const brillo = halo(COLORES.ambar, 4.5);
  brillo.position.z = -0.3;
  grupo.add(brillo);

  grupo.userData.update = (t) => {
    grupo.rotation.z = -t * 0.25;
    centro.rotation.z = t * 0.25;
    // Una letra por vez se "juega": se enciende verde (acierto) o roja.
    const paso = Math.floor(t * 2.2);
    discos.forEach(({ mat, i }) => {
      const turno = (paso - i + letras.length * 100) % letras.length;
      const jugado = turno < 10;
      const error = [3, 8, 14].includes(i);
      mat.emissive.setHex(jugado ? (error ? COLORES.rojo : COLORES.verde) : 0x000000);
      mat.emissiveIntensity = turno === 0 ? 1.6 : 0.55;
    });
  };
  return grupo;
}

function armarAhoraCaigo() {
  const grupo = new THREE.Group();
  const geo = new THREE.BoxGeometry(0.9, 0.42, 0.9);
  const torre = (x, color) => {
    const t = new THREE.Group();
    const bloques = Array.from({ length: 6 }, (_, i) => {
      const b = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: 0.25, roughness: 0.3, metalness: 0.4
      }));
      b.position.y = -1.6 + i * 0.45;
      t.add(b);
      return b;
    });
    t.position.x = x;
    grupo.add(t);
    return { t, bloques };
  };
  const a = torre(-1.5, COLORES.equipoA);
  const b = torre(1.5, COLORES.equipoB);
  // Escalera de luz al medio
  const escalones = Array.from({ length: 8 }, (_, i) => {
    const e = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.35),
      new THREE.MeshStandardMaterial({ color: 0x222650, emissive: COLORES.ambar, emissiveIntensity: 0 }));
    e.position.set(0, -1.6 + i * 0.42, 0.2);
    grupo.add(e);
    return e;
  });
  const brillo = halo(COLORES.ambar, 3);
  brillo.position.set(0, 0.6, -0.5);
  grupo.add(brillo);

  grupo.userData.update = (t) => {
    grupo.rotation.y = Math.sin(t * 0.4) * 0.35;
    // Las torres crecen por turnos y una "cae" cada tanto.
    const ciclo = t % 6;
    a.bloques.forEach((blk, i) => {
      const visible = ciclo < 3 ? i <= Math.floor(ciclo * 2) : true;
      blk.scale.setScalar(visible ? 1 : 0.001);
    });
    b.bloques.forEach((blk, i) => {
      const cayendo = ciclo > 4.2;
      const k = cayendo ? Math.min((ciclo - 4.2) * 1.4, 1) : 0;
      blk.position.y = -1.6 + i * 0.45 - (cayendo ? k * k * (i + 1) * 0.5 : 0);
      blk.rotation.z = cayendo ? k * (i % 2 ? 0.8 : -0.6) : 0;
      blk.scale.setScalar(ciclo < 1.2 && i > Math.floor(ciclo * 5) ? 0.001 : 1);
    });
    const subidos = Math.floor((t * 1.6) % 10);
    escalones.forEach((e, i) => { e.material.emissiveIntensity = i <= subidos ? 1.2 : 0.05; });
  };
  return grupo;
}

function armarImpostor() {
  const grupo = new THREE.Group();
  const geo = new THREE.PlaneGeometry(1.25, 1.75);
  const dorso = texturaCarta('?', 'SOY', ['#2b2f74', '#14173a']);
  const caras = [
    ['🍎', 'MANZANA', ['#2f6b4a', '#173a29']],
    ['🕵️', 'IMPOSTOR', ['#8a1f43', '#3a0c1d']],
    ['🍎', 'MANZANA', ['#2f6b4a', '#173a29']],
    ['🍎', 'MANZANA', ['#2f6b4a', '#173a29']]
  ];
  const cartas = caras.map(([cara, txt, fondo], i) => {
    const carta = new THREE.Group();
    const frente = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: texturaCarta(cara, txt, fondo), roughness: 0.45 }));
    const atras = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: dorso, roughness: 0.45 }));
    atras.rotation.y = Math.PI;
    carta.add(frente, atras);
    const ang = (i - 1.5) * 0.42;
    carta.position.set(Math.sin(ang) * 2.6, -0.1, Math.cos(ang) * 0.6 - 0.6);
    carta.rotation.y = -ang;
    grupo.add(carta);
    return { carta, base: -ang, i };
  });
  const foco = halo(COLORES.rosa, 3.2);
  foco.position.set(0, 0, -0.8);
  grupo.add(foco);

  grupo.userData.update = (t) => {
    // Las cartas se dan vuelta de a una; la del impostor tarda un poco más.
    cartas.forEach(({ carta, base, i }) => {
      const fase = ((t * 0.6 - i * 0.35) % 3 + 3) % 3;
      const giro = fase < 1 ? fase * Math.PI : fase < 2 ? Math.PI : Math.PI + (fase - 2) * Math.PI;
      carta.rotation.y = base + Math.PI + giro;
      carta.position.y = -0.1 + Math.sin(t * 1.5 + i) * 0.12;
    });
    foco.material.opacity = 0.6 + Math.sin(t * 3) * 0.3;
  };
  return grupo;
}

// Gran Premio: dos autitos chocadores dando vueltas que se golpean de a ratos.
function armarGranPremio() {
  const grupo = new THREE.Group();
  const pista = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.35, 10, 64), new THREE.MeshStandardMaterial({ color: 0x474c63, roughness: 0.8 }));
  pista.rotation.x = Math.PI / 2;
  pista.scale.set(1.35, 1, 1);
  pista.position.y = -1.2;
  grupo.add(pista);
  const auto = (color) => {
    const a = new THREE.Group();
    const cuerpo = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.28, 0.6), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.25, metalness: 0.4, roughness: 0.3 }));
    const goma = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.1, 8, 20), new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 }));
    goma.rotation.x = Math.PI / 2; goma.scale.set(1, 0.72, 1); goma.position.y = -0.08;
    const antena = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.7), new THREE.MeshBasicMaterial({ color: 0xdddddd }));
    antena.position.set(-0.3, 0.45, 0);
    a.add(cuerpo, goma, antena);
    grupo.add(a);
    return a;
  };
  const a = auto(COLORES.equipoA);
  const b = auto(COLORES.equipoB);
  const brillo = halo(COLORES.ambar, 2.2);
  brillo.position.y = -0.9;
  grupo.add(brillo, halo(COLORES.rojo, 4.5));
  // Inclinada hacia la cámara, para ver la pista desde arriba.
  grupo.rotation.x = 0.6;
  grupo.scale.setScalar(0.78);
  [a, b].forEach((x) => x.scale.setScalar(1.5));
  const lugar = (obj, ang, extra) => {
    obj.position.set(Math.cos(ang) * 2.97, -0.95 + extra, Math.sin(ang) * 2.2);
    obj.rotation.y = -ang - Math.PI / 2;
  };
  grupo.userData.update = (t) => {
    const angA = t * 1.1;
    // B va un poco más rápido: lo alcanza, lo choca y rebota.
    const ciclo = (t % 5.7) / 5.7;
    const angB = angA - 0.9 + ciclo * 0.9 + Math.sin(ciclo * Math.PI) * 0.1;
    const choque = ciclo > 0.92 ? Math.sin((ciclo - 0.92) / 0.08 * Math.PI) : 0;
    lugar(a, angA, choque * 0.25);
    lugar(b, angB, 0);
    a.rotation.z = choque * 0.4;
    brillo.position.set(Math.cos(angA) * 2.97, -0.6, Math.sin(angA) * 2.2);
    brillo.material.opacity = choque;
  };
  return grupo;
}

// Noche de Casino: una ruleta girando con la bola dando vueltas al revés.
function armarCasino() {
  const grupo = new THREE.Group();
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  const orden = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
  const paso = (Math.PI * 2) / 37;
  orden.forEach((n, i) => {
    g.beginPath(); g.moveTo(256, 256); g.arc(256, 256, 250, i * paso - paso / 2, i * paso + paso / 2); g.closePath();
    g.fillStyle = n === 0 ? '#0f8a3c' : i % 2 ? '#c2182b' : '#141414'; g.fill();
    g.strokeStyle = '#d9b45a'; g.lineWidth = 2; g.stroke();
  });
  g.beginPath(); g.arc(256, 256, 150, 0, Math.PI * 2); g.fillStyle = '#6b3417'; g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const plato = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.12, 64), [
    new THREE.MeshStandardMaterial({ color: 0x5a2a12 }), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4 }), new THREE.MeshStandardMaterial({ color: 0x5a2a12 })
  ]);
  const aro = new THREE.Mesh(new THREE.TorusGeometry(1.75, 0.18, 12, 64), new THREE.MeshStandardMaterial({ color: 0x5a2a12, roughness: 0.4 }));
  aro.rotation.x = Math.PI / 2;
  const torreta = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.5, 24), new THREE.MeshStandardMaterial({ color: 0xd9b45a, metalness: 0.9, roughness: 0.2 }));
  torreta.position.y = 0.3;
  const bola = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 12), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x666666 }));
  const rueda = new THREE.Group();
  rueda.add(plato, torreta);
  grupo.add(rueda, aro, bola, halo(COLORES.ambar, 4.5));
  grupo.rotation.x = 0.75;
  grupo.position.y = -0.3;
  grupo.userData.update = (t) => {
    rueda.rotation.y = t * 0.8;
    const ciclo = (t % 6) / 6;
    const r = ciclo < 0.7 ? 1.55 : 1.55 - (ciclo - 0.7) * 1.2;
    const ang = -t * 3.2;
    bola.position.set(Math.cos(ang) * r, 0.12, Math.sin(ang) * r);
  };
  return grupo;
}

function armarGenerico() {
  const grupo = new THREE.Group();
  const signo = new THREE.Mesh(
    new THREE.TorusKnotGeometry(0.9, 0.28, 128, 16),
    new THREE.MeshStandardMaterial({ color: COLORES.violeta, emissive: COLORES.violeta, emissiveIntensity: 0.4, roughness: 0.2, metalness: 0.6 })
  );
  grupo.add(signo, halo(COLORES.violeta, 4));
  grupo.userData.update = (t) => { signo.rotation.set(t * 0.4, t * 0.6, 0); };
  return grupo;
}

const PIEZAS = {
  'el-rosco': armarRosco,
  'ahora-caigo': armarAhoraCaigo,
  varios: armarImpostor,
  'gran-premio': armarGranPremio,
  casino: armarCasino
};

// ---------- El estudio ----------

export function createStage(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x07081a, 9, 22);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 60);
  camera.position.set(0, 1.2, 9);

  scene.add(new THREE.HemisphereLight(0x8b9cff, 0x0b0b20, 0.6));
  const llave = new THREE.DirectionalLight(0xffffff, 1.2);
  llave.position.set(3, 5, 6);
  scene.add(llave);

  // Piso brillante con anillos de LED
  const piso = new THREE.Mesh(
    new THREE.CircleGeometry(8, 64),
    new THREE.MeshStandardMaterial({ color: 0x0c0e28, roughness: 0.25, metalness: 0.7 })
  );
  piso.rotation.x = -Math.PI / 2;
  piso.position.y = -2.2;
  scene.add(piso);
  const anillos = [2.6, 3.6, 4.8].map((r, i) => {
    const anillo = new THREE.Mesh(
      new THREE.RingGeometry(r, r + 0.05, 96),
      new THREE.MeshBasicMaterial({ color: [COLORES.ambar, COLORES.rosa, COLORES.cian][i], transparent: true, opacity: 0.7 })
    );
    anillo.rotation.x = -Math.PI / 2;
    anillo.position.y = -2.18;
    scene.add(anillo);
    return anillo;
  });

  // Paneles de luces al fondo (como la escenografía de un programa)
  const paneles = [];
  for (let i = 0; i < 15; i++) {
    const ang = (i / 14 - 0.5) * Math.PI * 0.95;
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 5.5, 0.1),
      new THREE.MeshBasicMaterial({ color: i % 2 ? COLORES.violeta : COLORES.cian, transparent: true, opacity: 0.4 })
    );
    panel.position.set(Math.sin(ang) * 8, 0.6, -Math.cos(ang) * 8 + 1);
    panel.lookAt(0, 0.6, 1);
    scene.add(panel);
    paneles.push(panel);
  }

  // Reflectores: luz real + un cono visible de "humo iluminado"
  const reflectores = [COLORES.ambar, COLORES.rosa, COLORES.cian].map((color, i) => {
    const luz = new THREE.SpotLight(color, 60, 20, 0.35, 0.6, 1.4);
    luz.position.set((i - 1) * 4, 6, 3);
    scene.add(luz, luz.target);
    const cono = new THREE.Mesh(
      new THREE.ConeGeometry(1.6, 9, 32, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    );
    cono.position.copy(luz.position);
    scene.add(cono);
    return { luz, cono, fase: i * 2.1 };
  });

  // Polvo / confeti flotando en la luz
  const cantidad = 220;
  const pos = new Float32Array(cantidad * 3);
  for (let i = 0; i < cantidad; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 14;
    pos[i * 3 + 1] = Math.random() * 7 - 2;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 8;
  }
  const geoPolvo = new THREE.BufferGeometry();
  geoPolvo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const polvo = new THREE.Points(geoPolvo, new THREE.PointsMaterial({
    color: 0xffe2b0, size: 0.05, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false
  }));
  scene.add(polvo);

  // Pieza central: entra creciendo y sale achicándose al cambiar de Programa.
  let pieza = null;
  let saliente = null;
  let cambio = 0;
  // Dónde va la pieza según la pantalla: en compu, a la derecha del texto;
  // en celu (vertical), arriba, para que el texto de abajo no la tape.
  const lugar = { x: 0, y: 0.3, escala: 1 };
  function setProgram(id) {
    if (saliente) { scene.remove(saliente); }
    saliente = pieza;
    pieza = (PIEZAS[id] || armarGenerico)();
    pieza.position.set(lugar.x, lugar.y, 0);
    pieza.scale.setScalar(0.001);
    scene.add(pieza);
    cambio = 0;
  }

  function resize() {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // En celu (vertical) se aleja un poco para que entre todo.
    const vertical = camera.aspect < 0.8;
    camera.position.z = vertical ? 12.5 : 9;
    lugar.x = camera.aspect > 1.3 ? 2.8 : 0;
    lugar.y = vertical ? 3.3 : 0.3;
    lugar.escala = vertical ? 0.62 : 1;
    if (pieza) pieza.position.set(lugar.x, lugar.y, 0);
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  let visible = true;
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0.05 });
  io.observe(canvas);

  const ARRIBA = new THREE.Vector3(0, 1, 0);
  const destino = new THREE.Vector3();
  const eje = new THREE.Vector3();

  const reloj = new THREE.Clock();
  let raf = 0;
  function frame() {
    raf = requestAnimationFrame(frame);
    if (!visible || document.hidden) return;
    const dt = Math.min(reloj.getDelta(), 0.05);
    const t = reloj.elapsedTime;

    camera.position.x = Math.sin(t * 0.15) * 0.8;
    camera.lookAt(lugar.x * 0.35, 0.2, 0);

    reflectores.forEach(({ luz, cono, fase }) => {
      const x = Math.sin(t * 0.5 + fase) * 3;
      const z = Math.cos(t * 0.37 + fase) * 1.5;
      luz.target.position.set(x, -2.2, z);
      // El cono apunta (con la punta) al reflector y la base cae en el piso.
      destino.set(x, -2.2, z);
      eje.copy(luz.position).sub(destino).normalize();
      cono.quaternion.setFromUnitVectors(ARRIBA, eje);
      cono.position.copy(luz.position).lerp(destino, 0.5);
    });
    paneles.forEach((p, i) => { p.material.opacity = 0.18 + 0.35 * (0.5 + 0.5 * Math.sin(t * 2 - i * 0.5)); });
    anillos.forEach((a, i) => { a.material.opacity = 0.35 + 0.35 * Math.sin(t * 1.5 + i); });
    polvo.rotation.y = t * 0.03;

    cambio = Math.min(cambio + dt * 1.8, 1);
    const ease = 1 - Math.pow(1 - cambio, 3);
    if (pieza) {
      pieza.scale.setScalar(Math.max(ease * lugar.escala, 0.001));
      pieza.userData.update(t);
    }
    if (saliente) {
      saliente.scale.setScalar(Math.max((1 - ease) * lugar.escala, 0.001));
      if (cambio >= 1) { scene.remove(saliente); saliente = null; }
    }
    renderer.render(scene, camera);
  }
  frame();

  return {
    setProgram,
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      renderer.dispose();
    }
  };
}
