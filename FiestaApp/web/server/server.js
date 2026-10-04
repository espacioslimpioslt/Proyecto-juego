const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const compression = require('compression');
const { Server } = require('socket.io');
const rooms = require('./rooms');

const app = express();
const server = http.createServer(app);
// Latido mas seguido que el de fabrica (25s + 20s): asi un celu que se quedo
// sin señal se marca como desconectado en ~18s y su turno pasa al siguiente
// del equipo, en vez de dejar a todos esperando casi un minuto.
const io = new Server(server, { pingInterval: 10000, pingTimeout: 8000 });

// Comprime lo que se manda (el 3D de la portada pesa ~680 KB sin comprimir,
// ~170 KB comprimido): importa mucho con datos moviles.
app.use(compression());

// ---------- Que ningún celu se quede con una versión vieja ----------
// Antes los archivos se guardaban 1 hora en el celu: después de publicar un
// juego nuevo, alguien que ya había entrado seguía con la app vieja (no
// conocía el juego y mostraba "Turno de null"). Ahora:
//  - la página principal no se guarda nunca;
//  - app.js, styles.css y los efectos se piden con "?v=VERSION" (cambia en
//    cada publicación, porque el servidor arranca de nuevo);
//  - el resto de .js/.css/.html se revalida siempre (respuesta 304 si no
//    cambió, casi no gasta datos).
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
// La versión sale del contenido de los archivos: cambia solo cuando se
// publica algo nuevo (no cada vez que el hosting reinicia el servidor).
function calcularVersion() {
  const h = crypto.createHash('sha1');
  const fx = fs.readdirSync(path.join(PUBLIC_DIR, 'fx')).filter((f) => f.endsWith('.js')).sort().map((f) => `fx/${f}`);
  ['index.html', 'app.js', 'styles.css', ...fx].forEach((f) => h.update(fs.readFileSync(path.join(PUBLIC_DIR, f))));
  return h.digest('hex').slice(0, 10);
}
const VERSION = calcularVersion();
const indexHtml = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8')
  .replace(/(href|src)="(styles\.css|app\.js|fx\/[a-z0-9]+\.js)"/g, `$1="$2?v=${VERSION}"`)
  .replace('<head>', `<head>\n<script>window.__V = '${VERSION}';</script>`);
function enviarIndex(req, res) {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.type('html').send(indexHtml);
}
app.get(['/', '/index.html'], enviarIndex);
app.use(express.static(PUBLIC_DIR, {
  index: false,
  setHeaders(res, archivo) {
    if (/vendor\//.test(archivo)) res.set('Cache-Control', 'public, max-age=604800');
    else if (/\.(js|css|html)$/.test(archivo)) res.set('Cache-Control', 'no-cache');
    else res.set('Cache-Control', 'public, max-age=3600');
  }
}));
app.get('/api/version', (req, res) => res.json({ version: VERSION }));

app.get('/api/catalog', (req, res) => {
  res.json(rooms.getCatalog());
});

app.get('/api/regions', (req, res) => {
  res.json(rooms.REGIONES);
});

app.get('/api/difficulties', (req, res) => {
  res.json(rooms.DIFICULTADES);
});

// Para revisar el hosting: si "arrancado" cambia sin que hayamos subido nada,
// el servidor se reinicio solo (y se cortaron las partidas en curso).
const arrancado = new Date().toISOString();
app.get('/api/salud', (req, res) => {
  // Como esta conectado cada celu: "websocket" (lo ideal) o "polling" (el
  // hosting no deja pasar WebSockets; funciona igual, un poco mas lento).
  const transportes = {};
  for (const s of io.of('/').sockets.values()) {
    const t = s.conn.transport.name;
    transportes[t] = (transportes[t] || 0) + 1;
  }
  res.json({
    transportes,
    ok: true,
    node: process.version,
    arrancado,
    segundosPrendido: Math.round(process.uptime()),
    salas: [...rooms.allRooms()].length
  });
});

// ---------- Identidad del jugador ----------
// El jugador NO es la conexion (socket): en un celu la conexion se corta
// todo el tiempo (se bloquea la pantalla, se cambia de app, se va el wifi
// un segundo) y cada vez que vuelve es un socket nuevo. Cada celu genera un
// playerId + un secreto propios y los manda al conectarse; el servidor
// recuerda que secreto corresponde a cada playerId, asi nadie puede hacerse
// pasar por otro jugador sabiendo solo su id (que viaja a todos en la sala).
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const secrets = new Map(); // playerId -> hash del secreto
const playerRoom = new Map(); // playerId -> code
const disconnectTimers = new Map(); // playerId -> timeout de gracia

// Cuanto se espera a que un jugador vuelva antes de sacarlo de la sala.
const GRACIA_MS = Number(process.env.GRACIA_MS) || 120000;

function hash(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

function identify(socket) {
  const { playerId, secret } = socket.handshake.auth || {};
  if (!ID_RE.test(playerId || '') || !ID_RE.test(secret || '')) return null;
  const known = secrets.get(playerId);
  if (known && known !== hash(secret)) return null;
  if (!known) secrets.set(playerId, hash(secret));
  return playerId;
}

// Cada jugador recibe su propia version del estado: algunos juegos tienen
// datos secretos por persona (ver privateView en El Impostor).
function broadcast(room) {
  for (const p of room.players) {
    if (String(p.id).startsWith('test:')) continue; // inventados del modo prueba: no tienen celu
    io.to(`p:${p.id}`).emit('room-update', rooms.publicState(room, p.id));
  }
}

// ---------- Limite de mensajes ----------
// Un celu normal manda pocas acciones por segundo; esto frena a un cliente
// que manda miles (adivinanzas en serie, intentos de adivinar codigos, etc.).
const LIMITE_POR_SEGUNDO = 15;
const LIMITE_UNIRSE_POR_MINUTO = 10;

function rateLimiter() {
  let tokens = LIMITE_POR_SEGUNDO;
  let last = Date.now();
  const joins = [];
  return {
    allow() {
      const now = Date.now();
      tokens = Math.min(LIMITE_POR_SEGUNDO, tokens + ((now - last) / 1000) * LIMITE_POR_SEGUNDO);
      last = now;
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    },
    allowJoin() {
      const now = Date.now();
      while (joins.length && now - joins[0] > 60000) joins.shift();
      if (joins.length >= LIMITE_UNIRSE_POR_MINUTO) return false;
      joins.push(now);
      return true;
    }
  };
}

function enterRoom(socket, playerId, room) {
  const previous = playerRoom.get(playerId);
  if (previous && previous !== room.code) {
    // Se fue a otra sala: deja la anterior en serio (solo esa).
    socket.leave(previous);
    leaveRoomFor(playerId, previous);
  }
  socket.join(room.code);
  playerRoom.set(playerId, room.code);
}

// ---------- Audio en vivo (micrófonos) ----------
// El audio viaja DIRECTO de celu a celu (WebRTC): el servidor solo lleva la
// lista de quién tiene el audio prendido en cada sala y pasa los mensajes
// para que dos celus se conecten ("señalización"). Nunca pasa ni se guarda
// audio por acá.
const voz = new Map(); // code -> Map(playerId -> { mic })

function vozLista(code) {
  return [...(voz.get(code) || new Map()).entries()].map(([id, v]) => ({ id, mic: !!v.mic }));
}
function vozAvisar(code) {
  io.to(code).emit('voz-lista', vozLista(code));
}
function vozSacar(playerId, code) {
  const sala = voz.get(code);
  if (sala && sala.delete(playerId)) {
    if (!sala.size) voz.delete(code);
    vozAvisar(code);
  }
}

function leaveRoomFor(playerId, code = playerRoom.get(playerId)) {
  vozSacar(playerId, code);
  if (playerRoom.get(playerId) === code) playerRoom.delete(playerId);
  const room = rooms.getRoom(code);
  if (!room) return;
  rooms.leaveRoom(room, playerId);
  if (rooms.getRoom(code)) broadcast(room);
}

io.on('connection', (socket) => {
  const playerId = identify(socket);
  if (!playerId) {
    socket.emit('room-error', 'No se pudo identificar este dispositivo. Recargá la página.');
    socket.disconnect(true);
    return;
  }
  socket.join(`p:${playerId}`);
  // Para que el celu se dé cuenta si tiene la página de una versión anterior.
  socket.emit('version', VERSION);
  const limiter = rateLimiter();

  function handle(fn) {
    return (payload) => {
      if (!limiter.allow()) return;
      try {
        const result = fn(payload);
        if (result && result.error) socket.emit('room-error', result.error);
      } catch (err) {
        console.error(err);
        socket.emit('room-error', 'Algo salio mal en el servidor.');
      }
    };
  }

  function currentRoom() {
    return rooms.getRoom(playerRoom.get(playerId));
  }

  // Volvio un jugador que se habia desconectado: recupera su lugar.
  clearTimeout(disconnectTimers.get(playerId));
  disconnectTimers.delete(playerId);
  const back = currentRoom();
  if (back && rooms.setConnected(back, playerId, true)) {
    socket.join(back.code);
    broadcast(back);
  } else {
    playerRoom.delete(playerId);
  }

  socket.on('create-room', handle(({ name, programId, prefs } = {}) => {
    const room = rooms.createRoom(playerId, name || 'Anfitrion', programId, prefs || {});
    enterRoom(socket, playerId, room);
    broadcast(room);
  }));

  socket.on('join-room', handle(({ code, name } = {}) => {
    if (!limiter.allowJoin()) return { error: 'Demasiados intentos. Esperá un minuto.' };
    const { room, error } = rooms.joinRoom(code, playerId, name || 'Jugador');
    if (error) return { error };
    enterRoom(socket, playerId, room);
    broadcast(room);
  }));

  socket.on('leave-room', handle(() => {
    const room = currentRoom();
    if (!room) return;
    socket.leave(room.code);
    leaveRoomFor(playerId);
  }));

  socket.on('kick-player', handle(({ playerId: target } = {}) => {
    const room = currentRoom();
    if (!room) return { error: 'No estas en ninguna sala.' };
    const { error } = rooms.kickPlayer(room, playerId, target);
    if (error) return { error };
    io.to(`p:${target}`).emit('kicked');
    io.in(`p:${target}`).socketsLeave(room.code);
    playerRoom.delete(target);
    broadcast(room);
  }));

  socket.on('lock-room', handle(({ locked } = {}) => {
    const room = currentRoom();
    if (!room) return { error: 'No estas en ninguna sala.' };
    const { error } = rooms.setLocked(room, playerId, locked);
    if (error) return { error };
    broadcast(room);
  }));

  socket.on('set-config', handle((payload = {}) => {
    const room = currentRoom();
    if (!room) return { error: 'No estas en ninguna sala.' };
    const { error } = rooms.setConfig(room, playerId, payload);
    if (error) return { error };
    broadcast(room);
  }));

  socket.on('start-game', handle(() => {
    const room = currentRoom();
    if (!room) return { error: 'No estas en ninguna sala.' };
    const { error } = rooms.startGame(room, playerId);
    if (error) return { error };
    broadcast(room);
  }));

  // El payload depende del juego: un indice de opcion, una casilla, o dos
  // casillas en la sopa de letras. Cada tipo de ronda lo interpreta.
  // Autos Chocadores: posición del auto propio (~10 por segundo). Va por
  // fuera del límite general de mensajes, con un tope propio.
  let autosEnSegundo = 0;
  let segundoAutos = 0;
  socket.on('auto', (datos) => {
    const ahora = Math.floor(Date.now() / 1000);
    if (ahora !== segundoAutos) { segundoAutos = ahora; autosEnSegundo = 0; }
    if (++autosEnSegundo > 25) return;
    rooms.autoEstado(currentRoom(), playerId, datos);
  });
  socket.on('auto-golpe', (atacanteId) => {
    if (!limiter.allow()) return;
    rooms.autoGolpe(currentRoom(), playerId, String(atacanteId || ''));
  });
  // Audio en vivo: entrar/salir del audio de la sala, y señales WebRTC.
  socket.on('voz-unirse', (datos = {}) => {
    const room = currentRoom();
    if (!room || room.vozApagada || !limiter.allow()) return;
    if (!voz.has(room.code)) voz.set(room.code, new Map());
    voz.get(room.code).set(playerId, { mic: !!(datos && datos.mic) });
    vozAvisar(room.code);
  });
  socket.on('voz-salir', () => {
    const room = currentRoom();
    if (room) vozSacar(playerId, room.code);
  });
  let senalesEnSegundo = 0;
  let segundoSenales = 0;
  socket.on('voz-senal', (msg = {}) => {
    const ahora = Math.floor(Date.now() / 1000);
    if (ahora !== segundoSenales) { segundoSenales = ahora; senalesEnSegundo = 0; }
    if (++senalesEnSegundo > 80) return;
    const room = currentRoom();
    const sala = room && voz.get(room.code);
    const a = msg && String(msg.a || '');
    if (!sala || !sala.has(playerId) || !sala.has(a)) return;
    if (JSON.stringify(msg.datos || {}).length > 20000) return;
    io.to(`p:${a}`).emit('voz-senal', { de: playerId, datos: msg.datos });
  });
  // Anfitrión: apagar (o volver a permitir) el audio de toda la sala.
  socket.on('voz-sala', handle(({ apagada } = {}) => {
    const room = currentRoom();
    if (!room) return { error: 'No estás en ninguna sala.' };
    if (!rooms.isHost(room, playerId)) return { error: 'Solo el anfitrión puede cambiar el audio de la sala.' };
    room.vozApagada = !!apagada;
    if (room.vozApagada) { voz.delete(room.code); vozAvisar(room.code); }
    broadcast(room);
  }));
  socket.on('voz-pedir-lista', () => {
    const room = currentRoom();
    if (room) socket.emit('voz-lista', vozLista(room.code));
  });

  // Para medir la demora (ida y vuelta) desde el celu o desde el chequeo del sitio.
  socket.on('eco', (t, ack) => { if (typeof ack === 'function') ack(t); });

  socket.on('submit-answer', handle((payload = {}) => {
    const room = currentRoom();
    if (!room) return { error: 'No estas en ninguna sala.' };
    const value = payload.answerIndex !== undefined ? payload.answerIndex
      : payload.cellIndex !== undefined ? payload.cellIndex
        : payload;
    const { error } = rooms.submitAnswer(room, playerId, value);
    if (error) return { error };
    broadcast(room);
  }));

  socket.on('judge-word', handle((payload = {}) => {
    const room = currentRoom();
    if (!room) return { error: 'No estas en ninguna sala.' };
    const { error } = rooms.judgeWord(room, playerId, payload);
    if (error) return { error };
    broadcast(room);
  }));

  socket.on('pasapalabra', handle(() => {
    const room = currentRoom();
    if (!room) return { error: 'No estas en ninguna sala.' };
    const { error } = rooms.pasapalabra(room, playerId);
    if (error) return { error };
    broadcast(room);
  }));

  socket.on('continue-game', handle(() => {
    const room = currentRoom();
    if (!room) return { error: 'No estas en ninguna sala.' };
    const { error } = rooms.continueGame(room, playerId);
    if (error) return { error };
    broadcast(room);
  }));

  // Desde la pantalla de resultados: vuelve a la sala de espera con el mismo
  // grupo, sin tener que crear una sala nueva ni repartir el codigo de nuevo.
  socket.on('play-again', handle(() => {
    const room = currentRoom();
    if (!room) return { error: 'No estas en ninguna sala.' };
    const { error } = rooms.playAgain(room, playerId);
    if (error) return { error };
    broadcast(room);
  }));

  // Se corto la conexion: el jugador NO se va de la sala enseguida. Queda
  // marcado como desconectado (el resto lo ve) y tiene un rato para volver;
  // recien si no vuelve se lo saca de verdad.
  socket.on('disconnect', async () => {
    // Puede tener otra pestaña/conexion abierta con la misma identidad.
    const others = await io.in(`p:${playerId}`).fetchSockets();
    if (others.length) return;
    const room = currentRoom();
    if (!room) return;
    vozSacar(playerId, room.code); // sin conexión no hay audio; al volver se reconecta solo
    rooms.setConnected(room, playerId, false);
    broadcast(room);
    clearTimeout(disconnectTimers.get(playerId));
    disconnectTimers.set(playerId, setTimeout(() => {
      disconnectTimers.delete(playerId);
      leaveRoomFor(playerId);
    }, GRACIA_MS));
  });
});

// Reloj del juego: el tiempo corre solo para el equipo que tiene el turno.
// El servidor es el que lleva la cuenta (no cada celu) para que todos vean lo mismo.
setInterval(() => {
  for (const room of rooms.allRooms()) {
    if (rooms.tickRoom(room)) broadcast(room);
  }
}, 1000);

// Autos Chocadores: 10 veces por segundo se reparten las posiciones de todos.
setInterval(() => {
  for (const room of rooms.allRooms()) {
    const pos = rooms.autoPosiciones(room);
    if (pos) io.to(room.code).volatile.emit('autos', pos);
  }
}, 100);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`FiestaApp escuchando en http://localhost:${PORT}`);
});
