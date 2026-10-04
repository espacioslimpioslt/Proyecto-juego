// Ruleta europea en 3D: cilindro de madera, plato con los 37 casilleros en el
// orden real (0-32-15-19-4...), separadores metálicos, torreta dorada y la
// bola, que gira al revés que el plato, pierde velocidad, rebota y cae en el
// número que decidió el servidor. Al final la cámara se acerca al casillero.
//
// Hecha con Three.js y texturas dibujadas en un canvas (sin descargar nada).

import * as THREE from '../vendor/three.module.min.js';

export const ORDEN = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
export const ROJOS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const PASO = (Math.PI * 2) / 37;
const R_IN = 1.95; // radio interno de los casilleros
const R_OUT = 3.0; // radio externo de los casilleros
const R_BOLA_PISTA = 3.55; // la bola gira arriba, en la pista del cilindro
const R_BOLA_CASILLERO = 2.35;

function colorDe(n) {
  if (n === 0) return '#0f8a3c';
  return ROJOS.has(n) ? '#c2182b' : '#141414';
}

// Textura del plato: cuñas de colores con los números, dibujadas en polar.
function texturaPlato() {
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const cx = S / 2;
  const escala = (S / 2) / R_OUT;
  ORDEN.forEach((n, i) => {
    const a = i * PASO;
    g.beginPath();
    g.moveTo(cx + Math.cos(a - PASO / 2) * R_IN * escala, cx + Math.sin(a - PASO / 2) * R_IN * escala);
    g.arc(cx, cx, R_OUT * escala, a - PASO / 2, a + PASO / 2);
    g.arc(cx, cx, R_IN * escala, a + PASO / 2, a - PASO / 2, true);
    g.closePath();
    g.fillStyle = colorDe(n);
    g.fill();
    g.strokeStyle = '#d9b45a';
    g.lineWidth = 3;
    g.stroke();
    // Número en la parte de afuera del casillero, mirando al centro.
    g.save();
    g.translate(cx + Math.cos(a) * (R_OUT - 0.22) * escala, cx + Math.sin(a) * (R_OUT - 0.22) * escala);
    g.rotate(a + Math.PI / 2);
    g.fillStyle = '#fff';
    g.font = `800 ${Math.round(S * 0.034)}px Inter, system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(n), 0, 0);
    g.restore();
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function texturaPano() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 10, 128, 128, 180);
  grad.addColorStop(0, '#1f7a46');
  grad.addColorStop(1, '#0b3d22');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.04})`; g.fillRect(Math.random() * 256, Math.random() * 256, 1, 1); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function crearRuleta(contenedor) {
  const canvas = document.createElement('canvas');
  canvas.className = 'rl-canvas';
  contenedor.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x06140d);
  const camara = new THREE.PerspectiveCamera(45, 1, 0.05, 100);

  scene.add(new THREE.HemisphereLight(0xfff4e0, 0x0b2a18, 0.9));
  const foco = new THREE.SpotLight(0xfff1d6, 60, 30, 0.6, 0.5, 1.4);
  foco.position.set(2, 10, 3);
  scene.add(foco);
  const relleno = new THREE.PointLight(0xffd27a, 8, 14);
  relleno.position.set(-4, 4, -3);
  scene.add(relleno);

  // Paño verde de fondo
  const pano = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ map: texturaPano(), roughness: 1 }));
  pano.rotation.x = -Math.PI / 2;
  pano.position.y = -0.62;
  scene.add(pano);

  // Cilindro de madera (perfil girado): borde, pista de la bola y bajada al plato.
  const perfil = [
    [4.5, -0.6], [4.6, -0.2], [4.55, 0.35], [4.3, 0.45], [4.05, 0.42], [3.75, 0.3], [3.25, 0.12], [3.05, 0.05], [3.0, -0.05]
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const madera = new THREE.Mesh(new THREE.LatheGeometry(perfil, 96), new THREE.MeshStandardMaterial({ color: 0x5a2a12, roughness: 0.35, metalness: 0.15, side: THREE.DoubleSide }));
  scene.add(madera);
  const pista = new THREE.Mesh(new THREE.LatheGeometry([[4.06, 0.43], [3.75, 0.31], [3.3, 0.14]].map(([x, y]) => new THREE.Vector2(x, y)), 96), new THREE.MeshStandardMaterial({ color: 0xc9a46a, roughness: 0.25, metalness: 0.1, side: THREE.DoubleSide }));
  scene.add(pista);
  // Deflectores (los "diamantes" de la pista)
  for (let i = 0; i < 8; i++) {
    const d = new THREE.Mesh(new THREE.OctahedronGeometry(0.12), new THREE.MeshStandardMaterial({ color: 0xe8d18a, metalness: 0.9, roughness: 0.2 }));
    const a = (i / 8) * Math.PI * 2;
    d.position.set(Math.cos(a) * 3.6, 0.27, Math.sin(a) * 3.6);
    d.scale.set(1, 0.6, 2.2);
    d.rotation.y = -a;
    scene.add(d);
  }

  // Plato que gira
  const plato = new THREE.Group();
  scene.add(plato);
  const casilleros = new THREE.Mesh(new THREE.RingGeometry(R_IN, R_OUT, 148, 1), new THREE.MeshStandardMaterial({ map: texturaPlato(), roughness: 0.35, metalness: 0.1 }));
  casilleros.rotation.x = -Math.PI / 2;
  plato.add(casilleros);
  const oro = new THREE.MeshStandardMaterial({ color: 0xd9b45a, metalness: 0.95, roughness: 0.18 });
  for (let i = 0; i < 37; i++) {
    const a = i * PASO + PASO / 2;
    const sep = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.14, 0.035), oro);
    sep.position.set(Math.cos(a) * 2.45, 0.07, Math.sin(a) * 2.45);
    sep.rotation.y = -a;
    plato.add(sep);
  }
  const anillo = new THREE.Mesh(new THREE.TorusGeometry(R_OUT, 0.05, 8, 96), oro);
  anillo.rotation.x = Math.PI / 2;
  anillo.position.y = 0.04;
  plato.add(anillo);
  const centro = new THREE.Mesh(new THREE.CylinderGeometry(R_IN, R_IN + 0.05, 0.1, 64), new THREE.MeshStandardMaterial({ color: 0x4a220f, roughness: 0.4 }));
  centro.position.y = 0.0;
  plato.add(centro);
  const cono = new THREE.Mesh(new THREE.ConeGeometry(1.1, 0.7, 48), new THREE.MeshStandardMaterial({ color: 0x6b3417, roughness: 0.3, metalness: 0.2 }));
  cono.position.y = 0.4;
  plato.add(cono);
  const torreta = new THREE.Group();
  torreta.add(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 1.0, 24), oro));
  torreta.children[0].position.y = 0.9;
  const perilla = new THREE.Mesh(new THREE.SphereGeometry(0.16, 24, 16), oro);
  perilla.position.y = 1.45;
  torreta.add(perilla);
  for (let k = 0; k < 4; k++) {
    const brazo = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.4, 12), oro);
    brazo.rotation.z = Math.PI / 2;
    brazo.rotation.y = (k * Math.PI) / 4;
    brazo.position.y = 1.15;
    const punta = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 10), oro);
    punta.position.set(Math.cos((k * Math.PI) / 4) * 0.7, 1.15, -Math.sin((k * Math.PI) / 4) * 0.7);
    const punta2 = punta.clone();
    punta2.position.set(-punta.position.x, 1.15, -punta.position.z);
    torreta.add(brazo, punta, punta2);
  }
  plato.add(torreta);

  const bola = new THREE.Mesh(new THREE.SphereGeometry(0.11, 24, 16), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.15, metalness: 0.05 }));
  scene.add(bola);
  // Brillo debajo del casillero ganador
  const marca = new THREE.Mesh(new THREE.RingGeometry(0.0, 0.32, 24), new THREE.MeshBasicMaterial({ color: 0xffe18a, transparent: true, opacity: 0 }));
  marca.rotation.x = -Math.PI / 2;
  marca.position.y = 0.02;
  plato.add(marca);

  let rho = 0; // giro del plato
  let anim = null; // animación en curso
  let vivo = true;
  let reloj = performance.now();
  let distancia = 12; // se ajusta a la forma de la pantalla (ver tam)
  const DIR = new THREE.Vector3(0, 0.86, 0.51).normalize();
  let vista = { pos: DIR.clone().multiplyScalar(12), mira: new THREE.Vector3(0, 0, 0) };
  let tamCambio = true;
  const alCambiar = () => { tamCambio = true; };
  window.addEventListener('resize', alCambiar);

  function tam() {
    const w = contenedor.clientWidth || 360;
    const h = contenedor.clientHeight || 640;
    renderer.setSize(w, h, false);
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    camara.aspect = w / h;
    // Que entre la ruleta entera (unos 10,5 de ancho) en cualquier pantalla.
    camara.fov = w < h ? 50 : 42;
    camara.updateProjectionMatrix();
    const mitad = Math.tan((camara.fov * Math.PI) / 360);
    distancia = Math.max(10, 10.6 / (2 * mitad * Math.min(camara.aspect, 1.4)));
    if (!anim) vista.pos = DIR.clone().multiplyScalar(distancia);
  }

  function ubicarBola(ang, r, y) {
    bola.position.set(Math.cos(ang) * r, y, Math.sin(ang) * r);
  }
  ubicarBola(0.4, R_BOLA_PISTA, 0.38);

  // Gira y hace caer la bola en "numero". dur en ms.
  function girar(numero, dur = 7000, alTerminar) {
    const i = ORDEN.indexOf(numero);
    const T = dur / 1000;
    const Tl = T * 0.64; // momento en que la bola cae en el casillero
    const wr = 2.4; // velocidad inicial del plato (rad/s)
    const wb = 9.5; // velocidad inicial de la bola (al revés)
    const rho0 = rho;
    const rhoEn = (t) => rho0 + wr * (Math.min(t, T) - Math.min(t, T) ** 2 / (2 * T));
    const casilleroEn = (t) => i * PASO - rhoEn(t); // ángulo en el mundo
    const phiL = casilleroEn(Tl);
    const avance = wb * Tl * (1 - 0.375); // lo que gira la bola hasta caer
    const phi0 = phiL + avance;
    marca.position.set(Math.cos(i * PASO) * 2.45, 0.03, Math.sin(i * PASO) * 2.45);
    marca.material.opacity = 0;
    // El tiempo sale del reloj real: en un celu lento la bola cae igual a tiempo.
    anim = { inicio: performance.now(), t: 0, T, Tl, wb, phi0, rhoEn, casilleroEn, i, alTerminar, numero };
  }

  // Sin animación (por ejemplo, si alguien entra justo cuando ya salió el número).
  function mostrar(numero) {
    const i = ORDEN.indexOf(numero);
    anim = null;
    ubicarBola(i * PASO - rho, R_BOLA_CASILLERO, 0.12);
    marca.position.set(Math.cos(i * PASO) * 2.45, 0.03, Math.sin(i * PASO) * 2.45);
    marca.material.opacity = 0.85;
    const b = bola.position;
    vista = { pos: new THREE.Vector3(b.x * 1.75, 5.2, b.z * 1.75 + 0.01), mira: b.clone() };
  }

  function cuadro(ahora) {
    if (!vivo) return;
    requestAnimationFrame(cuadro);
    const dt = Math.min((ahora - reloj) / 1000, 0.05);
    reloj = ahora;
    if (document.hidden) return;
    if (tamCambio) { tam(); tamCambio = false; }

    if (anim) {
      const a = anim;
      a.t = (ahora - a.inicio) / 1000;
      const t = a.t;
      rho = a.rhoEn(t);
      if (t < a.Tl) {
        // Bola en la pista: frena de a poco y, en la última parte, baja girando.
        const phi = a.phi0 - (a.wb * t - (0.75 * a.wb) * t * t / (2 * a.Tl));
        const bajada = Math.max(0, (t - a.T * 0.45) / (a.Tl - a.T * 0.45));
        const r = R_BOLA_PISTA - (R_BOLA_PISTA - R_BOLA_CASILLERO) * bajada * bajada;
        const rebote = bajada > 0.55 ? Math.abs(Math.sin(bajada * 22)) * 0.16 * (1 - bajada) : 0;
        ubicarBola(phi, r, 0.38 - 0.26 * bajada + rebote);
      } else {
        // Ya en el casillero: unos rebotes chicos y queda.
        const k = t - a.Tl;
        const amort = Math.exp(-k * 3.2);
        const wobble = Math.sin(k * 18) * 0.09 * amort;
        ubicarBola(a.casilleroEn(t) + wobble, R_BOLA_CASILLERO, 0.12 + Math.abs(Math.sin(k * 14)) * 0.08 * amort);
        marca.material.opacity = Math.min(0.85, k * 1.2);
      }
      // Cámara: vista general y, al final, se acerca al casillero ganador.
      const acercar = Math.max(0, Math.min(1, (t - a.Tl * 0.95) / (a.T - a.Tl * 0.95)));
      const suave = acercar * acercar * (3 - 2 * acercar);
      const b = bola.position;
      const lejos = DIR.clone().multiplyScalar(distancia).add(new THREE.Vector3(Math.sin(t * 0.15) * 1.2, 0, 0));
      const cerca = new THREE.Vector3(b.x * 1.75, 5.2, b.z * 1.75 + 0.01);
      vista.pos.copy(lejos.lerp(cerca, suave));
      vista.mira.copy(new THREE.Vector3(0, 0, 0).lerp(b, suave));
      if (t >= a.T + 0.6) {
        const fin = a.alTerminar;
        anim = null;
        if (fin) fin(a.numero);
      }
    } else {
      rho += dt * 0.15; // girando despacito mientras se apuesta
    }
    plato.rotation.y = rho;
    camara.position.lerp(vista.pos, anim ? 1 : Math.min(1, dt * 2));
    camara.lookAt(vista.mira);
    renderer.render(scene, camara);
  }
  requestAnimationFrame(cuadro);

  return {
    girar,
    mostrar,
    destruir() {
      vivo = false;
      window.removeEventListener('resize', alCambiar);
      renderer.dispose();
      canvas.remove();
    }
  };
}
