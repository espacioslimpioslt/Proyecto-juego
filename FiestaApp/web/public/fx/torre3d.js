// La Torre en 3D: la torre de bloques de cada equipo, el bloque que va y
// viene, los pedazos que se cortan y caen, y el destello del "¡perfecto!".
//
// El servidor manda la torre ya calculada (posición y tamaño de cada bloque);
// acá solo se dibuja y se anima. El bloque que se mueve se anima en cada
// celu con la velocidad que manda el servidor, y el que suelta manda dónde
// estaba en el momento del toque.
//
// Hecho con Three.js (public/vendor), sin texturas ni modelos: anda en celus
// de gama media.

import * as THREE from '../vendor/three.module.min.js';

const H = 2; // alto de cada bloque

// Posición del bloque que va y viene: arranca en -rango y rebota en los bordes.
export function posicionMovil(segundos, velocidad, rango) {
  const p = (segundos * velocidad) % (4 * rango);
  return p < 2 * rango ? -rango + p : 3 * rango - p;
}

function colorBloque(n, hueEquipo) {
  const c = new THREE.Color();
  c.setHSL(((hueEquipo + n * 9) % 360) / 360, 0.72, 0.58);
  return c;
}

export function crearTorre(contenedor, { onSoltar } = {}) {
  const canvas = document.createElement('canvas');
  canvas.className = 'torre-canvas';
  contenedor.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camara = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 400);
  scene.add(new THREE.HemisphereLight(0xcfd8ff, 0x1a1030, 1.1));
  const sol = new THREE.DirectionalLight(0xffffff, 1.6);
  sol.position.set(12, 30, 8);
  scene.add(sol);

  // Piso: un disco brillante debajo de la torre, como un escenario.
  const piso = new THREE.Mesh(
    new THREE.CylinderGeometry(16, 16, 0.6, 48),
    new THREE.MeshStandardMaterial({ color: 0x1b1f4a, metalness: 0.3, roughness: 0.4 })
  );
  piso.position.y = -H * 6;
  scene.add(piso);
  const aro = new THREE.Mesh(
    new THREE.TorusGeometry(16, 0.18, 8, 64),
    new THREE.MeshBasicMaterial({ color: 0x3de6ff })
  );
  aro.rotation.x = Math.PI / 2;
  aro.position.y = -H * 6 + 0.3;
  scene.add(aro);

  const geoCubo = new THREE.BoxGeometry(1, 1, 1);
  let bloques = []; // meshes de la torre
  let torreId = null;
  let movil = null; // { mesh, desde, datos }
  let movilSerie = null;
  let esperando = false; // ya tocó y espera la respuesta del servidor
  let caidos = []; // pedazos cayendo
  let destellos = [];
  let ultimoCaido = null;
  let hue = 200;
  let alturaCamara = 0;
  let zoom = 1;
  let fase = 'apilar';
  let giro = 0;
  let puedeSoltar = false;
  let vivo = true;
  let reloj = performance.now();

  function material(color) {
    return new THREE.MeshStandardMaterial({ color, metalness: 0.15, roughness: 0.45 });
  }

  function mallaBloque(b, n) {
    const m = new THREE.Mesh(geoCubo, material(colorBloque(n, hue)));
    if (n === 0) {
      // La base es un pedestal alto, para que la torre "nazca" de algo.
      m.scale.set(b.w, H * 6, b.d);
      m.position.set(b.x, -H * 2.5, b.z);
      m.material.color.set(0x2a2f66);
    } else {
      m.scale.set(b.w, H, b.d);
      m.position.set(b.x, n * H, b.z);
    }
    return m;
  }

  function limpiarTorre() {
    bloques.forEach((m) => { scene.remove(m); m.material.dispose(); });
    bloques = [];
    if (movil) { scene.remove(movil.mesh); movil.mesh.material.dispose(); movil = null; }
    movilSerie = null;
  }

  function destello(b, n) {
    const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(b.w, 0.05, b.d));
    const linea = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true }));
    linea.position.set(b.x, n * H + H / 2, b.z);
    scene.add(linea);
    destellos.push({ obj: linea, vida: 0 });
  }

  function soltarCaido(c) {
    const m = new THREE.Mesh(geoCubo, material(colorBloque(c.n, hue)));
    m.scale.set(c.w, H, c.d);
    m.position.set(c.x, c.n * H, c.z);
    scene.add(m);
    caidos.push({
      mesh: m,
      vy: 0,
      giro: new THREE.Vector3((Math.random() - 0.5) * 3, 0, (Math.random() - 0.5) * 3),
      vida: 0
    });
  }

  function tamCanvas() {
    const ancho = contenedor.clientWidth || 320;
    const alto = Math.round(Math.min(Math.max(ancho * 1.05, 300), 480));
    renderer.setSize(ancho, alto, false);
    canvas.style.width = '100%';
    canvas.style.height = `${alto}px`;
    return ancho / alto;
  }
  let aspecto = tamCanvas();
  const alCambiarTam = () => { aspecto = tamCanvas(); };
  window.addEventListener('resize', alCambiarTam);

  function posicionActual() {
    if (!movil) return null;
    const seg = (performance.now() - movil.desde) / 1000;
    return posicionMovil(seg, movil.datos.velocidad, movil.datos.rango);
  }

  function tocar(e) {
    if (!puedeSoltar || esperando || !movil || fase !== 'apilar') return;
    e.preventDefault();
    esperando = true;
    const pos = posicionActual();
    movil.congelado = pos;
    if (onSoltar) onSoltar(pos);
  }
  contenedor.addEventListener('pointerdown', tocar);

  // Lo llama app.js con cada actualización del servidor.
  function actualizar(round, opts = {}) {
    puedeSoltar = !!opts.puedeSoltar;
    fase = round.fase;
    const nuevoHue = opts.hue !== undefined ? opts.hue : hue;
    const id = `${round.number}|${opts.clave || ''}`;
    if (id !== torreId || (round.bloques || []).length < bloques.length) {
      hue = nuevoHue;
      limpiarTorre();
      torreId = id;
      giro = 0;
    }

    // Bloques nuevos (con una pequeña caída al apoyarse).
    (round.bloques || []).forEach((b, n) => {
      if (bloques[n]) return;
      const m = mallaBloque(b, n);
      if (n > 0 && bloques.length) m.userData.bajar = 0.6;
      scene.add(m);
      bloques[n] = m;
      if (b.perfecto) destello(b, n);
    });

    // Pedazo que se cortó (o el bloque entero si cayó afuera).
    if (round.caido && round.serie !== ultimoCaido) {
      ultimoCaido = round.serie;
      soltarCaido(round.caido);
    }

    // El bloque que va y viene.
    const datos = round.movil;
    if (!datos || fase !== 'apilar') {
      if (movil) { scene.remove(movil.mesh); movil.mesh.material.dispose(); movil = null; }
      movilSerie = null;
      esperando = false;
    } else if (datos.serie !== movilSerie) {
      if (movil) { scene.remove(movil.mesh); movil.mesh.material.dispose(); }
      const arriba = round.bloques[round.bloques.length - 1];
      const mesh = new THREE.Mesh(geoCubo, material(colorBloque(datos.n, hue)));
      mesh.scale.set(arriba.w, H, arriba.d);
      mesh.position.set(arriba.x, datos.n * H, arriba.z);
      scene.add(mesh);
      movil = { mesh, desde: performance.now(), datos, arriba, congelado: null };
      movilSerie = datos.serie;
      esperando = false;
    }
  }

  function cuadro(ahora) {
    if (!vivo) return;
    requestAnimationFrame(cuadro);
    const dt = Math.min((ahora - reloj) / 1000, 0.05);
    reloj = ahora;
    if (document.hidden) return;

    if (movil) {
      const pos = movil.congelado !== null ? movil.congelado : posicionActual();
      movil.mesh.position[movil.datos.eje] = pos;
    }
    bloques.forEach((m) => {
      if (m.userData.bajar > 0) {
        m.userData.bajar = Math.max(m.userData.bajar - dt * 4, 0);
        m.position.y = bloques.indexOf(m) * H + m.userData.bajar;
      }
    });
    caidos = caidos.filter((c) => {
      c.vida += dt;
      c.vy -= 40 * dt;
      c.mesh.position.y += c.vy * dt;
      c.mesh.rotation.x += c.giro.x * dt;
      c.mesh.rotation.z += c.giro.z * dt;
      if (c.vida > 2) { scene.remove(c.mesh); c.mesh.material.dispose(); return false; }
      return true;
    });
    destellos = destellos.filter((d) => {
      d.vida += dt;
      const s = 1 + d.vida * 1.6;
      d.obj.scale.set(s, 1, s);
      d.obj.material.opacity = Math.max(1 - d.vida * 1.4, 0);
      if (d.vida > 0.75) { scene.remove(d.obj); d.obj.geometry.dispose(); d.obj.material.dispose(); return false; }
      return true;
    });

    // Cámara: sigue la punta de la torre; al terminar, se aleja y gira para
    // mostrarla entera.
    const altura = Math.max(bloques.length - 1, 0) * H;
    const fin = fase === 'fin';
    const objetivoY = fin ? altura / 2 - H * 2 : altura;
    alturaCamara += (objetivoY - alturaCamara) * Math.min(dt * 3, 1);
    const objetivoZoom = fin ? Math.max(1, (altura + H * 10) / 34) : 1;
    zoom += (objetivoZoom - zoom) * Math.min(dt * 2, 1);
    if (fin) giro += dt * 0.5;
    const radio = 40;
    const ang = Math.PI / 4 + giro;
    camara.position.set(Math.cos(ang) * radio, alturaCamara + 28, Math.sin(ang) * radio);
    camara.lookAt(0, alturaCamara, 0);
    const media = 17 * zoom;
    camara.left = -media * aspecto;
    camara.right = media * aspecto;
    camara.top = media;
    camara.bottom = -media;
    camara.updateProjectionMatrix();
    aro.material.color.setHSL(((hue + ahora / 40) % 360) / 360, 0.9, 0.6);

    renderer.render(scene, camara);
  }
  requestAnimationFrame(cuadro);

  function destruir() {
    vivo = false;
    window.removeEventListener('resize', alCambiarTam);
    contenedor.removeEventListener('pointerdown', tocar);
    limpiarTorre();
    caidos.forEach((c) => scene.remove(c.mesh));
    renderer.dispose();
    canvas.remove();
  }

  return { actualizar, destruir, posicionActual };
}
