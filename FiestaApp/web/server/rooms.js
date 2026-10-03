// Motor comun ("la cascara"): todo lo que cualquier Programa reutiliza igual --
// sala, codigo, jugadores/equipos, configuracion previa, avance de rondas y
// puntaje. No sabe nada de un Programa en particular; solo sabe llamar al tipo
// de ronda que le corresponda (ver server/roundTypes/).

const fs = require('fs');
const opcionesJuego = require('./opciones');
const path = require('path');

const roundTypes = {
  'rosco-por-turnos': require('./roundTypes/roscoPorTurnos'),
  'eligi-una': require('./roundTypes/eligiUna'),
  'la-silla': require('./roundTypes/laSilla'),
  'donde-estaba': require('./roundTypes/dondeEstaba'),
  'sopa-de-letras': require('./roundTypes/sopaDeLetras'),
  'palabras-cruzadas': require('./roundTypes/palabrasCruzadas'),
  'tutifruti': require('./roundTypes/tutifruti'),
  'la-cadena': require('./roundTypes/laCadena'),
  'adivina-la-cancion': require('./roundTypes/adivinaCancion'),
  mimica: require('./roundTypes/mimica'),
  'palabra-prohibida': require('./roundTypes/palabraProhibida'),
  'duelo-torres': require('./roundTypes/dueloTorres'),
  'escalera-final': require('./roundTypes/escaleraFinal'),
  impostor: require('./roundTypes/impostor')
};

// Catalogo de Programas: se arma solo escaneando `programs/*/manifest.json`.
// Sumar un Programa nuevo es agregar una carpeta bien formada ahi -- no hace
// falta tocar este archivo.
const PROGRAMS_DIR = path.join(__dirname, '..', 'programs');

function loadPrograms() {
  const result = {};
  if (!fs.existsSync(PROGRAMS_DIR)) return result;
  for (const folder of fs.readdirSync(PROGRAMS_DIR)) {
    const manifestPath = path.join(PROGRAMS_DIR, folder, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    result[manifest.id] = manifest;
  }
  return result;
}

const programs = loadPrograms();

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O ni 1/I, se confunden
// 6 caracteres: ~1.000 millones de combinaciones. Con 4 (~1 millon) y salas
// que se comparten por internet, se podian adivinar codigos probando al azar.
const LARGO_CODIGO = 6;

// Rival ficticio que aparece solo en modo prueba, para poder probar los turnos
// sin necesidad de que se sume otra persona.
const RIVAL_DE_PRUEBA = 'Rival de prueba';

const rooms = new Map(); // code -> room

function generateCode() {
  let code;
  do {
    code = Array.from({ length: LARGO_CODIGO }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

// Nombres: sin caracteres que sirvan para armar HTML (< > & " ' `), sin
// espacios de mas y con largo maximo. Es la primera barrera; el cliente
// ademas escapa todo lo que dibuja.
function limpiarNombre(name, fallback = 'Jugador') {
  return String(name || '').replace(/[<>&"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20) || fallback;
}

function makePlayer(playerId, name) {
  return {
    id: playerId,
    name: limpiarNombre(name),
    team: null,
    connected: true
  };
}

// Un icono simple por tipo de juego, para que el catalogo se vea mas a la
// pesca de un vistazo y no solo texto.
const ICONS = {
  'rosco-por-turnos': '🎡',
  'eligi-una': '🔤',
  'la-silla': '🪑',
  'donde-estaba': '🖼️',
  'sopa-de-letras': '🔍',
  'palabras-cruzadas': '✏️',
  tutifruti: '🍇',
  'la-cadena': '🔗',
  'adivina-la-cancion': '🎵',
  mimica: '🎭',
  'palabra-prohibida': '🤐',
  'duelo-torres': '🗼',
  'escalera-final': '🪜',
  impostor: '🕵️'
};

// El catalogo se muestra ANTES de crear una sala (pantalla de portada), asi que
// no depende de estar dentro de una sala para consultarlo.
function getCatalog() {
  return Object.values(programs).map((p) => ({
    id: p.id,
    name: p.name,
    tagline: p.tagline,
    description: p.description,
    minPlayers: p.minPlayers,
    maxPlayers: p.maxPlayers,
    games: p.games || [],
    gameLabels: [...(p.games || []), p.finalGame]
      .filter((g) => roundTypes[g])
      .map((g) => ({ label: roundTypes[g].label, icon: ICONS[g] || '🎮' }))
  }));
}

function createRoom(hostPlayerId, hostName, initialProgramId, prefs = {}) {
  const code = generateCode();
  const room = {
    code,
    hostId: hostPlayerId,
    phase: 'lobby', // lobby -> config -> playing -> roundResult -> results
    players: [makePlayer(hostPlayerId, hostName)],
    locked: false, // el anfitrion cierra la sala cuando ya estan todos
    banned: [], // playerIds expulsados: no pueden volver a esta sala
    programId: null,
    roundCount: null,
    estimatedSeconds: null,
    teamsEnabled: false,
    testMode: false, // permite jugar solo, controlando todos los equipos
    testNamesA: [], // nombres inventados para el Equipo A en modo prueba (opcional)
    testNamesB: [], // idem Equipo B
    selectedGames: [], // juegos tildados a mano por el anfitrion (Programas "pick", ej. Varios)
    baseTimeSeconds: 90, // tiempo por equipo cuando el juego se juega suelto
    region: 'global', // desde donde estan jugando, para elegir el contenido
    adultsOnly: false, // habilita mazos para mayores de 18
    difficulty: 'normal',
    formato: 'clasica',
    tiempoRespuesta: 30, // segundos para responder en juegos por turnos (0 = sin límite)
    gameOptions: {}, // ajustes elegidos por juego: { 'tutifruti': { letras: 5 }, ... }
    turnoSegundos: 0, // cuánto lleva esperando el turno actual
    usedDeckIds: [], // temas ya jugados en esta partida, para no repetir
    usedLetters: [], // letras ya sorteadas (ej. Tutifruti), para no repetir
    gameSequence: [], // que juego toca en cada ronda
    memberTurnIndex: {}, // a quien le toca dentro de cada equipo
    roundState: null, // estado del juego en curso (lo maneja el tipo de ronda)
    currentRoundIndex: -1,
    scores: {}, // entrantId -> puntos acumulados
    timeCarryOver: {}, // entrantId -> segundos que se arrastran al proximo juego
    lastRoundPoints: null // ultimo resultado, para mostrar en pantalla de ronda
  };
  rooms.set(code, room);
  // Si vino de la pantalla de catalogo (tocó una tarjeta), ya sabemos el
  // Programa -- se precarga con 6 rondas por defecto, ajustable en la sala.
  // Equipos van prendidos por defecto: en una juntada de 5-8 personas, que
  // juegue todo el grupo y no dos personas mientras el resto mira. La region
  // y "solo mayores" vienen de las preferencias guardadas en el celu del
  // anfitrion (menu lateral), asi no las tiene que tocar cada vez.
  if (initialProgramId && programs[initialProgramId]) {
    setConfig(room, hostPlayerId, {
      programId: initialProgramId,
      roundCount: 6,
      teamsEnabled: true,
      region: prefs.region,
      adultsOnly: prefs.adultsOnly,
      difficulty: prefs.difficulty,
      tiempoRespuesta: 30
    });
    // Arranca como "Clásica" si la dificultad guardada es la normal.
    room.formato = room.difficulty === 'normal' ? 'clasica' : 'personalizada';
  }
  return room;
}

function getRoom(code) {
  return rooms.get((code || '').toUpperCase());
}

// Se puede entrar mientras la sala sigue en la sala de espera. 'config' tambien
// cuenta: el anfitrion ya eligio Programa (viene de tocar una tarjeta en la
// portada) pero todavia no arranco la partida.
const JOINABLE_PHASES = ['lobby', 'config'];

function joinRoom(code, playerId, name) {
  const room = getRoom(code);
  if (!room) return { error: 'No existe una sala con ese codigo.' };
  // Ya estaba en la sala (por ejemplo, se le corto la conexion y vuelve a
  // entrar con el codigo): recupera su lugar, aunque la partida ya empezo.
  const existing = room.players.find((p) => p.id === playerId);
  if (existing) {
    setConnected(room, playerId, true);
    return { room };
  }
  if (room.banned.includes(playerId)) return { error: 'El anfitrión no te dejó volver a entrar a esta sala.' };
  if (room.locked) return { error: 'El anfitrión cerró la sala: ya no entra nadie más.' };
  if (!JOINABLE_PHASES.includes(room.phase)) return { error: 'Esa sala ya empezo a jugar.' };
  room.players.push(makePlayer(playerId, name));
  // Se reparte al toque para que cada uno vea su equipo en la sala de espera,
  // y no recien cuando arranca la partida.
  if (room.teamsEnabled) {
    if (tieneNombresDePrueba(room)) buildTestRoster(room);
    else assignTeamsAutomatically(room);
  }
  return { room };
}

function isHost(room, playerId) {
  return !!room && room.hostId === playerId;
}

function kickPlayer(room, hostPlayerId, playerId) {
  if (!isHost(room, hostPlayerId)) return { error: 'Solo el anfitrion puede sacar jugadores.' };
  if (playerId === room.hostId) return { error: 'El anfitrion no se puede sacar a si mismo.' };
  if (!room.players.some((p) => p.id === playerId)) return { error: 'Ese jugador ya no está en la sala.' };
  if (!String(playerId).startsWith('test:') && !room.banned.includes(playerId)) room.banned.push(playerId);
  dropPlayer(room, playerId);
  return { room };
}

function setLocked(room, hostPlayerId, locked) {
  if (!isHost(room, hostPlayerId)) return { error: 'Solo el anfitrion puede cerrar la sala.' };
  room.locked = !!locked;
  return { room };
}

// Un jugador se desconecto (o volvio). No se lo saca de la sala: queda
// marcado, el resto lo ve, y los turnos lo saltean mientras no este.
function setConnected(room, playerId, connected) {
  const player = room && room.players.find((p) => p.id === playerId);
  if (!player) return false;
  if (player.connected !== connected) {
    player.connected = connected;
    syncRosters(room);
  }
  return true;
}

function isRealPlayer(p) {
  return !String(p.id).startsWith('test:');
}

// Entrant = jugador o equipo, segun teamsEnabled. Es la unidad que puntua.
function entrantIds(room) {
  if (!room.teamsEnabled) {
    const ids = room.players.map((p) => p.id);
    // En modo prueba se agrega un rival ficticio para poder probar los turnos.
    if (room.testMode && ids.length < 2) return [...ids, RIVAL_DE_PRUEBA];
    return ids;
  }
  const teams = [...new Set(room.players.map((p) => p.team).filter(Boolean))];
  if (room.testMode && teams.length < 2) {
    if (!teams.includes('Equipo A')) teams.push('Equipo A');
    if (!teams.includes('Equipo B')) teams.push('Equipo B');
  }
  return teams;
}

function assignTeamsAutomatically(room) {
  room.players.forEach((p, i) => {
    p.team = i % 2 === 0 ? 'Equipo A' : 'Equipo B';
  });
}

// Modo prueba, version "de verdad": en vez de jugar solo con el anfitrion
// (que deja equipos vacios o de 1 sola persona, y hace que juegos como
// Mimica no se puedan probar bien), el anfitrion puede cargar nombres
// inventados para cada equipo antes de arrancar. Se crean como jugadores
// "falsos" (sin socket real -- el anfitrion los controla a todos, como
// siempre en modo prueba) para que la partida entera se vea y rote igual
// que con gente de verdad.
function tieneNombresDePrueba(room) {
  return room.testMode && ((room.testNamesA || []).length || (room.testNamesB || []).length);
}

function buildTestRoster(room) {
  const host = room.players.find((p) => p.id === room.hostId);
  // Los invitados reales que ya entraron se quedan (antes desaparecian de la
  // lista sin aviso); se reparten entre los dos equipos, como siempre.
  const invitados = room.players
    .filter((p) => p.id !== room.hostId && isRealPlayer(p))
    .map((p, i) => ({ ...p, team: i % 2 === 0 ? 'Equipo B' : 'Equipo A' }));
  const falsos = [];
  (room.testNamesA || []).forEach((name, i) => falsos.push({ id: `test:A:${i}`, name, team: 'Equipo A', connected: true }));
  (room.testNamesB || []).forEach((name, i) => falsos.push({ id: `test:B:${i}`, name, team: 'Equipo B', connected: true }));
  room.players = [...(host ? [{ ...host, team: 'Equipo A' }] : []), ...invitados, ...falsos];
}

const TIEMPOS_VALIDOS = [60, 90, 120, 180, 300]; // segundos por equipo

// Reloj para responder en los juegos por turnos (0 = sin límite). Lo usan
// los juegos que declaran alVencerTurno (ver eligiUna, laSilla, etc.).
const TIEMPOS_RESPUESTA = [0, 15, 20, 30, 45, 60];

// Formatos de un toque: llenan la configuración entera de una vez (y
// vuelven los ajustes de cada juego a los de su dificultad). Después el
// anfitrión puede retocar lo que quiera ("personalizada").
const FORMATOS = {
  rapida: { nombre: '⚡ Rápida', desc: '3 pruebas, ritmo ágil', roundCount: 3, difficulty: 'normal', baseTimeSeconds: 60, tiempoRespuesta: 20 },
  clasica: { nombre: '🎬 Clásica', desc: '6 pruebas, el programa completo', roundCount: 6, difficulty: 'normal', baseTimeSeconds: 90, tiempoRespuesta: 30 },
  maraton: { nombre: '🏃 Maratón', desc: '9 pruebas, la noche entera', roundCount: 9, difficulty: 'normal', baseTimeSeconds: 120, tiempoRespuesta: 30 },
  familia: { nombre: '👨‍👩‍👧 Familia con chicos', desc: 'Fácil y sin apuro', roundCount: 3, difficulty: 'facil', baseTimeSeconds: 120, tiempoRespuesta: 0, adultsOnly: false },
  desafio: { nombre: '🔥 Desafío', desc: 'Difícil y contrarreloj', roundCount: 6, difficulty: 'dificil', baseTimeSeconds: 60, tiempoRespuesta: 15 }
};

// Dificultad: filtra el contenido (preguntas mas o menos dificiles, donde ya
// hay mazos escritos para eso) y, en los juegos sin mazos por dificultad,
// ajusta el tiempo/tamaño del desafio -- ver DIFICULTAD_MECANICA en cada
// tipo de ronda que la usa.
const DIFICULTADES = [
  { id: 'facil', nombre: 'Fácil' },
  { id: 'normal', nombre: 'Normal' },
  { id: 'dificil', nombre: 'Difícil' }
];

// Paises con packs de contenido propios. 'global' = preguntas que sirven en
// cualquier lado. Sumar un pais es agregar mazos con esa region, nada mas.
const REGIONES = [
  { id: 'global', nombre: 'Sin país en particular' },
  { id: 'ar', nombre: 'Argentina' },
  { id: 'uy', nombre: 'Uruguay' },
  { id: 'cl', nombre: 'Chile' },
  { id: 'pe', nombre: 'Perú' }
];

// Limpia lo que carga el anfitrion en los campos de nombres de prueba: recorta
// espacios, saca vacios, y limita la cantidad para no permitir listas eternas.
function sanitizeTestNames(list) {
  return (Array.isArray(list) ? list : [])
    .map((n) => limpiarNombre(n, ''))
    .filter(Boolean)
    .slice(0, 10);
}

// Limpia la lista de juegos que tildo el anfitrion en un Programa "pick"
// (Varios): solo los que de verdad existen en ese Programa.
function sanitizeSelectedGames(program, selectedGames) {
  const validos = new Set(program.games || []);
  return (Array.isArray(selectedGames) ? selectedGames : []).filter((g) => validos.has(g));
}

// Los ajustes que vienen del celu se quedan solo si existen en el juego.
function sanitizeGameOptions(program, gameOptions) {
  const out = {};
  [...(program.games || []), program.finalGame].filter((g) => roundTypes[g]).forEach((g) => {
    const limpias = opcionesJuego.limpiar(roundTypes[g].opciones, (gameOptions || {})[g]);
    if (Object.keys(limpias).length) out[g] = limpias;
  });
  return out;
}

function setConfig(room, hostPlayerId, config) {
  let {
    roundCount, baseTimeSeconds, difficulty, adultsOnly, tiempoRespuesta, gameOptions
  } = config;
  const {
    programId, teamsEnabled, testMode, region, testNamesA, testNamesB, selectedGames, formato
  } = config;
  // Un formato de un toque pisa esos campos y limpia los ajustes por juego.
  const preset = FORMATOS[formato];
  if (preset) {
    ({ roundCount, baseTimeSeconds, difficulty, tiempoRespuesta } = preset);
    if (preset.adultsOnly !== undefined) adultsOnly = preset.adultsOnly;
    gameOptions = {};
  }
  if (!isHost(room, hostPlayerId)) return { error: 'Solo el anfitrion puede configurar la partida.' };
  const program = programs[programId];
  if (!program) return { error: 'Ese Programa no existe.' };
  const count = [3, 6, 9].includes(roundCount) ? roundCount : 3;
  const esPick = program.sequenceMode === 'pick';

  room.programId = programId;
  room.roundCount = count;
  room.selectedGames = esPick ? sanitizeSelectedGames(program, selectedGames) : [];
  room.teamsEnabled = !!teamsEnabled;
  room.testMode = !!testMode;
  room.baseTimeSeconds = TIEMPOS_VALIDOS.includes(baseTimeSeconds) ? baseTimeSeconds : 90;
  room.region = REGIONES.some((r) => r.id === region) ? region : 'global';
  room.adultsOnly = !!adultsOnly;
  room.difficulty = DIFICULTADES.some((d) => d.id === difficulty) ? difficulty : 'normal';
  room.testNamesA = sanitizeTestNames(testNamesA);
  room.testNamesB = sanitizeTestNames(testNamesB);
  room.formato = preset ? formato : 'personalizada';
  room.tiempoRespuesta = TIEMPOS_RESPUESTA.includes(Number(tiempoRespuesta)) ? Number(tiempoRespuesta) : 0;
  room.gameOptions = sanitizeGameOptions(program, gameOptions);

  if (esPick) {
    // Sin rosco final que gaste tiempo: la duracion estimada es solo la
    // suma de los juegos que el anfitrion tildo hasta ahora.
    room.estimatedSeconds = Math.round(room.selectedGames
      .map((g) => roundTypes[g])
      .filter(Boolean)
      .reduce((a, t) => a + t.estimateSecondsPerRound, 0));
  } else {
    // Duracion estimada: el promedio de los juegos del pool, mas el rosco final.
    const poolTypes = (program.games || []).map((g) => roundTypes[g]).filter(Boolean);
    const finalType = roundTypes[program.finalGame];
    const promedioPool = poolTypes.length
      ? poolTypes.reduce((a, t) => a + t.estimateSecondsPerRound, 0) / poolTypes.length
      : 90;
    room.estimatedSeconds = Math.round((count - 1) * promedioPool + (finalType ? finalType.estimateSecondsPerRound : 0));
  }
  if (room.teamsEnabled) {
    if (tieneNombresDePrueba(room)) buildTestRoster(room);
    else assignTeamsAutomatically(room);
  } else {
    room.players.forEach((p) => { p.team = null; });
  }
  room.phase = 'config';
  return { room };
}

function roundTypeOf(room) {
  return room.roundState ? roundTypes[room.roundState.gameType] : null;
}

// Arma la secuencia de juegos de la partida: se sortean juegos del pool del
// Programa (sin repetir) y SIEMPRE se cierra con el juego final, igual que en el
// programa real, donde todo lo ganado antes se gasta en el rosco.
function buildGameSequence(program, roundCount) {
  const pool = (program.games || []).filter((g) => roundTypes[g]);
  const cantidadPrevios = Math.max(roundCount - 1, 0);
  const secuencia = [];
  let disponibles = [];
  for (let i = 0; i < cantidadPrevios; i++) {
    if (!disponibles.length) disponibles = [...pool].sort(() => Math.random() - 0.5);
    secuencia.push(disponibles.pop());
  }
  if (program.finalGame && roundTypes[program.finalGame]) secuencia.push(program.finalGame);
  return secuencia.filter(Boolean);
}

// La nomina real de gente detras de cada entrant -- la mayoria de los juegos
// no la necesitan (les alcanza con "de quien es el turno", que ya resuelve
// currentMemberOf), pero los que eligen a una persona puntual (ej. quien
// actua en Mimica) necesitan saber quienes son todos los del equipo.
function rostersOf(room) {
  const ids = entrantIds(room);
  if (!room.teamsEnabled) {
    return Object.fromEntries(ids.map((id) => {
      const p = room.players.find((pl) => pl.id === id);
      return [id, p ? [{ id: p.id, name: p.name }] : []];
    }));
  }
  return Object.fromEntries(ids.map((id) => {
    const members = room.players.filter((p) => p.team === id);
    // Para elegir quien actua/duela se usa solo a los que estan conectados;
    // si justo no hay ninguno, se deja a todos (pueden estar volviendo).
    const online = members.filter((p) => p.connected !== false);
    return [id, (online.length ? online : members).map((p) => ({ id: p.id, name: p.name }))];
  }));
}

// Avisa al juego en curso que cambio quien esta disponible en cada equipo
// (alguien se desconecto, volvio o se fue), para que no espere para siempre
// a una persona que ya no esta -- ej. el duelista del Duelo de Torres.
function syncRosters(room) {
  if (room.phase !== 'playing' || !room.roundState) return;
  const roundType = roundTypeOf(room);
  if (roundType && roundType.onRosterChange) roundType.onRosterChange(room.roundState, rostersOf(room));
  if (room.roundState.finished) finishRound(room);
}

// Arranca un juego del pool. Le pasa el tiempo acumulado de juegos anteriores
// (mecanica central del programa real) y los temas ya usados, para no repetir.
function beginRound(room) {
  const gameType = room.gameSequence[room.currentRoundIndex];
  const roundType = roundTypes[gameType];
  room.roundState = roundType.createRound({
    entrantIds: entrantIds(room),
    rosters: rostersOf(room),
    carryOver: room.timeCarryOver,
    baseTimeSeconds: room.baseTimeSeconds,
    usedDeckIds: room.usedDeckIds,
    usedLetters: room.usedLetters,
    region: room.region,
    adultsOnly: room.adultsOnly,
    difficulty: room.difficulty,
    opciones: (room.gameOptions || {})[gameType] || {}
  });
  room.roundState.gameType = gameType;
  room.turnoSegundos = 0;
  if (room.roundState.deckId) room.usedDeckIds.push(room.roundState.deckId);
  if (room.roundState.letter) room.usedLetters.push(room.roundState.letter);
  // Cada juego arranca rotando desde el primer integrante de cada equipo.
  room.memberTurnIndex = {};
  room.phase = 'playing';
  // Un juego puede nacer ya terminado (ej. no hay contenido, o quedo un solo
  // equipo): si no se cierra aca, nadie lo cierra y la partida se traba.
  if (room.roundState.finished) finishRound(room);
}

// A quien le toca contestar dentro de un equipo. Rota en cada letra para que
// participen todos y no conteste siempre el mas rapido.
function currentMemberOf(room, entrantId) {
  if (!room.teamsEnabled) return null;
  const members = room.players.filter((p) => p.team === entrantId);
  if (!members.length) return null;
  const idx = (room.memberTurnIndex[entrantId] || 0) % members.length;
  // Si al que le toca se le corto la conexion, contesta el siguiente que
  // este conectado -- el equipo no se queda esperando.
  for (let step = 0; step < members.length; step++) {
    const m = members[(idx + step) % members.length];
    if (m.connected !== false) return m;
  }
  return members[idx];
}

function advanceMemberTurn(room, entrantId) {
  room.memberTurnIndex[entrantId] = (room.memberTurnIndex[entrantId] || 0) + 1;
}

function startGame(room, hostPlayerId) {
  if (!isHost(room, hostPlayerId)) return { error: 'Solo el anfitrion puede arrancar.' };
  if (!room.programId) return { error: 'Todavia no se eligio Programa y cantidad de rondas.' };

  // Se reasignan aca y no solo en setConfig, porque puede haberse sumado gente
  // a la sala despues de que el anfitrion activo el modo equipos.
  if (room.teamsEnabled) {
    if (tieneNombresDePrueba(room)) buildTestRoster(room);
    else assignTeamsAutomatically(room);
  }

  // Con un solo participante no hay a quien pasarle el turno: el rosco se
  // vuelve raro (pasapalabra no pasa a nadie). Mejor avisar antes de arrancar.
  if (entrantIds(room).length < 2) {
    return {
      error: room.teamsEnabled
        ? 'Hacen falta al menos 2 jugadores para armar dos equipos.'
        : 'Hacen falta al menos 2 jugadores para jugar por turnos.'
    };
  }

  const program = programs[room.programId];
  if (program.sequenceMode === 'pick') {
    // Varios: se juega exactamente lo que el anfitrion tildo a mano, en ese
    // orden -- nada de sorteo ni de prueba final obligatoria.
    room.gameSequence = (room.selectedGames || []).filter((g) => roundTypes[g] && (program.games || []).includes(g));
    if (!room.gameSequence.length) return { error: 'Elegí al menos un juego para jugar.' };
  } else {
    room.gameSequence = buildGameSequence(program, room.roundCount);
    if (!room.gameSequence.length) return { error: 'Ese Programa no tiene juegos configurados.' };
  }

  // Juegos que necesitan un minimo de personas (ej. El Impostor: con 2 no
  // hay a quien sospechar). Se avisa antes de arrancar, no a mitad.
  const cantidad = room.players.length;
  const faltan = room.gameSequence.map((g) => roundTypes[g]).find((t) => t.minJugadores && cantidad < t.minJugadores);
  if (faltan) return { error: `${faltan.label} necesita al menos ${faltan.minJugadores} jugadores.` };

  room.currentRoundIndex = 0;
  room.endedEarly = false;
  room.scores = {};
  room.timeCarryOver = {};
  room.usedDeckIds = [];
  room.usedLetters = [];
  entrantIds(room).forEach((id) => { room.scores[id] = 0; });
  beginRound(room);
  return { room };
}

function entrantOf(room, playerId, payload) {
  const player = room.players.find((p) => p.id === playerId);
  if (!player) return null;
  // En modo prueba el anfitrion juega por todos los equipos, asi puede probar
  // la partida entera sin esperar a nadie.
  if (room.testMode && isHost(room, playerId) && room.roundState) {
    const roundType = roundTypeOf(room);
    if (roundType && roundType.simultaneous) {
      // Juegos simultaneos (ej. Tutifruti) no tienen "de quien es el turno" --
      // todos escriben a la vez. El cliente le avisa al servidor por que
      // equipo esta completando en este momento; sin esa pista, se elige el
      // primer equipo que todavia no mando nada.
      const hinted = payload && payload.asEntrant;
      if (hinted && room.roundState.entrants[hinted]) return hinted;
      const pending = Object.entries(room.roundState.entrants).find(([, e]) => !e.submitted);
      return pending ? pending[0] : Object.keys(room.roundState.entrants)[0];
    }
    return room.roundState.activeEntrant;
  }
  return room.teamsEnabled ? player.team : player.id;
}

// Chequea que quien manda la accion sea el integrante al que le toca dentro del
// equipo. El anfitrion en modo prueba juega por todos, asi que se lo saltea.
function checkMemberTurn(room, playerId, entrantId) {
  if (room.testMode && isHost(room, playerId)) return null;
  const member = currentMemberOf(room, entrantId);
  if (member && member.id !== playerId) {
    return `Le toca a ${member.name}. Pueden ayudarlo en voz alta, pero contesta desde su celu.`;
  }
  return null;
}

function submitAnswer(room, playerId, payload) {
  if (room.phase !== 'playing') return { error: 'No hay un juego activo ahora mismo.' };
  const entrantId = entrantOf(room, playerId, payload);
  if (!entrantId) return { error: 'No estas en esta sala.' };
  const roundType = roundTypeOf(room);
  // Casi todos los juegos exigen que conteste "el de turno" dentro del
  // equipo (checkMemberTurn). Algunos (ej. Mimica: cualquiera puede
  // adivinar, no solo un representante rotativo) declaran skipMemberGate y
  // resuelven ellos mismos, con el playerId, quien puede actuar.
  if (!roundType.skipMemberGate) {
    const turnError = checkMemberTurn(room, playerId, entrantId);
    if (turnError) return { error: turnError };
  }
  // En modo prueba el anfitrion controla a todos los jugadores inventados;
  // algunos juegos (ej. Mimica) chequean el playerId puntual de quien actua,
  // y necesitan saber que este socket "vale por cualquiera" en ese caso.
  const isTestHost = room.testMode && isHost(room, playerId);
  const result = roundType.answer(room.roundState, entrantId, payload, playerId, isTestHost);
  if (result.error) return { error: result.error };
  advanceMemberTurn(room, entrantId);
  // Algunos juegos (ej. duelos donde dos equipos actuan en el mismo momento,
  // como Adivina la Cancion) necesitan rotar tambien a OTRO equipo ademas del
  // que hizo esta accion -- lo piden devolviendo advanceAlso con sus ids.
  (result.advanceAlso || []).forEach((id) => advanceMemberTurn(room, id));
  room.turnoSegundos = 0;
  if (room.roundState.finished) finishRound(room);
  return { room };
}

function pasapalabra(room, playerId) {
  if (room.phase !== 'playing') return { error: 'No hay un juego activo ahora mismo.' };
  const entrantId = entrantOf(room, playerId);
  if (!entrantId) return { error: 'No estas en esta sala.' };
  const turnError = checkMemberTurn(room, playerId, entrantId);
  if (turnError) return { error: turnError };
  const roundType = roundTypeOf(room);
  if (!roundType.pasapalabra) return { error: 'Este juego no tiene pasapalabra.' };
  const { error } = roundType.pasapalabra(room.roundState, entrantId);
  if (error) return { error };
  advanceMemberTurn(room, entrantId);
  room.turnoSegundos = 0;
  if (room.roundState.finished) finishRound(room);
  return { room };
}

// El anfitrion acepta o rechaza una palabra que no estaba en el banco (Tutifruti).
// Representa lo que el grupo discutio en voz alta antes de dar el punto por bueno.
function judgeWord(room, hostPlayerId, payload) {
  if (!isHost(room, hostPlayerId)) return { error: 'Solo el anfitrion puede resolver palabras dudosas.' };
  if (room.phase !== 'playing') return { error: 'No hay un juego activo ahora mismo.' };
  const roundType = roundTypeOf(room);
  if (!roundType.judge) return { error: 'Este juego no tiene palabras para juzgar.' };
  const result = roundType.judge(room.roundState, payload);
  if (result.error) return { error: result.error };
  (result.advanceAlso || []).forEach((id) => advanceMemberTurn(room, id));
  room.turnoSegundos = 0;
  if (room.roundState.finished) finishRound(room);
  return { room };
}

// Se llama una vez por segundo desde el servidor mientras se juega.
function tickRoom(room) {
  if (room.phase !== 'playing' || !room.roundState) return false;
  const roundType = roundTypeOf(room);
  let cambio = false;
  if (roundType.tick) {
    roundType.tick(room.roundState);
    cambio = true;
  }
  // Reloj para responder: si el turno lleva más de lo permitido, el juego lo
  // da por perdido (alVencerTurno) y pasa al que sigue.
  if (!room.roundState.finished && relojDeTurnoActivo(room)) {
    room.turnoSegundos = (room.turnoSegundos || 0) + 1;
    cambio = true;
    if (room.turnoSegundos >= room.tiempoRespuesta) {
      const quien = room.roundState.activeEntrant;
      roundType.alVencerTurno(room.roundState);
      if (quien) advanceMemberTurn(room, quien);
      room.turnoSegundos = 0;
      room.roundState.lastFeedback = { ...(room.roundState.lastFeedback || {}), timeout: true };
    }
  }
  if (room.roundState.finished) finishRound(room);
  return cambio;
}

function relojDeTurnoActivo(room) {
  const roundType = roundTypeOf(room);
  return !!(room.tiempoRespuesta && roundType && roundType.alVencerTurno
    && (!roundType.turnoEnEspera || roundType.turnoEnEspera(room.roundState)));
}

function finishRound(room) {
  const roundType = roundTypeOf(room);
  const pointsThisRound = roundType.scores(room.roundState);
  Object.entries(pointsThisRound).forEach(([entrantId, pts]) => {
    room.scores[entrantId] = (room.scores[entrantId] || 0) + pts;
  });
  room.lastRoundPoints = pointsThisRound;

  // Los mini-juegos REPARTEN segundos (se acumulan); el rosco los GASTA (queda
  // lo que sobro). Por eso uno suma sobre lo anterior y el otro lo reemplaza.
  const ganado = roundType.carryOver ? roundType.carryOver(room.roundState) : {};
  const esFinal = room.roundState.gameType === programs[room.programId].finalGame;
  if (esFinal) {
    room.timeCarryOver = ganado;
  } else {
    const acumulado = { ...room.timeCarryOver };
    Object.entries(ganado).forEach(([id, seg]) => { acumulado[id] = (acumulado[id] || 0) + seg; });
    room.timeCarryOver = acumulado;
  }
  room.lastRoundSeconds = ganado;
  room.phase = 'roundResult';
}

function continueGame(room, hostPlayerId) {
  if (!isHost(room, hostPlayerId)) return { error: 'Solo el anfitrion puede continuar.' };
  if (room.phase !== 'roundResult') return { error: 'Todavia no termino el juego actual.' };

  const isLastRound = room.currentRoundIndex >= room.gameSequence.length - 1;
  if (isLastRound) {
    room.phase = 'results';
  } else {
    room.currentRoundIndex += 1;
    room.lastRoundPoints = null;
    beginRound(room);
  }
  return { room };
}

// Vuelve a la sala de espera desde la pantalla de resultados, para elegir otro
// Programa (o el mismo) sin tener que crear una sala nueva ni que el grupo
// vuelva a entrar con un codigo. Se conservan jugadores y equipos.
function playAgain(room, hostPlayerId) {
  if (!isHost(room, hostPlayerId)) return { error: 'Solo el anfitrion puede volver a jugar.' };
  if (room.phase !== 'results') return { error: 'Todavia no termino el programa.' };

  room.phase = 'lobby';
  room.roundState = null;
  room.currentRoundIndex = -1;
  room.scores = {};
  room.timeCarryOver = {};
  room.usedDeckIds = [];
  room.usedLetters = [];
  room.gameSequence = [];
  room.memberTurnIndex = {};
  room.lastRoundPoints = null;
  room.lastRoundSeconds = null;
  room.endedEarly = false;
  return { room };
}

// Saca a un jugador de una sala de verdad (se fue, lo expulsaron, o no
// volvio despues de cortarse). Se encarga de todo lo que eso rompe: quien
// queda de anfitrion, salas vacias, y equipos que se quedan sin nadie.
function dropPlayer(room, playerId) {
  const wasHost = room.hostId === playerId;
  room.players = room.players.filter((p) => p.id !== playerId);

  const reales = room.players.filter(isRealPlayer);
  if (!reales.length) {
    // Solo quedaron jugadores inventados del modo prueba (o nadie).
    rooms.delete(room.code);
    return;
  }
  if (wasHost) {
    const nuevo = reales.find((p) => p.connected !== false) || reales[0];
    room.hostId = nuevo.id;
  }

  if (room.phase === 'playing' || room.phase === 'roundResult') {
    if (room.teamsEnabled && !room.testMode) {
      const conGente = new Set(room.players.map((p) => p.team).filter(Boolean));
      const enJuego = Object.keys(room.scores || {});
      if (enJuego.some((id) => !conGente.has(id))) {
        // Un equipo se quedo sin nadie: no hay contra quien seguir. Se cierra
        // el Programa con el puntaje que hay hasta aca.
        room.phase = 'results';
        room.endedEarly = true;
        return;
      }
    }
    syncRosters(room);
  }
}

function leaveRoom(room, playerId) {
  if (room.players.some((p) => p.id === playerId)) dropPlayer(room, playerId);
}

function removePlayer(playerId) {
  for (const room of [...rooms.values()]) {
    if (room.players.some((p) => p.id === playerId)) dropPlayer(room, playerId);
  }
}

// Estado que se manda por WebSocket a todos en la sala. Mientras la ronda esta
// "playing" no se manda la respuesta correcta, para no arruinar el juego.
// viewerId: a quien se le manda. Algunos juegos (ej. El Impostor) tienen
// informacion distinta para cada persona (privateView): la palabra secreta
// no puede viajar al celu del impostor, ni siquiera escondida.
function publicState(room, viewerId) {
  const program = room.programId ? programs[room.programId] : null;
  const roundType = roundTypeOf(room);
  const privado = room.roundState && roundType && roundType.privateView && viewerId
    ? roundType.privateView(room.roundState, viewerId, room.testMode && isHost(room, viewerId))
    : null;

  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    players: room.players.map((p) => ({ id: p.id, name: p.name, team: p.team, connected: p.connected !== false })),
    locked: !!room.locked,
    formato: room.formato,
    formatos: Object.entries(FORMATOS).map(([id, f]) => ({ id, nombre: f.nombre, desc: f.desc })),
    tiempoRespuesta: room.tiempoRespuesta,
    tiemposRespuesta: TIEMPOS_RESPUESTA,
    gameOptions: room.gameOptions || {},
    // Ajustes disponibles de cada juego del Programa (para dibujar la sala).
    ajustesJuegos: program
      ? [...(program.games || []), program.finalGame].filter((g) => roundTypes[g] && (roundTypes[g].opciones || []).length)
        .map((g) => ({ id: g, label: roundTypes[g].label, icon: ICONS[g] || '🎮', opciones: opcionesJuego.publico(roundTypes[g].opciones, room.difficulty) }))
      : [],
    // Reloj para responder del turno actual (null si no corre).
    turnoRestante: room.phase === 'playing' && relojDeTurnoActivo(room) ? Math.max(room.tiempoRespuesta - (room.turnoSegundos || 0), 0) : null,
    endedEarly: !!room.endedEarly,
    programId: room.programId,
    programName: program ? program.name : null,
    sequenceMode: program ? (program.sequenceMode || 'random') : 'random',
    hasFinalGame: !!(program && program.finalGame),
    selectedGames: room.selectedGames || [],
    roundCount: room.roundCount,
    estimatedSeconds: room.estimatedSeconds,
    teamsEnabled: room.teamsEnabled,
    testMode: room.testMode,
    testNamesA: room.testNamesA || [],
    testNamesB: room.testNamesB || [],
    baseTimeSeconds: room.baseTimeSeconds,
    tiemposDisponibles: TIEMPOS_VALIDOS,
    region: room.region,
    adultsOnly: room.adultsOnly,
    regionesDisponibles: REGIONES,
    difficulty: room.difficulty,
    dificultadesDisponibles: DIFICULTADES,
    // A quien le toca dentro de cada equipo, para mostrarlo en pantalla.
    currentMembers: room.roundState
      ? Object.fromEntries(entrantIds(room).map((id) => {
        const m = currentMemberOf(room, id);
        return [id, m ? { id: m.id, name: m.name } : null];
      }))
      : {},
    currentRoundNumber: room.currentRoundIndex + 1,
    totalRounds: (room.gameSequence && room.gameSequence.length) || room.roundCount,
    round: room.roundState && roundType ? { ...roundType.publicView(room.roundState), privado } : null,
    gameSequence: (room.gameSequence || []).map((g) => (roundTypes[g] ? roundTypes[g].label : g)),
    timeCarryOver: room.timeCarryOver,
    lastRoundSeconds: room.lastRoundSeconds || null,
    lastRoundPoints: room.lastRoundPoints,
    scores: room.scores,
    availablePrograms: Object.values(programs).map((p) => ({ id: p.id, name: p.name }))
  };
}

module.exports = {
  REGIONES,
  DIFICULTADES,
  getCatalog,
  createRoom,
  getRoom,
  joinRoom,
  isHost,
  kickPlayer,
  setLocked,
  setConnected,
  setConfig,
  startGame,
  submitAnswer,
  pasapalabra,
  judgeWord,
  tickRoom,
  continueGame,
  playAgain,
  leaveRoom,
  removePlayer,
  publicState,
  allRooms: () => rooms.values()
};
