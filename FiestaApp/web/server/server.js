const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const rooms = require('./rooms');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

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

const socketRoom = new Map(); // socketId -> code

function broadcast(room) {
  io.to(room.code).emit('room-update', rooms.publicState(room));
}

function handle(socket, fn) {
  return (payload) => {
    try {
      const result = fn(payload);
      if (result && result.error) socket.emit('room-error', result.error);
    } catch (err) {
      console.error(err);
      socket.emit('room-error', 'Algo salio mal en el servidor.');
    }
  };
}

io.on('connection', (socket) => {
  socket.on('create-room', handle(socket, ({ name, programId, prefs } = {}) => {
    const room = rooms.createRoom(socket.id, name || 'Anfitrion', programId, prefs || {});
    socket.join(room.code);
    socketRoom.set(socket.id, room.code);
    broadcast(room);
  }));

  socket.on('join-room', handle(socket, ({ code, name } = {}) => {
    const { room, error } = rooms.joinRoom(code, socket.id, name || 'Jugador');
    if (error) return { error };
    socket.join(room.code);
    socketRoom.set(socket.id, room.code);
    broadcast(room);
  }));

  socket.on('kick-player', handle(socket, ({ playerId } = {}) => {
    const room = rooms.getRoom(socketRoom.get(socket.id));
    if (!room) return { error: 'No estas en ninguna sala.' };
    const { error } = rooms.kickPlayer(room, socket.id, playerId);
    if (error) return { error };
    io.to(playerId).emit('kicked');
    io.sockets.sockets.get(playerId)?.leave(room.code);
    socketRoom.delete(playerId);
    broadcast(room);
  }));

  socket.on('set-config', handle(socket, (payload = {}) => {
    const room = rooms.getRoom(socketRoom.get(socket.id));
    if (!room) return { error: 'No estas en ninguna sala.' };
    const { error } = rooms.setConfig(room, socket.id, payload);
    if (error) return { error };
    broadcast(room);
  }));

  socket.on('start-game', handle(socket, () => {
    const room = rooms.getRoom(socketRoom.get(socket.id));
    if (!room) return { error: 'No estas en ninguna sala.' };
    const { error } = rooms.startGame(room, socket.id);
    if (error) return { error };
    broadcast(room);
  }));

  // El payload depende del juego: un indice de opcion, una casilla, o dos
  // casillas en la sopa de letras. Cada tipo de ronda lo interpreta.
  socket.on('submit-answer', handle(socket, (payload = {}) => {
    const room = rooms.getRoom(socketRoom.get(socket.id));
    if (!room) return { error: 'No estas en ninguna sala.' };
    const value = payload.answerIndex !== undefined ? payload.answerIndex
      : payload.cellIndex !== undefined ? payload.cellIndex
        : payload;
    const { error } = rooms.submitAnswer(room, socket.id, value);
    if (error) return { error };
    broadcast(room);
  }));

  socket.on('judge-word', handle(socket, (payload = {}) => {
    const room = rooms.getRoom(socketRoom.get(socket.id));
    if (!room) return { error: 'No estas en ninguna sala.' };
    const { error } = rooms.judgeWord(room, socket.id, payload);
    if (error) return { error };
    broadcast(room);
  }));

  socket.on('pasapalabra', handle(socket, () => {
    const room = rooms.getRoom(socketRoom.get(socket.id));
    if (!room) return { error: 'No estas en ninguna sala.' };
    const { error } = rooms.pasapalabra(room, socket.id);
    if (error) return { error };
    broadcast(room);
  }));

  socket.on('continue-game', handle(socket, () => {
    const room = rooms.getRoom(socketRoom.get(socket.id));
    if (!room) return { error: 'No estas en ninguna sala.' };
    const { error } = rooms.continueGame(room, socket.id);
    if (error) return { error };
    broadcast(room);
  }));

  // Desde la pantalla de resultados: vuelve a la sala de espera con el mismo
  // grupo, sin tener que crear una sala nueva ni repartir el codigo de nuevo.
  socket.on('play-again', handle(socket, () => {
    const room = rooms.getRoom(socketRoom.get(socket.id));
    if (!room) return { error: 'No estas en ninguna sala.' };
    const { error } = rooms.playAgain(room, socket.id);
    if (error) return { error };
    broadcast(room);
  }));

  socket.on('disconnect', () => {
    const code = socketRoom.get(socket.id);
    socketRoom.delete(socket.id);
    rooms.removeSocket(socket.id);
    const room = rooms.getRoom(code);
    if (room) broadcast(room);
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
