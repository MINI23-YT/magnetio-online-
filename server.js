const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const CENTER_X = 2000;
const CENTER_Y = 2000; 


const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname)); // Sirve index.html y game.js

let players = {};

let lobbyTimer = null;
let lobbyTimeLeft = 0;
let lobbyStarted = false;
let gameStarted = false;
let gameStartTime = null; 



let initialOrbs = [];
function generateInitialOrbs() {
  initialOrbs = [];
  for (let i = 0; i < 20; i++) {
    initialOrbs.push({
      id: 'orb' + i,
      x: Math.random() * (4000 - 10) + 5,
      y: Math.random() * (4000 - 10) + 5,
      radius: 5
    });
  }
}

let orbs = [];
let specialItems = [];
const SPECIAL_ITEM_TYPES = ["freeze", "hook", "missile", "repulse", "shield"];
const SPECIAL_ITEM_RADIUS = 7;

function spawnOrb() {
  if (orbs.length >= 150) return;
  const orb = {
    id: 'orb' + Date.now() + Math.random(),
    x: Math.random() * (4000 - 200) + 100,
    y: Math.random() * (4000 - 200) + 100,
    radius: 3 + Math.random() * 2
  };
  orbs.push(orb);
  io.emit('newOrb', orb);
}

function spawnSpecialItem() {
  if (specialItems.length >= 5) return;
  const item = {
    id: 'item' + Date.now() + Math.random(),
    type: SPECIAL_ITEM_TYPES[Math.floor(Math.random() * SPECIAL_ITEM_TYPES.length)],
    x: Math.random() * (4000 - 2 * SPECIAL_ITEM_RADIUS) + SPECIAL_ITEM_RADIUS,
    y: Math.random() * (4000 - 2 * SPECIAL_ITEM_RADIUS) + SPECIAL_ITEM_RADIUS,
    radius: SPECIAL_ITEM_RADIUS
  };
  specialItems.push(item);
  io.emit('newSpecialItem', item);
}

function startLobbyCountdown() {
  if (lobbyStarted || gameStarted) return;
  lobbyStarted = true;
  lobbyTimeLeft = 10;
  io.emit('lobbyCountdown', { timeLeft: lobbyTimeLeft });

  lobbyTimer = setInterval(() => {
    lobbyTimeLeft--;
    io.emit('lobbyCountdown', { timeLeft: lobbyTimeLeft });
    if (lobbyTimeLeft <= 0) {
      clearInterval(lobbyTimer);
      lobbyTimer = null;
      lobbyStarted = false;
      if (Object.keys(players).length >= 2) {
        // Empieza la partida
        generateInitialOrbs();
        orbs = [...initialOrbs];
        specialItems = [];
        gameStarted = true;
        gameStartTime = Date.now(); // <-- Guarda el tiempo de inicio
        io.emit('startGame', {
            orbs,
          startTime: gameStartTime, // <-- Usa el mismo tiempo para todos
          specialItems
        });
      } else {
        io.emit('lobbyFailed');
        Object.keys(players).forEach(id => {
          // Puedes desconectar si quieres, o dejar que el cliente vuelva al menú
        });
      }
    }
  }, 1000);
}   
io.on('connection', (socket) => {
    console.log('Nuevo jugador conectado:', socket.id);

  // Si la partida ya empezó, añade al jugador y mándale el estado actual
  if (gameStarted) {
    players[socket.id] = {
      x: CENTER_X,
      y: CENTER_Y,
      radius: 10,
      polarity: 1,
      fieldRadius: 60,
      health: 100,
      maxHealth: 100,
      dead: false,
      name: "Jugador"
    };
    socket.emit('init', { id: socket.id, players });
    // Envía el estado de la partida con el tiempo REAL de inicio
    socket.emit('startGame', {
      orbs,
      startTime: gameStartTime, // <-- Usa el mismo tiempo para todos
      specialItems
    });
    io.emit('syncPlayers', players);
  }
    // Si no hay partida, añade al jugador al lobby
  if (Object.keys(players).length < 10) {
    players[socket.id] = {
      x: CENTER_X,
      y: CENTER_Y,
      radius: 10,
      polarity: 1,
      fieldRadius: 60,
      health: 100,
      maxHealth: 100,
      dead: false,
      name: "Jugador"
    };
    socket.emit('init', { id: socket.id, players });

    if (Object.keys(players).length === 1) {
      startLobbyCountdown();
    }
    if (lobbyStarted && lobbyTimeLeft > 0) {
      socket.emit('lobbyCountdown', { timeLeft: lobbyTimeLeft });
    }
  } else {
    socket.emit('lobbyFull');
    socket.disconnect();
  }

    // Si es el primer jugador, inicia el lobby
    if (Object.keys(players).length === 1) {
      startLobbyCountdown();
    }
    // Si el lobby ya está en marcha, envía el tiempo restante al nuevo jugador
    if (lobbyStarted && lobbyTimeLeft > 0) {
      socket.emit('lobbyCountdown', { timeLeft: lobbyTimeLeft });
    }

socket.on('specialAction', (data) => {
  if (data.type === "freeze" && data.to) {
    const freezeUntil = Date.now() + 2000;
    if (players[data.to]) {
      players[data.to].frozenUntil = freezeUntil;
    }
    io.emit('specialAction', { ...data, frozenUntil: freezeUntil });
  } else if (data.type === "shield" && data.from) {
    const shieldUntil = Date.now() + 3000;
    if (players[data.from]) {
      players[data.from].shieldUntil = shieldUntil;
    }
    io.emit('specialAction', { ...data, shieldUntil: shieldUntil });
  } else {
    io.emit('specialAction', data);
  }
});

socket.on('update', (data) => {
  if (players[socket.id]) {
    Object.assign(players[socket.id], data);
    players[socket.id].id = socket.id;
  }
  io.emit('syncPlayers', players);
});

  socket.on('disconnect', () => {
    console.log('Jugador desconectado:', socket.id);
    delete players[socket.id];
    io.emit('playerLeft', socket.id);

    // Si no hay jugadores, resetea el lobby y la partida
    if (Object.keys(players).length === 0) {
      if (lobbyTimer) clearInterval(lobbyTimer);
      lobbyTimer = null;
      lobbyStarted = false;
      gameStarted = false;
    }
  });

  socket.on('orbCollected', (orbId) => {
    orbs = orbs.filter(o => o.id !== orbId);
    io.emit('removeOrb', orbId);
  });

  socket.on('specialItemCollected', (itemId) => {
    specialItems = specialItems.filter(i => i.id !== itemId);
    io.emit('removeSpecialItem', itemId);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});

setInterval(() => {
  if (Object.keys(players).length >= 2) {
    spawnOrb();
  }
}, 1500);

setInterval(() => {
  if (Object.keys(players).length >= 2) {
    spawnSpecialItem();
  }
}, 10000);
