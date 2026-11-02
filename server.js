const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
app.use(cors());

// Tự tìm thư mục chứa index.html (dù nằm cùng cấp hay trong thư mục con)
const GAME_DIR = fs.existsSync(path.join(__dirname, 'index.html'))
  ? __dirname
  : path.join(__dirname, '3D-Space-Shooter-main');
console.log('Thư mục game:', GAME_DIR);

app.use('/3D-Space-Shooter-main', express.static(path.join(__dirname, '3D-Space-Shooter-main')));
app.get('/', (req, res) => res.sendFile(path.join(GAME_DIR, 'index.html')));
app.use(express.static(GAME_DIR));
app.get('/health', (req, res) => res.send('ok'));

// ==========================================
// THÔNG SỐ
// ==========================================
const MAX_PLAYERS = { coop: 4, pvp: 2 };
const SHIP_HP = { '1': 100, '2': 70, '3': 150 };
const SHIP_CD = { '1': 0.25, '2': 0.20, '3': 0.35 };
const BOT_DIFFICULTY = 2; // 1..3: dễ - vừa - khó
const BOT_PROFILE = {
  1: { reactionMs: 260, aimError: 0.85, fireBias: 1.15, stray: 0.9, chaseBias: 0.8 },
  2: { reactionMs: 170, aimError: 0.45, fireBias: 1, stray: 0.65, chaseBias: 1 },
  3: { reactionMs: 100, aimError: 0.22, fireBias: 0.8, stray: 0.45, chaseBias: 1.18 },
};
const SHIP_FOLLOW_SPEED = 12;
const SHIP_MAX_SPEED = 18;
const SHIP_ACCEL = 70;
const SHIP_STOP_RADIUS = 0.28;
const SHIP_SPEED_BY_CLASS = {
  destroyer: 18,
  corvette: 20,
  frigate: 16,
  cruiser: 13,
  dreadnought: 11,
};

const COOP_CONFIG = {
  LEGACY_MODE: false, // true restores the old asteroid-only Co-op simulation.
  ARENA: 14,
  MAX_PLAYERS: 4,
  SHIP_HP: 100,
  ARMOR_MAX: 50,
  ARMOR_DAMAGE_ABSORPTION: 1,
  BULLET_DAMAGE: 25,
  BULLET_SPEED: 28,
  BULLET_COOLDOWN_MS: 220,
  BULLET_RADIUS: 0.35,
  PLAYER_RADIUS: 0.9,
  RESPAWN_SECONDS: 3,
  SPAWN_INVULNERABILITY_SECONDS: 2,
  WIN_SCORE: 10,
  MATCH_SECONDS: 300,
  TICK_MS: 33,
  MOVE_SPEED: 16,
};

const COOP = {
  ARENA: COOP_CONFIG.ARENA,
  SHIELD: COOP_CONFIG.ARMOR_MAX,
  BULLET_SPEED: COOP_CONFIG.BULLET_SPEED,
  TICK_MS: COOP_CONFIG.TICK_MS,
  HIT_DAMAGE: COOP_CONFIG.BULLET_DAMAGE,
};

const rooms = {};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const cleanName = (n) => String(n || 'Player').trim().slice(0, 12) || 'Player';
const cleanShip = (s) => (['1', '2', '3'].includes(String(s)) ? String(s) : '1');
const dist2 = (ax, az, bx, bz) => (ax - bx) ** 2 + (az - bz) ** 2;
const safeMapX = 13.2;
const safeMapZ = 13.2;

function movePlayerTowardTarget(player, dt) {
  const targetX = clamp(Number(player.targetX) || player.x, -COOP.ARENA, COOP.ARENA);
  const targetZ = clamp(Number(player.targetZ) || player.z, -COOP.ARENA, COOP.ARENA);
  player.targetX = targetX;
  player.targetZ = targetZ;

  const shipClass = player.ship === '2' ? 'corvette' : player.ship === '3' ? 'cruiser' : 'destroyer';
  const maxSpeed = Math.min(SHIP_MAX_SPEED, SHIP_SPEED_BY_CLASS[shipClass]);
  const dx = targetX - player.x;
  const dz = targetZ - player.z;
  const distance = Math.hypot(dx, dz);
  const desiredSpeed = distance < SHIP_STOP_RADIUS ? 0 : Math.min(maxSpeed, distance * SHIP_FOLLOW_SPEED);
  const desiredX = distance > 0 ? dx / distance * desiredSpeed : 0;
  const desiredZ = distance > 0 ? dz / distance * desiredSpeed : 0;
  player.vx += clamp(desiredX - player.vx, -SHIP_ACCEL * dt, SHIP_ACCEL * dt);
  player.vz += clamp(desiredZ - player.vz, -SHIP_ACCEL * dt, SHIP_ACCEL * dt);
  if (distance < SHIP_STOP_RADIUS) {
    player.vx *= 0.35;
    player.vz *= 0.35;
  }
  player.x = clamp(player.x + player.vx * dt, -COOP.ARENA, COOP.ARENA);
  player.z = clamp(player.z + player.vz * dt, -COOP.ARENA, COOP.ARENA);
  player.rotation = clamp(-player.vx / maxSpeed * 0.42, -0.42, 0.42);
}

function genCode() {
  let code;
  do {
    code = String(Math.floor(1000 + Math.random() * 9000));
  } while (rooms[code]);
  return code;
}

function freeNumber(room) {
  for (let n = 1; n <= MAX_PLAYERS[room.mode]; n++) {
    if (!room.players.some((p) => p.number === n)) return n;
  }
  return null;
}

function newPlayer(id, number, ud) {
  const ship = cleanShip(ud.ship);
  return {
    id, number, name: cleanName(ud.name), ship,
    x: 0, z: 12, hp: SHIP_HP[ship], alive: true, lastShot: 0, left: false,
    vx: 0, vz: 0, rotation: 0,
  };
}

function createBotPlayer(number = 2) {
  const ship = '1';
  return {
    id: `BOT_${number}`,
    number,
    name: 'BOT',
    ship,
    x: 0,
    z: -12,
    hp: SHIP_HP[ship],
    alive: true,
    left: false,
    vx: 0,
    vz: 0,
    rotation: 0,
    lastShot: 0,
    bot: true,
    aimBias: 0,
    state: 'HUNT',
    dodgeDir: 1,
    strafeTimer: 0,
  };
}

function publicPlayers(room) {
  return room.players
    .filter((p) => !p.left)
    .map((p) => ({ number: p.number, name: p.name, ship: p.ship }));
}

function broadcastLobby(code) {
  const room = rooms[code];
  if (!room) return;
  const host = room.players.find((p) => p.id === room.host);
  io.to(code).emit('lobbyUpdate', {
    mode: room.mode,
    host: host ? host.number : 1,
    players: publicPlayers(room),
  });
}

function roomHasBot(room) {
  return !!(room && room.bot && room.bot.alive);
}

function ensureBot(room) {
  if (!room || room.mode !== 'pvp' || !room.botEnabled || room.bot) return;
  room.bot = createBotPlayer(2);
  room.players.push(room.bot);
}

function stopPvpBotLoop(code) {
  const room = rooms[code];
  if (!room || !room.botLoop) return;
  clearInterval(room.botLoop);
  room.botLoop = null;
}

function startPvpBotLoop(code) {
  const room = rooms[code];
  if (!room || room.mode !== 'pvp' || !room.botEnabled || room.botLoop) return;
  ensureBot(room);
  room.projectiles = room.projectiles || [];
  room.botLoop = setInterval(() => tickPvPBot(code), 33);
}

function getBotProfile() {
  return BOT_PROFILE[BOT_DIFFICULTY] || BOT_PROFILE[2];
}

function predictTargetPosition(target, bulletSpeed, seconds) {
  const tx = Number(target.x) || 0;
  const tz = Number(target.z) || 0;
  const vx = Number(target.vx) || 0;
  const vz = Number(target.vz) || 0;
  return {
    x: tx + vx * seconds,
    z: tz + vz * seconds,
    dx: vx,
    dz: vz,
  };
}

function pointInsideThreat(x, z, obj) {
  const pad = (obj.radius || 0.8) + 0.45;
  return dist2(x, z, obj.x, obj.z) <= pad * pad;
}

function isSafeMove(bot, tx, tz, projectiles, asteroids) {
  const edgePenalty = Math.max(0, Math.abs(tx) - safeMapX) * 25 + Math.max(0, Math.abs(tz) - safeMapZ) * 25;
  if (edgePenalty > 0) return { safe: false, score: -9999 };

  let score = 0;
  const lookAhead = 1.4;

  for (const projectile of projectiles || []) {
    const px = Number(projectile.x) || 0;
    const pz = Number(projectile.z) || 0;
    const pvx = Number(projectile.vx) || 0;
    const pvz = Number(projectile.vz) || 0;
    const futureX = px + pvx * lookAhead;
    const futureZ = pz + pvz * lookAhead;
    const d = Math.hypot(futureX - tx, futureZ - tz);
    if (d < 2.1) score -= 80;
    if (Math.hypot(px - tx, pz - tz) < 2.6) score -= 20;
  }

  for (const asteroid of asteroids || []) {
    const ax = Number(asteroid.x) || 0;
    const az = Number(asteroid.z) || 0;
    const avx = Number(asteroid.vx) || 0;
    const avz = Number(asteroid.vz) || 0;
    const futureX = ax + avx * lookAhead;
    const futureZ = az + avz * lookAhead;
    const d = Math.hypot(futureX - tx, futureZ - tz);
    if (d < 2.2 + (asteroid.r || 1)) score -= 120;
  }

  if (Math.abs(tx) > 12.3 || Math.abs(tz) > 12.3) score -= 50;
  if (Math.abs(tx) < 1.8 && Math.abs(tz) < 1.8) score -= 20;
  return { safe: score > -40, score: score + (Math.abs(tx) * 0.5) + (Math.abs(tz) * 0.3) };
}

function chooseBotMove(bot, opponent, projectiles, asteroids) {
  const profile = getBotProfile();
  const angleStep = 25;
  const candidateMoves = [];
  const baseSpeed = 2.7 + profile.chaseBias * 0.9;

  for (let a = -180; a <= 180; a += angleStep) {
    const rad = (a * Math.PI) / 180;
    const tx = clamp(bot.x + Math.cos(rad) * baseSpeed * 0.9, -COOP.ARENA, COOP.ARENA);
    const tz = clamp(bot.z + Math.sin(rad) * baseSpeed * 0.9, -COOP.ARENA, COOP.ARENA);
    const result = isSafeMove(bot, tx, tz, projectiles, asteroids);
    candidateMoves.push({ tx, tz, score: result.score, safe: result.safe });
  }

  const sorted = candidateMoves.sort((a, b) => b.score - a.score);
  const best = sorted.find((c) => c.safe) || sorted[0];
  if (!best) {
    return { x: bot.x, z: bot.z };
  }

  return { x: best.tx, z: best.tz };
}

function botPredictiveShot(bot, opponent, room, profile) {
  const bulletSpeed = 30;
  const travelTime = Math.max(0.35, Math.hypot(opponent.x - bot.x, opponent.z - bot.z) / bulletSpeed);
  const predicted = predictTargetPosition(opponent, bulletSpeed, travelTime);
  const aimJitter = (Math.random() - 0.5) * profile.aimError * 1.8;
  const targetX = predicted.x + aimJitter;
  const targetZ = predicted.z + aimJitter * 0.6;
  return {
    x: bot.x,
    z: bot.z + 1.8,
    vx: 0,
    vz: 30 * (profile.fireBias || 1),
    targetX,
    targetZ,
  };
}

function tickPvPBot(code) {
  const room = rooms[code];
  if (!room || !room.bot || room.over) return;
  const bot = room.bot;
  const human = room.players.find((p) => !p.bot && !p.left);
  if (!human) return;

  const profile = getBotProfile();
  const projectiles = room.projectiles || [];
  const asteroids = room.asteroids || [];
  const humanState = room.latestHumanState || { x: human.x, z: human.z, vx: 0, vz: 0, hp: human.hp };
  const currentDist = Math.hypot(humanState.x - bot.x, humanState.z - bot.z);
  const lowHp = bot.hp <= 35;
  const oppLowHp = humanState.hp <= 35;

  let danger = false;
  for (const projectile of projectiles) {
    const futureX = (projectile.x || 0) + (projectile.vx || 0) * 1.6;
    const futureZ = (projectile.z || 0) + (projectile.vz || 0) * 1.6;
    const d = Math.hypot(futureX - bot.x, futureZ - bot.z);
    if (d < 2.7) {
      danger = true;
      break;
    }
  }

  for (const a of asteroids) {
    const futureX = (a.x || 0) + (a.vx || 0) * 1.4;
    const futureZ = (a.z || 0) + (a.vz || 0) * 1.4;
    const d = Math.hypot(futureX - bot.x, futureZ - bot.z);
    if (d < (a.r || 1.2) + 1.4) {
      danger = true;
      break;
    }
  }

  let move = { x: bot.x, z: bot.z };
  let state = 'HUNT';

  if (danger || lowHp) {
    state = 'EVADE';
    move = chooseBotMove(bot, humanState, projectiles, asteroids);
    bot.x = clamp(move.x, -COOP.ARENA, COOP.ARENA);
    bot.z = clamp(move.z, -COOP.ARENA, COOP.ARENA);
    bot.state = state;
  } else {
    const desiredRange = oppLowHp ? 6.2 : 4.8;
    let targetX = humanState.x;
    let targetZ = humanState.z;

    if (currentDist > desiredRange + 0.8) {
      state = 'APPROACH';
      const nx = humanState.x - bot.x;
      const nz = humanState.z - bot.z;
      const m = Math.hypot(nx, nz) || 1;
      targetX = bot.x + (nx / m) * (2.0 + profile.chaseBias * 0.8);
      targetZ = bot.z + (nz / m) * (2.0 + profile.chaseBias * 0.8);
    } else if (currentDist < desiredRange - 1.0) {
      state = 'RETREAT';
      const nx = bot.x - humanState.x;
      const nz = bot.z - humanState.z;
      const m = Math.hypot(nx, nz) || 1;
      targetX = bot.x + (nx / m) * (1.5 + profile.chaseBias * 0.5);
      targetZ = bot.z + (nz / m) * (1.5 + profile.chaseBias * 0.5);
    } else {
      state = 'STRAFE';
      const side = bot.dodgeDir || 1;
      const lateral = side * 1.5;
      const angle = Math.atan2(humanState.z - bot.z, humanState.x - bot.x);
      targetX = bot.x + Math.cos(angle + Math.PI / 2) * lateral;
      targetZ = bot.z + Math.sin(angle + Math.PI / 2) * lateral;
      bot.dodgeDir *= -1;
    }

    const strafeSafe = isSafeMove(bot, targetX, targetZ, projectiles, asteroids);
    if (strafeSafe.safe) {
      move = { x: clamp(targetX, -COOP.ARENA, COOP.ARENA), z: clamp(targetZ, -COOP.ARENA, COOP.ARENA) };
      bot.x = move.x;
      bot.z = move.z;
    } else {
      move = chooseBotMove(bot, humanState, projectiles, asteroids);
      bot.x = clamp(move.x, -COOP.ARENA, COOP.ARENA);
      bot.z = clamp(move.z, -COOP.ARENA, COOP.ARENA);
    }
    bot.state = state;
  }

  bot.vx = bot.x - (bot._lastX ?? bot.x);
  bot.vz = bot.z - (bot._lastZ ?? bot.z);
  bot._lastX = bot.x;
  bot._lastZ = bot.z;

  const now = Date.now();
  const shotReady = now - bot.lastShot > (SHIP_CD[bot.ship] * 1000) * profile.fireBias;
  const closeEnough = Math.hypot(humanState.x - bot.x, humanState.z - bot.z) < 16;
  const canShoot = shotReady && closeEnough && !danger && bot.alive && human.alive;

  if (canShoot) {
    const fire = botPredictiveShot(bot, humanState, room, profile);
    const aimX = Number(fire.targetX || humanState.x);
    const aimZ = Number(fire.targetZ || humanState.z);
    const aimDelta = Math.hypot(aimX - humanState.x, aimZ - humanState.z);
    const shouldFire = aimDelta < 2.2 || Math.random() < 0.78;

    if (shouldFire) {
      const packet = { x: bot.x, z: bot.z + 1.8, vx: 0, vz: 30 };
      room.projectiles = room.projectiles || [];
      room.projectiles.push({ x: packet.x, z: packet.z, vx: packet.vx, vz: packet.vz, radius: 0.35, owner: 2, ttl: 2.4, createdAt: now });
      io.to(code).emit('opponentShoot', packet);
      bot.lastShot = now;
    }
  }

  const opponentState = {
    x: clamp(bot.x, -COOP.ARENA, COOP.ARENA),
    z: clamp(bot.z, -COOP.ARENA, COOP.ARENA),
    rotation: bot.rotation,
    hp: clamp(bot.hp, 0, SHIP_HP[bot.ship]),
  };

  io.to(code).emit('opponentState', opponentState);
}

function publicBotState(room) {
  if (!room || !room.bot) return null;
  return {
    x: room.bot.x,
    z: room.bot.z,
    hp: room.bot.hp,
    rotation: room.bot.rotation,
  };
}

// ==========================================
// LOGIC CO-OP (SERVER TỰ TÍNH)
// ==========================================
function coopSpawnPoint(room, occupied) {
  const points = [
    [-10, -10], [10, -10], [-10, 10], [10, 10], [0, -12], [0, 12],
  ];
  const available = points.filter(([x, z]) => room.players.every((p) =>
    occupied !== p.number || Math.hypot(p.x - x, p.z - z) > 5));
  const point = available[Math.floor(Math.random() * available.length)] || points[0];
  return { x: point[0], z: point[1] };
}

function startCoop(code) {
  const room = rooms[code];
  room.started = true;
  room.players.forEach((p, index) => {
    const spawn = coopSpawnPoint(room, p.number);
    p.x = spawn.x;
    p.z = spawn.z;
    p.hp = COOP_CONFIG.SHIP_HP;
    p.armor = COOP_CONFIG.ARMOR_MAX;
    p.alive = true;
    p.respawnAt = 0;
    p.invulnerableUntil = Date.now() + COOP_CONFIG.SPAWN_INVULNERABILITY_SECONDS * 1000;
    p.score = 0;
    p.targetX = p.x;
    p.targetZ = p.z;
    p.vx = 0;
    p.vz = 0;
    p.lastShot = 0;
  });
  room.sim = COOP_CONFIG.LEGACY_MODE ? {
    time: 0, score: 0, shield: COOP.SHIELD, nextId: 1,
    spawnTimer: 1.5, asteroids: [], bullets: [], last: Date.now(), timer: null,
  } : {
    time: 0, nextBulletId: 1, bullets: [], last: Date.now(), timer: null,
  };
  setTimeout(() => {
    if (rooms[code] !== room || !room.sim) return;
    room.sim.last = Date.now();
    room.sim.timer = setInterval(() => tickCoop(code), COOP_CONFIG.TICK_MS);
  }, 2500);
}

function endCoop(code, reason) {
  const room = rooms[code];
  if (!room || !room.sim || room.over) return;
  clearInterval(room.sim.timer);
  room.sim.timer = null;
  room.over = true;
  io.to(code).emit('coop:matchEnd', {
    reason,
    time: Math.floor(room.sim.time),
    players: room.players.map((p) => ({ number: p.number, name: p.name, score: p.score || 0 })),
  });
}

function tickCoop(code) {
  const room = rooms[code];
  if (!room || !room.sim || room.over) return;
  const sim = room.sim;

  if (!COOP_CONFIG.LEGACY_MODE) {
    const now = Date.now();
    const dt = Math.min((now - sim.last) / 1000, 0.1);
    sim.last = now;
    sim.time += dt;

    for (const player of room.players) {
      if (!player.alive && player.respawnAt && now >= player.respawnAt) {
        const spawn = coopSpawnPoint(room, player.number);
        player.x = spawn.x;
        player.z = spawn.z;
        player.hp = COOP_CONFIG.SHIP_HP;
        player.armor = COOP_CONFIG.ARMOR_MAX;
        player.alive = true;
        player.respawnAt = 0;
        player.invulnerableUntil = now + COOP_CONFIG.SPAWN_INVULNERABILITY_SECONDS * 1000;
        player.targetX = player.x;
        player.targetZ = player.z;
      }
    }

    for (const player of room.players.filter((p) => p.alive)) movePlayerTowardTarget(player, dt);

    for (const bullet of sim.bullets) {
      bullet.x += bullet.vx * dt;
      bullet.z += bullet.vz * dt;
      bullet.ttl -= dt;
      for (const target of room.players) {
        if (!target.alive || target.invulnerableUntil > now || bullet.owner === target.number) continue;
        if (Math.hypot(bullet.x - target.x, bullet.z - target.z) > COOP_CONFIG.PLAYER_RADIUS + COOP_CONFIG.BULLET_RADIUS) continue;
        let remaining = COOP_CONFIG.BULLET_DAMAGE;
        if (target.armor > 0) {
          const absorbed = Math.min(target.armor, remaining * COOP_CONFIG.ARMOR_DAMAGE_ABSORPTION);
          target.armor -= absorbed;
          remaining -= absorbed;
        }
        target.hp = Math.max(0, target.hp - remaining);
        bullet.dead = true;
        if (target.hp <= 0) {
          target.alive = false;
          target.respawnAt = now + COOP_CONFIG.RESPAWN_SECONDS * 1000;
          const killer = room.players.find((p) => p.number === bullet.owner);
          if (killer) killer.score = (killer.score || 0) + 1;
          io.to(code).emit('coop:killed', {
            killer: killer ? { number: killer.number, name: killer.name } : null,
            victim: { number: target.number, name: target.name },
          });
          const winner = room.players.find((p) => (p.score || 0) >= COOP_CONFIG.WIN_SCORE);
          if (winner) return endCoop(code, 'score');
        }
        break;
      }
    }
    sim.bullets = sim.bullets.filter((b) => !b.dead && b.ttl > 0 && Math.abs(b.x) <= COOP_CONFIG.ARENA + 5 && Math.abs(b.z) <= COOP_CONFIG.ARENA + 5);

    if (sim.time >= COOP_CONFIG.MATCH_SECONDS) return endCoop(code, 'time');

    const f = (n) => Math.round(n * 100) / 100;
    io.to(code).emit('coop:snapshot', {
      time: Math.floor(sim.time),
      players: room.players.map((p) => ({
        number: p.number, name: p.name, x: f(p.x), z: f(p.z),
        hp: p.hp, armor: p.armor, alive: p.alive,
        score: p.score || 0, respawnIn: p.alive ? 0 : Math.max(0, Math.ceil((p.respawnAt - now) / 1000)),
        invulnerable: p.invulnerableUntil > now,
      })),
      bullets: sim.bullets.map((b) => ({ id: b.id, x: f(b.x), z: f(b.z), vx: f(b.vx), vz: f(b.vz) })),
    });
    return;
  }

  const now = Date.now();
  const dt = Math.min((now - sim.last) / 1000, 0.1);
  sim.last = now;
  sim.time += dt;

  const diff = room.map === '2' ? 1.3 : 1;
  const mul = Math.min(3.5, 1 + sim.time * 0.02) * diff;
  const level = 1 + Math.floor(sim.time / 20);
  const alivePlayers = room.players.filter((p) => p.alive && !p.bot);

  for (const p of alivePlayers) movePlayerTowardTarget(p, dt);

  sim.spawnTimer -= dt;
  if (sim.spawnTimer <= 0) {
    const r = 0.9 + Math.random() * 1.6;
    const hp = r < 1.5 ? 1 : r < 2.1 ? 2 : 3;
    sim.asteroids.push({
      id: sim.nextId++,
      x: (Math.random() * 2 - 1) * COOP.ARENA,
      z: COOP.SPAWN_Z,
      vx: (Math.random() - 0.5) * 2,
      vz: (7 + Math.random() * 4) * mul,
      r, hp, maxHp: hp,
    });
    const crowd = 1 + 0.35 * (Math.max(1, alivePlayers.length) - 1);
    sim.spawnTimer = Math.max(0.3, 1.3 / mul) / crowd;
  }

  for (const a of sim.asteroids) {
    a.x += a.vx * dt;
    a.z += a.vz * dt;
    if (a.x > COOP.ARENA + 2 || a.x < -COOP.ARENA - 2) a.vx = -a.vx;
  }

  for (const b of sim.bullets) b.z -= COOP.BULLET_SPEED * dt;
  sim.bullets = sim.bullets.filter((b) => b.z > COOP.SPAWN_Z - 5);

  for (const b of sim.bullets) {
    for (const a of sim.asteroids) {
      if (a.hp <= 0) continue;
      const dx = b.x - a.x, dz = b.z - a.z, rr = a.r + 0.4;
      if (dx * dx + dz * dz < rr * rr) {
        a.hp -= 1;
        b.dead = true;
        if (a.hp <= 0) sim.score += 10 * a.maxHp;
        break;
      }
    }
  }
  sim.bullets = sim.bullets.filter((b) => !b.dead);

  for (const p of alivePlayers) {
    for (const a of sim.asteroids) {
      if (a.hp <= 0) continue;
      const dx = p.x - a.x, dz = p.z - a.z, rr = a.r + 1.1;
      if (dx * dx + dz * dz < rr * rr) {
        a.hp = 0;
        p.hp -= COOP.HIT_DAMAGE;
        if (p.hp <= 0) { p.hp = 0; p.alive = false; }
      }
    }
  }

  for (const a of sim.asteroids) {
    if (a.hp > 0 && a.z > COOP.END_Z) { a.hp = 0; sim.shield -= 1; }
  }
  sim.asteroids = sim.asteroids.filter((a) => a.hp > 0);

  const f = (n) => Math.round(n * 100) / 100;
  io.to(code).emit('snapshot', {
    t: Math.floor(sim.time), sc: sim.score, lv: level, sh: Math.max(0, sim.shield), m: f(mul),
    a: sim.asteroids.map((a) => [a.id, f(a.x), f(a.z), f(a.vx), f(a.vz), f(a.r)]),
    b: sim.bullets.map((b) => [b.id, f(b.x), f(b.z)]),
    p: room.players.map((p) => [p.number, f(p.x), f(p.z), p.hp, p.alive ? 1 : 0]),
  });

  if (sim.shield <= 0) endCoop(code, 'shield');
  else if (!room.players.some((p) => p.alive && !p.bot)) endCoop(code, 'dead');
}

// ==========================================
// SOCKET
// ==========================================
io.on('connection', (socket) => {
  console.log('Kết nối:', socket.id);

  socket.on('createRoom', (userData) => {
    if (socket.data.room) return;
    const ud = userData || {};
    const mode = ud.mode === 'pvp' ? 'pvp' : 'coop';
    const code = genCode();
    rooms[code] = {
      mode,
      map: ud.map === '2' ? '2' : '1',
      host: socket.id,
      players: [],
      started: false,
      over: false,
      sim: null,
      botEnabled: !!(ud.bot === true || ud.bot === 'true'),
      projectiles: [],
      bot: null,
      latestHumanState: null,
      botLoop: null,
    };
    rooms[code].players.push(newPlayer(socket.id, 1, ud));
    if (mode === 'pvp' && rooms[code].botEnabled) ensureBot(rooms[code]);
    socket.join(code);
    socket.data.room = code;
    console.log('[COOP] roomCreated', code, mode);
    socket.emit('roomCreated', { roomCode: code, playerNumber: 1, mode });
    broadcastLobby(code);
    console.log('Tạo phòng', code, mode, 'bot=', rooms[code].botEnabled);
  });

  socket.on('joinRoom', (data) => {
    if (socket.data.room) return socket.emit('errorMsg', 'Bạn đã ở trong phòng');
    const code = String((data && data.roomCode) || '').trim();
    const ud = (data && data.userData) || {};
    const room = rooms[code];

    if (!room) return socket.emit('errorMsg', 'Mã phòng không tồn tại');
    if (room.started) return socket.emit('errorMsg', 'Phòng đã bắt đầu');
    const number = freeNumber(room);
    if (!number) return socket.emit('errorMsg', 'Phòng đã đầy');

    room.players.push(newPlayer(socket.id, number, ud));
    room.botEnabled = room.botEnabled || !!(ud.bot === true || ud.bot === 'true');
    if (room.mode === 'pvp' && room.botEnabled) ensureBot(room);
    socket.join(code);
    socket.data.room = code;
    console.log('[COOP] roomJoined', code, number, room.mode);
    socket.emit('roomJoined', { roomCode: code, playerNumber: number, mode: room.mode });
    broadcastLobby(code);

    if (room.mode === 'pvp' && room.players.length >= 2) {
      room.started = true;
      io.to(code).emit('gameStart', { mode: 'pvp', map: room.map, players: publicPlayers(room) });
      if (room.botEnabled && room.bot) startPvpBotLoop(code);
    }
  });

  socket.on('startGame', () => {
    const code = socket.data.room;
    const room = rooms[code];
    if (!room || room.mode !== 'coop' || room.started || room.host !== socket.id) return;
    console.log('[COOP] startGame', code, room.players.length);
    startCoop(code);
    io.to(code).emit('gameStart', { mode: 'coop', map: room.map, players: publicPlayers(room) });
  });

  socket.on('coop:state', (d) => {
    const code = socket.data.room;
    const room = rooms[code];
    if (!room || room.mode !== 'coop' || !room.started || room.over || !d) return;
    const player = room.players.find((p) => p.id === socket.id);
    if (!player || !player.alive) return;
    player.targetX = clamp(Number(d.targetX) || player.x, -COOP_CONFIG.ARENA, COOP_CONFIG.ARENA);
    player.targetZ = clamp(Number(d.targetZ) || player.z, -COOP_CONFIG.ARENA, COOP_CONFIG.ARENA);
  });

  socket.on('coop:shoot', (d) => {
    const code = socket.data.room;
    const room = rooms[code];
    const sim = room && room.sim;
    if (!room || room.mode !== 'coop' || !sim || room.over || !d) return;
    const player = room.players.find((p) => p.id === socket.id);
    if (!player || !player.alive) return;
    const now = Date.now();
    if (now - (player.lastShot || 0) < COOP_CONFIG.BULLET_COOLDOWN_MS) return;
    player.lastShot = now;
    const originX = Number.isFinite(Number(d.x)) ? Number(d.x) : player.x;
    const originZ = Number.isFinite(Number(d.z)) ? Number(d.z) : player.z;
    let vx = Number(d.vx) || 0;
    let vz = Number(d.vz) || -COOP_CONFIG.BULLET_SPEED;
    const length = Math.hypot(vx, vz);
    if (length > 0) {
      vx = vx / length * COOP_CONFIG.BULLET_SPEED;
      vz = vz / length * COOP_CONFIG.BULLET_SPEED;
    } else {
      vz = -COOP_CONFIG.BULLET_SPEED;
    }
    if (sim.bullets.length >= 250) return;
    sim.bullets.push({
      id: sim.nextBulletId++, x: originX, z: originZ,
      vx, vz, ttl: 3, owner: player.number,
    });
  });

  socket.on('state', (d) => {
    const code = socket.data.room;
    const room = rooms[code];
    if (!room || !d) return;
    if (room.mode === 'pvp') {
      if (!room.started || room.over) return;
      const prev = room.latestHumanState || { x: 0, z: 12, vx: 0, vz: 0 };
      const next = {
        x: clamp(Number(d.x) || 0, -COOP.ARENA, COOP.ARENA),
        z: clamp(Number(d.z) || 0, -COOP.ARENA, COOP.ARENA),
        rotation: clamp(Number(d.rotation) || 0, -Math.PI, Math.PI),
        hp: clamp(Number(d.hp) || 0, 0, 150),
        vx: (Number(d.x) || 0) - prev.x,
        vz: (Number(d.z) || 0) - prev.z,
      };
      room.latestHumanState = next;
      const human = room.players.find((p) => !p.bot && p.id === socket.id);
      if (human) {
        const targetX = Number.isFinite(Number(d.targetX)) ? Number(d.targetX) : human.targetX;
        const targetZ = Number.isFinite(Number(d.targetZ)) ? Number(d.targetZ) : human.targetZ;
        human.targetX = clamp(targetX, -COOP.ARENA, COOP.ARENA);
        human.targetZ = clamp(targetZ, -COOP.ARENA, COOP.ARENA);
        const now = Date.now();
        const receiveDt = clamp((now - (human._lastMoveAt || now)) / 1000, 0.01, 0.05);
        human._lastMoveAt = now;
        movePlayerTowardTarget(human, receiveDt);
        human.hp = next.hp;
        human.vx = Number(d.vx) || 0;
        human.vz = Number(d.vz) || 0;
        next.x = human.x;
        next.z = human.z;
        next.vx = human.vx;
        next.vz = human.vz;
      }
      room.latestHumanState = next;
      socket.to(code).emit('opponentState', {
        x: next.x,
        z: next.z,
        rotation: next.rotation,
        hp: next.hp,
      });
    } else {
      const p = room.players.find((x) => x.id === socket.id);
      if (p && p.alive) {
        const targetX = Number.isFinite(Number(d.targetX)) ? Number(d.targetX) : p.targetX;
        const targetZ = Number.isFinite(Number(d.targetZ)) ? Number(d.targetZ) : p.targetZ;
        p.targetX = clamp(targetX, -COOP.ARENA, COOP.ARENA);
        p.targetZ = clamp(targetZ, -COOP.ARENA, COOP.ARENA);
      }
    }
  });

  socket.on('shoot', (d) => {
    const code = socket.data.room;
    const room = rooms[code];
    if (!room || !d) return;
    if (room.mode === 'pvp') {
      if (!room.started || room.over) return;
      room.projectiles = room.projectiles || [];
      room.projectiles.push({
        x: Number(d.x) || 0,
        z: Number(d.z) || 0,
        vx: Number(d.vx) || 0,
        vz: Number(d.vz) || 0,
        radius: 0.4,
        owner: 1,
        ttl: 2.4,
        createdAt: Date.now(),
      });
      socket.to(code).emit('opponentShoot', d);
      return;
    }
    const sim = room.sim;
    const p = room.players.find((x) => x.id === socket.id);
    if (!sim || !sim.timer || room.over || !p || !p.alive) return;

    const now = Date.now();
    if (now - p.lastShot < SHIP_CD[p.ship] * 1000 * 0.8) return;
    p.lastShot = now;
    p.x = clamp(Number(d.x) || p.x, -COOP.ARENA, COOP.ARENA);
    p.z = clamp(Number(d.z) || p.z, -COOP.ARENA, COOP.ARENA);
    if (sim.bullets.length < 250) {
      sim.bullets.push({ id: sim.nextId++, x: p.x, z: p.z - 1.8 });
    }
  });

  socket.on('died', () => {
    const code = socket.data.room;
    const room = rooms[code];
    if (!room || room.mode !== 'pvp' || room.over) return;
    const p = room.players.find((x) => x.id === socket.id);
    if (!p) return;
    room.over = true;
    io.to(code).emit('gameOver', { loser: p.number });
  });

  socket.on('disconnect', () => {
    const code = socket.data.room;
    const room = rooms[code];
    if (!room) return;
    const idx = room.players.findIndex((p) => p.id === socket.id);
    if (idx < 0) return;

    if (room.mode === 'pvp') {
      if (room.bot && socket.id === room.bot.id) {
        room.bot = null;
      }
      if (room.botLoop) stopPvpBotLoop(code);
      room.over = true;
      socket.to(code).emit('opponentLeft');
      delete rooms[code];
      return;
    }

    const leaving = room.players[idx];
    if (room.started) {
      leaving.alive = false;
      leaving.hp = 0;
      leaving.left = true;
      socket.to(code).emit('playerLeft', { number: leaving.number });
    } else {
      room.players.splice(idx, 1);
    }

    if (room.players.filter((p) => !p.left).length === 0) {
      if (room.sim && room.sim.timer) clearInterval(room.sim.timer);
      delete rooms[code];
      return;
    }
    if (!room.started) {
      if (room.host === socket.id) room.host = room.players[0].id;
      broadcastLobby(code);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server chạy tại http://localhost:' + PORT));
