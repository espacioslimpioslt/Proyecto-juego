// Juego "Caja Fuerte" — inspirado en los programas de "¿trato o no trato?":
// hay cajas cerradas con premios (en puntos) escondidos. Cada equipo, en su
// turno, se queda con una caja sin abrirla y después va abriendo las demás de
// a tandas; al final de cada tanda la Banca le ofrece puntos por SU caja. El
// equipo decide: TRATO (se lleva la oferta y termina) o NO TRATO (sigue
// abriendo). Si llega al final sin aceptar, se lleva lo que tenía su caja.
//
// No hay preguntas ni árbitro: es pura tensión y decisión en grupo, así que
// juegan igual chicos y grandes. Decide el integrante de turno del equipo
// (el resto opina en voz alta), y cada equipo juega su propio tablero.

const { shuffle } = require('../contentLoader');
const { resolver } = require('../opciones');

const type = 'caja-fuerte';
const label = 'Caja Fuerte';
const estimateSecondsPerRound = 240;
const skipMemberGate = false;

const SEG_FINAL = 9;

// Premios posibles (puntos), de menor a mayor. Se usan los primeros N según la
// cantidad de cajas elegida, siempre con el más alto incluido.
const PREMIOS = [0, 1, 1, 2, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30];

// Ajustes que el anfitrión puede elegir en la sala (ver server/opciones.js).
// Si no elige, cada uno sale de la dificultad.
const opciones = [
  { id: 'cajas', label: 'Cajas', valores: [[10, '10'], [13, '13'], [16, '16']], porDificultad: { facil: 10, normal: 13, dificil: 16 } },
  { id: 'banca', label: 'La Banca es...', valores: [['generosa', 'Generosa'], ['justa', 'Justa'], ['tacana', 'Tacaña']], porDificultad: { facil: 'generosa', normal: 'justa', dificil: 'tacana' } }
];

// Cuántas cajas se abren en cada tanda antes de cada oferta.
function tandas(totalCajas) {
  const resto = totalCajas - 1; // sin contar la propia
  const plan = totalCajas >= 16 ? [5, 4, 3, 2, 1] : totalCajas >= 13 ? [4, 3, 2, 1, 1] : [3, 2, 2, 1];
  const out = [];
  let quedan = resto;
  for (const n of plan) {
    if (quedan <= 1) break;
    const k = Math.min(n, quedan - 1);
    out.push(k);
    quedan -= k;
  }
  while (quedan > 1) { out.push(1); quedan -= 1; }
  return out;
}

const GENEROSIDAD = { generosa: [0.75, 0.85, 0.95, 1.05, 1.1], justa: [0.55, 0.7, 0.82, 0.92, 1], tacana: [0.4, 0.52, 0.65, 0.78, 0.88] };

function nuevoTablero(n) {
  const premios = [...PREMIOS.slice(0, n - 1), PREMIOS[PREMIOS.length - 1]];
  return shuffle(premios).map((valor, i) => ({ n: i + 1, valor, abierta: false }));
}

function empezarTurno(state) {
  const team = state.order[state.turnoIndex];
  state.activeEntrant = team;
  state.cajas = nuevoTablero(state.totalCajas);
  state.miCaja = null;
  state.plan = tandas(state.totalCajas);
  state.tanda = 0;
  state.abiertasEnTanda = 0;
  state.oferta = null;
  state.ofertas = [];
  state.fase = 'elegir';
  state.resultado = null;
}

function sinAbrir(state) {
  return state.cajas.filter((c) => !c.abierta && c.n !== state.miCaja);
}

function calcularOferta(state) {
  const quedan = state.cajas.filter((c) => !c.abierta); // incluye la propia
  const promedio = quedan.reduce((a, c) => a + c.valor, 0) / quedan.length;
  const tabla = GENEROSIDAD[state.banca] || GENEROSIDAD.justa;
  const factor = tabla[Math.min(state.tanda, tabla.length - 1)];
  return Math.max(1, Math.round(promedio * factor));
}

function terminarTurno(state, puntos, como) {
  state.entrants[state.activeEntrant].points += puntos;
  state.resultado = {
    puntos,
    como, // 'trato' | 'su-caja'
    valorSuCaja: state.cajas.find((c) => c.n === state.miCaja).valor,
    oferta: state.oferta
  };
  state.fase = 'final';
  state.segundosFinal = SEG_FINAL;
  const mejor = como === 'trato' ? puntos >= state.resultado.valorSuCaja : true;
  state.lastFeedback = { result: mejor ? 'correct' : 'wrong', entrantId: state.activeEntrant, puntos };
}

function siguienteTurno(state) {
  state.turnoIndex += 1;
  if (state.turnoIndex >= state.order.length) {
    state.finished = true;
    return;
  }
  empezarTurno(state);
}

function abrir(state, n) {
  const caja = state.cajas.find((c) => c.n === n);
  if (!caja || caja.abierta || caja.n === state.miCaja) return { error: 'Elegí una caja cerrada que no sea la tuya.' };
  caja.abierta = true;
  state.abiertasEnTanda += 1;
  state.lastFeedback = { result: caja.valor >= 15 ? 'wrong' : 'correct', entrantId: state.activeEntrant, abierta: n, valor: caja.valor };
  if (sinAbrir(state).length === 0) {
    // No quedan más: se lleva lo que tenía su caja.
    terminarTurno(state, state.cajas.find((c) => c.n === state.miCaja).valor, 'su-caja');
    return {};
  }
  if (state.abiertasEnTanda >= state.plan[state.tanda]) {
    state.oferta = calcularOferta(state);
    state.ofertas.push(state.oferta);
    state.fase = 'oferta';
  }
  return {};
}

function createRound({ entrantIds, difficulty, opciones: elegidas }) {
  const o = resolver(opciones, elegidas, difficulty);
  const entrants = {};
  entrantIds.forEach((id) => { entrants[id] = { points: 0, secondsWon: 0 }; });
  const state = {
    gameType: type,
    order: [...entrantIds],
    totalCajas: o.cajas,
    banca: o.banca,
    turnoIndex: 0,
    entrants,
    lastFeedback: null,
    finished: entrantIds.length < 1
  };
  if (!state.finished) empezarTurno(state);
  return state;
}

// payload: { caja: n } para elegir o abrir; { trato: true | false } en la oferta.
function answer(state, entrantId, payload) {
  if (state.finished) return { error: 'Este juego ya terminó.' };
  if (entrantId !== state.activeEntrant) return { error: 'No es el turno de tu equipo.' };
  const p = payload || {};

  if (state.fase === 'elegir') {
    const caja = state.cajas.find((c) => c.n === Number(p.caja));
    if (!caja) return { error: 'Elegí una caja.' };
    state.miCaja = caja.n;
    state.fase = 'abrir';
    state.lastFeedback = { result: 'elegida', entrantId, caja: caja.n };
    return {};
  }
  if (state.fase === 'abrir') return abrir(state, Number(p.caja));
  if (state.fase === 'oferta') {
    if (p.trato === true) {
      terminarTurno(state, state.oferta, 'trato');
      return {};
    }
    if (p.trato === false) {
      state.tanda += 1;
      state.abiertasEnTanda = 0;
      state.oferta = null;
      state.fase = 'abrir';
      state.lastFeedback = { result: 'no-trato', entrantId };
      return {};
    }
    return { error: '¿Trato o no trato?' };
  }
  return { error: 'Ahora no hay nada para elegir.' };
}

// Anfitrión: pasar al siguiente equipo sin esperar el reloj de la revelación.
function judge(state, payload) {
  if (state.finished) return { error: 'Este juego ya terminó.' };
  if (payload && payload.siguiente && state.fase === 'final') {
    siguienteTurno(state);
    return {};
  }
  return { error: 'Acción no reconocida.' };
}

function tick(state) {
  if (state.finished || state.fase !== 'final') return;
  state.segundosFinal -= 1;
  if (state.segundosFinal <= 0) siguienteTurno(state);
}

// Reloj para responder: si el equipo no decide, el juego elige por él (una
// caja al azar, o "no trato").
function turnoEnEspera(state) {
  return !state.finished && state.fase !== 'final';
}

function alVencerTurno(state) {
  if (!turnoEnEspera(state)) return;
  const team = state.activeEntrant;
  if (state.fase === 'elegir') answer(state, team, { caja: shuffle(state.cajas)[0].n });
  else if (state.fase === 'abrir') answer(state, team, { caja: shuffle(sinAbrir(state))[0].n });
  else if (state.fase === 'oferta') answer(state, team, { trato: false });
}

function scores(state) {
  return Object.fromEntries(Object.entries(state.entrants).map(([id, e]) => [id, e.points]));
}

function carryOver(state) {
  return Object.fromEntries(Object.entries(state.entrants).map(([id, e]) => [id, e.secondsWon]));
}

function publicView(state) {
  const revelar = state.fase === 'final' || state.finished;
  const valoresQuedan = (state.cajas || []).filter((c) => !c.abierta).map((c) => c.valor);
  return {
    type,
    label,
    number: Math.min(state.turnoIndex + 1, state.order.length),
    total: state.order.length,
    activeEntrant: state.activeEntrant,
    fase: state.fase,
    miCaja: state.miCaja,
    abrirEnTanda: state.fase === 'abrir' ? state.plan[state.tanda] - state.abiertasEnTanda : 0,
    // El valor de cada caja solo viaja cuando está abierta (la propia, al final).
    cajas: (state.cajas || []).map((c) => ({
      n: c.n,
      abierta: c.abierta,
      valor: c.abierta || (revelar && c.n === state.miCaja) ? c.valor : null
    })),
    // Tablero de premios: cuáles siguen en juego (sin decir en qué caja están).
    premios: [...(state.cajas || [])].map((c) => c.valor).sort((a, b) => a - b)
      .map((v, i, arr) => ({ v, enJuego: valoresQuedan.filter((x) => x === v).length > arr.slice(0, i).filter((x) => x === v).length })),
    oferta: state.oferta,
    ofertas: state.ofertas || [],
    resultado: state.resultado,
    segundosFinal: state.segundosFinal || 0,
    entrants: Object.fromEntries(Object.entries(state.entrants).map(([id, e]) => [id, { points: e.points, secondsWon: e.secondsWon }])),
    lastFeedback: state.lastFeedback,
    finished: state.finished
  };
}

module.exports = {
  type, label, estimateSecondsPerRound, skipMemberGate, opciones,
  createRound, answer, judge, tick, turnoEnEspera, alVencerTurno, scores, carryOver, publicView
};
