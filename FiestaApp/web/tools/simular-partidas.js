// Simulador de partidas: juega partidas completas contra el motor real
// (server/rooms.js) con jugadores "bots" que mandan respuestas correctas,
// incorrectas e invalidas al azar, en los 3 Programas y las 3 dificultades.
// En ~50% de las partidas desconecta a alguien a mitad de juego.
// Detecta excepciones, partidas trabadas (que nunca terminan) y puntajes raros.
//
// Uso: node tools/simular-partidas.js [partidas por programa y dificultad]
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rooms = require(path.join(ROOT, 'server/rooms.js'));
const banco = require(path.join(ROOT, 'programs/el-rosco/content/tutifruti/palabras.json')).categorias;

const R = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[R(a.length)];
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function candidates(room, sockets) {
  const st = room.roundState;
  const t = st.gameType;
  const host = room.hostId;
  const out = [];
  const sub = (s, v) => out.push(['submit', s, v]);
  const jud = (v) => out.push(['judge', host, v]);
  const teamOf = (s) => room.players.find((p) => p.id === s)?.team;
  for (const s of sockets) {
    switch (t) {
      case 'rosco-por-turnos': {
        const e = st.entrants[st.activeEntrant];
        if (e && e.position >= 0 && Math.random() < 0.6) sub(s, st.solutions[e.position]);
        sub(s, R(4)); out.push(['pasa', s]); break;
      }
      case 'eligi-una': case 'la-silla': case 'palabras-cruzadas': case 'escalera-final': case 'duelo-torres':
        sub(s, R(4));
        if (t === 'escalera-final' && Math.random() < 0.05) sub(s, { plantarse: true });
        if (t === 'duelo-torres' && st.currentQuestion && Math.random() < 0.5) sub(s, st.currentQuestion.correctIndex);
        if (t === 'palabras-cruzadas') { const e = st.entrants[teamOf(s)]; const c = e && e.crosses[e.index]; if (c) sub(s, c.correctIndex); }
        if (t === 'eligi-una') { const q = (st.questionsByTeam[st.activeEntrant] || [])[st.step]; if (q) sub(s, q.correctIndex); }
        break;
      case 'donde-estaba':
        sub(s, R(9)); if (st.asks[st.index]) sub(s, st.asks[st.index].cell); break;
      case 'sopa-de-letras': {
        const e = st.entrants[teamOf(s)];
        const w = e && e.words.find((x) => !x.found);
        if (w) sub(s, { from: w.cells[0], to: w.cells[w.cells.length - 1] });
        sub(s, { from: R(49), to: R(49) }); break;
      }
      case 'tutifruti': {
        const ans = {};
        for (const c of st.categorias) {
          const opts = (banco[c] || []).filter((w) => norm(w)[0] === norm(st.letter));
          ans[c] = Math.random() < 0.7 && opts.length ? pick(opts) : (Math.random() < 0.5 ? st.letter + 'zzz' : '');
        }
        sub(s, { answers: ans });
        break;
      }
      case 'mimica': case 'palabra-prohibida': {
        const word = t === 'mimica' ? st.currentWord : st.currentCard && st.currentCard.word;
        if (word) sub(s, { guess: Math.random() < 0.5 ? word : 'nada' });
        sub(s, { pasar: true }); break;
      }
      case 'la-cadena': {
        const q = (st.questionsByTeam[st.activeEntrant] || [])[st.step];
        const e = st.entrants[st.activeEntrant];
        if (q && e) sub(s, { recitar: Math.random() < 0.6 ? [...e.chain, q.options[q.correctIndex]].join(' ') : 'eh no se' });
        break;
      }
      case 'adivina-la-cancion':
        sub(s, { intento: true }); break;
      case 'impostor': {
        const c = st.caso;
        if (!c) break;
        if (c.phase === 'pistas') {
          // A veces los que saben la palabra intentan decirla: el servidor
          // tiene que rechazarlo. (El impostor no la sabe; si la "adivinara"
          // como pista, se acepta: rechazarla le confirmaria cual es.)
          const sabe = s !== c.impostorId;
          sub(s, { pista: sabe && Math.random() < 0.2 ? c.word : pick(['rojo', 'grande', 'casa', 'rapido', 'dulce']) });
        } else if (c.phase === 'votacion') {
          sub(s, { voto: pick(c.order).id });
        } else if (c.phase === 'robo') {
          sub(s, { robo: R(c.roboOptions.length) });
        }
        break;
      }
    }
  }
  if (t === 'tutifruti') st.pendingJudgements.filter((p) => p.decided === null).forEach((p) => jud({ entrantId: p.entrantId, category: p.category, accept: Math.random() < 0.5 }));
  if (t === 'mimica' || t === 'palabra-prohibida') { jud({ elegirModo: pick(['azar', 'rotativo']) }); if (Math.random() < 0.1) jud({ confirmarManual: true }); if (t === 'palabra-prohibida') jud({ falta: true }); }
  if (t === 'la-cadena' && Math.random() < 0.1) jud({ confirmarManual: true });
  if (t === 'impostor' && Math.random() < 0.05) jud(pick([{ saltarTurno: true }, { cerrarVotacion: true }, { siguienteCaso: true }]));
  if (t === 'adivina-la-cancion') { jud({ ok: Math.random() < 0.5 }); if (Math.random() < 0.1) jud({ skip: true }); }
  return out;
}

function play({ programId, difficulty, players = 4, disconnectAt = null, label }) {
  const ids = Array.from({ length: players }, (_, i) => `s${i}-${Math.random().toString(36).slice(2, 6)}`);
  const room = rooms.createRoom(ids[0], 'Host', programId, { difficulty });
  ids.slice(1).forEach((id, i) => rooms.joinRoom(room.code, id, 'P' + (i + 1)));
  const cfg = { programId, roundCount: pick([3, 6, 9]), teamsEnabled: true, difficulty, baseTimeSeconds: 90 };
  if (programId === 'varios') cfg.selectedGames = ['impostor', 'mimica', 'adivina-la-cancion', 'la-cadena', 'palabra-prohibida'];
  rooms.setConfig(room, ids[0], cfg);
  let r = rooms.startGame(room, ids[0]);
  if (r.error) return { label, error: 'start: ' + r.error };
  const errors = new Map();
  let sockets = [...ids];
  let steps = 0; let roundSteps = 0;
  const log = [];
  let reconnect = null;
  while (room.phase !== 'results') {
    if (++steps > 200000) return { label, stuck: 'global', log };
    if (room.phase === 'roundResult') {
      const sc = room.lastRoundPoints;
      for (const v of Object.values(sc || {})) if (typeof v !== 'number' || Number.isNaN(v)) log.push('NaN score in ' + room.roundState.gameType);
      for (const [k, v] of Object.entries(room.timeCarryOver)) if (typeof v !== 'number' || Number.isNaN(v) || v < 0) log.push(`bad carry ${k}=${v} after ${room.roundState.gameType}`);
      log.push(`${room.roundState.gameType}: ${JSON.stringify(sc)} carry=${JSON.stringify(room.timeCarryOver)} (${roundSteps} pasos)`);
      roundSteps = 0;
      rooms.continueGame(room, room.hostId);
      continue;
    }
    if (room.phase === 'results') break;
    if (++roundSteps > 20000) return { label, stuck: room.roundState.gameType, phase: room.roundState.phase, view: JSON.stringify(rooms.publicState(room).round).slice(0, 600), log };
    if (disconnectAt !== null && steps === disconnectAt) {
      // Mitad de las veces se le corta y vuelve al rato (celu bloqueado);
      // la otra mitad se va del todo (no vuelve dentro del tiempo de gracia).
      const victim = pick(sockets.slice(1).length ? sockets.slice(1) : sockets);
      if (Math.random() < 0.5) {
        rooms.setConnected(room, victim, false);
        sockets = sockets.filter((s) => s !== victim);
        reconnect = { id: victim, at: steps + 30 + R(300) };
        log.push(`SE CORTA ${victim} durante ${room.roundState && room.roundState.gameType}`);
      } else {
        rooms.removePlayer(victim); sockets = sockets.filter((s) => s !== victim);
        log.push(`SE VA ${victim} durante ${room.roundState && room.roundState.gameType}`);
      }
      if (room.phase === 'results') break;
    }
    if (reconnect && steps === reconnect.at) {
      rooms.joinRoom(room.code, reconnect.id, 'Vuelve');
      sockets.push(reconnect.id);
      log.push(`VUELVE ${reconnect.id}`);
      reconnect = null;
    }
    try {
      if (Math.random() < 0.15) { rooms.tickRoom(room); continue; }
      const cands = candidates(room, sockets);
      if (!cands.length) { rooms.tickRoom(room); continue; }
      const [kind, s, v] = pick(cands);
      const res = kind === 'submit' ? rooms.submitAnswer(room, s, v)
        : kind === 'pasa' ? rooms.pasapalabra(room, s) : rooms.judgeWord(room, s, v);
      if (res.error) errors.set(res.error.replace(/Le toca a .*?\./, 'Le toca a X.'), (errors.get(res.error) || 0) + 1);
      rooms.publicState(room); // que no explote serializar
      // El Impostor: la palabra secreta nunca puede llegarle al celu del
      // impostor mientras se juega (ni escondida en el estado).
      const c = room.roundState && room.roundState.caso;
      if (room.roundState && room.roundState.gameType === 'impostor' && c && (c.phase === 'pistas' || c.phase === 'votacion')) {
        const visto = JSON.stringify(rooms.publicState(room, c.impostorId));
        if (visto.includes(`"${c.word}"`)) return { label, exception: `FUGA: el impostor recibe la palabra "${c.word}"`, game: 'impostor' };
        const otro = c.order.find((x) => x.id !== c.impostorId);
        if (otro && JSON.stringify(rooms.publicState(room, otro.id)).includes(`"impostorId":"${c.impostorId}"`)) {
          return { label, exception: 'FUGA: se sabe quien es el impostor antes de tiempo', game: 'impostor' };
        }
      }
    } catch (e) {
      return { label, exception: e.stack.split('\n').slice(0, 4).join(' | '), game: room.roundState && room.roundState.gameType };
    }
  }
  if (room.players.some((p) => !p.id.startsWith('s'))) log.push('jugador raro en la sala');
  return { label, ok: true, endedEarly: !!room.endedEarly, scores: room.scores, log };
}

const results = [];
const N = Number(process.argv[2] || 15);
for (const programId of ['el-rosco', 'ahora-caigo', 'varios']) {
  for (const difficulty of ['facil', 'normal', 'dificil']) {
    for (let i = 0; i < N; i++) {
      // Varios incluye El Impostor, que necesita al menos 3 personas.
      const players = programId === 'varios' ? pick([3, 4, 5, 7]) : pick([2, 3, 4, 5, 7]);
      const disconnectAt = Math.random() < 0.5 ? 50 + R(400) : null;
      results.push(play({ programId, difficulty, players, disconnectAt, label: `${programId}/${difficulty}/${players}j${disconnectAt ? '/desc@' + disconnectAt : ''}` }));
    }
  }
}
const bad = results.filter((r) => !r.ok);
console.log(`partidas: ${results.length}, ok: ${results.length - bad.length}, con problemas: ${bad.length}`
  + ` (terminadas antes por quedarse un equipo sin gente: ${results.filter((r) => r.endedEarly).length})`);
const byKind = {};
for (const b of bad) {
  const key = b.exception ? 'EXC ' + b.exception : b.stuck ? `TRABADA en ${b.stuck} (${b.phase || ''})` : b.error;
  (byKind[key] = byKind[key] || []).push(b);
}
for (const [k, v] of Object.entries(byKind)) {
  console.log(`\n### ${v.length}x ${k}`);
  console.log('  ej: ' + v.slice(0, 3).map((x) => x.label).join(', '));
  if (v[0].view) console.log('  vista: ' + v[0].view);
  if (v[0].log) console.log('  log: ' + v[0].log.slice(-4).join('\n       '));
}
const anomalies = results.flatMap((r) => (r.log || []).filter((l) => /NaN|bad carry/.test(l)));
if (anomalies.length) console.log('\nANOMALIAS:', [...new Set(anomalies)].slice(0, 10));
process.exit(bad.length ? 1 : 0);
