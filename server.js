const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const CENTER_X = 3000;
const CENTER_Y = 3000; 

const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname)); // Sirve index.html y game.js

// =====================
// SISTEMA DE LOBBIES
// =====================
let lobbies = {};
let nextLobbyId = 1;

function createLobby() {
  const id = "lobby" + nextLobbyId++;
  lobbies[id] = {
    id,
    players: {},
    orbs: [],
    specialItems: [],
    lobbyTimer: null,
    lobbyTimeLeft: 0,
    lobbyStarted: false,
    gameStarted: false,
    gameStartTime: null
  };
  return lobbies[id];
}

function deleteLobby(id) {
  if (lobbies[id]) {
    if (lobbies[id].lobbyTimer) clearInterval(lobbies[id].lobbyTimer);
    delete lobbies[id];
  }
}

function checkForWinner(lobby, ioNamespace) {
  const alivePlayers = Object.entries(lobby.players).filter(([id, p]) => !p.dead);
  if (alivePlayers.length === 1) {
    const winnerId = alivePlayers[0][0];
    ioNamespace.emit('gameOver', { winnerId });
    // Limpia lobby después de un tiempo
    setTimeout(() => deleteLobby(lobby.id), 5000);
  } else if (alivePlayers.length === 0) {
    ioNamespace.emit('gameOver', { winnerId: null });
    setTimeout(() => deleteLobby(lobby.id), 5000);
  }
}

function generateInitialOrbs() {
  const orbs = [];
  for (let i = 0; i < 20; i++) {
    orbs.push({
      id: 'orb' + i,
      x: Math.random() * (4000 - 10) + 5,
      y: Math.random() * (4000 - 10) + 5,
      radius: 5
    });
  }
  return orbs;
}

function startLobbyCountdown(lobby, ioNamespace) {
  if (lobby.lobbyStarted || lobby.gameStarted) return;
  lobby.lobbyStarted = true;
  lobby.lobbyTimeLeft = 10;

  ioNamespace.emit('lobbyCountdown', { timeLeft: lobby.lobbyTimeLeft });

  lobby.lobbyTimer = setInterval(() => {
    lobby.lobbyTimeLeft--;
    ioNamespace.emit('lobbyCountdown', { timeLeft: lobby.lobbyTimeLeft });

    if (lobby.lobbyTimeLeft <= 0) {
      clearInterval(lobby.lobbyTimer);
      lobby.lobbyTimer = null;
      lobby.lobbyStarted = false;

      if (Object.keys(lobby.players).length >= 2) {
        // Empieza la partida
        lobby.orbs = generateInitialOrbs();
        lobby.specialItems = [];
        lobby.gameStarted = true;
        lobby.gameStartTime = Date.now();
        ioNamespace.emit('startGame', {
          orbs: lobby.orbs,
          startTime: lobby.gameStartTime,
          specialItems: lobby.specialItems
        });
      } else {
        ioNamespace.emit('lobbyFailed');
        // Elimina la lobby si no arranca
        deleteLobby(lobby.id);
      }
    }
  }, 1000);
}

// =====================
// CONEXIONES SOCKET.IO
// =====================
io.on('connection', (socket) => {
  console.log('Nuevo jugador conectado:', socket.id);

  // Buscar lobby libre
  let lobby = Object.values(lobbies).find(l => !l.gameStarted && Object.keys(l.players).length < 10);
  if (!lobby) {
    lobby = createLobby();
  }

  // Únete a la sala de socket de este lobby
  socket.join(lobby.id);

  // Crear jugador
  lobby.players[socket.id] = {
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

  // Enviar datos iniciales
  socket.emit('init', { id: socket.id, players: lobby.players });

  // Iniciar countdown si es el primer jugador
  if (Object.keys(lobby.players).length === 1) {
    startLobbyCountdown(lobby, io.to(lobby.id));
  }
  // Si el lobby ya estaba esperando, mandar el tiempo restante
  if (lobby.lobbyStarted && lobby.lobbyTimeLeft > 0) {
    socket.emit('lobbyCountdown', { timeLeft: lobby.lobbyTimeLeft });
  }
  // Si el juego ya empezó, sincronizar con el estado
  if (lobby.gameStarted) {
    socket.emit('startGame', {
      orbs: lobby.orbs,
      startTime: lobby.gameStartTime,
      specialItems: lobby.specialItems
    });
    io.to(lobby.id).emit('syncPlayers', lobby.players);
  }

  // =====================
  // EVENTOS DE JUEGO
  // =====================
  socket.on('specialAction', (data) => {
    const player = lobby.players[socket.id];
    if (!player) return;

    if (data.type === "freeze" && data.to) {
      const freezeUntil = Date.now() + 2000;
      if (lobby.players[data.to]) {
        lobby.players[data.to].frozenUntil = freezeUntil;
      }
      io.to(lobby.id).emit('specialAction', { ...data, frozenUntil: freezeUntil });
    } else if (data.type === "shield" && data.from) {
      const shieldUntil = Date.now() + 3000;
      if (lobby.players[data.from]) {
        lobby.players[data.from].shieldUntil = shieldUntil;
      }
      io.to(lobby.id).emit('specialAction', { ...data, shieldUntil: shieldUntil });
    } else {
      io.to(lobby.id).emit('specialAction', data);
    }
  });

  socket.on('update', (data) => {
    if (lobby.players[socket.id]) {
      Object.assign(lobby.players[socket.id], data);
      lobby.players[socket.id].id = socket.id;
    }
    io.to(lobby.id).emit('syncPlayers', lobby.players);
  });

  socket.on('orbCollected', (orbId) => {
    lobby.orbs = lobby.orbs.filter(o => o.id !== orbId);
    io.to(lobby.id).emit('removeOrb', orbId);
  });

  socket.on('specialItemCollected', (itemId) => {
    lobby.specialItems = lobby.specialItems.filter(i => i.id !== itemId);
    io.to(lobby.id).emit('removeSpecialItem', itemId);
  });

  // =====================
  // DESCONEXIÓN
  // =====================
  socket.on('disconnect', () => {
    console.log('Jugador desconectado:', socket.id);
    delete lobby.players[socket.id];
    io.to(lobby.id).emit('playerLeft', socket.id);

checkForWinner(lobby, io.to(lobby.id));

    if (Object.keys(lobby.players).length === 0) {
      deleteLobby(lobby.id);
    }
  });
});

// =====================
// SPAWNEO GLOBAL POR LOBBY
// =====================
setInterval(() => {
  Object.values(lobbies).forEach(lobby => {
    if (lobby.gameStarted && Object.keys(lobby.players).length >= 2) {
      // Calcula el radio seguro actual
      const elapsed = (Date.now() - lobby.gameStartTime) / 1000;
      const battleTimer = Math.max(0, 300 - elapsed);
      const maxRadius = Math.hypot(CENTER_X, CENTER_Y);
      const currentSafeRadius = maxRadius * (battleTimer / 300);

      // ORBES
      if (lobby.orbs.length < 160) { // más orbes simultáneos
        let tries = 0;
        while (tries < 10) {
          const angle = Math.random() * 2 * Math.PI;
          const r = Math.random() * (currentSafeRadius - 100);
          const x = CENTER_X + Math.cos(angle) * r;
          const y = CENTER_Y + Math.sin(angle) * r;
          if (x > 5 && x < CENTER_X * 2 - 5 && y > 5 && y < CENTER_Y * 2 - 5) {
            const orb = {
              id: 'orb' + Date.now() + Math.random(),
              x, y,
              radius: 3 + Math.random() * 2
            };
            lobby.orbs.push(orb);
            io.to(lobby.id).emit('newOrb', orb);
            break;
          }
          tries++;
        }
      }
    }
  });
}, 900); // más frecuente
// --- Objetos especiales ---
setInterval(() => {
  Object.values(lobbies).forEach(lobby => {
    if (lobby.gameStarted && Object.keys(lobby.players).length >= 2) {
      // Calcula el radio seguro actual
      const elapsed = (Date.now() - lobby.gameStartTime) / 1000;
      const battleTimer = Math.max(0, 300 - elapsed);
      const maxRadius = Math.hypot(CENTER_X, CENTER_Y);
      const currentSafeRadius = maxRadius * (battleTimer / 300);

      if (lobby.specialItems.length < 8) {
        let tries = 0;
        while (tries < 10) {
          const angle = Math.random() * 2 * Math.PI;
          const r = Math.random() * (currentSafeRadius - 100);
          const x = CENTER_X + Math.cos(angle) * r;
          const y = CENTER_Y + Math.sin(angle) * r;
          if (x > 7 && x < CENTER_X * 2 - 7 && y > 7 && y < CENTER_Y * 2 - 7) {
            const item = {
              id: 'item' + Date.now() + Math.random(),
              type: ["freeze", "hook", "missile", "repulse", "shield"][Math.floor(Math.random() * 5)],
              x, y,
              radius: 7
            };
            lobby.specialItems.push(item);
            io.to(lobby.id).emit('newSpecialItem', item);
            break;
          }
          tries++;
        }
      }
    }
  });
}, 6000); // más frecuente

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});
