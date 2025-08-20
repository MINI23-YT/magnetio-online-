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

let players = {};
let lobbyTimer = null;
let lobbyTimeLeft = 0;
let lobbyStarted = false;
let gameStarted = false;
let gameStartTime = null; 
let spectators = {};


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

function checkGameEnd() {
  if (!gameStarted) return;
  
  const alivePlayers = Object.values(players).filter(p => !p.dead && p.health > 0);
  
  if (alivePlayers.length <= 1) {
    // El juego ha terminado, crear ranking COMPLETO
    const allPlayers = Object.values(players);
    
    console.log('Datos de jugadores antes del ranking:', allPlayers.map(p => ({
      name: p.name,
      kills: p.kills,
      maxHealthEverReached: p.maxHealthEverReached,
      dead: p.dead,
      health: p.health
    })));
    
    // NUEVO RANKING: Ordena por orden de muerte (último vivo = posición 1)
    const ranking = allPlayers
      .sort((a, b) => {
        // Si uno está vivo y otro muerto, el vivo va primero
        if ((!a.dead && a.health > 0) && (b.dead || b.health <= 0)) return -1;
        if ((a.dead || a.health <= 0) && (!b.dead && b.health > 0)) return 1;
        
        // Si ambos están muertos, ordena por kills y luego por vida máxima
        const aKills = a.kills || 0;
        const bKills = b.kills || 0;
        const aMaxHealth = a.maxHealthEverReached || a.maxHealth || 60;
        const bMaxHealth = b.maxHealthEverReached || b.maxHealth || 60;
        
        if (bKills !== aKills) return bKills - aKills;
        return bMaxHealth - aMaxHealth;
      })
      .map((player, index) => ({
        name: player.name || "Jugador",
        position: index + 1,
        kills: player.kills || 0,
        maxHealthEverReached: player.maxHealthEverReached || player.maxHealth || 60,
        alive: !player.dead && player.health > 0
      }));
    
    console.log('Ranking final generado:', ranking);
    
    // Envía el ranking final a todos los clientes
    io.emit('gameEnd', ranking);
    
    console.log('Juego terminado. Ranking completo enviado:', ranking.length, 'jugadores');
    
    // Resetea el juego después de un tiempo
    setTimeout(() => {
      gameStarted = false;
      gameStartTime = null;
      players = {};
      spectators = {};
      orbs = [];
      specialItems = [];
      console.log('Juego reseteado');
    }, 30000); // 30 segundos para ver el ranking
  }
}

function notifyPlayerKilled(killerId, victimId) {
  io.emit('playerKilled', { killerId, victimId });
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
  health: 60,        // CAMBIADO: vida inicial 60
  maxHealth: 60,     // CAMBIADO: vida máx inicial 60
  maxHealthEverReached: 60, // NUEVO: para ranking final
  dead: false,
  name: "Jugador",
  kills: 0           // NUEVO: contador de kills
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
  health: 60,        // CAMBIADO: vida inicial 60
  maxHealth: 60,     // CAMBIADO: vida máx inicial 60
  maxHealthEverReached: 60, // NUEVO: para ranking final
  dead: false,
  name: "Jugador",
  kills: 0           // NUEVO: contador de kills
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
    
    // Actualizar récord de vida máxima si es necesario
    if (data.maxHealth && data.maxHealth > (players[socket.id].maxHealthEverReached || 60)) {
      players[socket.id].maxHealthEverReached = data.maxHealth;
    }
  }
  io.emit('syncPlayers', players);
});

socket.on('spectatorMode', (data) => {
  if (data.active) {
    spectators[socket.id] = { target: data.target };
    console.log(`Jugador ${socket.id} entró en modo espectador siguiendo a ${data.target}`);
  } else {
    delete spectators[socket.id];
    console.log(`Jugador ${socket.id} salió del modo espectador`);
  }
});

socket.on('playerDied', (data) => {
  if (players[socket.id]) {
    players[socket.id].dead = true;
    players[socket.id].health = 0;
    
    if (data.killedBy) {
      notifyPlayerKilled(data.killedBy, socket.id);
    }
    
    checkGameEnd();
  }
});

socket.on('playerKill', (data) => {
  // data = { killerId: string, victimId: string, killerNewStats: object }
  if (players[data.killerId] && players[data.victimId]) {
    // Actualizar stats del killer
    players[data.killerId].kills = (players[data.killerId].kills || 0) + 1;
    
    if (data.killerNewStats) {
      players[data.killerId].health = data.killerNewStats.health;
      players[data.killerId].maxHealth = data.killerNewStats.maxHealth;
      players[data.killerId].fieldRadius = data.killerNewStats.fieldRadius;
      
      // Actualizar récord si es necesario
      if (data.killerNewStats.maxHealth > (players[data.killerId].maxHealthEverReached || 60)) {
        players[data.killerId].maxHealthEverReached = data.killerNewStats.maxHealth;
      }
    }
    
    // Marcar víctima como muerta
    players[data.victimId].dead = true;
    players[data.victimId].health = 0;
    
    console.log(`${players[data.killerId].name} mató a ${players[data.victimId].name}`);
    
    // Notificar a todos los clientes
    io.emit('playerKilled', { killerId: data.killerId, victimId: data.victimId });
    io.emit('syncPlayers', players);
    
    checkGameEnd();
  }
});

socket.on('disconnect', () => {
  console.log('Jugador desconectado:', socket.id);
  
  // Elimina del modo espectador si estaba
  delete spectators[socket.id];
  
  // Guarda información del jugador antes de eliminarlo (para el ranking)
  const disconnectedPlayer = players[socket.id];
  
  delete players[socket.id];
  io.emit('playerLeft', socket.id);

  // Si no hay jugadores, resetea el lobby y la partida
  if (Object.keys(players).length === 0) {
    if (lobbyTimer) clearInterval(lobbyTimer);
    lobbyTimer = null;
    lobbyStarted = false;
    gameStarted = false;
    spectators = {}; // Limpia espectadores
  }
  
  // Verifica si el juego debe terminar (solo queda 1 jugador vivo)
  checkGameEnd();
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
  if (gameStarted && Object.keys(players).length >= 2) {
    const elapsed = (Date.now() - gameStartTime) / 1000;
    const battleTimer = Math.max(0, 300 - elapsed);
    const maxRadius = Math.hypot(CENTER_X, CENTER_Y);
    const currentSafeRadius = maxRadius * (battleTimer / 300);

    if (orbs.length < 160) {
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
          orbs.push(orb);
          io.emit('newOrb', orb);
          break;
        }
        tries++;
      }
    }
  }
}, 900);

setInterval(() => {
  if (gameStarted && Object.keys(players).length >= 2) {
    const elapsed = (Date.now() - gameStartTime) / 1000;
    const battleTimer = Math.max(0, 300 - elapsed);
    const maxRadius = Math.hypot(CENTER_X, CENTER_Y);
    const currentSafeRadius = maxRadius * (battleTimer / 300);

    if (specialItems.length < 8) {
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
          specialItems.push(item);
          io.emit('newSpecialItem', item);
          break;
        }
        tries++;
      }
    }
  }
}, 6000);

setInterval(() => {
  if (gameStarted) {
    checkGameEnd();
  }
}, 2000); 