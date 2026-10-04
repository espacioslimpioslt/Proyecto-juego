// Juego "Autos Chocadores" — carrera por equipos en una pista ovalada, contra
// reloj. Cada uno maneja su auto inclinando el celu (giroscopio): levantarlo
// hasta 45° es acelerar a fondo, bajarlo hasta quedar plano es frenar, y
// ladearlo a la izquierda o a la derecha es doblar.
//
// - Los autos del MISMO equipo se atraviesan; los de equipos contrarios
//   chocan y se empujan. Un buen golpe hace trompear al rival.
// - Puntos por equipo (como en la F1 gana el equipo): cada vuelta suma
//   PUNTOS_VUELTA y cada golpe fuerte a un rival suma PUNTOS_GOLPE.
//
// La física de cada auto corre en SU celu (así se maneja sin demora) y el
// celu manda su posición ~10 veces por segundo; el servidor la valida y la
// reparte a todos (ver server.js: canal 'autos'). Cada celu resuelve los
// choques de su propio auto contra los demás; el que RECIBE el golpe lo
// avisa, así un golpe se cuenta una sola vez.

const { resolver } = require('../opciones');

const type = 'chocadores';
const label = 'Autos Chocadores';
const estimateSecondsPerRound = 200;
const simultaneous = true;
const skipMemberGate = true;

// Pista: un "estadio" (dos rectas y dos curvas). Los mismos números usa el
// cliente (public/fx/chocadores3d.js).
const PISTA = { largo: 60, radio: 28, ancho: 9 };
const PERIMETRO = 2 * PISTA.largo + 2 * Math.PI * PISTA.radio;
const VEL_MAX = 22;
const VUELTA_MINIMA_SEG = (PERIMETRO / (VEL_MAX * 1.6)) * 0.8;

const PUNTOS_VUELTA = 10;
const PUNTOS_GOLPE = 3;
const SEG_CALIBRAR = 45;
const SEG_LARGADA = 4;
const SEG_FIN = 7;

const opciones = [
  { id: 'duracion', label: 'Duración', valores: [[90, '1:30'], [120, '2:00'], [180, '3:00']], porDificultad: { facil: 90, normal: 120, dificil: 180 } },
  { id: 'obstaculos', label: 'Obstáculos', valores: [['pocos', 'Pocos'], ['normal', 'Normal'], ['muchos', 'Muchos']], porDificultad: { facil: 'pocos', normal: 'normal', dificil: 'muchos' } },
  { id: 'choques', label: 'Choques', valores: [['suaves', 'Suaves'], ['fuertes', 'Fuertes']], porDificultad: { facil: 'suaves', normal: 'fuertes', dificil: 'fuertes' } }
];

// Punto de la línea central de la pista a "s" metros de la largada.
function puntoEnPista(s) {
  const { largo: L, radio: R } = PISTA;
  const P = PERIMETRO;
  let d = ((s % P) + P) % P;
  // Arranca en la mitad de la recta de abajo (x=0, z=+R) yendo hacia +x.
  d += L / 2;
  if (d >= P) d -= P;
  if (d < L) return { x: -L / 2 + d, z: R, ang: 0 };
  d -= L;
  if (d < Math.PI * R) {
    const a = Math.PI / 2 - d / R;
    return { x: L / 2 + Math.cos(a) * R, z: Math.sin(a) * R, ang: -d / R };
  }
  d -= Math.PI * R;
  if (d < L) return { x: L / 2 - d, z: -R, ang: Math.PI };
  d -= L;
  const a = -Math.PI / 2 - d / R;
  return { x: -L / 2 + Math.cos(a) * R, z: Math.sin(a) * R, ang: Math.PI - d / R };
}

// Conos, manchas de aceite y turbos, en lugares al azar de la pista.
function obstaculos(nivel) {
  const cantidad = { pocos: [4, 2, 2], normal: [7, 3, 3], muchos: [11, 5, 4] }[nivel] || [7, 3, 3];
  const [nConos, nAceite, nTurbo] = cantidad;
  const usados = [];
  const lugar = () => {
    // Lejos de la largada (primeros 30 m) y separados entre sí.
    for (let intento = 0; intento < 40; intento++) {
      const s = 30 + Math.random() * (PERIMETRO - 50);
      if (usados.every((u) => Math.abs(u - s) > 12)) { usados.push(s); return s; }
    }
    return 30 + Math.random() * (PERIMETRO - 50);
  };
  // Corrido hacia un costado de la línea central (perpendicular al rumbo).
  const conCostado = (s, lado) => {
    const p = puntoEnPista(s);
    return { x: +(p.x - Math.sin(p.ang) * lado).toFixed(2), z: +(p.z + Math.cos(p.ang) * lado).toFixed(2) };
  };
  const lado = () => (Math.random() * 2 - 1) * (PISTA.ancho - 2.5);
  const conos = [];
  for (let i = 0; i < nConos; i++) {
    const s = lugar();
    const l = lado();
    conos.push(conCostado(s, l));
    if (Math.random() < 0.5) conos.push(conCostado(s + 1.5, Math.max(-(PISTA.ancho - 2.5), Math.min(PISTA.ancho - 2.5, l + (Math.random() < 0.5 ? 2 : -2)))));
  }
  const aceite = Array.from({ length: nAceite }, () => ({ ...conCostado(lugar(), lado()), r: 2.6 }));
  const turbo = Array.from({ length: nTurbo }, () => {
    const s = lugar();
    return { ...conCostado(s, lado() * 0.7), ang: +puntoEnPista(s).ang.toFixed(3) };
  });
  return { conos, aceite, turbo };
}

function createRound({ entrantIds, rosters = {}, difficulty, opciones: elegidas }) {
  const o = resolver(opciones, elegidas, difficulty);
  const entrants = {};
  entrantIds.forEach((id) => { entrants[id] = { points: 0, secondsWon: 0, vueltas: 0, golpes: 0 }; });
  // Grilla de largada intercalando equipos (A, B, A, B...).
  const listas = entrantIds.map((id) => (rosters[id] || []).map((p) => ({ id: p.id, name: p.name, entrant: id })));
  const max = Math.max(0, ...listas.map((l) => l.length));
  const pilotos = [];
  for (let i = 0; i < max; i++) listas.forEach((l) => { if (l[i]) pilotos.push({ ...l[i], name: l[i].name || 'Jugador' }); });
  pilotos.forEach((p, i) => { p.grilla = i; });
  return {
    gameType: type,
    duracion: o.duracion,
    choques: o.choques,
    obst: obstaculos(o.obstaculos),
    pilotos,
    autos: {}, // playerId -> { x, z, a, vx, vz, giro, t }
    vueltas: {}, // playerId -> vueltas
    ultimaVuelta: {}, // playerId -> ms de la última vuelta contada
    mejorVuelta: {}, // playerId -> segundos
    golpes: {}, // playerId -> golpes dados
    recibidos: {}, // playerId -> golpes recibidos
    ultimoGolpe: {}, // "atacante>victima" -> ms
    listos: {},
    fase: 'calibrar',
    segundos: SEG_CALIBRAR,
    serie: 1,
    eventos: [],
    entrants,
    activeEntrant: null,
    lastFeedback: null,
    finished: pilotos.length < 1
  };
}

function piloto(state, playerId) {
  return state.pilotos.find((p) => p.id === playerId);
}

function largar(state) {
  state.fase = 'largada';
  state.segundos = SEG_LARGADA;
  state.serie += 1;
}

function sumarPuntos(state) {
  Object.values(state.entrants).forEach((e) => { e.points = e.vueltas * PUNTOS_VUELTA + e.golpes * PUNTOS_GOLPE; });
}

// payload: { listo: true } en la calibración.
function answer(state, entrantId, payload, playerId, isTestHost) {
  if (state.finished) return { error: 'Este juego ya terminó.' };
  const p = payload || {};
  if (p.listo && state.fase === 'calibrar') {
    const quien = isTestHost ? (state.pilotos.find((x) => !state.listos[x.id] && x.id === playerId) || state.pilotos.find((x) => !state.listos[x.id])) : piloto(state, playerId);
    if (!quien) return { error: 'No estás en esta carrera (entraste a mitad del juego).' };
    state.listos[quien.id] = true;
    const faltan = state.pilotos.filter((x) => !state.listos[x.id] && !String(x.id).startsWith('test:'));
    if (!faltan.length) largar(state);
    return {};
  }
  return { error: 'Ahora no hay nada para elegir.' };
}

// Anfitrión: largar sin esperar a todos, o pasar del podio al resultado.
function judge(state, payload) {
  if (state.finished) return { error: 'Este juego ya terminó.' };
  if (payload && payload.largar && state.fase === 'calibrar') { largar(state); return {}; }
  if (payload && payload.siguiente && state.fase === 'fin') { state.finished = true; return {}; }
  return { error: 'Acción no reconocida.' };
}

function tick(state) {
  if (state.finished) return;
  state.segundos -= 1;
  if (state.segundos > 0) return;
  if (state.fase === 'calibrar') largar(state);
  else if (state.fase === 'largada') {
    state.fase = 'carrera';
    state.segundos = state.duracion;
    state.inicioCarrera = Date.now();
  } else if (state.fase === 'carrera') {
    state.fase = 'fin';
    state.segundos = SEG_FIN;
    state.serie += 1;
  } else {
    state.finished = true;
  }
}

const LIMITE = PISTA.largo / 2 + PISTA.radio + PISTA.ancho + 6;
const num = (v, max) => (Number.isFinite(v) && Math.abs(v) <= max ? v : null);

// Posición que manda cada celu (~10 por segundo). Se valida lo grueso: que
// esté dentro del estadio, que no vaya más rápido que el turbo y que no
// cuente vueltas imposibles.
function estado(state, playerId, d) {
  if (state.finished || (state.fase !== 'largada' && state.fase !== 'carrera')) return;
  const p = piloto(state, playerId);
  if (!p || !Array.isArray(d)) return;
  const [x, z, a, vx, vz, vueltas, giro] = d;
  if (num(x, LIMITE) === null || num(z, LIMITE) === null || num(a, 1000) === null) return;
  const vel = Math.hypot(Number(vx) || 0, Number(vz) || 0);
  if (!Number.isFinite(vel) || vel > VEL_MAX * 1.8) return;
  state.autos[playerId] = {
    x: +x.toFixed(2), z: +z.toFixed(2), a: +(a % (Math.PI * 2)).toFixed(3),
    vx: +(+vx).toFixed(2), vz: +(+vz).toFixed(2), giro: giro ? 1 : 0, t: Date.now()
  };
  if (state.fase !== 'carrera') return;
  const v = Math.floor(Number(vueltas) || 0);
  const antes = state.vueltas[playerId] || 0;
  if (v === antes + 1) {
    const ahora = Date.now();
    const desde = state.ultimaVuelta[playerId] || state.inicioCarrera || ahora;
    const seg = (ahora - desde) / 1000;
    if (seg >= VUELTA_MINIMA_SEG) {
      state.vueltas[playerId] = v;
      state.ultimaVuelta[playerId] = ahora;
      if (!state.mejorVuelta[playerId] || seg < state.mejorVuelta[playerId]) state.mejorVuelta[playerId] = +seg.toFixed(2);
      state.entrants[p.entrant].vueltas += 1;
      sumarPuntos(state);
      state.eventos.push({ tipo: 'vuelta', id: playerId, n: v, t: ahora });
    }
  }
}

// El celu del que RECIBIÓ el golpe avisa quién se lo dio. Se cuenta solo si
// son de equipos distintos, estaban cerca y no se repite enseguida.
function golpe(state, victimaId, atacanteId) {
  if (state.finished || state.fase !== 'carrera') return false;
  const v = piloto(state, victimaId);
  const a = piloto(state, atacanteId);
  if (!v || !a || v.entrant === a.entrant) return false;
  const pv = state.autos[victimaId];
  const pa = state.autos[atacanteId];
  if (!pv || !pa || Math.hypot(pv.x - pa.x, pv.z - pa.z) > 8) return false;
  const clave = `${atacanteId}>${victimaId}`;
  const ahora = Date.now();
  if (state.ultimoGolpe[clave] && ahora - state.ultimoGolpe[clave] < 1500) return false;
  state.ultimoGolpe[clave] = ahora;
  state.golpes[atacanteId] = (state.golpes[atacanteId] || 0) + 1;
  state.recibidos[victimaId] = (state.recibidos[victimaId] || 0) + 1;
  state.entrants[a.entrant].golpes += 1;
  sumarPuntos(state);
  state.eventos.push({ tipo: 'golpe', id: atacanteId, a: victimaId, t: ahora });
  return true;
}

// Lo que viaja ~10 veces por segundo a todos: posiciones y puntos.
function posiciones(state) {
  const ahora = Date.now();
  state.eventos = state.eventos.filter((e) => ahora - e.t < 3000);
  return {
    fase: state.fase,
    autos: Object.entries(state.autos).map(([id, c]) => [id, c.x, c.z, c.a, c.vx, c.vz, c.giro]),
    puntos: Object.fromEntries(Object.entries(state.entrants).map(([id, e]) => [id, e.points])),
    vueltas: state.vueltas,
    eventos: state.eventos
  };
}

function onRosterChange(state, rosters) {
  // Si alguien vuelve (se le cortó justo al armar la carrera) o se suma a un
  // equipo, entra a correr con el próximo lugar de la grilla.
  Object.entries(rosters).forEach(([entrant, lista]) => {
    if (!state.entrants[entrant]) return;
    lista.forEach((p) => {
      if (state.pilotos.some((x) => x.id === p.id)) return;
      state.pilotos.push({ id: p.id, name: p.name || 'Jugador', entrant, grilla: state.pilotos.length });
    });
  });
  // Si alguien se va, su auto deja de estar en la pista.
  const siguen = new Set(Object.values(rosters).flat().map((p) => p.id));
  Object.keys(state.autos).forEach((id) => { if (!siguen.has(id)) delete state.autos[id]; });
  if (state.fase === 'calibrar' && !state.pilotos.some((x) => siguen.has(x.id) && !state.listos[x.id] && !String(x.id).startsWith('test:'))) largar(state);
}

function scores(state) {
  return Object.fromEntries(Object.entries(state.entrants).map(([id, e]) => [id, e.points]));
}

function carryOver(state) {
  return Object.fromEntries(Object.keys(state.entrants).map((id) => [id, 0]));
}

function publicView(state) {
  return {
    type,
    label,
    number: 1,
    total: 1,
    fase: state.fase,
    segundos: Math.max(state.segundos, 0),
    duracion: state.duracion,
    serie: state.serie,
    choques: state.choques,
    pista: PISTA,
    velMax: VEL_MAX,
    obst: state.obst,
    pilotos: state.pilotos.map((p) => ({
      ...p,
      listo: !!state.listos[p.id],
      vueltas: state.vueltas[p.id] || 0,
      golpes: state.golpes[p.id] || 0,
      recibidos: state.recibidos[p.id] || 0,
      mejorVuelta: state.mejorVuelta[p.id] || null
    })),
    activeEntrant: null,
    entrants: Object.fromEntries(Object.entries(state.entrants).map(([id, e]) => [id, { points: e.points, secondsWon: 0, vueltas: e.vueltas, golpes: e.golpes }])),
    puntosVuelta: PUNTOS_VUELTA,
    puntosGolpe: PUNTOS_GOLPE,
    lastFeedback: state.lastFeedback,
    finished: state.finished
  };
}

module.exports = {
  type, label, estimateSecondsPerRound, simultaneous, skipMemberGate, opciones,
  createRound, answer, judge, tick, onRosterChange, scores, carryOver, publicView,
  estado, golpe, posiciones,
  _pista: { PISTA, PERIMETRO, puntoEnPista, VUELTA_MINIMA_SEG }
};
