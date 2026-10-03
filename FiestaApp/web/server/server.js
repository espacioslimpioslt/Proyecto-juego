const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const rooms = require('./rooms');

const app = express();
const server = http.createServer(app);
// Latido mas seguido que el de fabrica (25s + 20s): asi un celu que se quedo
// sin señal se marca como desconectado en ~18s y su turno pasa al siguiente
// del equipo, en vez de dejar a todos esperando casi un minuto.
const io = new Server(server, { pingInterval: 10000, pingTimeout: 8000 });

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/catalog', (req, res) => {
  res.json(rooms.getCatalog());
});

app.get('/api/regions', (req, res) => {
  res.json(rooms.REGIONES);
});

app.get('/api/difficulties', (req, res) => {
  res.json(rooms.DIFICULTADES);
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

function broadcast(room) {
  io.to(room.code).emit('room-update', rooms.publicState(room));
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

function leaveRoomFor(playerId, code = playerRoom.get(playerId)) {
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`FiestaApp escuchando en http://localhost:${PORT}`);
});
