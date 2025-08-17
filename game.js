const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let mouseX = 0, mouseY = 0;
// El joystick pone estas coordenadas al mover
window.joystickOffsetX = 0;
window.joystickOffsetY = 0;
window.isJoystickActive = false;

canvas.addEventListener('mousemove', e => {
  // Solo permitir en PC o cuando no esté usando el joystick
  if (isMobileDevice() || isJoystickActive) return;
  const rect = canvas.getBoundingClientRect();
  mouseX = e.clientX - rect.left;
  mouseY = e.clientY - rect.top;
});

let waitingForPlayers = false;
let isOnline = false;
let socket;
let playerId = null;
let otherPlayers = {};


let gameStartTime = null;
let battleTimer = 300; // 5 minutos en segundos
let safeZoneDamage = 0;

let missiles = [];

let timeSinceLastGrowth = 0;
const decayInterval = 1000;
const decayAmount = 1;

let lastPolarityChange = 0;
const POLARITY_COOLDOWN = 3000;

let lastGameMode = null;
let deathPosition = null;
let showDeathOverlay = false;

let orbs = [];
const ORB_COUNT_MAX = 40;
const ORB_RADIUS = 5;

const worldWidth = 4000;
const worldHeight = 4000;

let currentSafeRadius = Math.hypot(worldWidth / 2, worldHeight / 2);
function launchMissile(p) {
let enemies = isOnline ? Object.values(otherPlayers).concat(player) : [...bots];
if (p.id !== 'player') enemies = enemies.filter(e => e.id !== p.id);
  let nearest = null, minDist = Infinity;
  for (let e of enemies) {
    if (e === p) continue;
    let d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d < 400 && d < minDist) {
      minDist = d;
      nearest = e;
    }
  }
if (nearest && minDist <= 400) {
    missiles.push({
      x: p.x,
      y: p.y,
      target: nearest,
      speed: 7,
      radius: 6,
      owner: p,
      explosionTimer: 0
    });
    nearest.targetedIndicatorUntil = Date.now() + 2000;

  }
}

function isMobileDevice() {
  return /Mobi|Android|iPhone/i.test(navigator.userAgent);
}

function createInitialOrbs() {
  orbs = [];
  for (let i = 0; i < 20; i++) {
    orbs.push({
      x: Math.random() * (worldWidth - 2 * ORB_RADIUS) + ORB_RADIUS,
      y: Math.random() * (worldHeight - 2 * ORB_RADIUS) + ORB_RADIUS,
      radius: ORB_RADIUS
    });
  }
}

function spawnOrb() {
  if (orbs.length >= 150) return; // Límite mayor: más orbes
  const x = Math.random() * (worldWidth - 200) + 100;
  const y = Math.random() * (worldHeight - 200) + 100;
  const radius = 3 + Math.random() * 2;
  orbs.push({ x, y, radius });
}

// Parámetros para fuerzas
const MIN_SPEED = 0.5;
const MAX_SPEED = 4;
const ATTRACTION_STRENGTH_BASE = 0.05;
const REPULSION_STRENGTH_BASE = 0.1;
const FIELD_FORCE_RADIUS_MULTIPLIER = 2;

function speedBySize(radius, fieldRadius = 60) {
  const minRadius = 10;
  const maxRadius = 150;
  const maxField = 150;

  let baseSpeed = 4.2;
  let speed = baseSpeed;

  // Penaliza según el campo electromagnético (como en agar.io)
  let slowdownFactor = (fieldRadius - 60) / (maxField - 60);
  speed -= slowdownFactor * 2.2; // penalización

  return Math.max(MIN_SPEED, speed);
}

function damageBySize(radius) {
  return 0.5 + (radius - 10) * 0.03; // Ajusta el 0.03 para más o menos escalado
}

function growOnKill(killer, victim) {
  // Crecimiento MUCHO mayor y vida al máximo
  const growth = Math.max(10, Math.floor(victim.radius * 1.2)); // antes 0.7, ahora 1.2
  const fieldGrowth = Math.max(20, Math.floor(victim.fieldRadius * 0.9)); // antes 0.5, ahora 0.9
  const healthGain = Math.max(60, Math.floor(victim.maxHealth * 1.2)); // antes 0.7, ahora 1.2

  killer.fieldRadius = Math.min(killer.fieldRadius + fieldGrowth, 150);
  killer.maxHealth += healthGain;
  killer.health = killer.maxHealth; // Vida al máximo SIEMPRE
  killer.kills = (killer.kills || 0) + 1; // Suma kill
}

let player = {
  id: 'player',
  name: localStorage.getItem('playerName') || "Jugador",
  x: worldWidth / 2,
  y: worldHeight / 2,
  radius: 10,
  polarity: 1,
  speed: 3,
  fieldRadius: 60,
  health: 100,
  maxHealth: 100,
  baseFieldRadius: 60,
  baseMaxHealth: 100,
  kills: 0,
  score: 0,
  velocity: { x: 0, y: 0 },
  hitTimer: 0
};

const BOT_COUNT = 3;

let bots = [];
function createBots() {
  bots = [];
  for (let i = 0; i < BOT_COUNT; i++) {
    bots.push({
      id: 'bot' + i,
      name: "Bot " + (i + 1),
      x: Math.random() * (worldWidth - 20) + 10,
      y: Math.random() * (worldHeight - 20) + 10,
      radius: 10,
      polarity: Math.random() < 0.5 ? 1 : -1,
      fieldRadius: 60,
      health: 100,
      maxHealth: 100,
      baseFieldRadius: 60,
      lastPolarityChange: 0,
      kills: 0,
      score: 0,
      speed: 4.2,
      behavior: Math.random() < 0.5 ? 'aggressive' : 'collector',
      velocity: { x: 0, y: 0 },
      hitTimer: 0
    });
  }
}

let keys = {};
document.addEventListener('keydown', e => {
  if (gameMode === null) return; // Añade esto
  keys[e.key.toLowerCase()] = true;
});
document.addEventListener('keyup', e => {
  if (gameMode === null) return; // Añade esto
  keys[e.key.toLowerCase()] = false;
});
document.addEventListener('keypress', e => {
  if (gameMode === null) return; // Ya lo tienes aquí, perfecto
  if (e.key === ' ') {
    const now = Date.now();
    if (player.frozenUntil && player.frozenUntil > now) return;
    if (now - lastPolarityChange > POLARITY_COOLDOWN) {
      player.polarity *= -1;
      lastPolarityChange = now;
    }
  }
});

function computeForce(entityA, entityB) {
  let dx = entityB.x - entityA.x;
  let dy = entityB.y - entityA.y;
  let dist = Math.sqrt(dx * dx + dy * dy);
  if (dist === 0) return { x: 0, y: 0 };

  let influenceDistance = entityA.fieldRadius + entityB.fieldRadius;
  if (dist > influenceDistance) return { x: 0, y: 0 };

  let nx = dx / dist;
  let ny = dy / dist;

  let samePolarity = (entityA.polarity === entityB.polarity);
  let overlap = 1 - (dist / influenceDistance);

  // Volumen estimado por radio³
  let volumeA = Math.pow(entityA.radius, 3);

  // Limitar el multiplicador para no descontrolar la fuerza
  let strengthMultiplier = Math.min(Math.max(volumeA / 1000, 0.2), 10);

  // Ajusta estos valores para la fuerza base
  const ATTRACTION_STRENGTH_BASE = 2.5;
  const REPULSION_STRENGTH_BASE = 2.8;

  let forceMagnitude;
  if (samePolarity) {
    // Repulsión fuerte si están muy cerca (núcleos en contacto)
    if (dist < entityA.radius + entityB.radius) {
      forceMagnitude = Math.max(-40, -REPULSION_STRENGTH_BASE * strengthMultiplier * (1 + overlap * 8));
    } else {
      forceMagnitude = -REPULSION_STRENGTH_BASE * strengthMultiplier * overlap;
    }
  } else {
    // ATRACCIÓN INSUPERABLE si los núcleos están tocando
    if (dist <= entityA.radius + entityB.radius) {
      forceMagnitude = 12; // Fuerza gigantesca, imposible separarse por movimiento
    } else {
      forceMagnitude = ATTRACTION_STRENGTH_BASE * strengthMultiplier * overlap;
    }
  }

  // Limita la fuerza máxima para evitar teletransporte (excepto cuando están pegados)
  if (!(dist <= entityA.radius + entityB.radius && !samePolarity)) {
    const MAX_FORCE = 40;
    forceMagnitude = Math.max(-MAX_FORCE, Math.min(MAX_FORCE, forceMagnitude));
  }

  return { x: nx * forceMagnitude, y: ny * forceMagnitude };
}
function updateMissiles(dt) {
  for (let i = missiles.length - 1; i >= 0; i--) {
    let m = missiles[i];
    if (!m.target || m.target.health <= 0) {
      missiles.splice(i, 1);
      continue;
    }
    let dx = m.target.x - m.x;
    let dy = m.target.y - m.y;
    let dist = Math.hypot(dx, dy);
    if (dist < m.radius + m.target.radius) {
      if (!(m.target.shieldUntil > Date.now())) {
        m.target.health = Math.max(0, m.target.health - m.target.maxHealth * 0.3);
        m.target.hitTimer = 10;
      }
      m.explosionTimer = 15;
      m.hitX = m.x;
      m.hitY = m.y;
      missiles.splice(i, 1);
      explosions.push(m);
      continue;
    }
    // BAJA la velocidad del misil aquí:
    m.x += (dx / dist) * (m.speed * 0.45); // antes era m.speed, ahora m.speed * 0.45
    m.y += (dy / dist) * (m.speed * 0.45);
  }
}
function updatePlayerMovement(deltaTime) {
  if (player.dead || player.health <= 0) return; 
  if (player.frozenUntil && player.frozenUntil > Date.now()) return;
  let totalForce = { x: 0, y: 0 };

  let others = isOnline ? Object.values(otherPlayers) : bots;
  others.forEach(other => {
    if (other.dead || other.health <= 0) return;
    let force = computeForce(player, other);
    totalForce.x += force.x;
    totalForce.y += force.y;
  });

  // Atracción hacia las orbs
  orbs.forEach(orb => {
    let dx = orb.x - player.x;
    let dy = orb.y - player.y;
    let dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < player.fieldRadius + orb.radius) {
      let nx = dx / dist;
      let ny = dy / dist;
      totalForce.x += nx * 0.05;
      totalForce.y += ny * 0.05;
    }
  });

  // Movimiento hacia el puntero del ratón (como Agar.io)
  let centerX = canvas.width / 2;
  let centerY = canvas.height / 2;
  let dx, dy;

  if (window.isJoystickActive && (Math.abs(window.joystickOffsetX) > 2 || Math.abs(window.joystickOffsetY) > 2)) {
    dx = window.joystickOffsetX;
    dy = window.joystickOffsetY;
  } else if (!isMobileDevice()) {
    dx = mouseX - centerX;
    dy = mouseY - centerY;
  }

  let distance = Math.sqrt(dx * dx + dy * dy);

  if (distance > 5) {
    let directionX = dx / distance;
    let directionY = dy / distance;
    let currentSpeed = speedBySize(player.radius, player.fieldRadius);
    // Suma la fuerza de movimiento a la fuerza total
    totalForce.x += directionX * currentSpeed;
    totalForce.y += directionY * currentSpeed;
  }

  // Suavizado
  const smoothing = 0.15;
  player.velocity.x += (totalForce.x - player.velocity.x) * smoothing;
  player.velocity.y += (totalForce.y - player.velocity.y) * smoothing;

  // Actualiza posición
  player.x += player.velocity.x * deltaTime * 0.06;
  player.y += player.velocity.y * deltaTime * 0.06;

  // Limita dentro del mundo
  player.x = Math.max(player.radius, Math.min(worldWidth - player.radius, player.x));
  player.y = Math.max(player.radius, Math.min(worldHeight - player.radius, player.y));
}

function update(deltaTime) {
  updateMissiles(deltaTime);
  updatePlayerMovement(deltaTime);
  applySafeZoneDamage();

  timeSinceLastGrowth += deltaTime;
  if (timeSinceLastGrowth >= decayInterval) {
  player.fieldRadius = Math.max(player.baseFieldRadius, player.fieldRadius - decayAmount * 0.1);
  player.maxHealth = Math.max(player.baseMaxHealth, player.maxHealth - decayAmount * 0.1);
    player.health = Math.min(player.health, player.maxHealth);
    timeSinceLastGrowth = 0;
  }
  if (gameStartTime) {
  const elapsed = (Date.now() - gameStartTime) / 1000;
  battleTimer = Math.max(0, 300 - elapsed);
  const maxRadius = Math.hypot(worldWidth / 2, worldHeight / 2);
  const minRadius = 0;
  currentSafeRadius = maxRadius * (battleTimer / 300);
  safeZoneDamage = 0.1 + (1 - battleTimer / 300) * 1.5;
}
}

function markTargeting() {
  // Limpia indicadores anteriores
  let allPlayers = isOnline ? [player, ...Object.values(otherPlayers)] : [player, ...bots];
  allPlayers.forEach(p => {
    p.isBeingTargeted = false;
    p.targeting = null;
  });

  allPlayers.forEach(p => {
    const offensiveItems = ["freeze", "hook", "missile"];
    let items = [p.specialItem1, p.specialItem2].filter(i => offensiveItems.includes(i));
    if (!items.length) return;

    // En online, enemigos son todos los demás jugadores
    let enemies = allPlayers.filter(e => e !== p && !e.dead && e.health > 0);
    let nearest = null, minDist = Infinity;

    for (let e of enemies) {
      let d = Math.hypot(p.x - e.x, p.y - e.y);
      if (d < 400 && d < minDist) {
        minDist = d;
        nearest = e;
      }
    }

    if (nearest && minDist < 400) {
      p.targeting = nearest;
      nearest.isBeingTargeted = true;
    } else {
      p.targeting = null;
    }
  });
}

function updateBot(bot, deltaTime) {
  if (bot.frozenUntil && bot.frozenUntil > Date.now()) return;
  if (bot.dead || bot.health <= 0) return;

  let targetX = bot.x, targetY = bot.y;
  const cx = worldWidth / 2, cy = worldHeight / 2;
  const distToCenter = Math.hypot(bot.x - cx, bot.y - cy);

  // 1. Si está fuera de la zona segura, prioriza volver al centro
  if (distToCenter > currentSafeRadius - bot.radius * 2) {
    let dx = cx - bot.x;
    let dy = cy - bot.y;
    let d = Math.hypot(dx, dy);
    if (d > 0) {
      targetX = bot.x + dx / d * 120;
      targetY = bot.y + dy / d * 120;
    }
  } else {
    // 2. Si tiene poca vida, busca orbes o usa escudo/repulsión si tiene
    if (bot.health < bot.maxHealth * 0.4 && (bot.specialItem1 === "shield" || bot.specialItem2 === "shield")) {
      if (bot.specialItem1 === "shield") activateSpecialItem(bot, "specialItem1");
      if (bot.specialItem2 === "shield") activateSpecialItem(bot, "specialItem2");
    }
    if (bot.health < bot.maxHealth * 0.4 && (bot.specialItem1 === "repulse" || bot.specialItem2 === "repulse")) {
      if (bot.specialItem1 === "repulse") activateSpecialItem(bot, "specialItem1");
      if (bot.specialItem2 === "repulse") activateSpecialItem(bot, "specialItem2");
    }

    // 3. Si hay enemigos cerca de polaridad distinta, ataca
    let enemies = [player, ...bots.filter(b => b !== bot && !b.dead && b.health > 0)];
let nearest = null, nearestDist = Infinity;
let attackable = enemies.filter(e => Math.hypot(e.x - bot.x, e.y - bot.y) < 400);

for (let e of attackable) {
  if (e === bot || e.dead || e.health <= 0) continue;
  let d = Math.hypot(e.x - bot.x, e.y - bot.y);
  if (d < nearestDist) {
    nearest = e;
    nearestDist = d;
  }
}

if (nearest) {
  const botScore = bot.kills * 100 + bot.fieldRadius;
  const enemyScore = nearest.kills * 100 + nearest.fieldRadius;
  const botPower = bot.health + bot.fieldRadius;
  const enemyPower = nearest.health + nearest.fieldRadius;

  const isStronger = botPower > enemyPower * 1.1;
  const isWeaker = botPower < enemyPower * 0.8;

  if (isStronger) {
    // Ataca
    targetX = nearest.x;
    targetY = nearest.y;

    if (bot.specialItem1 && ["missile", "freeze", "hook"].includes(bot.specialItem1)) {
    if (nearest.frozenUntil && nearest.frozenUntil > Date.now())

      activateSpecialItem(bot, "specialItem1");
    }
    if (bot.specialItem2 && ["missile", "freeze", "hook"].includes(bot.specialItem2)) {
      activateSpecialItem(bot, "specialItem2");
    }
  } else if (isWeaker) {
    // Huye (usa repulsión o escudo si tiene)
    const dx = bot.x - nearest.x;
    const dy = bot.y - nearest.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 0) {
      targetX = bot.x + dx / dist * 120;
      targetY = bot.y + dy / dist * 120;
    }

    if (bot.specialItem1 === "repulse") activateSpecialItem(bot, "specialItem1");
    if (bot.specialItem2 === "repulse") activateSpecialItem(bot, "specialItem2");
    if (bot.health < bot.maxHealth * 0.6 && (bot.specialItem1 === "shield" || bot.specialItem2 === "shield")) {
      if (bot.specialItem1 === "shield") activateSpecialItem(bot, "specialItem1");
      if (bot.specialItem2 === "shield") activateSpecialItem(bot, "specialItem2");
    }
  } else {
    // Neutral: aléjate o busca orbes
let orbTarget = orbs
  .filter(orb => Math.hypot(orb.x - cx, orb.y - cy) < currentSafeRadius - 100)
  .reduce((nearest, orb) => {
    let d = Math.hypot(orb.x - bot.x, orb.y - bot.y);
    return d < nearest.dist ? { orb, dist: d } : nearest;
  }, { orb: null, dist: Infinity });


    if (orbTarget.orb) {
      targetX = orbTarget.orb.x;
      targetY = orbTarget.orb.y;
    }
  }
}
{
      // 4. Si no hay enemigos cerca, busca orbes
let orbTarget = orbs
  .filter(orb => Math.hypot(orb.x - cx, orb.y - cy) < currentSafeRadius - 100)
  .reduce((nearest, orb) => {
    let d = Math.hypot(orb.x - bot.x, orb.y - bot.y);
    return d < nearest.dist ? { orb, dist: d } : nearest;
  }, { orb: null, dist: Infinity });
      if (orbTarget.orb) {
        targetX = orbTarget.orb.x;
        targetY = orbTarget.orb.y;
      }
    }
  }

  // Suma fuerzas de repulsión/atracción con otras entidades vivas
  let totalForce = { x: 0, y: 0 };
  [player, ...bots.filter(b => b !== bot && !b.dead && b.health > 0)].forEach(other => {
    let force = computeForce(bot, other);
    totalForce.x += force.x;
    totalForce.y += force.y;
  });

  // Atracción suave hacia orbs cercanos
  orbs.forEach(orb => {
    let dx = orb.x - bot.x;
    let dy = orb.y - bot.y;
    let dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < bot.fieldRadius + orb.radius) {
      let nx = dx / dist;
      let ny = dy / dist;
      totalForce.x += nx * 0.03;
      totalForce.y += ny * 0.03;
    }
  });

  // Fuerza hacia el objetivo
  if (targetX !== undefined && targetY !== undefined) {
    let dx = targetX - bot.x;
    let dy = targetY - bot.y;
    let dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 0) {
      totalForce.x += (dx / dist);
      totalForce.y += (dy / dist);
    }
  }

  // Limitar la fuerza total para que el bot no acelere más que su velocidad máxima
let botSpeed = speedBySize(bot.radius, bot.fieldRadius);
  let forceMag = Math.hypot(totalForce.x, totalForce.y);
  if (forceMag > botSpeed) {
    totalForce.x = (totalForce.x / forceMag) * botSpeed;
    totalForce.y = (totalForce.y / forceMag) * botSpeed;
  }

  // Suavizamos velocidad
  bot.velocity.x += (totalForce.x - bot.velocity.x) * 0.15;
  bot.velocity.y += (totalForce.y - bot.velocity.y) * 0.15;

  // Movemos bot ajustando por deltaTime y tamaño
  bot.x += bot.velocity.x * deltaTime * 0.06;
  bot.y += bot.velocity.y * deltaTime * 0.06;

  // Limitar dentro del mapa
  bot.x = Math.max(bot.radius, Math.min(worldWidth - bot.radius, bot.x));
  bot.y = Math.max(bot.radius, Math.min(worldHeight - bot.radius, bot.y));

  // Cambios de polaridad según comportamiento y proximidad
  const now = Date.now();
  if (now - bot.lastPolarityChange > POLARITY_COOLDOWN) {
    // Si está pegado a un enemigo de polaridad igual, cambia polaridad para poder separarse
    let stuckEnemy = [player, ...bots.filter(b => b !== bot && !b.dead && b.health > 0)]
      .find(e => e.polarity === bot.polarity && Math.hypot(e.x - bot.x, e.y - bot.y) < bot.radius + e.radius + 2);
    if (stuckEnemy) {
      bot.polarity *= -1;
      bot.lastPolarityChange = now;
    }
    // Si está muy débil, cambia polaridad para huir si es collector
    if (bot.behavior === 'collector' && bot.health < bot.maxHealth * 0.4 && now - bot.lastPolarityChange > 3000) {
      bot.polarity *= -1;
      bot.lastPolarityChange = now;
    }
  }

  // Decaimiento suave campo y salud máxima
  bot.fieldRadius = Math.max(bot.baseFieldRadius, bot.fieldRadius - decayAmount * 0.005);
  bot.health = Math.min(bot.health, bot.maxHealth);
}

function handleDamage() {
  // --- Daño entre jugadores humanos (online) ---
if (isOnline) {
  let allPlayers = [player, ...Object.values(otherPlayers)];
  for (let i = 0; i < allPlayers.length; i++) {
    let p1 = allPlayers[i];
    if (p1.dead || p1.health <= 0) continue;
    for (let j = i + 1; j < allPlayers.length; j++) {
      let p2 = allPlayers[j];
      if (p2.dead || p2.health <= 0) continue;
      let dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      if (dist < p1.radius + p2.radius && p1.polarity !== p2.polarity) {
        const p1Frozen = p1.frozenUntil && p1.frozenUntil > Date.now();
        const p2Frozen = p2.frozenUntil && p2.frozenUntil > Date.now();

        // Solo el que NO está congelado puede hacer daño
        if (!p1Frozen && !(p2.shieldUntil > Date.now())) p2.health -= damageBySize(p1.radius);
        if (!p2Frozen && !(p1.shieldUntil > Date.now())) p1.health -= damageBySize(p2.radius);
        p1.hitTimer = 10;
        p2.hitTimer = 10;

        // --- MUERTE DEL JUGADOR EN ONLINE (por colisión) ---
        if (p1.id === player.id && p1.health <= 0 && !p1.dead) {
          p1.health = 0; p1.dead = true; p1.specialItem1 = null; p1.specialItem2 = null;
          if (deathPosition === null) {
            let playersList = [player, ...Object.values(otherPlayers)];
            const totalPlayers = playersList.length;
            const muertosAntes = playersList.filter(p => p.dead && p !== player).length;
            deathPosition = totalPlayers - muertosAntes;
          }
          if (!waitingForPlayers && battleTimer > 0) {
            showEndOverlay("death", deathPosition);
            return;
          }
        }
        if (p2.id === player.id && p2.health <= 0 && !p2.dead) {
          p2.health = 0; p2.dead = true; p2.specialItem1 = null; p2.specialItem2 = null;
          if (deathPosition === null) {
            let playersList = [player, ...Object.values(otherPlayers)];
            const totalPlayers = playersList.length;
            const muertosAntes = playersList.filter(p => p.dead && p !== player).length;
            deathPosition = totalPlayers - muertosAntes;
          }
          if (!waitingForPlayers && battleTimer > 0) {
            showEndOverlay("death", deathPosition);
            return;
          }
        }

        // --- MUERTE de otros jugadores (no local) ---
        if (p1.health <= 0 && !p1.dead) {
          p1.health = 0; p1.dead = true; p1.specialItem1 = null; p1.specialItem2 = null;
          growOnKill(p2, p1);
        }
        if (p2.health <= 0 && !p2.dead) {
          p2.health = 0; p2.dead = true; p2.specialItem1 = null; p2.specialItem2 = null;
          growOnKill(p1, p2);
        }
      }
    }
  }
}
  // --- Daño jugador vs bots (modo bots) ---
  bots.forEach(bot => {
    const playerFrozen = player.frozenUntil && player.frozenUntil > Date.now();
    const botFrozen = bot.frozenUntil && bot.frozenUntil > Date.now();
    if (bot.dead || bot.health <= 0) return;
    let dist = Math.hypot(bot.x - player.x, bot.y - player.y);
    if (dist < player.radius + bot.radius) {
      if (player.polarity !== bot.polarity) {
        const playerDamage = damageBySize(player.radius);
        const botDamage = damageBySize(bot.radius);

        if (!(bot.shieldUntil > Date.now())) {
          bot.health -= playerFrozen ? 0 : playerDamage;
        }
        if (!(player.shieldUntil > Date.now())) {
          player.health -= botFrozen ? 0 : botDamage;
        }
        bot.hitTimer = 10;
        player.hitTimer = 10;
      }
      if (bot.health <= 0 && !bot.dead) {
        bot.health = 0;
        bot.dead = true;
        bot.hitTimer = 0;
        bot.specialItem1 = null;
        bot.specialItem2 = null;
        if (player && player.health > 0) {
          growOnKill(player, bot);
        }
      }
      // --- MUERTE DEL JUGADOR EN BOTS ---
      if (player.health <= 0 && !player.dead) {
        player.health = 0;
        player.dead = true;
        if (deathPosition === null) {
          let playersList = [player, ...bots];
          const totalPlayers = playersList.length;
          const muertosAntes = playersList.filter(p => p.dead && p !== player).length;
          deathPosition = totalPlayers - muertosAntes;
        }
        showEndOverlay("death", deathPosition);
        return;
      }
    }
  });

  // --- Daño bots vs bots ---
  for (let i = 0; i < bots.length; i++) {
    let b1 = bots[i];
    const b1Frozen = b1.frozenUntil && b1.frozenUntil > Date.now();
    if (b1.dead || b1.health <= 0) continue;
    for (let j = i + 1; j < bots.length; j++) {
      let b2 = bots[j];
      const b2Frozen = b2.frozenUntil && b2.frozenUntil > Date.now();
      if (b2.dead || b2.health <= 0) continue;
      let dist = Math.hypot(b1.x - b2.x, b1.y - b2.y);
      if (dist < b1.radius + b2.radius && b1.polarity !== b2.polarity) {
        if (!b1Frozen) b2.health -= 0.5;
        if (!b2Frozen) b1.health -= 0.5;
        b1.hitTimer = 10;
        b2.hitTimer = 10;
        if (b1.health <= 0 && !b1.dead) {
          b1.health = 0;
          b1.dead = true;
          b1.hitTimer = 0;
          b1.specialItem1 = null;
          b1.specialItem2 = null;
          if (b2 && b2.health > 0) {
            growOnKill(b2, b1);
          }
        }
        if (b2.health <= 0 && !b2.dead) {
          b2.health = 0;
          b2.dead = true;
          b2.hitTimer = 0;
          b2.specialItem1 = null;
          b2.specialItem2 = null;
          if (b1 && b1.health > 0) {
            growOnKill(b1, b2); 
         }
        }
      }
    }
  }

  // --- BLOQUE DE VICTORIA ---
  // Para modo bots
  if (!isOnline && !player.dead) {
    let vivos = [player, ...bots].filter(p => !p.dead && p.health > 0);
    if (vivos.length === 1 && vivos[0].id === player.id) {
      showEndOverlay("victory", 1);
      setTimeout(() => {
      showDeathOverlay = true;
      window._endType = "victory";
      window._endPosition = 1;
    }, 100); 
      player.dead = true;
      return;
    }
  }
  // Para modo online
if (isOnline && !player.dead && battleTimer > 0 && !waitingForPlayers) {
  let vivos = [player, ...Object.values(otherPlayers)].filter(p => !p.dead && p.health > 0);
  if (vivos.length === 1 && vivos[0].id === player.id) {
    showEndOverlay("victory", 1);
    player.dead = true;
    return;
  }
}
  // --- MUERTE DEL JUGADOR EN ONLINE ---
if (isOnline && player.health <= 0 && !player.dead) {
  player.health = 0;
  player.dead = true;
  if (deathPosition === null) {
    let playersList = [player, ...Object.values(otherPlayers)];
    const totalPlayers = playersList.length;
    const muertosAntes = playersList.filter(p => p.dead && p !== player).length;
    deathPosition = totalPlayers - muertosAntes;
  }
  if (!waitingForPlayers && battleTimer > 0) {
    showEndOverlay("death", deathPosition);
    setTimeout(() => {
      showDeathOverlay = true;
      window._endType = "death";
      window._endPosition = deathPosition;
    }, 100);
    // Desconecta al jugador al morir
    if (socket) {
      socket.disconnect();
      socket = null;
      isOnline = false;
      playerId = null;
      otherPlayers = {};
      waitingForPlayers = false;
    }
    return;
  }
  player.hitTimer = 0;
  player.specialItem1 = null;
  player.specialItem2 = null;
}
}

function applySafeZoneDamage() {
  const cx = worldWidth / 2;
  const cy = worldHeight / 2;
  let allPlayers = isOnline ? [player, ...Object.values(otherPlayers)] : [player, ...bots];

  allPlayers.forEach(p => {
    if (p.dead || p.health <= 0) return;
    const d = Math.hypot(p.x - cx, p.y - cy);
    if (d > currentSafeRadius && !(p.shieldUntil > Date.now())) {
      p.health -= safeZoneDamage;
      p.hitTimer = 5;

      if (p.health <= 0 && !p.dead) {
        p.health = 0;
        p.dead = true;
        p.specialItem1 = null;
        p.specialItem2 = null;
        // Si es el jugador local en online, muestra overlay de muerte
if (isOnline && p.id === player.id && !waitingForPlayers && battleTimer > 0) {
  if (deathPosition === null) {
    let playersList = [player, ...Object.values(otherPlayers)];
    const totalPlayers = playersList.length;
    const muertosAntes = playersList.filter(pl => pl.dead && pl !== player).length;
    deathPosition = totalPlayers - muertosAntes;
  }
  showEndOverlay("death", deathPosition);
  return;
        }
      }
    }
  });
}
// --- MEJORAS VISUALES Y DE RENDIMIENTO ---

// Añadimos hitTimer a player y bots para efecto de daño
player.hitTimer = 0;

// Mejora: Solo dibujar orbes visibles en pantalla
function drawOrbs(offsetX, offsetY) {
  ctx.fillStyle = 'yellow';
  orbs.forEach(o => {
    const drawX = o.x - offsetX;
    const drawY = o.y - offsetY;
    if (
      drawX + o.radius > 0 && drawX - o.radius < canvas.width &&
      drawY + o.radius > 0 && drawY - o.radius < canvas.height
    ) {
      ctx.beginPath();
      ctx.arc(drawX, drawY, o.radius, 0, 2 * Math.PI);
      ctx.fill();
    }
  });
}


// Mejora: Mostrar cooldown de polaridad sobre el jugador
function drawPolarityCooldown(e, offsetX, offsetY) {
  let now = Date.now();
  let cd = 1;
  // El jugador local usa la variable global
  if (e.id === player.id) {
    cd = Math.min(1, (now - lastPolarityChange) / POLARITY_COOLDOWN);
  } else {
    cd = Math.min(1, (now - (e.lastPolarityChange || 0)) / POLARITY_COOLDOWN);
  }
  if (cd < 1) {
    // Usa Math.round para evitar problemas de subpíxeles en móvil
    const drawX = Math.round(e.x - offsetX);
    const drawY = Math.round(e.y - offsetY);
    ctx.save();
    ctx.beginPath();
    ctx.arc(drawX, drawY, e.radius + 8, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * cd);
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 4;
    ctx.globalAlpha = 0.7;
    ctx.stroke();
    ctx.restore();
  }
}

function resetBotsMode() {
  lastGameMode = "bots";
  deathPosition = null;
  player.name = localStorage.getItem('playerName') || "Jugador";
  createInitialOrbs();
  createBots(); // ¡Esto es esencial!
  player.id = 'player';
  player.x = worldWidth / 2;
  player.y = worldHeight / 2;
  player.radius = 10;
  player.polarity = 1;
  player.fieldRadius = 60;
  player.health = 100;
  player.maxHealth = 100;
  player.kills = 0;
  player.velocity = { x: 0, y: 0 };
  player.hitTimer = 0;
  lastPolarityChange = 0;
  timeSinceLastGrowth = 0;
  orbSpawnTimer = 0;
  lastTime = performance.now();
  // Reinicia ranking de bots
  bots.forEach(b => { b.kills = 0; b.fieldRadius = b.baseFieldRadius; });
player.specialItem1 = null;
player.specialItem2 = null;
  bots.forEach(b => b.specialItem = null);
  gameStartTime = Date.now();
battleTimer = 300;
currentSafeRadius = Math.hypot(worldWidth, worldHeight); // MUCHÍSIMO más grande que el mapa
safeZoneDamage = 0;
player.dead = false;
player.health = player.maxHealth; 
bots.forEach(b => b.dead = false);
}

// Mejora: Animación de absorción de orbes (fade out)
let absorbedOrbs = [];
function handleOrbAbsorption() {
  let allPlayers = isOnline ? [player, ...Object.values(otherPlayers)] : [player];
  // Jugadores humanos recogen orbs
  for (let i = orbs.length - 1; i >= 0; i--) {
    let orb = orbs[i];
    for (let p of allPlayers) {
      if (Math.hypot(orb.x - p.x, orb.y - p.y) < p.radius + orb.radius) {
        absorbedOrbs.push({ ...orb, alpha: 1 });
        if (isOnline && orb.id) {
  socket.emit('orbCollected', orb.id);
}
        orbs.splice(i, 1);
        p.fieldRadius = Math.min(p.fieldRadius + 3, 150);
        p.maxHealth += 5;
        p.health = Math.min(p.health + p.maxHealth * 0.25, p.maxHealth);
        timeSinceLastGrowth = 0;
        break;
      }
    }
  }
  // Bots recogen orbs
  bots.forEach(bot => {
    for (let i = orbs.length - 1; i >= 0; i--) {
      let orb = orbs[i];
      if (Math.hypot(orb.x - bot.x, orb.y - bot.y) < bot.radius + orb.radius) {
        absorbedOrbs.push({ ...orb, alpha: 1 });
        orbs.splice(i, 1);
        bot.fieldRadius = Math.min(bot.fieldRadius + 3, 150);
        bot.maxHealth += 5;
        bot.health = Math.min(bot.health + bot.maxHealth * 0.25, bot.maxHealth);
      }
    }
  });
}

// Dibuja orbes absorbidos con fade out
function drawAbsorbedOrbs(offsetX, offsetY) {
  for (let i = absorbedOrbs.length - 1; i >= 0; i--) {
    let o = absorbedOrbs[i];
    ctx.save();
    ctx.globalAlpha = o.alpha;
    ctx.fillStyle = 'yellow';
    ctx.beginPath();
    ctx.arc(o.x - offsetX, o.y - offsetY, o.radius * o.alpha, 0, 2 * Math.PI);
    ctx.fill();
    ctx.restore();
    o.alpha -= 0.07;
    if (o.alpha <= 0) absorbedOrbs.splice(i, 1);
  }
}


function drawEntity(e, offsetX, offsetY) {
    if (e.dead || e.health <= 0) return; // No dibujar si está muerto
  const drawX = e.x - offsetX;
  const drawY = e.y - offsetY;
  ctx.save();
  if (e.hitTimer && e.hitTimer > 0) {
    ctx.globalAlpha = 0.5 + 0.5 * Math.sin(e.hitTimer * 2);
    e.hitTimer--;
  }
  // Color gris si está congelado
  let isFrozen = e.frozenUntil && e.frozenUntil > Date.now();
  let fieldColor = isFrozen
    ? 'rgba(180,180,180,0.4)'
    : (e.polarity === 1 ? 'rgba(255,50,50,0.4)' : 'rgba(50,100,255,0.4)');
  let coreColor = isFrozen
    ? '#bbb'
    : (e.polarity === 1 ? 'red' : 'blue');
  ctx.beginPath();
  ctx.arc(drawX, drawY, e.fieldRadius, 0, 2 * Math.PI);
  ctx.strokeStyle = fieldColor;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(drawX, drawY, e.radius, 0, 2 * Math.PI);
  ctx.fillStyle = coreColor;
  ctx.fill();
  if (e.repulseVisualUntil && e.repulseVisualUntil > Date.now()) {
  ctx.beginPath();
  ctx.arc(drawX, drawY, e.radius + 25, 0, 2 * Math.PI);
  ctx.strokeStyle = "white";
  ctx.lineWidth = 3;
  ctx.setLineDash([5, 5]);
  ctx.stroke();
  ctx.setLineDash([]);
}
if (e.repulseVisualUntil && e.repulseVisualUntil > Date.now()) {
  const t = 1 - (e.repulseVisualUntil - Date.now()) / 300;
  const rippleRadius = Math.max(1, e.radius + 25 + 80 * t); // Nunca negativo
  ctx.beginPath();
  ctx.arc(drawX, drawY, rippleRadius, 0, 2 * Math.PI);
  ctx.strokeStyle = `rgba(255,255,255,${1 - t})`;
  ctx.lineWidth = 4 * (1 - t);
  ctx.stroke();
}

if (e.shieldUntil && e.shieldUntil > Date.now()) {
  const pulse = 1 + 0.1 * Math.sin(performance.now() / 100);
  const shieldRadius = e.radius * 1.4 * pulse;

  ctx.save();
  ctx.globalAlpha = 0.35 + 0.25 * Math.sin(performance.now() / 150);
  ctx.fillStyle = 'rgba(0,255,0,0.2)';
  ctx.beginPath();
  ctx.arc(drawX, drawY, shieldRadius, 0, 2 * Math.PI);
  ctx.fill();

  ctx.strokeStyle = "lime";
  ctx.lineWidth = 2.5;
  ctx.shadowColor = "lime";
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.arc(drawX, drawY, shieldRadius, 0, 2 * Math.PI);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.restore();
}

  if (e.isBeingTargeted) {
  const drawX = e.x - offsetX;
  const drawY = e.y - offsetY;
  ctx.save();
  ctx.strokeStyle = 'red';
  ctx.lineWidth = 3;
  ctx.globalAlpha = 0.5 + 0.5 * Math.sin(performance.now() / 120);
  ctx.beginPath();
  ctx.arc(drawX, drawY, e.radius + 22, 0, 2 * Math.PI);
  ctx.setLineDash([4, 6]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}
  ctx.restore();

  // Dibuja el icono del objeto especial si lo tiene
  if (e.specialItem1) {
  drawSpecialItemIconOnEntity(e, drawX + e.radius + 12, drawY, e.specialItem1, "Q");
}
if (e.specialItem2) {
  drawSpecialItemIconOnEntity(e, drawX + e.radius + 32, drawY, e.specialItem2, "E");
}
// Dibuja el nombre debajo del núcleo
ctx.save();
ctx.font = "bold 16px Arial";
ctx.textAlign = "center";
ctx.textBaseline = "top";
ctx.strokeStyle = "#222";
ctx.lineWidth = 4;
const nameColor = e.polarity === 1 ? "#ff4444" : "#3399ff";
ctx.strokeText(e.name || "Jugador", drawX, drawY + e.radius + 10);
ctx.fillStyle = nameColor;
ctx.fillText(e.name || "Jugador", drawX, drawY + e.radius + 10);
ctx.restore();
}

function drawHealthBar(e, offsetX, offsetY) {
  if (e.dead || e.health <= 0) return; // No dibujar barra si está muerto
  const w = 80, h = 10;
  const x = e.x - w / 2 - offsetX;
  const y = e.y - e.fieldRadius - 20 - offsetY;
  ctx.fillStyle = '#555';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'limegreen';
  ctx.fillRect(x, y, Math.max(0, (e.health / e.maxHealth) * w), h);
  ctx.strokeStyle = 'black';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
}

function drawGrid(offsetX, offsetY, gridSize = 50) {
  ctx.strokeStyle = 'rgba(200, 200, 200, 0.1)';
  for (let x = -gridSize * 10; x < canvas.width + gridSize * 10; x += gridSize) {
    let px = x - (offsetX % gridSize);
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, canvas.height);
    ctx.stroke();
  }
  for (let y = -gridSize * 10; y < canvas.height + gridSize * 10; y += gridSize) {
    let py = y - (offsetY % gridSize);
    ctx.beginPath();
    ctx.moveTo(0, py);
    ctx.lineTo(canvas.width, py);
    ctx.stroke();
  }
  if (battleTimer > 0) {
  ctx.save();
  ctx.strokeStyle = "rgba(255,0,0,0.3)";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(worldWidth / 2 - offsetX, worldHeight / 2 - offsetY, currentSafeRadius, 0, 2 * Math.PI);
  ctx.stroke();
  ctx.restore();
}
if (battleTimer > 0) {
  const cx = worldWidth / 2 - offsetX;
  const cy = worldHeight / 2 - offsetY;
  const step = 20;
  ctx.save();
  ctx.fillStyle = 'rgba(255,0,0,0.07)';
  for (let y = 0; y < canvas.height; y += step) {
    for (let x = 0; x < canvas.width; x += step) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > currentSafeRadius) {
        ctx.fillRect(x, y, step, step);
      }
    }
  }
  ctx.restore();
}
}

function drawMiniMap() {
  const w = 110, h = 110, pad = 18;
  const mapX = canvas.width - w - pad;
  const mapY = canvas.height - h - pad;

  // El área jugable es worldWidth x worldHeight
  const scaleX = (w - 20) / worldWidth;
  const scaleY = (h - 20) / worldHeight;

  // Fondo minimapa (oscuro)
  ctx.save();
  ctx.globalAlpha = 0.92;
  ctx.shadowColor = "#222";
  ctx.shadowBlur = 10;
  ctx.fillStyle = darkMode ? "#10131a" : "#e3f0ff";
  ctx.fillRect(mapX + 10, mapY + 10, worldWidth * scaleX, worldHeight * scaleY);
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
  ctx.restore();

// Niebla roja fuera del círculo seguro
if (battleTimer > 0) {
  const cx = mapX + 10 + (worldWidth / 2) * scaleX;
  const cy = mapY + 10 + (worldHeight / 2) * scaleY;
  const r = currentSafeRadius * scaleX;
  const step = 4; // más pequeño = más suave

  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = "red";
  for (let y = 0; y < worldHeight * scaleY; y += step) {
    for (let x = 0; x < worldWidth * scaleX; x += step) {
      const dx = (x + mapX + 10) - cx;
      const dy = (y + mapY + 10) - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > r) {
        ctx.fillRect(mapX + 10 + x, mapY + 10 + y, step, step);
      }
    }
  }
  ctx.restore();
}

// ...en drawMiniMap, reemplaza el bloque del borde rojo por:
if (battleTimer > 0) {
  const cx = mapX + 10 + (worldWidth / 2) * scaleX;
  const cy = mapY + 10 + (worldHeight / 2) * scaleY;
  const r = currentSafeRadius * scaleX;

  ctx.save();
  // Recorta el dibujo al área del minimapa
  ctx.beginPath();
  ctx.rect(mapX + 10, mapY + 10, worldWidth * scaleX, worldHeight * scaleY);
  ctx.clip();

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, 2 * Math.PI);
  ctx.strokeStyle = "red";
  ctx.lineWidth = 2.5;
  ctx.globalAlpha = 0.85;
  ctx.shadowColor = "red";
  ctx.shadowBlur = 8;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.restore();
}

  // Borde blanco
  ctx.save();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.strokeRect(mapX + 10, mapY + 10, worldWidth * scaleX, worldHeight * scaleY);
  ctx.restore();

  // Dibuja los objetos especiales en el minimapa
  drawSpecialItemsOnMinimap(scaleX, scaleY, mapX, mapY);

  // Orbes
  let orbPulse = 1 + 0.2 * Math.sin(performance.now() / 200);
  orbs.forEach(o => {
    ctx.save();
    ctx.globalAlpha = 0.7 + 0.3 * orbPulse;
    ctx.fillStyle = 'yellow';
    ctx.beginPath();
    ctx.arc(mapX + 10 + o.x * scaleX, mapY + 10 + o.y * scaleY, 2 * orbPulse, 0, 2 * Math.PI);
    ctx.fill();
    ctx.restore();
  });

  // Bots
  bots.forEach(b => {
    if (b.dead) return;
    let botPulse = 1 + 0.08 * Math.sin(performance.now() / 400 + b.x + b.y);
    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.arc(mapX + 10 + b.x * scaleX, mapY + 10 + b.y * scaleY, 5 * botPulse, 0, 2 * Math.PI);
    ctx.fillStyle = b.polarity === 1 ? "#ff4444" : "#3399ff";
    ctx.shadowColor = b.polarity === 1 ? "#ff4444" : "#3399ff";
    ctx.shadowBlur = 8 * botPulse;
    ctx.fill();
    ctx.restore();
  });

  // Jugadores online en el minimapa
if (isOnline) {
  for (const id in otherPlayers) {
    const p = otherPlayers[id];
    if (p.dead) continue;
    let playerPulse = 1 + 0.10 * Math.sin(performance.now() / 300 + p.x + p.y);
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(mapX + 10 + p.x * scaleX, mapY + 10 + p.y * scaleY, 7 * playerPulse, 0, 2 * Math.PI);
    ctx.fillStyle = "#fff";
    ctx.shadowColor = "#fff";
    ctx.shadowBlur = 10 * playerPulse;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(mapX + 10 + p.x * scaleX, mapY + 10 + p.y * scaleY, 4.5 * playerPulse, 0, 2 * Math.PI);
    ctx.fillStyle = p.polarity === 1 ? "#ff4444" : "#3399ff";
    ctx.shadowBlur = 0;
    ctx.fill();
    ctx.restore();
  }
} 

  // Jugador
  if (!player.dead) {
    let playerPulse = 1 + 0.10 * Math.sin(performance.now() / 300);
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(mapX + 10 + player.x * scaleX, mapY + 10 + player.y * scaleY, 7 * playerPulse, 0, 2 * Math.PI);
    ctx.fillStyle = "#fff";
    ctx.shadowColor = "#fff";
    ctx.shadowBlur = 10 * playerPulse;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(mapX + 10 + player.x * scaleX, mapY + 10 + player.y * scaleY, 4.5 * playerPulse, 0, 2 * Math.PI);
    ctx.fillStyle = player.polarity === 1 ? "#ff4444" : "#3399ff";
    ctx.shadowBlur = 0;
    ctx.fill();
    ctx.restore();
  }
}
// Ranking minimalista y sin mostrar size
function drawRanking() {
let playersList = isOnline ? [player, ...Object.values(otherPlayers)] : [player, ...bots];  playersList.forEach(p => p.score = p.kills * 100 + Math.floor(p.fieldRadius));
  playersList.sort((a, b) => b.score - a.score);

  // Solo top 3
  playersList = playersList.slice(0, 3);

// --- Cálculo de altura dinámica para el ranking ---
const rowHeight = 38; // Debe coincidir con el espacio vertical entre jugadores
const baseY = 47;     // Y inicial del primer jugador
const extraBottom = 18; // Espacio extra abajo para que no se corte

const rankingHeight = baseY + playersList.length * rowHeight + extraBottom;

// Fondo minimalista con sombra y borde redondeado, opacidad más baja
ctx.save();
ctx.globalAlpha = 0.70;
ctx.shadowColor = "#222";
ctx.shadowBlur = 8;
ctx.fillStyle = 'rgba(30,40,60,0.80)';
ctx.beginPath();
ctx.moveTo(20, 10);
ctx.lineTo(180, 10);
ctx.quadraticCurveTo(200, 10, 200, 30);
ctx.lineTo(200, rankingHeight - 20);
ctx.quadraticCurveTo(200, rankingHeight, 180, rankingHeight);
ctx.lineTo(20, rankingHeight);
ctx.quadraticCurveTo(0, rankingHeight, 0, rankingHeight - 20);
ctx.lineTo(0, 30);
ctx.quadraticCurveTo(0, 10, 20, 10);
ctx.closePath();
ctx.fill();
ctx.shadowBlur = 0;
ctx.globalAlpha = 1;
ctx.restore();

// Borde blanco fino
ctx.save();
ctx.strokeStyle = '#fff';
ctx.lineWidth = 1.5;
ctx.beginPath();
ctx.moveTo(20, 10);
ctx.lineTo(180, 10);
ctx.quadraticCurveTo(200, 10, 200, 30);
ctx.lineTo(200, rankingHeight - 20);
ctx.quadraticCurveTo(200, rankingHeight, 180, rankingHeight);
ctx.lineTo(20, rankingHeight);
ctx.quadraticCurveTo(0, rankingHeight, 0, rankingHeight - 20);
ctx.lineTo(0, 30);
ctx.quadraticCurveTo(0, 10, 20, 10);
ctx.closePath();
ctx.stroke();
ctx.restore();

  // Título minimalista
  ctx.save();
  ctx.font = 'bold 15px Arial';
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.fillText('RANKING', 100, 27);
  ctx.restore();

  // Lista de jugadores (máx 3, no se salen del recuadro)
for (let i = 0; i < playersList.length; i++) {
  let p = playersList[i];
  let y = 47 + i * 38; // Aumenta el espacio vertical
  let color = p.polarity === 1 ? '#ff4444' : '#3399ff';
  let shadow = color;
  let pulse = 1 + 0.08 * Math.sin(performance.now() / 200 + i);

  ctx.save();
  ctx.font = `bold 15px Arial`;
  ctx.fillStyle = color;
  ctx.shadowColor = shadow;
  ctx.shadowBlur = 6 * pulse;
  ctx.textAlign = 'left';

  // Nombre (alineado a la izquierda)
  let nick = p.name || "Jugador";
  // Limita el ancho del nombre para que no se salga
  let maxNameWidth = 120;
  if (ctx.measureText(nick).width > maxNameWidth) {
    while (ctx.measureText(nick + '…').width > maxNameWidth && nick.length > 0) {
      nick = nick.slice(0, -1);
    }
    nick += '…';
  }
  ctx.fillText(`${i + 1}. ${nick}`, 26, y);

  ctx.shadowBlur = 0;
  ctx.font = '13px Arial';
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'left';
  // Score y kills debajo del nombre, alineados a la izquierda
  let scoreText = `Score: ${p.score}   Kills: ${p.kills}`;
  let maxScoreWidth = 150;
  if (ctx.measureText(scoreText).width > maxScoreWidth) {
    while (ctx.measureText(scoreText + '…').width > maxScoreWidth && scoreText.length > 0) {
      scoreText = scoreText.slice(0, -1);
    }
    scoreText += '…';
  }
  ctx.fillText(scoreText, 40, y + 16); // Un poco a la derecha y debajo del nombre
  ctx.restore();
}
}

function drawDeathOverlay() {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "white";
  ctx.textAlign = "center";

if (window._endType === "victory") {
  ctx.font = "bold 54px Arial";
  ctx.fillStyle = "#00ff44"; // Verde brillante
  ctx.fillText("¡VICTORIA!", canvas.width / 2, canvas.height / 2 - 80);
  ctx.fillStyle = "white";
  ctx.font = "32px Arial";
  ctx.fillText("¡HAS QUEDADO EN LA POSICIÓN #1!", canvas.width / 2, canvas.height / 2 - 20);
} else {
    ctx.font = "bold 48px Arial";
    ctx.fillText("¡Has muerto!", canvas.width / 2, canvas.height / 2 - 80);
    ctx.font = "32px Arial";
    ctx.fillText(
      `Has quedado en la posición #${window._endPosition !== null ? window._endPosition : "?"}`,
      canvas.width / 2,
      canvas.height / 2 - 20
    );
  }

  // Botón: Jugar de nuevo
  ctx.fillStyle = "#33cc33";
  ctx.fillRect(canvas.width / 2 - 160, canvas.height / 2 + 40, 140, 50);
  ctx.fillStyle = "#fff";
  ctx.font = "20px Arial";
  ctx.fillText("Jugar de nuevo", canvas.width / 2 - 90, canvas.height / 2 + 72);

  // Botón: Volver al menú
  ctx.fillStyle = "#cc3333";
  ctx.fillRect(canvas.width / 2 + 20, canvas.height / 2 + 40, 140, 50);
  ctx.fillStyle = "#fff";
  ctx.fillText("Volver al menú", canvas.width / 2 + 90, canvas.height / 2 + 72);

  ctx.restore();
}

// --- MENÚ PRINCIPAL MAGNÉTICO CON MODO OSCURO ---
let gameMode = null; // null = menú, 'bots', '1vs1', 'online'
let menuSelection = 0;
let darkMode = true;
const menuOptions = [
  { name: "BATTLE ROYALE BOTS", mode: "bots" },
  { name: "ONLINE (PRÓXIMAMENTE)", mode: "online" }
];
const extraOptions = [
  { name: () => darkMode ? "☀️ MODO DÍA: OFF" : "☀️ MODO DÍA: ON", action: () => { darkMode = !darkMode; } }
];
let totalMenuOptions = menuOptions.length + extraOptions.length;


canvas.addEventListener("touchstart", function (e) {
  if (gameMode !== null) return;

  const rect = canvas.getBoundingClientRect();
  const touch = e.touches[0];
  const x = (touch.clientX - rect.left) * (canvas.width / rect.width);
  const y = (touch.clientY - rect.top) * (canvas.height / rect.height);

  for (let i = 0; i < totalMenuOptions; i++) {
    // Calcula la Y exactamente igual que en drawMagnetMenu
    let isExtra = i >= menuOptions.length;
    let yOption = 320 + i * 70 + (isExtra ? 30 : 0);
    let optionTop = yOption - 34;
    let optionBottom = optionTop + 40;
    let centerX = canvas.width / 2;

    if (y >= optionTop && y <= optionBottom && Math.abs(x - centerX) < 250) {
      menuSelection = i;

      if (menuSelection < menuOptions.length) {
        if (menuOptions[menuSelection].mode === "online") {
          startOnlineMode();
        }
        gameMode = menuOptions[menuSelection].mode;
        if (gameMode === "bots") resetBotsMode();
      } else {
        // Opción extra (como modo día/noche)
        extraOptions[menuSelection - menuOptions.length].action();
      }
      break;
    }
  }
});

document.addEventListener('keydown', function menuNav(e) {
  if (gameMode !== null) return;
  if (["ArrowUp", "w", "W"].includes(e.key)) {
    menuSelection = (menuSelection + totalMenuOptions - 1) % totalMenuOptions;
  }
  if (["ArrowDown", "s", "S"].includes(e.key)) {
    menuSelection = (menuSelection + 1) % totalMenuOptions;
  }
  if (e.key === "Enter") {
    if (menuSelection < menuOptions.length) {
      if (menuOptions[menuSelection].mode === "online") {
        startOnlineMode();
      }
      gameMode = menuOptions[menuSelection].mode;
      if (gameMode === "bots") resetBotsMode();
    } else {
      extraOptions[menuSelection - menuOptions.length].action();
    }
  }
});

document.addEventListener('keydown', function (e) {
  if (e.key === "Escape") {
    window.exitToMenu();
  }
});

// Dibuja un imán simple (polo: 1=rojo+, -1=azul-)
function drawMagnet(x, y, w, h, polarity) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.arc(x + w, y + h / 2, h / 2, -Math.PI / 2, Math.PI / 2, false);
  ctx.lineTo(x, y + h);
  ctx.arc(x, y + h / 2, h / 2, Math.PI / 2, -Math.PI / 2, false);
  ctx.closePath();
  ctx.fillStyle = polarity === 1 ? "#ff4444" : "#3399ff";
  ctx.shadowColor = polarity === 1 ? "#ff4444" : "#3399ff";
  ctx.shadowBlur = 12;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.restore();

  // Polo decorativo
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + (polarity === 1 ? w - 18 : 18), y + h / 2, 14, 0, 2 * Math.PI);
  ctx.fillStyle = "#fff";
  ctx.fill();
  ctx.font = "bold 20px Arial";
  ctx.fillStyle = polarity === 1 ? "#ff4444" : "#3399ff";
  ctx.textAlign = "center";
  ctx.fillText(polarity === 1 ? "+" : "-", x + (polarity === 1 ? w - 18 : 18), y + h / 2 + 7);
  ctx.restore();
}

// --- DIBUJO DEL MENÚ ---
function drawMagnetMenu() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Fondo gradiente según modo
  if (darkMode) {
    ctx.fillStyle = "#10131a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else {
    let grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    grad.addColorStop(0, "#e3f0ff");
    grad.addColorStop(1, "#b3cfff");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // Título con imanes
  ctx.save();
  ctx.font = "bold 54px Arial";
  ctx.textAlign = "center";
  ctx.shadowColor = darkMode ? "#fff" : "#3399ff";
  ctx.shadowBlur = 18;
  ctx.fillStyle = "#ff4444";
  ctx.fillText("MAGNET.IO", canvas.width / 2, 110);
  ctx.shadowBlur = 0;
  ctx.restore();

  // Dibuja dos imanes enfrentados (más grandes y arriba)
  let mx = canvas.width / 2 - 180, my = 170;
  drawMagnet(mx - 120, my, 120, 40, 1);
  drawMagnet(mx + 360, my, 120, 40, -1);

  // Opciones de menú con animación y separación visual
  for (let i = 0; i < menuOptions.length; i++) {
    let y = 320 + i * 70;
    let pulse = 1 + 0.08 * Math.sin(performance.now() / 200 + i);

    // Opción de menú
    ctx.save();
    ctx.font = menuSelection === i ? "bold 34px Arial" : "28px Arial";
    ctx.textAlign = "center";
    ctx.globalAlpha = menuSelection === i ? 1 : 0.7;
    ctx.shadowColor = menuSelection === i ? "#ff4444" : "#3399ff";
    ctx.shadowBlur = menuSelection === i ? 16 * pulse : 0;
    ctx.fillStyle = menuSelection === i ? "#ff4444" : "#3399ff";
    ctx.fillText(menuOptions[i].name, canvas.width / 2, y);
    ctx.restore();

    // Polos decorativos alineados con el texto
    const poloYOffset = 10;
    const poloOffset = 260;

    ctx.save();
    ctx.beginPath();
    ctx.arc(canvas.width / 2 - poloOffset, y - poloYOffset, 15, 0, 2 * Math.PI);
    ctx.fillStyle = "#ff4444";
    ctx.fill();
    ctx.font = "bold 22px Arial";
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("+", canvas.width / 2 - poloOffset, y - poloYOffset);

    ctx.beginPath();
    ctx.arc(canvas.width / 2 + poloOffset, y - poloYOffset, 15, 0, 2 * Math.PI);
    ctx.fillStyle = "#3399ff";
    ctx.fill();
    ctx.font = "bold 22px Arial";
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("-", canvas.width / 2 + poloOffset, y - poloYOffset);
    ctx.restore();
  }

  // Opciones extra (modo oscuro)
  for (let i = 0; i < extraOptions.length; i++) {
    let idx = menuOptions.length + i;
    let y = 320 + idx * 70 + 30;
    ctx.save();
    ctx.font = menuSelection === idx ? "bold 26px Arial" : "22px Arial";
    ctx.textAlign = "center";
    ctx.globalAlpha = menuSelection === idx ? 1 : 0.7;
    ctx.shadowColor = menuSelection === idx ? "#ff4444" : "#3399ff";
    ctx.shadowBlur = menuSelection === idx ? 12 : 0;
    ctx.fillStyle = menuSelection === idx ? "#ff4444" : "#3399ff";
    ctx.fillText(extraOptions[i].name(), canvas.width / 2, y);
    ctx.restore();
  }
  // Al final de drawMagnetMenu, después de dibujar las opciones extra:
const nameDiv = document.getElementById('nameContainer');
if (nameDiv) {
  // Calcula la posición debajo de las opciones extra
  let y = 320 + (menuOptions.length + extraOptions.length) * 70 + 30;
  // Si es móvil, sube el campo un poco para que no quede tan abajo
  if (window.innerWidth <= 700) {
    y = 320 + (menuOptions.length + extraOptions.length) * 70 - 10;
  }
  nameDiv.style.top = `${y}px`;
}
  // Instrucciones
  ctx.save();
  ctx.font = "18px Arial";
  ctx.fillStyle = darkMode ? "#eee" : "#222";
  ctx.globalAlpha = 0.7;
  ctx.fillText("Usa ↑ y ↓ o W/S para navegar. ENTER para seleccionar.", canvas.width / 2, canvas.height - 40);
  ctx.restore();
}

// --- FONDO EN GAMELOOP Y GAMELOOP1VS1 ---
function gameLoop(time = 0) {
  // Fondo según modo oscuro
  if (darkMode) {
    ctx.fillStyle = "#10131a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  const offsetX = player.x - canvas.width / 2;
  const offsetY = player.y - canvas.height / 2;
  const deltaTime = time - lastTime;
  lastTime = time;

  drawGrid(offsetX, offsetY);
  update(deltaTime);
  bots.forEach(bot => handleSpecialItemPickup(bot));
  handleDamage();
  handleOrbAbsorption();

  // Solo generar orbes y objetos especiales si NO es online
  if (!isOnline) {
    lastSpecialItemSpawn += deltaTime;
    if (lastSpecialItemSpawn > SPECIAL_ITEM_RESPAWN_INTERVAL) {
      spawnSpecialItem();
      lastSpecialItemSpawn = 0;
    }

    orbSpawnTimer += deltaTime;
    if (orbSpawnTimer > ORB_SPAWN_INTERVAL) {
      spawnOrb();
      orbSpawnTimer = 0;
    }
  }
  
  handleSpecialItemPickup(player);

  drawOrbs(offsetX, offsetY);
  drawSpecialItems(offsetX, offsetY);
  drawAbsorbedOrbs(offsetX, offsetY);
  drawMissiles(offsetX, offsetY);
  markTargeting();
  drawEntity(player, offsetX, offsetY);
  drawPolarityCooldown(player, offsetX, offsetY);

  drawEntity(player, offsetX, offsetY);
  drawPolarityCooldown(player, offsetX, offsetY);
  drawHealthBar(player, offsetX, offsetY);

  if (isOnline) {
  for (const id in otherPlayers) {
    const p = otherPlayers[id];
    drawEntity(p, offsetX, offsetY);
    drawHealthBar(p, offsetX, offsetY);
    drawPolarityCooldown(p, offsetX, offsetY);
  }
}
  drawPolarityCooldown(player, offsetX, offsetY);
  drawHealthBar(player, offsetX, offsetY);
  bots.forEach(bot => {
  if (bot.dead || bot.health <= 0) return;
  updateBot(bot, deltaTime);
  updateBotSpecialItem(bot);
  handleSpecialItemPickup(bot);
  drawEntity(bot, offsetX, offsetY);
  drawPolarityCooldown(bot, offsetX, offsetY);
  drawHealthBar(bot, offsetX, offsetY);
  if (isOnline) {
  for (const id in otherPlayers) {
    const p = otherPlayers[id];
    drawEntity(p, offsetX, offsetY);
    drawHealthBar(p, offsetX, offsetY);
    // Si quieres, también puedes mostrar el nombre o los objetos especiales aquí
  }
}
}); 

ctx.save();
ctx.font = "bold 28px Arial";
ctx.fillStyle = "white";
ctx.textAlign = "center";
ctx.fillText(
  `${Math.floor(battleTimer / 60).toString().padStart(2, '0')}:${Math.floor(battleTimer % 60).toString().padStart(2, '0')}`,
  canvas.width / 2, 40
);
ctx.restore();

  drawMiniMap();
  drawRanking();
if (showDeathOverlay) {
  drawDeathOverlay();
}
}

// --- FIN DEL CÓDIGO DE MENÚ --- //

let lastTime = 0;
let orbSpawnTimer = 0;
const ORB_SPAWN_INTERVAL = 1500;

function resetOnlineMode(orbsFromServer, startTimeFromServer, specialItemsFromServer) {
  deathPosition = null;
  showDeathOverlay = false;
  window._endType = null;
  window._endPosition = null;
  player.name = localStorage.getItem('playerName') || "Jugador";
  orbs = orbsFromServer || [];
  specialItems = specialItemsFromServer || [];
  player.x = worldWidth / 2;
  player.y = worldHeight / 2;
  player.radius = 10;
  player.polarity = 1;
  player.fieldRadius = 60;
  player.health = 100;
  player.maxHealth = 100;
  player.kills = 0;
  player.velocity = { x: 0, y: 0 };
  player.hitTimer = 0;
  lastPolarityChange = 0;
  timeSinceLastGrowth = 0;
  orbSpawnTimer = 0;
  lastTime = performance.now();
  player.specialItem1 = null;
  player.specialItem2 = null;
  gameStartTime = startTimeFromServer || Date.now();
  battleTimer = 300;
  currentSafeRadius = Math.hypot(worldWidth, worldHeight);
  safeZoneDamage = 0;
  player.dead = false;
  player.health = player.maxHealth;
  bots = [];
}

function startOnlineMode() {
  lastGameMode = "online";
  isOnline = true;
  gameMode = "online";
  showDeathOverlay = false;
  window._endType = null;
  window._endPosition = null;
  player.dead = false;
  deathPosition = null;
  waitingForPlayers = true; // <-- CLAVE: siempre empieza esperando

  // Si ya hay un socket abierto, ciérralo antes de abrir uno nuevo
  if (socket) {
    socket.disconnect();
    socket = null;
  }

  // Conecta al servidor
  socket = io();

  socket.on('lobbyCountdown', ({ timeLeft }) => {
  waitingForPlayers = true;
  window._lobbyTimeLeft = timeLeft;
});

socket.on('lobbyFailed', () => {
  // Vuelve al menú si no hay suficientes jugadores
  alert("No se han conectado suficientes jugadores. Volviendo al menú.");
  gameMode = null;
  waitingForPlayers = false;
  player.dead = false;
  if (socket) {
    socket.disconnect();
    socket = null;
    isOnline = false;
    playerId = null;
    otherPlayers = {};
  }
});

socket.on("init", ({ id, players }) => {
  playerId = id;
  player.id = playerId;
  // --- CORREGIDO: sincroniza la posición local con la del servidor ---
  if (players[playerId]) {
    player.x = players[playerId].x;
    player.y = players[playerId].y;
    player.radius = players[playerId].radius;
    player.polarity = players[playerId].polarity;
    player.fieldRadius = players[playerId].fieldRadius;
    player.health = players[playerId].health;
    player.maxHealth = players[playerId].maxHealth;
    player.dead = players[playerId].dead;
    player.name = players[playerId].name || player.name;
    player.specialItem1 = players[playerId].specialItem1 || null;
    player.specialItem2 = players[playerId].specialItem2 || null;
    player.frozenUntil = players[playerId].frozenUntil || 0;
    player.shieldUntil = players[playerId].shieldUntil || 0;
    player.repulseVisualUntil = players[playerId].repulseVisualUntil || 0;
    player.hitTimer = players[playerId].hitTimer || 0;
    player.lastPolarityChange = players[playerId].lastPolarityChange || 0;
    player.kills = players[playerId].kills || 0;
    player.velocity = players[playerId].velocity || { x: 0, y: 0 };
  }
  otherPlayers = {};
  for (const pid in players) {
    if (pid !== playerId) {
      otherPlayers[pid] = {
        ...players[pid],
        id: pid,
        name: players[pid]?.name || "Jugador",
        radius: players[pid]?.radius || 10,
        polarity: players[pid]?.polarity || 1,
        fieldRadius: players[pid]?.fieldRadius || 60,
        health: players[pid]?.health || 100,
        maxHealth: players[pid]?.maxHealth || 100,
        dead: players[pid]?.dead || false,
        velocity: players[pid]?.velocity || { x: 0, y: 0 },
        hitTimer: players[pid]?.hitTimer || 0,
        specialItem1: players[pid]?.specialItem1 || null,
        specialItem2: players[pid]?.specialItem2 || null,
        frozenUntil: players[pid]?.frozenUntil || 0,
        shieldUntil: players[pid]?.shieldUntil || 0,
        repulseVisualUntil: players[pid]?.repulseVisualUntil || 0,
        lastPolarityChange: players[pid]?.lastPolarityChange || 0,
        kills: players[pid]?.kills || 0
      };
    }
  }
  waitingForPlayers = true;

  // Emite posición inmediatamente (esto ya lo tienes)
  if (isOnline && socket && playerId) {
    socket.emit("update", {
      x: player.x,
      y: player.y,
      name: player.name,
      radius: player.radius,
      polarity: player.polarity,
      fieldRadius: player.fieldRadius,
      health: player.health,
      maxHealth: player.maxHealth,
      dead: player.dead,
      specialItem1: player.specialItem1,
      specialItem2: player.specialItem2,
      frozenUntil: player.frozenUntil,
      shieldUntil: player.shieldUntil,
      repulseVisualUntil: player.repulseVisualUntil,
      hitTimer: player.hitTimer,
      lastPolarityChange
    });
  }
});

  socket.on('newOrb', (orb) => {
    orbs.push(orb);
  });

  socket.on('removeOrb', (orbId) => {
    orbs = orbs.filter(o => o.id !== orbId);
  });

  socket.on('newSpecialItem', (item) => {
    specialItems.push(item);
  });

  socket.on('removeSpecialItem', (itemId) => {
    specialItems = specialItems.filter(i => i.id !== itemId);
  });

socket.on("startGame", ({ orbs, startTime, specialItems: items }) => {
  resetOnlineMode(orbs, startTime, items);
  waitingForPlayers = false;
  window._lobbyTimeLeft = undefined;

  if (isOnline && socket && playerId) {
    lastTime = performance.now();
    requestAnimationFrame(mainLoop);
  }
});

socket.on("update", ({ id, data }) => {
  if (id === playerId) return;
  if (!otherPlayers[id]) {
    otherPlayers[id] = {};
  }
  if (typeof data.lastPolarityChange !== "undefined") {
    otherPlayers[id].lastPolarityChange = data.lastPolarityChange;
  }
  Object.assign(otherPlayers[id], data);
});

socket.on("playerLeft", (id) => {
  delete otherPlayers[id];
  // Si solo queda el jugador local y la partida está en marcha, muestra victoria
  if (
    isOnline &&
    !player.dead &&
    !waitingForPlayers &&
    battleTimer > 0 &&
    Object.values(otherPlayers).filter(p => !p.dead && p.health > 0).length === 0
  ) {
    showEndOverlay("victory", 1);
    setTimeout(() => {
      showDeathOverlay = true;
      window._endType = "victory";
      window._endPosition = 1;
    }, 100);
    player.dead = true;
    return;
  }
  if (Object.keys(otherPlayers).length + 1 < 2) {
    waitingForPlayers = true;
  }
});

socket.on('specialAction', ({ type, from, to, slot, frozenUntil, shieldUntil }) => {
  const fromPlayer = from === playerId ? player : otherPlayers[from];
  const toPlayer = to ? (to === playerId ? player : otherPlayers[to]) : null;

  if (!fromPlayer || (["freeze", "hook", "missile"].includes(type) && !toPlayer)) return;

  if (type === "freeze") {
    // Usa el frozenUntil recibido del servidor
    toPlayer.frozenUntil = frozenUntil || (Date.now() + 2000);
    toPlayer.velocity.x = 0;
    toPlayer.velocity.y = 0;
    toPlayer.hitTimer = 10;
  } else if (type === "shield") {
    // Usa el shieldUntil recibido del servidor
    fromPlayer.shieldUntil = shieldUntil || (Date.now() + 3000);
  } else if (type === "missile") {
    missiles.push({
      x: fromPlayer.x,
      y: fromPlayer.y,
      target: toPlayer,
      speed: 7,
      radius: 6,
      owner: fromPlayer,
      explosionTimer: 0
    });
    toPlayer.targetedIndicatorUntil = Date.now() + 2000;
  } else if (type === "repulse") {
    let enemies = [player, ...Object.values(otherPlayers)].filter(
      e => e && typeof e.x === "number" && typeof e.y === "number" && e.id !== fromPlayer.id && !e.dead && e.health > 0
    );
    enemies.forEach(e => {
      let dx = e.x - fromPlayer.x;
      let dy = e.y - fromPlayer.y;
      let dist = Math.hypot(dx, dy);
      if (dist < 150 && dist > 0) {
        let factor = 80 * (1 - dist / 150);
        let nx = dx / dist;
        let ny = dy / dist;
        e.velocity.x += nx * factor;
        e.velocity.y += ny * factor;
      }
    });
    fromPlayer.repulseVisualUntil = Date.now() + 300;
  } else if (type === "hook") {
    let dx = fromPlayer.x - toPlayer.x;
    let dy = fromPlayer.y - toPlayer.y;
    let dist = Math.hypot(dx, dy);
    if (dist > 0) {
      let minDist = fromPlayer.radius + toPlayer.radius + 2;
      toPlayer.x = fromPlayer.x - dx / dist * minDist;
      toPlayer.y = fromPlayer.y - dy / dist * minDist;
    }
    toPlayer.hitTimer = 10;
  }

  if (fromPlayer[slot]) fromPlayer[slot] = null;
});

socket.on('syncPlayers', (playersObj) => {
  otherPlayers = {};
  for (const id in playersObj) {
    if (id !== playerId) {
      otherPlayers[id] = {
        ...playersObj[id],
        id,
        name: playersObj[id]?.name || "Jugador",
        radius: playersObj[id]?.radius || 10,
        polarity: playersObj[id]?.polarity || 1,
        fieldRadius: playersObj[id]?.fieldRadius || 60,
        health: playersObj[id]?.health || 100,
        maxHealth: playersObj[id]?.maxHealth || 100,
        dead: playersObj[id]?.dead || false,
        velocity: playersObj[id]?.velocity || { x: 0, y: 0 },
        hitTimer: playersObj[id]?.hitTimer || 0,
        specialItem1: playersObj[id]?.specialItem1 || null,
        specialItem2: playersObj[id]?.specialItem2 || null,
        frozenUntil: playersObj[id]?.frozenUntil || 0,
        shieldUntil: playersObj[id]?.shieldUntil || 0,
        repulseVisualUntil: playersObj[id]?.repulseVisualUntil || 0,
        lastPolarityChange: playersObj[id]?.lastPolarityChange || 0,
        kills: playersObj[id]?.kills || 0
      };
    }
  }
});
}

// --- OBJETOS ESPECIALES (Completos) ---
const SPECIAL_ITEM_TYPES = ["freeze", "hook", "missile", "repulse", "shield"];
let specialItems = [];
const SPECIAL_ITEM_RADIUS = 7;
const SPECIAL_ITEM_RESPAWN_INTERVAL = 10000;
let lastSpecialItemSpawn = 0;

// Asignar item al jugador/bot si aún no tiene
function handleSpecialItemPickup(p) {
  if (p.specialItem1 && p.specialItem2) return;

  for (let i = specialItems.length - 1; i >= 0; i--) {
    const item = specialItems[i];
    const dist = Math.hypot(item.x - p.x, item.y - p.y);
    if (dist < p.radius + item.radius) {
      if (!p.specialItem1) {
        p.specialItem1 = item.type;
      } else if (!p.specialItem2) {
        p.specialItem2 = item.type;
      }
      if (isOnline && item.id) {
  socket.emit('specialItemCollected', item.id);
}
      specialItems.splice(i, 1);
      break;
    }
  }
}

function activateSpecialItem(p, slot) {
  const type = p[slot];
  if (p.frozenUntil && p.frozenUntil > Date.now()) return;
  if (!type) return;

  let enemies = isOnline ? Object.values(otherPlayers) : [...bots];
  enemies = enemies.filter(e => e && typeof e.x === "number" && e.id !== p.id);

  if (["freeze", "hook", "missile", "repulse"].includes(type)) {
    let target = null;
    if (type !== "repulse") {
      for (let e of enemies) {
        if (e.dead || e.health <= 0) continue;
        let d = Math.hypot(e.x - p.x, e.y - p.y);
        if (d < 400) {
          target = e;
          break;
        }
      }
      if (!target) return;
    }
    if (isOnline && socket) {
      socket.emit('specialAction', {
        type,
        slot,
        from: playerId, // <-- Usa playerId, no p.id
        to: target ? target.id : null
      });
      p[slot] = null;
      return;
    }
  }

  // Solo en bots
  if (type === "freeze") applyFreezeToNearestEnemy(p);
  else if (type === "missile") launchMissile(p);
  else if (type === "repulse") applyRepulsion(p);
  else if (type === "shield") applyShield(p);
  else if (type === "hook") applyHook(p);

  p[slot] = null;
}

function applyFreezeToNearestEnemy(p) {
  let enemies = isOnline ? Object.values(otherPlayers) : [...bots];
  enemies = enemies.filter(e => e && e.id !== p.id);

  let nearest = null, minDist = Infinity;
  for (let e of enemies) {
    let d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d < 400 && d < minDist) {
      minDist = d;
      nearest = e;
    }
  }

  if (nearest && minDist <= 400) {
    nearest.frozenUntil = Date.now() + 2000;
    nearest.velocity.x = 0;
    nearest.velocity.y = 0;
    nearest.hitTimer = 10;
  }
}

function applyRepulsion(p) {
  let enemies = isOnline ? Object.values(otherPlayers) : [...bots];
  enemies = enemies.filter(e => e && typeof e.x === "number" && e.id !== p.id);

  enemies.forEach(e => {
    let dx = e.x - p.x;
    let dy = e.y - p.y;
    let dist = Math.hypot(dx, dy);
    if (dist < 150) {
      let factor = 80 * (1 - dist / 150);
      let nx = dx / dist;
      let ny = dy / dist;
      e.velocity.x += nx * factor;
      e.velocity.y += ny * factor;
    }
  });

  p.repulseVisualUntil = Date.now() + 300;
}

function applyShield(p) {
  p.shieldUntil = Date.now() + 3000;
}

function applyHook(p) {
  let enemies = isOnline ? Object.values(otherPlayers) : [...bots];
  enemies = enemies.filter(e => e && e.id !== p.id);

  let nearest = null, minDist = Infinity;
  for (let e of enemies) {
    let d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d < 400 && d < minDist) {
      minDist = d;
      nearest = e;
    }
  }
  if (nearest && minDist <= 400) {
    let dx = p.x - nearest.x;
    let dy = p.y - nearest.y;
    let dist = Math.hypot(dx, dy);
    if (dist > 0) {
      let minDist = p.radius + nearest.radius + 2;
      nearest.x = p.x - dx / dist * minDist;
      nearest.y = p.y - dy / dist * minDist;
    }
    nearest.hitTimer = 10;
  }
}

function spawnSpecialItem() {
  if (specialItems.length >= 5) return;
  const type = SPECIAL_ITEM_TYPES[Math.floor(Math.random() * SPECIAL_ITEM_TYPES.length)];
  const x = Math.random() * (worldWidth - 2 * SPECIAL_ITEM_RADIUS) + SPECIAL_ITEM_RADIUS;
  const y = Math.random() * (worldHeight - 2 * SPECIAL_ITEM_RADIUS) + SPECIAL_ITEM_RADIUS;
  specialItems.push({ x, y, type, radius: SPECIAL_ITEM_RADIUS });
}

// --- NUEVO: Dibuja iconos de special items con emojis y coherencia ---
function drawSpecialItemIconUnified(type, x, y, size = 18, keyLabel = null, showKeyAbove = false) {
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = 0.97;

  // Fondo sutil para resaltar el icono
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, size / 2.1, 0, 2 * Math.PI);
  ctx.fillStyle = "rgba(30,30,30,0.18)";
  ctx.shadowColor = "#000";
  ctx.shadowBlur = 6;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.restore();

  ctx.save();
  switch (type) {
    case "freeze": // Copo de nieve azul claro
      ctx.strokeStyle = "#00eaff";
      ctx.lineWidth = size * 0.16;
      for (let i = 0; i < 6; i++) {
        ctx.save();
        ctx.rotate((Math.PI / 3) * i);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, -size * 0.38);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, -size * 0.22);
        ctx.lineTo(size * 0.09, -size * 0.30);
        ctx.moveTo(0, -size * 0.22);
        ctx.lineTo(-size * 0.09, -size * 0.30);
        ctx.stroke();
        ctx.restore();
      }
      break;
    case "hook": // Gancho morado, forma de anzuelo
      ctx.strokeStyle = "#d600ff";
      ctx.lineWidth = size * 0.18;
      ctx.beginPath();
      ctx.arc(0, size * 0.13, size * 0.28, Math.PI * 0.2, Math.PI * 1.15, false);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -size * 0.32);
      ctx.lineTo(0, size * 0.13);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(size * 0.13, size * 0.23);
      ctx.lineTo(0, size * 0.13);
      ctx.lineTo(-size * 0.13, size * 0.23);
      ctx.stroke();
      break;
    case "missile": // Bomba naranja con mecha y chispa
      ctx.save();
      // Bomba
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.23, 0, 2 * Math.PI);
      ctx.fillStyle = "#ff6600";
      ctx.shadowColor = "#ff6600";
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;
      // Mecha
      ctx.beginPath();
      ctx.moveTo(0, -size * 0.23);
      ctx.lineTo(0, -size * 0.38);
      ctx.strokeStyle = "#222";
      ctx.lineWidth = size * 0.13;
      ctx.stroke();
      // Chispa
      ctx.beginPath();
      ctx.arc(0, -size * 0.41, size * 0.09, 0, 2 * Math.PI);
      ctx.fillStyle = "#ffd700";
      ctx.fill();
      ctx.restore();
      break;
    case "repulse": // Pulso blanco/gris, doble círculo y líneas radiales
      ctx.save();
      ctx.strokeStyle = "#eee";
      ctx.lineWidth = size * 0.13;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.22, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.33, 0, 2 * Math.PI);
      ctx.stroke();
      // Líneas radiales
      for (let i = 0; i < 4; i++) {
        ctx.save();
        ctx.rotate((Math.PI / 2) * i);
        ctx.beginPath();
        ctx.moveTo(0, -size * 0.13);
        ctx.lineTo(0, -size * 0.33);
        ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
      break;
    case "shield": // Escudo verde claro con cruz blanca
      ctx.save();
      // Forma de escudo
      ctx.beginPath();
      ctx.moveTo(0, -size * 0.28);
      ctx.lineTo(size * 0.18, -size * 0.08);
      ctx.lineTo(size * 0.13, size * 0.22);
      ctx.lineTo(0, size * 0.32);
      ctx.lineTo(-size * 0.13, size * 0.22);
      ctx.lineTo(-size * 0.18, -size * 0.08);
      ctx.closePath();
      ctx.fillStyle = "#7fffaf";
      ctx.globalAlpha = 0.85;
      ctx.shadowColor = "#00e676";
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      ctx.lineWidth = size * 0.13;
      ctx.strokeStyle = "#00e676";
      ctx.stroke();
      // Cruz blanca
      ctx.lineWidth = size * 0.09;
      ctx.strokeStyle = "#fff";
      ctx.beginPath();
      ctx.moveTo(0, -size * 0.13);
      ctx.lineTo(0, size * 0.18);
      ctx.moveTo(-size * 0.09, 0.03);
      ctx.lineTo(size * 0.09, 0.03);
      ctx.stroke();
      ctx.restore();
      break;
    default:
      break;
  }
  ctx.restore();

  // Tecla (si aplica)
  if (keyLabel) {
    ctx.font = "bold 14px Arial";
    ctx.textAlign = "center";
    ctx.lineWidth = 3.5;
    // Borde negro para que siempre se vea
    ctx.strokeStyle = "#111";
    ctx.strokeText(keyLabel, 0, showKeyAbove ? -size / 2 - 7 : size / 2 + 12);
    ctx.fillStyle = "#fff";
    ctx.globalAlpha = 1;
    ctx.fillText(keyLabel, 0, showKeyAbove ? -size / 2 - 7 : size / 2 + 12);
  }
  ctx.restore();
}

function drawSpecialItems(offsetX, offsetY) {
  specialItems.forEach(item => {
    drawSpecialItemIconUnified(item.type, item.x - offsetX, item.y - offsetY, 22);
  });
}

function drawSpecialItemIconOnEntity(e, x, y, type, keyLabel) {
  // Muestra la tecla encima del icono
  drawSpecialItemIconUnified(type, x, y, 18, keyLabel, true);
}

function activateClosestEnemy(p, targets) {
  let closest = null, minDist = Infinity;
  for (let t of targets) {
    const d = Math.hypot(p.x - t.x, p.y - t.y);
    if (d < minDist) {
      minDist = d; closest = t;
    }
  }
  if (closest) activateSpecialItem(p, closest);
}

// Teclas para activar
document.addEventListener('keydown', e => {
  if (gameMode === "bots" && e.key === "e") activateClosestEnemy(player, bots);
if (e.key.toLowerCase() === 'q' && player.specialItem1) {
  activateSpecialItem(player, 'specialItem1');
}

if (e.key.toLowerCase() === 'e' && player.specialItem2) {
  activateSpecialItem(player, 'specialItem2');
  }
});

let explosions = [];
function drawMissiles(offsetX, offsetY) {
  missiles.forEach(m => {
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "orange";
    ctx.beginPath();
    ctx.arc(m.x - offsetX, m.y - offsetY, m.radius, 0, 2 * Math.PI);
    ctx.fill();
    ctx.restore();
  });

  for (let i = explosions.length - 1; i >= 0; i--) {
    const e = explosions[i];
    if (e.explosionTimer > 0) {
      ctx.save();
      ctx.globalAlpha = e.explosionTimer / 15;
      ctx.fillStyle = "red";
      ctx.beginPath();
      ctx.arc(e.hitX - offsetX, e.hitY - offsetY, 20 - (15 - e.explosionTimer) * 1.3, 0, 2 * Math.PI);
      ctx.fill();
      ctx.restore();
      e.explosionTimer--;
    } else {
      explosions.splice(i, 1);
    }
  }
}
// Mostrar en minimapa
function drawSpecialItemsOnMinimap(scaleX, scaleY, mapX, mapY) {
  specialItems.forEach(o => {
    // Tamaño intermedio (12), borde blanco para destacar
    ctx.save();
    drawSpecialItemIconUnified(o.type, mapX + 10 + o.x * scaleX, mapY + 10 + o.y * scaleY, 12);
    ctx.beginPath();
    ctx.arc(mapX + 10 + o.x * scaleX, mapY + 10 + o.y * scaleY, 8, 0, 2 * Math.PI);
    ctx.strokeStyle = "#fff";
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
  });
}
// Lógica para que los bots usen los objetos especiales
function updateBotSpecialItem(bot) {
  const now = Date.now();
  const offensiveItems = ["freeze", "hook", "missile"];
  const defensiveItems = ["shield", "repulse"];

  let enemies = [player, ...bots.filter(b => b !== bot)];
  let nearbyEnemies = enemies.filter(e => Math.hypot(bot.x - e.x, bot.y - e.y) < 250);
  let lowHealth = bot.health < bot.maxHealth * 0.4;

  ['specialItem1', 'specialItem2'].forEach(slot => {
    const item = bot[slot];
    if (!item) return;

    if (item === "repulse" && nearbyEnemies.length >= 2) {
      activateSpecialItem(bot, slot);
    } else if (item === "shield" && lowHealth) {
      activateSpecialItem(bot, slot);
    } else if (offensiveItems.includes(item) && nearbyEnemies.length > 0) {
      if (Math.random() < 0.02) activateSpecialItem(bot, slot);
    }
  });

  // SI NO TIENE OBJETO Y HAY ALGUNO CERCA, IR A POR ÉL
  if (!bot.specialItem1 || !bot.specialItem2) {
    const nearbyItem = specialItems.find(i => Math.hypot(i.x - bot.x, i.y - bot.y) < 200);
    if (nearbyItem) {
      bot.targetX = nearbyItem.x;
      bot.targetY = nearbyItem.y;
    }
  }
}

canvas.addEventListener('click', e => {
if (!showDeathOverlay) return;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  const cx = canvas.width / 2;

// Jugar de nuevo
if (x > cx - 160 && x < cx - 20 && y > canvas.height / 2 + 40 && y < canvas.height / 2 + 90) {
    showDeathOverlay = false;
  if (lastGameMode === "online") {
    startOnlineMode();
  } else {
    resetBotsMode();
  }
}
  // Volver al menú
  if (x > cx + 20 && x < cx + 160 && y > canvas.height / 2 + 40 && y < canvas.height / 2 + 90) {
    showDeathOverlay = false;
    gameMode = null;
    player.dead = false; // Si está en el contexto de muerte

// Si estabas en online, desconecta el socket y limpia todo
if (isOnline && socket) {
  socket.disconnect();
  socket = null;
  isOnline = false;
  playerId = null;
  otherPlayers = {};
  waitingForPlayers = false;
  // Limpia tu jugador local
  player.x = worldWidth / 2;
  player.y = worldHeight / 2;
  player.radius = 10;
  player.polarity = 1;
  player.fieldRadius = 60;
  player.health = 100;
  player.maxHealth = 100;
  player.kills = 0;
  player.velocity = { x: 0, y: 0 };
  player.hitTimer = 0;
  player.specialItem1 = null;
  player.specialItem2 = null;
  player.dead = false;
}
}
});

canvas.addEventListener('touchstart', function(e) {
if (!showDeathOverlay) return;
  const rect = canvas.getBoundingClientRect();
  const touch = e.touches[0];
  const x = (touch.clientX - rect.left) * (canvas.width / rect.width);
  const y = (touch.clientY - rect.top) * (canvas.height / rect.height);

  const cx = canvas.width / 2;

  // Jugar de nuevo
if (x > cx - 160 && x < cx - 20 && y > canvas.height / 2 + 40 && y < canvas.height / 2 + 90) {
    showDeathOverlay = false;
  if (lastGameMode === "online") {
    startOnlineMode();
  } else {
    resetBotsMode();
  }
}

  // Volver al menú
  if (x > cx + 20 && x < cx + 160 && y > canvas.height / 2 + 40 && y < canvas.height / 2 + 90) {
    showDeathOverlay = false;
    gameMode = null;
    player.dead = false; // Si está en el contexto de muerte

// Si estabas en online, desconecta el socket y limpia todo
if (isOnline && socket) {
  socket.disconnect();
  socket = null;
  isOnline = false;
  playerId = null;
  otherPlayers = {};
  waitingForPlayers = false;
  // Limpia tu jugador local
  player.x = worldWidth / 2;
  player.y = worldHeight / 2;
  player.radius = 10;
  player.polarity = 1;
  player.fieldRadius = 60;
  player.health = 100;
  player.maxHealth = 100;
  player.kills = 0;
  player.velocity = { x: 0, y: 0 };
  player.hitTimer = 0;
  player.specialItem1 = null;
  player.specialItem2 = null;
  player.dead = false;
}
  }
});

window.exitToMenu = function() {
  deathPosition = null;
  gameMode = null;
  player.dead = false;
  // Si estabas en online, desconecta el socket y limpia todo
  if (isOnline && socket) {
    socket.disconnect();
    socket = null;
    isOnline = false;
    playerId = null;
    otherPlayers = {};
    waitingForPlayers = false;
    // Limpia tu jugador local
    player.x = worldWidth / 2;
    player.y = worldHeight / 2;
    player.radius = 10;
    player.polarity = 1;
    player.fieldRadius = 60;
    player.health = 100;
    player.maxHealth = 100;
    player.kills = 0;
    player.velocity = { x: 0, y: 0 };
    player.hitTimer = 0;
    player.specialItem1 = null;
    player.specialItem2 = null;
    player.dead = false;
  }
  // Si estabas en bots, reinicia el estado del jugador y bots
  if (gameMode === null) {
    resetBotsMode();
    bots.forEach(b => b.dead = false);
    player.dead = false;
  }
};

function changePolarity() {
  const now = Date.now();
  if (player.frozenUntil && player.frozenUntil > now) return;
  if (now - lastPolarityChange > POLARITY_COOLDOWN) {
    player.polarity *= -1;
    lastPolarityChange = now;
    if (isOnline && socket && playerId) {
      socket.emit("update", {
        lastPolarityChange: lastPolarityChange
      });
    }
  }
}

function useSpecial(slot) {
  activateSpecialItem(player, slot);
}

function showEndOverlay(type, position = null) {
  showDeathOverlay = true;
  player.dead = true;
  window._endType = type; // "death" o "victory"
  window._endPosition = position;
  // Desconecta del servidor SOLO si ya estabas conectado
  if (isOnline && socket) {
    socket.disconnect();
    socket = null;
    isOnline = false;
    playerId = null;
    otherPlayers = {};
    waitingForPlayers = false;
  }
}

function mainLoop(time = 0) {
  document.getElementById('nameContainer').style.display = (gameMode === null) ? 'block' : 'none';
  if (showDeathOverlay) {
    drawDeathOverlay();
    requestAnimationFrame(mainLoop);
    return;
  }
  if (gameMode === null) {
    drawMagnetMenu();
  } else if (gameMode === "online" && waitingForPlayers && typeof window._lobbyTimeLeft === "number") {
    // SOLO muestra la pantalla de espera si hay tiempo de lobby
    ctx.save();
    ctx.fillStyle = darkMode ? "#10131a" : "#e3f0ff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = "bold 38px Arial";
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.fillText("Esperando jugadores...", canvas.width / 2, canvas.height / 2 - 60);
    ctx.font = "32px Arial";
    ctx.fillText(
      `Jugadores conectados: ${1 + Object.keys(otherPlayers).length} / 10`,
      canvas.width / 2,
      canvas.height / 2 - 10
    );
    ctx.font = "28px Arial";
    if (typeof window._lobbyTimeLeft === "number") {
      ctx.fillText(
        `La partida empieza en: ${window._lobbyTimeLeft} s`,
        canvas.width / 2,
        canvas.height / 2 + 40
      );
    }
    ctx.restore();
    // Solo emite posición, NO ejecuta gameLoop ni handleDamage
    if (isOnline && socket && playerId) {
      if (socket) socket.emit("update", {
        x: player.x,
        y: player.y,
        name: player.name,
        radius: player.radius,
        polarity: player.polarity,
        fieldRadius: player.fieldRadius,
        health: player.health,
        maxHealth: player.maxHealth,
        dead: player.dead,
        specialItem1: player.specialItem1,
        specialItem2: player.specialItem2,
        frozenUntil: player.frozenUntil,
        shieldUntil: player.shieldUntil,
        repulseVisualUntil: player.repulseVisualUntil,
        hitTimer: player.hitTimer,
        lastPolarityChange
      });
    }
  } else if (gameMode === "bots") {
    gameLoop(time);
    if (showDeathOverlay) {
      drawDeathOverlay();
    }
  } else if (gameMode === "online" && (!waitingForPlayers || typeof window._lobbyTimeLeft !== "number")) {
    // SOLO aquí ejecuta la partida online
    gameLoop(time);
    if (isOnline && socket && playerId) {
      if (socket) socket.emit("update", {
        x: player.x,
        y: player.y,
        name: player.name,
        radius: player.radius,
        polarity: player.polarity,
        fieldRadius: player.fieldRadius,
        health: player.health,
        maxHealth: player.maxHealth,
        dead: player.dead,
        specialItem1: player.specialItem1,
        specialItem2: player.specialItem2,
        frozenUntil: player.frozenUntil,
        shieldUntil: player.shieldUntil,
        repulseVisualUntil: player.repulseVisualUntil,
        hitTimer: player.hitTimer
      });
    }
  }
  requestAnimationFrame(mainLoop);
}
mainLoop();