// Juego "Casita Robada" — el clásico de cartas españolas (40 cartas).
// Se reparten cartas a cada jugador y se ponen 4 boca arriba en la mesa. En
// su turno, cada uno tira una carta de su mano:
//   - si hay cartas del MISMO NÚMERO en la mesa, las levanta y las pone en su
//     casita (pila boca arriba), con su carta arriba;
//   - si la carta de arriba de la casita de un rival es del mismo número, le
//     ROBA la casita entera;
//   - si no, la carta queda en la mesa.
// Cuando todos se quedan sin cartas se reparte de nuevo, hasta que se acaba
// el mazo. Gana la casita con más cartas.
//
// Con equipos, cada equipo comparte UNA casita y sus integrantes juegan
// alternados con los del otro equipo (A1, B1, A2, B2...). Cada uno ve solo su
// mano (privateView).

const { shuffle } = require('../contentLoader');
const { resolver } = require('../opciones');

const type = 'casita-robada';
const label = 'Casita Robada';
const estimateSecondsPerRound = 300;
const skipMemberGate = true; // el turno lo maneja el juego (orden alternado)

const PALOS = ['oros', 'copas', 'espadas', 'bastos'];
const NUMEROS = [1, 2, 3, 4, 5, 6, 7, 10, 11, 12];

const opciones = [
  { id: 'mano', label: 'Cartas por mano', valores: [[3, '3'], [4, '4']], porDificultad: { facil: 3, normal: 3, dificil: 4 } },
  { id: 'mesa', label: 'Cartas en la mesa al empezar', valores: [[2, '2'], [4, '4']], porDificultad: { facil: 4, normal: 4, dificil: 2 } }
];

function nuevoMazo() {
  const cartas = [];
  PALOS.forEach((palo) => NUMEROS.forEach((n) => cartas.push({ id: `${n}-${palo}`, n, palo })));
  return shuffle(cartas);
}

// Orden de turnos: alterna equipos (A1, B1, A2, B2, ...).
function armarOrden(rosters, entrantIds) {
  const listas = entrantIds.map((id) => (rosters[id] || []).map((p) => ({ id: p.id, name: p.name, entrant: id })));
  const max = Math.max(0, ...listas.map((l) => l.length));
  const orden = [];
  for (let i = 0; i < max; i++) listas.forEach((l) => { if (l[i]) orden.push(l[i]); });
  return orden;
}

function repartir(state) {
  for (let k = 0; k < state.cartasPorMano; k++) {
    state.orden.forEach((j) => {
      if (!state.mazo.length) return;
      (state.manos[j.id] = state.manos[j.id] || []).push(state.mazo.pop());
    });
  }
  state.repartos += 1;
}

function hayCartasEnManos(state) {
  return state.orden.some((j) => (state.manos[j.id] || []).length);
}

// Pasa el turno al siguiente que tenga cartas; si nadie tiene, reparte; si
// no queda mazo, termina.
function avanzar(state) {
  if (!hayCartasEnManos(state)) {
    if (!state.mazo.length) {
      state.finished = true;
      state.turnoDe = null;
      state.activeEntrant = null;
      return;
    }
    repartir(state);
    state.ultimo = { ...(state.ultimo || {}), reparto: true };
  }
  const n = state.orden.length;
  for (let paso = 1; paso <= n; paso++) {
    const j = state.orden[(state.turnoIndex + paso) % n];
    if ((state.manos[j.id] || []).length) {
      state.turnoIndex = (state.turnoIndex + paso) % n;
      state.turnoDe = j.id;
      state.activeEntrant = j.entrant;
      return;
    }
  }
}

function createRound({ entrantIds, rosters = {}, difficulty, opciones: elegidas }) {
  const o = resolver(opciones, elegidas, difficulty);
  const entrants = {};
  entrantIds.forEach((id) => { entrants[id] = { points: 0, secondsWon: 0 }; });
  const state = {
    gameType: type,
    cartasPorMano: o.mano,
    orden: armarOrden(rosters, entrantIds),
    mazo: nuevoMazo(),
    mesa: [],
    manos: {},
    casitas: Object.fromEntries(entrantIds.map((id) => [id, []])),
    robos: Object.fromEntries(entrantIds.map((id) => [id, 0])),
    repartos: 0,
    turnoIndex: -1,
    turnoDe: null,
    jugada: 0,
    ultimo: null,
    entrants,
    activeEntrant: null,
    lastFeedback: null,
    finished: entrantIds.length < 2
  };
  for (let i = 0; i < o.mesa; i++) state.mesa.push(state.mazo.pop());
  repartir(state);
  if (!state.finished) avanzar(state);
  return state;
}

function jugadorDe(state, playerId) {
  return state.orden.find((j) => j.id === playerId);
}

// payload: { carta: id, accion: 'mesa' | 'robar' | 'tirar', a?: entrantId }
function answer(state, entrantId, payload, playerId, isTestHost) {
  if (state.finished) return { error: 'Este juego ya terminó.' };
  const quien = isTestHost ? state.turnoDe : playerId;
  if (quien !== state.turnoDe) {
    const j = jugadorDe(state, state.turnoDe);
    return { error: `Le toca a ${j ? j.name : 'otro jugador'}.` };
  }
  const yo = jugadorDe(state, quien);
  const mano = state.manos[quien] || [];
  const p = payload || {};
  const idx = mano.findIndex((c) => c.id === p.carta);
  if (idx < 0) return { error: 'Esa carta no está en tu mano.' };
  const carta = mano[idx];
  const miCasita = state.casitas[yo.entrant];

  if (p.accion === 'robar') {
    const rival = state.casitas[p.a];
    if (!rival || p.a === yo.entrant || !rival.length) return { error: 'No hay casita para robar ahí.' };
    if (rival[rival.length - 1].n !== carta.n) return { error: `La casita de arriba no es un ${carta.n}.` };
    mano.splice(idx, 1);
    miCasita.push(...rival.splice(0), carta);
    state.robos[yo.entrant] += 1;
    state.ultimo = { tipo: 'robo', quien: yo.id, nombre: yo.name, entrant: yo.entrant, a: p.a, cantidad: miCasita.length - 1, carta };
    state.lastFeedback = { result: 'correct', entrantId: yo.entrant, robo: true };
  } else if (p.accion === 'mesa') {
    const iguales = state.mesa.filter((c) => c.n === carta.n);
    if (!iguales.length) return { error: `No hay ningún ${carta.n} en la mesa.` };
    mano.splice(idx, 1);
    state.mesa = state.mesa.filter((c) => c.n !== carta.n);
    miCasita.push(...iguales, carta);
    state.ultimo = { tipo: 'levanta', quien: yo.id, nombre: yo.name, entrant: yo.entrant, cantidad: iguales.length + 1, carta };
    state.lastFeedback = { result: 'correct', entrantId: yo.entrant };
  } else {
    mano.splice(idx, 1);
    state.mesa.push(carta);
    state.ultimo = { tipo: 'tira', quien: yo.id, nombre: yo.name, entrant: yo.entrant, carta };
    state.lastFeedback = null;
  }
  state.jugada += 1;
  state.ultimo.jugada = state.jugada;
  Object.entries(state.casitas).forEach(([id, c]) => { state.entrants[id].points = c.length; });
  avanzar(state);
  return {};
}

// Si se va alguien, sus cartas quedan en la mesa; si entra o vuelve alguien,
// se suma al orden y recibe cartas en el próximo reparto.
function onRosterChange(state, rosters) {
  if (state.finished) return;
  const ids = Object.keys(state.casitas);
  const nuevo = armarOrden(rosters, ids);
  const siguen = new Set(nuevo.map((j) => j.id));
  state.orden.forEach((j) => {
    if (!siguen.has(j.id) && (state.manos[j.id] || []).length) {
      state.mesa.push(...state.manos[j.id]);
      state.manos[j.id] = [];
    }
  });
  const turnoAntes = state.turnoDe;
  state.orden = nuevo;
  const i = nuevo.findIndex((j) => j.id === turnoAntes);
  if (i >= 0) {
    state.turnoIndex = i;
  } else {
    state.turnoIndex = Math.max(0, state.turnoIndex - 1) % Math.max(nuevo.length, 1);
    if (nuevo.length) avanzar(state);
    else state.finished = true;
  }
}

// Reloj para responder: si se le acaba el tiempo, tira su primera carta a la mesa.
function turnoEnEspera(state) {
  return !state.finished && !!state.turnoDe;
}

function alVencerTurno(state) {
  if (!turnoEnEspera(state)) return;
  const mano = state.manos[state.turnoDe] || [];
  if (mano.length) answer(state, state.activeEntrant, { carta: mano[0].id, accion: 'tirar' }, state.turnoDe, false);
}

function scores(state) {
  return Object.fromEntries(Object.entries(state.casitas).map(([id, c]) => [id, c.length]));
}

function carryOver(state) {
  return Object.fromEntries(Object.keys(state.casitas).map((id) => [id, 0]));
}

function publicView(state) {
  return {
    type,
    label,
    // "Mano 2 de 4": cuántas veces se repartió, sobre las que alcanzan con este mazo.
    number: state.repartos,
    total: state.repartos + Math.ceil(state.mazo.length / Math.max(1, state.orden.length * state.cartasPorMano)),
    mesa: state.mesa,
    mazo: state.mazo.length,
    casitas: Object.fromEntries(Object.entries(state.casitas).map(([id, c]) => [id, { cantidad: c.length, arriba: c[c.length - 1] || null }])),
    robos: state.robos,
    jugadores: state.orden.map((j) => ({ id: j.id, name: j.name, entrant: j.entrant, cartas: (state.manos[j.id] || []).length })),
    turnoDe: state.turnoDe,
    activeEntrant: state.activeEntrant,
    ultimo: state.ultimo,
    jugada: state.jugada,
    entrants: Object.fromEntries(Object.entries(state.entrants).map(([id, e]) => [id, { points: e.points, secondsWon: 0 }])),
    lastFeedback: state.lastFeedback,
    finished: state.finished
  };
}

// Cada uno ve su propia mano; el anfitrión en modo prueba ve la del que juega.
function privateView(state, viewerId, isTestHost) {
  const id = isTestHost ? state.turnoDe : viewerId;
  return { mano: state.manos[id] || [], deQuien: id };
}

module.exports = {
  type, label, estimateSecondsPerRound, skipMemberGate, opciones,
  createRound, answer, onRosterChange, turnoEnEspera, alVencerTurno, scores, carryOver, publicView, privateView
};
