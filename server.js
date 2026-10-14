const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Tự tìm thư mục chứa index.html (dù nằm cùng cấp hay trong thư mục con)
const GAME_DIR = fs.existsSync(path.join(__dirname, 'index.html'))
  ? __dirname
  : path.join(__dirname, '3D-Space-Shooter-main');
console.log('Thư mục game:', GAME_DIR);

app.use('/src', express.static(path.join(GAME_DIR, 'src')));
app.get('/', (req, res) => res.sendFile(path.join(GAME_DIR, 'index.html')));
app.get('/health', (req, res) => res.send('ok'));

// ==========================================
// THÔNG SỐ
// ==========================================
const MAX_PLAYERS = { coop: 4, pvp: 2 };
const SHIP_HP = { '1': 100, '2': 70, '3': 150 };
const SHIP_CD = { '1': 0.25, '2': 0.20, '3': 0.35 }; // giây giữa 2 phát bắn
const COOP = {
  ARENA: 14,        // tàu và thiên thạch nằm trong -14..14
  SPAWN_Z: -36,     // thiên thạch xuất hiện ở đây (phía trên)
  END_Z: 15,        // thiên thạch vượt qua mốc này => trừ lá chắn
  SHIELD: 5,        // số lá chắn chung của cả đội
  BULLET_SPEED: 36,
  TICK_MS: 33,      // ~30 lần/giây
  HIT_DAMAGE: 34,   // máu mất khi thiên thạch đâm trúng tàu
};

const rooms = {};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const cleanName = (n) => String(n || 'Player').trim().slice(0, 12) || 'Player';
const cleanShip = (s) => (['1', '2', '3'].includes(String(s)) ? String(s) : '1');

function genCode() {
  let code;
  do {
    code = String(Math.floor(1000 + Math.random() * 9000)); // 4 chữ số
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

// ==========================================
// LOGIC CO-OP (SERVER TỰ TÍNH)
// ==========================================
function startCoop(code) {
  const room = rooms[code];
  room.started = true;
  const startX = [-6, -2, 2, 6];
  room.players.forEach((p) => {
    p.x = startX[p.number - 1];
    p.z = 12;
    p.hp = SHIP_HP[p.ship];
    p.alive = true;
  });
  room.sim = {
    time: 0, score: 0, shield: COOP.SHIELD, nextId: 1,
    spawnTimer: 1.5, asteroids: [], bullets: [], last: Date.now(), timer: null,
  };
  // Chờ 2.5 giây cho các máy khởi tạo xong đồ họa rồi mới chạy
  setTimeout(() => {
    if (rooms[code] !== room || !room.sim) return;
    room.sim.last = Date.now();
    room.sim.timer = setInterval(() => tickCoop(code), COOP.TICK_MS);
  }, 2500);
}

function endCoop(code, reason) {
  const room = rooms[code];
  if (!room || !room.sim || room.over) return;
  const sim = room.sim;
  clearInterval(sim.timer);
  sim.timer = null;
  room.over = true;
  io.to(code).emit('coopOver', {
    score: sim.score,
    time: Math.floor(sim.time),
    level: 1 + Math.floor(sim.time / 20),
    reason,
  });
}

function tickCoop(code) {
  const room = rooms[code];
  if (!room || !room.sim || room.over) return;
  const sim = room.sim;

  const now = Date.now();
  const dt = Math.min((now - sim.last) / 1000, 0.1);
  sim.last = now;
  sim.time += dt;

  const diff = room.map === '2' ? 1.3 : 1;                    // map 2 khó hơn
  const mul = Math.min(3.5, 1 + sim.time * 0.02) * diff;      // tốc độ tăng dần theo thời gian
  const level = 1 + Math.floor(sim.time / 20);
  const alivePlayers = room.players.filter((p) => p.alive);

  // --- Sinh thiên thạch (nhiều người chơi => nhiều thiên thạch hơn) ---
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

  // --- Di chuyển thiên thạch ---
  for (const a of sim.asteroids) {
    a.x += a.vx * dt;
    a.z += a.vz * dt;
    if (a.x > COOP.ARENA + 2 || a.x < -COOP.ARENA - 2) a.vx = -a.vx;
  }

  // --- Di chuyển đạn ---
  for (const b of sim.bullets) b.z -= COOP.BULLET_SPEED * dt;
  sim.bullets = sim.bullets.filter((b) => b.z > COOP.SPAWN_Z - 5);

  // --- Đạn trúng thiên thạch ---
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

  // --- Thiên thạch đâm trúng tàu ---
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

  // --- Thiên thạch lọt qua => trừ lá chắn chung ---
  for (const a of sim.asteroids) {
    if (a.hp > 0 && a.z > COOP.END_Z) { a.hp = 0; sim.shield -= 1; }
  }
  sim.asteroids = sim.asteroids.filter((a) => a.hp > 0);

  // --- Gửi trạng thái (rút gọn bằng mảng cho nhẹ) ---
  const f = (n) => Math.round(n * 100) / 100;
  io.to(code).emit('snapshot', {
    t: Math.floor(sim.time), sc: sim.score, lv: level, sh: Math.max(0, sim.shield), m: f(mul),
    a: sim.asteroids.map((a) => [a.id, f(a.x), f(a.z), f(a.r)]),
    b: sim.bullets.map((b) => [b.id, f(b.x), f(b.z)]),
    p: room.players.map((p) => [p.number, f(p.x), f(p.z), p.hp, p.alive ? 1 : 0]),
  });

  // --- Kiểm tra thua ---
  if (sim.shield <= 0) endCoop(code, 'shield');
  else if (!room.players.some((p) => p.alive)) endCoop(code, 'dead');
}

// ==========================================
// SOCKET
// ==========================================
io.on('connection', (socket) => {
  console.log('Kết nối:', socket.id);

  // ----- Tạo phòng -----
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
    };
    rooms[code].players.push(newPlayer(socket.id, 1, ud));
    socket.join(code);
    socket.data.room = code;
    socket.emit('roomCreated', { roomCode: code, playerNumber: 1, mode });
    broadcastLobby(code);
    console.log('Tạo phòng', code, mode);
  });

  // ----- Vào phòng -----
  socket.on('joinRoom', (data) => {
    if (socket.data.room) return socket.emit('errorMsg', '你已在房間內 (Bạn đang ở trong một phòng)');
    const code = String((data && data.roomCode) || '').trim();
    const ud = (data && data.userData) || {};
    const room = rooms[code];

    if (!room) return socket.emit('errorMsg', '找不到房間 (Mã phòng không tồn tại)');
    if (room.started) return socket.emit('errorMsg', '遊戲已開始 (Phòng đã bắt đầu chơi)');
    const number = freeNumber(room);
    if (!number) return socket.emit('errorMsg', '房間已滿 (Phòng đã đầy)');

    room.players.push(newPlayer(socket.id, number, ud));
    socket.join(code);
    socket.data.room = code;
    socket.emit('roomJoined', { roomCode: code, playerNumber: number, mode: room.mode });
    broadcastLobby(code);

    // PvP: đủ 2 người thì tự bắt đầu
    if (room.mode === 'pvp' && room.players.length >= 2) {
      room.started = true;
      io.to(code).emit('gameStart', { mode: 'pvp', map: room.map, players: publicPlayers(room) });
    }
  });

  // ----- Chủ phòng bấm Bắt đầu (Co-op) -----
  socket.on('startGame', () => {
    const code = socket.data.room;
    const room = rooms[code];
    if (!room || room.mode !== 'coop' || room.started || room.host !== socket.id) return;
    io.to(code).emit('gameStart', { mode: 'coop', map: room.map, players: publicPlayers(room) });
    startCoop(code);
  });

  // ----- Vị trí tàu -----
  socket.on('state', (d) => {
    const code = socket.data.room;
    const room = rooms[code];
    if (!room || !d) return;
    if (room.mode === 'pvp') {
      socket.to(code).emit('opponentState', d);
    } else {
      const p = room.players.find((x) => x.id === socket.id);
      if (p && p.alive) {
        p.x = clamp(Number(d.x) || 0, -COOP.ARENA, COOP.ARENA);
        p.z = clamp(Number(d.z) || 0, -COOP.ARENA, COOP.ARENA);
      }
    }
  });

  // ----- Bắn -----
  socket.on('shoot', (d) => {
    const code = socket.data.room;
    const room = rooms[code];
    if (!room || !d) return;
    if (room.mode === 'pvp') {
      socket.to(code).emit('opponentShoot', d);
      return;
    }
    const sim = room.sim;
    const p = room.players.find((x) => x.id === socket.id);
    if (!sim || !sim.timer || room.over || !p || !p.alive) return;

    const now = Date.now();
    if (now - p.lastShot < SHIP_CD[p.ship] * 1000 * 0.8) return; // chống bắn quá nhanh
    p.lastShot = now;
    p.x = clamp(Number(d.x) || p.x, -COOP.ARENA, COOP.ARENA);
    p.z = clamp(Number(d.z) || p.z, -COOP.ARENA, COOP.ARENA);
    if (sim.bullets.length < 250) {
      sim.bullets.push({ id: sim.nextId++, x: p.x, z: p.z - 1.8 });
    }
  });

  // ----- Chết (PvP) -----
  socket.on('died', () => {
    const code = socket.data.room;
    const room = rooms[code];
    if (!room || room.mode !== 'pvp') return;
    const p = room.players.find((x) => x.id === socket.id);
    io.to(code).emit('gameOver', { loser: p ? p.number : 0 });
  });

  // ----- Ngắt kết nối -----
  socket.on('disconnect', () => {
    const code = socket.data.room;
    const room = rooms[code];
    if (!room) return;
    const idx = room.players.findIndex((p) => p.id === socket.id);
    if (idx < 0) return;

    if (room.mode === 'pvp') {
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