import * as THREE from 'three';

// ==========================================
// 1. KẾT NỐI SERVER + TRANG CHỦ + PHÒNG CHỜ
// ==========================================
const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const SERVER_URL = isLocal ? 'http://localhost:3000' : window.location.origin;
const socket = io(SERVER_URL, { reconnection: true, timeout: 20000 });

const $ = (id) => document.getElementById(id);
const setStatus = (msg) => { $('statusText').innerText = msg; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let selectedMode = 'pvp';
let currentRoomCode = null;
let myNumber = 1;
let gameStarted = false;
let soloMode = false;
let soloShootTimer = 1.5;
let currentMap = '1';

setStatus('Đang kết nối server...');
socket.onAny((event, ...args) => {
    if (event !== 'snapshot') console.log(`[socket] ${event}`, ...args);
});
socket.onAnyOutgoing((event, ...args) => console.log(`[socket] emit ${event}`, ...args));
socket.on('connect', () => setStatus('Đã kết nối'));
socket.on('disconnect', (reason) => {
    console.log('[socket] disconnect', reason);
    setStatus('Đang kết nối server...');
});
socket.on('connect_error', (error) => {
    console.warn('[socket] connect_error', error.message);
    setStatus('Đang kết nối server...');
});

function pickMode(m) {
    selectedMode = m;
    $('modeCoop').classList.toggle('active', m === 'coop');
    $('modePvp').classList.toggle('active', m === 'pvp');
}
$('modeCoop').onclick = () => pickMode('coop');
$('modePvp').onclick = () => pickMode('pvp');

function getUserData() {
    return {
        name: $('playerName').value || 'Player',
        ship: $('shipSelect').value || '1',
        map: $('mapSelect').value || '1',
        mode: selectedMode,
    };
}

$('btnCreateRoom').addEventListener('click', () => {
    const userData = getUserData();
    socket.emit('createRoom', userData);
    setStatus('正在建立房間... (Đang tạo phòng...)');
});

$('btnJoinRoom').addEventListener('click', () => {
    const code = $('roomCodeInput').value.trim();
    if (code.length !== 4) {
        alert('請輸入4位數房號！ (Vui lòng nhập đủ 4 số!)');
        return;
    }
    const data = { roomCode: code, userData: getUserData() };
    socket.emit('joinRoom', data);
    setStatus('正在加入房間... (Đang vào phòng...)');
});

function showWaiting(mode) {
    $('homePanel').classList.add('hidden');
    $('waitPanel').classList.remove('hidden');
    $('roomCodeBig').innerText = currentRoomCode;
    $('waitInfo').innerText = mode === 'coop'
        ? '把房號傳給朋友 (Gửi mã cho bạn bè, tối đa 4 người. Chủ phòng bấm Bắt đầu khi đủ người)'
        : '等待對手加入 (Đang chờ 1 đối thủ, tự bắt đầu khi đủ 2 người)';
    setStatus('');
}

socket.on('roomCreated', (d) => {
    currentRoomCode = d.roomCode;
    myNumber = d.playerNumber;
    showWaiting(d.mode);
    setStatus(`Đã tạo phòng ${currentRoomCode}`);
});

socket.on('roomJoined', (d) => {
    currentRoomCode = d.roomCode;
    myNumber = d.playerNumber;
    showWaiting(d.mode);
    setStatus(`Đã vào phòng ${currentRoomCode}`);
});

socket.on('lobbyUpdate', (d) => {
    $('playerList').innerHTML = d.players.map((p) =>
        `<li>${p.number === d.host ? '👑 ' : ''}${esc(p.name)}${p.number === myNumber ? ' (bạn)' : ''}</li>`
    ).join('');
    const isHost = myNumber === d.host;
    $('btnStart').classList.toggle('hidden', !(isHost && d.mode === 'coop'));
    if (d.players.length > 1 && d.mode === 'pvp') setStatus('Đã kết nối, đối thủ đã vào phòng');
});

$('btnStart').onclick = () => socket.emit('startGame');

$('btnSolo').addEventListener('click', () => {
    if (gameStarted) return;
    gameStarted = true;
    soloMode = true;
    currentRoomCode = '單人';
    myNumber = 1;
    $('lobby-menu').style.display = 'none';
    const user = getUserData();
    currentMap = user.map || '1';
    init3DGame({
        mode: 'pvp',
        map: currentMap,
        solo: true,
        players: [
            { number: 1, name: user.name, ship: user.ship },
            { number: 2, name: 'CPU', ship: '1' },
        ],
    });
});

socket.on('gameStart', (data) => {
    if (gameStarted) return;
    gameStarted = true;
    currentMap = data.map || currentMap;
    setStatus('遊戲開始！ (Trò chơi bắt đầu!)');
    setTimeout(() => {
        $('lobby-menu').style.display = 'none';
        init3DGame(data);
    }, 1200);
});

socket.on('errorMsg', (msg) => {
    const message = String(msg || 'Server error');
    if (/không tồn tại|找不到房間/i.test(message)) setStatus('Phòng không tồn tại');
    else if (/đã đầy|房間已滿/i.test(message)) setStatus('Phòng đầy');
    else setStatus(message);
});

// ==========================================
// 2. THÔNG SỐ GAME
// ==========================================
const SHIPS = {
    '1': { color: 0x00ffcc, speed: 14, hp: 100, cooldown: 0.25 },
    '2': { color: 0xffee00, speed: 20, hp: 70, cooldown: 0.20 },
    '3': { color: 0x66aaff, speed: 10, hp: 150, cooldown: 0.35 },
};
const ARENA = 14;
const OPP_COLOR = 0xff3366;
const START_X = [-6, -2, 2, 6];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function getMapDifficulty() {
    if (currentMap === '2') return 1.35;
    if (currentMap === '3') return 1.7;
    return 1;
}

let mode = 'coop';
let scene, camera, renderer, starField;
let myShip, myStats, oppShip;
let myHp = 100, oppHp = 100, alive = true, gameEnded = false;
let gameTime = 0, lastFrame = 0, lastSend = 0, shootCd = 0;
let hudEl, msgEl, bossHealthWrap, shipHealthBar;
let boss = null;
let bossShots = [];
let rockShots = [];

const oppTarget = { x: 0, z: -12 };
let oppRotationTarget = 0;
const bullets = [];
const decorRocks = [];
const keys = {};

const teamShips = {};
const playersInfo = {};
const astMeshes = new Map();
const bulMeshes = new Map();
const explosions = [];
let coopStats = { time: 0, score: 0, level: 1, shield: 5, mul: 1 };

const speedMul = () => Math.min(2, 1 + gameTime * 0.01);

const bulletGeo = new THREE.SphereGeometry(0.3, 8, 8);
const bulletMatMine = new THREE.MeshBasicMaterial({ color: 0xffee55 });
const bulletMatOpp = new THREE.MeshBasicMaterial({ color: 0xff5577 });
const bulletMatTeam = new THREE.MeshBasicMaterial({ color: 0x66ffee });
const rockGeo = new THREE.IcosahedronGeometry(1, 1);
const rockMat = new THREE.MeshStandardMaterial({ color: 0x8a7f73, roughness: 1, flatShading: true });
const boomGeo = new THREE.SphereGeometry(1, 12, 12);
const rockShotMat = new THREE.MeshBasicMaterial({ color: 0xffa855 });

const audioContext = window.AudioContext || window.webkitAudioContext ? new (window.AudioContext || window.webkitAudioContext)() : null;

function playTone({ freq = 440, duration = 0.08, type = 'square', volume = 0.04, slide = 0 } = {}) {
    if (!audioContext) return;
    const ctx = audioContext;
    if (ctx.state === 'suspended') ctx.resume();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slide) {
        osc.frequency.linearRampToValueAtTime(freq + slide, ctx.currentTime + duration);
    }

    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(volume, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration + 0.02);
}

function playUiTone() { playTone({ freq: 520, duration: 0.04, type: 'square', volume: 0.018, slide: 80 }); }
function playShootTone() { playTone({ freq: 700, duration: 0.05, type: 'square', volume: 0.025, slide: 120 }); }
function playHitTone() { playTone({ freq: 180, duration: 0.08, type: 'triangle', volume: 0.03, slide: -80 }); }
function playBossTone() { playTone({ freq: 120, duration: 0.12, type: 'sawtooth', volume: 0.04, slide: -50 }); }

function attachUiSoundHandlers() {
    document.addEventListener('click', (event) => {
        const target = event.target;
        if (target.closest('button, select, input')) playUiTone();
    });
    document.addEventListener('keydown', (event) => {
        if (event.target && (event.target.tagName === 'INPUT' || event.target.tagName === 'SELECT' || event.target.tagName === 'TEXTAREA')) return;
        const allowed = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD', 'KeyW', 'KeyS'];
        if (allowed.includes(event.code)) playUiTone();
    });
}
attachUiSoundHandlers();

// ==========================================
// 3. KHỞI TẠO ĐỒ HỌA 3D
// ==========================================
function init3DGame(data) {
    mode = data.mode;
    currentMap = data.map || currentMap;
    soloMode = !!data.solo;
    soloShootTimer = 1.5;
    const me = data.players.find((p) => p.number === myNumber) || data.players[0];
    myStats = SHIPS[me.ship] || SHIPS['1'];
    myHp = myStats.hp;

    data.players.forEach((p) => {
        const st = SHIPS[p.ship] || SHIPS['1'];
        playersInfo[p.number] = { name: p.name, hp: st.hp, max: st.hp, alive: true };
    });

    scene = new THREE.Scene();
    scene.background = new THREE.Color(currentMap === '2' ? 0x14100a : 0x050515);

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 42, 24);
    camera.lookAt(0, 0, -6);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.domElement.style.display = 'block';
    document.body.style.margin = '0';
    document.body.style.overflow = 'hidden';
    document.body.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const dirLight = new THREE.DirectionalLight(0x00d2ff, 1.5);
    dirLight.position.set(10, 20, 10);
    scene.add(dirLight);

    if (mode === 'pvp') {
        const opp = data.players.find((p) => p.number !== myNumber);
        oppHp = opp ? (SHIPS[opp.ship] || SHIPS['1']).hp : 100;

        myShip = makeShipMesh(myStats.color, -1);
        myShip.position.set(0, 0, 12);
        oppShip = makeShipMesh(OPP_COLOR, 1);
        oppShip.position.set(0, 0, -12);
        scene.add(oppShip);
        if (currentMap === '1' || currentMap === '2') createDecorRocks(currentMap === '2' ? 18 : 12);
    } else {
        myShip = makeShipMesh(myStats.color, -1);
        myShip.position.set(START_X[myNumber - 1] ?? 0, 0, 12);

        data.players.forEach((p) => {
            if (p.number === myNumber) return;
            const st = SHIPS[p.ship] || SHIPS['1'];
            const mesh = makeShipMesh(st.color, -1);
            const x = START_X[p.number - 1] ?? 0;
            mesh.position.set(x, 0, 12);
            scene.add(mesh);
            teamShips[p.number] = { mesh, tx: x, tz: 12 };
        });
    }
    scene.add(myShip);

    createStars();
    createHUD();
    setupInput();
    window.addEventListener('resize', onWindowResize);

    lastFrame = performance.now();
    animate();
}

function makeShipMesh(color, forward) {
    const geom = new THREE.ConeGeometry(1, 3, 4);
    geom.rotateX(forward * Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.3 });
    return new THREE.Mesh(geom, mat);
}

function createStars() {
    const geo = new THREE.BufferGeometry();
    const count = 1000;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        pos[i * 3] = (Math.random() - 0.5) * 160;
        pos[i * 3 + 1] = -10 - Math.random() * 30;
        pos[i * 3 + 2] = (Math.random() - 0.5) * 120;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    starField = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.5 }));
    scene.add(starField);
}

function createDecorRocks(count = 12) {
    for (const rock of decorRocks) {
        scene.remove(rock);
    }
    decorRocks.length = 0;
    rockShots.forEach((shot) => scene.remove(shot.mesh));
    rockShots = [];

    for (let i = 0; i < count; i++) {
        const rock = new THREE.Mesh(rockGeo, rockMat);
        const baseX = (Math.random() - 0.5) * 26;
        const baseZ = -10 + (Math.random() - 0.5) * 20;
        rock.position.set(baseX, 0, baseZ);
        rock.scale.setScalar(0.9 + Math.random() * 1.7);
        rock.rotation.set(Math.random() * 3, Math.random() * 3, 0);
        rock.userData = {
            baseX,
            baseZ,
            phase: Math.random() * Math.PI * 2,
            spread: 2.2 + Math.random() * 2.3,
            speed: 0.7 + Math.random() * 1.5,
            fireTimer: 1.5 + Math.random() * 2.2,
            drift: Math.random() * Math.PI * 2,
        };
        scene.add(rock);
        decorRocks.push(rock);
    }
}

function explode(x, z, size) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffaa33, transparent: true, opacity: 0.9 });
    const mesh = new THREE.Mesh(boomGeo, mat);
    mesh.position.set(x, 0, z);
    mesh.scale.setScalar(size * 0.6);
    scene.add(mesh);
    explosions.push({ mesh, life: 0, size });
}

function createHUD() {
    hudEl = document.createElement('div');
    hudEl.style.cssText = 'position:fixed;top:10px;left:10px;color:#fff;font:18px Arial;text-shadow:0 0 6px #000;z-index:50;line-height:1.6;';
    document.body.appendChild(hudEl);

    shipHealthBar = document.createElement('div');
    shipHealthBar.id = 'shipHealthBar';
    shipHealthBar.style.cssText = 'position:fixed;right:22px;top:20px;width:220px;z-index:70;display:none;';
    shipHealthBar.innerHTML = `
        <div style="position:relative;height:34px;border-radius:18px;background:rgba(15,18,25,.68);border:1px solid rgba(255,255,255,.18);overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,.28);">
            <div style="position:absolute;inset:0;background:linear-gradient(90deg, rgba(87,234,255,.3), rgba(34,179,255,.12));clip-path:polygon(0% 50%, 18% 18%, 68% 18%, 100% 50%, 68% 82%, 18% 82%);"></div>
            <div id="shipHpFill" style="position:absolute;left:0;top:0;height:100%;width:100%;background:linear-gradient(90deg,#48f5c3,#56deff,#aaf9a6);clip-path:polygon(0% 50%, 18% 18%, 68% 18%, 100% 50%, 68% 82%, 18% 82%);transition:width .14s ease;"></div>
            <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#04141a;font:700 12px Arial;letter-spacing:.12em;text-shadow:0 0 4px rgba(255,255,255,.75);">HP <span id="shipHpText">100</span></div>
        </div>
    `;
    document.body.appendChild(shipHealthBar);

    msgEl = document.createElement('div');
    msgEl.style.cssText = 'position:fixed;inset:0;display:none;align-items:center;justify-content:center;flex-direction:column;gap:24px;background:rgba(0,0,0,.7);color:#fff;font:bold 36px Arial;z-index:60;';
    document.body.appendChild(msgEl);

    bossHealthWrap = document.createElement('div');
    bossHealthWrap.id = 'bossHealthWrap';
    bossHealthWrap.style.cssText = 'position:fixed;left:50%;top:18px;transform:translateX(-50%);width:min(420px,62vw);padding:12px 14px;border-radius:18px;background:rgba(15,20,32,.76);border:2px solid rgba(255,210,120,.9);box-shadow:0 0 0 2px rgba(255,132,0,.4),0 12px 30px rgba(0,0,0,.35);display:none;z-index:70;color:#fff;font:600 14px Arial;';
    bossHealthWrap.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:7px;letter-spacing:.12em;text-transform:uppercase;">
            <span>Final Boss</span>
            <span id="bossHpText">0 / 0</span>
        </div>
        <div style="height:18px;border-radius:999px;background:rgba(255,255,255,.12);overflow:hidden;position:relative;border:1px solid rgba(255,255,255,.25);box-shadow:inset 0 0 10px rgba(255,255,255,.08);">
            <div style="position:absolute;inset:0;background:linear-gradient(90deg, rgba(255,255,255,.18), rgba(255,255,255,.02));"></div>
            <div id="bossHpFill" style="height:100%;width:0%;background:linear-gradient(90deg,#ff4d52,#ffbf60,#ffe38c);border-radius:999px;transition:width .12s ease;box-shadow:0 0 12px rgba(255,170,80,.8);"></div>
        </div>
    `;
    document.body.appendChild(bossHealthWrap);
}

function updateBossBar() {
    if (!bossHealthWrap || !boss) {
        if (bossHealthWrap) bossHealthWrap.style.display = 'none';
        return;
    }
    const fill = document.getElementById('bossHpFill');
    const text = document.getElementById('bossHpText');
    if (fill) fill.style.width = `${Math.max(0, (boss.hp / boss.maxHp) * 100)}%`;
    if (text) text.textContent = `${Math.max(0, Math.ceil(boss.hp))} / ${boss.maxHp}`;
    bossHealthWrap.style.display = 'block';
}

function updateShipHealthBar() {
    if (!shipHealthBar) return;
    const max = myStats && myStats.hp ? myStats.hp : 100;
    const ratio = clamp(myHp / max, 0, 1);
    const fill = document.getElementById('shipHpFill');
    const text = document.getElementById('shipHpText');
    if (fill) fill.style.width = `${ratio * 100}%`;
    if (text) text.textContent = `${Math.max(0, Math.round(myHp))}`;
    shipHealthBar.style.display = mode === 'pvp' ? 'block' : 'none';
}

function updateHUD() {
    updateShipHealthBar();

    if (mode === 'pvp') {
        hudEl.innerHTML =
            `❤️ Đối thủ: ${Math.max(0, Math.round(oppHp))} &nbsp;|&nbsp; ⚡ x${speedMul().toFixed(2)}` +
            `<br> 🏷️ Room ${currentRoomCode || 'solo'}`;
        return;
    }
    const lines = Object.entries(playersInfo).map(([n, p]) =>
        `${p.alive ? '🟢' : '💀'} ${esc(p.name)}${Number(n) === myNumber ? ' (bạn)' : ''} - Máu: ${Math.max(0, p.hp)}/${p.max}`);
    hudEl.innerHTML =
        `🏆 Điểm đội: ${coopStats.score} &nbsp;|&nbsp; 🌠 Cấp ${coopStats.level} &nbsp;|&nbsp; ⏱️ ${coopStats.time}s &nbsp;|&nbsp; ⚡ x${coopStats.mul.toFixed(2)}` +
        `<br>🛡️ 護盾 (Lá chắn): ${'🟦'.repeat(Math.max(0, coopStats.shield))} &nbsp;|&nbsp; 房號 ${currentRoomCode}` +
        `<br>${lines.join('<br>')}` +
        (alive ? '' : '<br>💥 你已陣亡，觀戰中 (Bạn đã hạ gục, đang xem đồng đội)');
}

function showMessage(html) {
    if (!msgEl) return;
    msgEl.innerHTML = `<div>${html}</div><button id="btnAgain" style="padding:12px 28px;font-size:20px;border:none;border-radius:6px;background:#28a745;color:#fff;cursor:pointer;">再玩一次 (Chơi lại)</button>`;
    msgEl.style.display = 'flex';
    document.getElementById('btnAgain').onclick = () => location.reload();
}

function setupInput() {
    const block = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    window.addEventListener('keydown', (e) => {
        keys[e.code] = true;
        if (block.includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { keys[e.code] = false; });
}

function spawnBullet(x, z, vx, vz, mine) {
    const mesh = new THREE.Mesh(bulletGeo, mine ? bulletMatMine : bulletMatOpp);
    mesh.position.set(x, 0, z);
    scene.add(mesh);
    bullets.push({ mesh, vx, vz, mine });
}

function spawnRockShot(rock) {
    const shot = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 8), rockShotMat);
    shot.position.copy(rock.position);
    scene.add(shot);

    const target = Math.hypot(myShip.position.x - rock.position.x, myShip.position.z - rock.position.z)
        < Math.hypot(oppShip.position.x - rock.position.x, oppShip.position.z - rock.position.z)
        ? myShip.position
        : oppShip.position;

    const dx = target.x - rock.position.x;
    const dz = target.z - rock.position.z;
    const dist = Math.hypot(dx, dz) || 1;

    rockShots.push({
        mesh: shot,
        vx: (dx / dist) * (7 + getMapDifficulty() * 3),
        vz: (dz / dist) * (7 + getMapDifficulty() * 3),
        life: 2.5,
    });
}

function spawnBossShot() {
    if (!boss || !scene) return;

    const target = myShip && myShip.position ? myShip.position : new THREE.Vector3(0, 0, 12);
    let aimX = target.x;
    let aimZ = target.z;

    for (const other of Object.values(teamShips)) {
        if (other && other.mesh && other.mesh.visible) {
            aimX = other.mesh.position.x;
            aimZ = other.mesh.position.z;
            break;
        }
    }

    const shotGeo = new THREE.SphereGeometry(0.55, 10, 10);
    const shotMat = new THREE.MeshBasicMaterial({ color: 0xff6a6a });
    const mesh = new THREE.Mesh(shotGeo, shotMat);
    mesh.position.copy(boss.mesh.position);
    scene.add(mesh);

    const dx = aimX - boss.mesh.position.x;
    const dz = aimZ - boss.mesh.position.z;
    const dist = Math.hypot(dx, dz) || 1;

    bossShots.push({
        mesh,
        vx: (dx / dist) * (10 + getMapDifficulty() * 3),
        vz: (dz / dist) * (10 + getMapDifficulty() * 3),
    });
}

function spawnBoss() {
    if (!scene || mode !== 'coop' || boss) return;

    const mapMul = getMapDifficulty();
    const bossGeo = new THREE.IcosahedronGeometry(2.9, 1);
    const bossMat = new THREE.MeshStandardMaterial({
        color: 0xff4d4d,
        emissive: 0x440000,
        metalness: 0.5,
        roughness: 0.35,
    });

    const mesh = new THREE.Mesh(bossGeo, bossMat);
    mesh.position.set(0, 0, -12);
    scene.add(mesh);

    boss = {
        mesh,
        hp: 700 * mapMul,
        maxHp: 700 * mapMul,
        fireTimer: 0.75,
        drift: 0,
        damage: 15 + mapMul * 5,
        speed: 1.2 + mapMul * 0.4,
    };
    updateBossBar();
}

function destroyBoss() {
    if (!boss) return;
    scene.remove(boss.mesh);
    boss = null;
    bossShots = [];
    if (bossHealthWrap) bossHealthWrap.style.display = 'none';
    setStatus('Boss đã bị hạ!');
    showMessage('🏆 Final Boss đã bị hạ!<br><br>Chiến thắng!');
    gameEnded = true;
}

function die() {
    alive = false;
    myShip.visible = false;
    if (!soloMode) socket.emit('died');
}

function update(dt, now) {
    gameTime += dt;

    if (mode === 'coop' && !boss && coopStats.time >= 28) spawnBoss();

    if (alive) {
        const moveMul = mode === 'pvp' ? speedMul() : 1;
        let dx = 0, dz = 0;
        if (keys.ArrowLeft || keys.KeyA) dx -= 1;
        if (keys.ArrowRight || keys.KeyD) dx += 1;
        if (keys.ArrowUp || keys.KeyW) dz -= 1;
        if (keys.ArrowDown || keys.KeyS) dz += 1;
        if (dx && dz) { dx *= 0.7071; dz *= 0.7071; }

        myShip.position.x = clamp(myShip.position.x + dx * myStats.speed * moveMul * dt, -ARENA, ARENA);
        myShip.position.z = clamp(myShip.position.z + dz * myStats.speed * moveMul * dt, -ARENA, ARENA);
        myShip.rotation.z = -dx * 0.4;

        shootCd -= dt;
        if (keys.Space && shootCd <= 0) {
            shootCd = myStats.cooldown;
            playShootTone();
            if (mode === 'pvp') {
                const b = { x: myShip.position.x, z: myShip.position.z - 1.8, vx: 0, vz: -30 * speedMul() };
                spawnBullet(b.x, b.z, b.vx, b.vz, true);
                if (!soloMode) socket.emit('shoot', b);
            } else {
                if (!soloMode) socket.emit('shoot', { x: myShip.position.x, z: myShip.position.z });
            }
        }
    }

    if (mode === 'pvp') updatePvp(dt); else updateCoop(dt);

    const starSpeed = mode === 'coop' ? coopStats.mul : speedMul();
    const arr = starField.geometry.attributes.position.array;
    for (let i = 2; i < arr.length; i += 3) {
        arr[i] += 15 * starSpeed * dt;
        if (arr[i] > 60) arr[i] = -60;
    }
    starField.geometry.attributes.position.needsUpdate = true;

    for (let i = explosions.length - 1; i >= 0; i--) {
        const e = explosions[i];
        e.life += dt;
        const t = e.life / 0.35;
        e.mesh.scale.setScalar(e.size * (0.6 + t * 1.2));
        e.mesh.material.opacity = Math.max(0, 0.9 * (1 - t));
        if (t >= 1) {
            scene.remove(e.mesh);
            e.mesh.material.dispose();
            explosions.splice(i, 1);
        }
    }

    if (!soloMode && now - lastSend > 50) {
        lastSend = now;
        socket.emit('state', {
            x: myShip.position.x,
            z: myShip.position.z,
            rotation: myShip.rotation.z,
            hp: myHp,
        });
    }

    updateHUD();
}

function updatePvp(dt) {
    const k = Math.min(1, dt * 12);
    const diff = getMapDifficulty();

    if (soloMode) {
        oppTarget.x = Math.sin(gameTime * 0.8) * 8;
        oppTarget.z = -12;
        soloShootTimer -= dt;
        if (soloShootTimer <= 0) {
            soloShootTimer = Math.max(0.7, 1.2 / diff);
            spawnBullet(oppShip.position.x, oppShip.position.z + 1.8, 0, 24 * speedMul(), false);
            playHitTone();
        }
    }

    oppShip.position.x += (oppTarget.x - oppShip.position.x) * k;
    oppShip.position.z += (oppTarget.z - oppShip.position.z) * k;
    oppShip.rotation.z += (oppRotationTarget - oppShip.rotation.z) * k;

    for (const rock of decorRocks) {
        const { baseX, baseZ, phase, spread, speed, drift } = rock.userData;
        const centerPull = 0.016 * diff * 60 * dt;
        rock.position.x += (0 - rock.position.x) * centerPull;
        rock.position.z += (-2 - rock.position.z) * centerPull * 0.8;
        rock.position.x = baseX + Math.sin(gameTime * speed + phase + drift) * spread + Math.sin(gameTime * 0.8 + drift) * 1.4;
        rock.position.z = baseZ + Math.cos(gameTime * (speed * 0.8) + phase) * (spread * 0.75) - 2;
        rock.rotation.x += dt * (0.4 + speed * 0.2);
        rock.rotation.y += dt * (0.5 + speed * 0.25);

        rock.userData.fireTimer -= dt;
        if (rock.userData.fireTimer <= 0) {
            spawnRockShot(rock);
            rock.userData.fireTimer = Math.max(1.2, 2.8 / diff);
        }

        const shipDistMine = Math.hypot(myShip.position.x - rock.position.x, myShip.position.z - rock.position.z);
        if (shipDistMine < 2.2) myHp = Math.max(0, myHp - 8 * dt * diff);
        const shipDistOpp = Math.hypot(oppShip.position.x - rock.position.x, oppShip.position.z - rock.position.z);
        if (shipDistOpp < 2.2) oppHp = Math.max(0, oppHp - 8 * dt * diff);
    }

    for (let i = rockShots.length - 1; i >= 0; i--) {
        const shot = rockShots[i];
        shot.mesh.position.x += shot.vx * dt;
        shot.mesh.position.z += shot.vz * dt;
        shot.life -= dt;

        const myDist = Math.hypot(shot.mesh.position.x - myShip.position.x, shot.mesh.position.z - myShip.position.z);
        const oppDist = Math.hypot(shot.mesh.position.x - oppShip.position.x, shot.mesh.position.z - oppShip.position.z);
        if (myDist < 1.5) {
            myHp = Math.max(0, myHp - 10 * diff);
            playHitTone();
            scene.remove(shot.mesh);
            rockShots.splice(i, 1);
            continue;
        }
        if (oppDist < 1.5) {
            oppHp = Math.max(0, oppHp - 10 * diff);
            scene.remove(shot.mesh);
            rockShots.splice(i, 1);
            continue;
        }
        if (shot.life <= 0 || Math.abs(shot.mesh.position.x) > 30 || Math.abs(shot.mesh.position.z) > 30) {
            scene.remove(shot.mesh);
            rockShots.splice(i, 1);
        }
    }

    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.mesh.position.x += b.vx * dt;
        b.mesh.position.z += b.vz * dt;

        let remove = Math.abs(b.mesh.position.x) > 30 || Math.abs(b.mesh.position.z) > 30;

        for (const rock of decorRocks) {
            const dx = b.mesh.position.x - rock.position.x;
            const dz = b.mesh.position.z - rock.position.z;
            if (dx * dx + dz * dz < 1.6) {
                remove = true;
                break;
            }
        }

        if (soloMode && b.mine) {
            const dx = b.mesh.position.x - oppShip.position.x;
            const dz = b.mesh.position.z - oppShip.position.z;
            if (dx * dx + dz * dz < 2.25) {
                oppHp -= 10 * diff;
                remove = true;
                playHitTone();
                if (oppHp <= 0 && !gameEnded) {
                    gameEnded = true;
                    oppShip.visible = false;
                    showMessage('🏆 Bạn đã thắng!');
                }
            }
        }

        if (!b.mine && alive) {
            const ex = b.mesh.position.x - myShip.position.x;
            const ez = b.mesh.position.z - myShip.position.z;
            if (ex * ex + ez * ez < 2.25) {
                myHp -= 10 * diff;
                remove = true;
                playHitTone();
                if (myHp <= 0) die();
            }
        }
        if (remove) {
            scene.remove(b.mesh);
            bullets.splice(i, 1);
        }
    }
    decorRocks.forEach((r) => { r.rotation.x += dt * 0.3; r.rotation.y += dt * 0.2; });
}

function updateCoop(dt) {
    const k = Math.min(1, dt * 14);
    for (const t of Object.values(teamShips)) {
        t.mesh.position.x += (t.tx - t.mesh.position.x) * k;
        t.mesh.position.z += (t.tz - t.mesh.position.z) * k;
    }
    const k2 = Math.min(1, dt * 25);
    for (const o of astMeshes.values()) {
        o.tx += o.vx * dt;
        o.tz += o.vz * dt;
        o.mesh.position.x += (o.tx - o.mesh.position.x) * k2;
        o.mesh.position.z += (o.tz - o.mesh.position.z) * k2;
        o.mesh.rotation.x += dt * o.spin;
        o.mesh.rotation.y += dt * o.spin * 0.7;
    }
    for (const o of bulMeshes.values()) {
        o.mesh.position.x += (o.tx - o.mesh.position.x) * k2;
        o.mesh.position.z += (o.tz - o.mesh.position.z) * k2;
    }

    if (boss) {
        boss.drift += dt;
        boss.mesh.position.x = Math.sin(boss.drift * boss.speed) * 7.2;
        boss.mesh.position.z = -12 + Math.cos(boss.drift * (boss.speed * 1.5)) * 2.5;
        boss.mesh.rotation.x += dt * 2.4;
        boss.mesh.rotation.y += dt * 2.8;
        boss.fireTimer -= dt;
        if (boss.fireTimer <= 0) {
            spawnBossShot();
            playBossTone();
            boss.fireTimer = Math.max(0.4, 0.85 / getMapDifficulty());
        }

        for (let i = bossShots.length - 1; i >= 0; i--) {
            const shot = bossShots[i];
            shot.mesh.position.x += shot.vx * dt;
            shot.mesh.position.z += shot.vz * dt;

            const hitDist = Math.hypot(shot.mesh.position.x - myShip.position.x, shot.mesh.position.z - myShip.position.z);
            if (hitDist < 1.8) {
                myHp = Math.max(0, myHp - boss.damage);
                playHitTone();
                if (myHp <= 0) die();
                scene.remove(shot.mesh);
                bossShots.splice(i, 1);
                continue;
            }

            if (Math.abs(shot.mesh.position.x) > 30 || Math.abs(shot.mesh.position.z) > 30) {
                scene.remove(shot.mesh);
                bossShots.splice(i, 1);
            }
        }

        const bulletEntries = [...bulMeshes.entries()];
        for (const [id, bullet] of bulletEntries) {
            if (!bullet || !bullet.mesh) continue;
            if (bullet.mesh.position.distanceTo(boss.mesh.position) < 3.3) {
                boss.hp -= 26;
                playHitTone();
                scene.remove(bullet.mesh);
                bulMeshes.delete(id);
                if (boss.hp <= 0) {
                    destroyBoss();
                    return;
                }
            }
        }

        updateBossBar();
    }
}

function animate(now = performance.now()) {
    requestAnimationFrame(animate);
    const dt = Math.min((now - lastFrame) / 1000, 0.05);
    lastFrame = now;
    if (!gameEnded) update(dt, now);
    renderer.render(scene, camera);
}

function onWindowResize() {
    if (!camera || !renderer) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

socket.on('snapshot', (s) => {
    if (!scene || mode !== 'coop') return;

    coopStats = { time: s.t, score: s.sc, level: s.lv, shield: s.sh, mul: s.m };

    for (const [n, x, z, hp, al] of s.p) {
        const info = playersInfo[n];
        if (info) { info.hp = hp; info.alive = !!al; }
        if (n === myNumber) {
            myHp = hp;
            if (!al && alive) {
                alive = false;
                myShip.visible = false;
                explode(myShip.position.x, myShip.position.z, 3);
            }
        } else if (teamShips[n]) {
            teamShips[n].tx = x;
            teamShips[n].tz = z;
            teamShips[n].mesh.visible = !!al;
        }
    }

    const seenA = new Set();
    for (const [id, x, z, vx, vz, r] of s.a) {
        seenA.add(id);
        let o = astMeshes.get(id);
        if (!o) {
            const mesh = new THREE.Mesh(rockGeo, rockMat);
            mesh.scale.setScalar(r);
            mesh.position.set(x, 0, z);
            mesh.rotation.set(Math.random() * 3, Math.random() * 3, 0);
            scene.add(mesh);
            o = { mesh, tx: x, tz: z, vx, vz, spin: (Math.random() - 0.5) * 2.5 };
            astMeshes.set(id, o);
        }
        o.tx = x;
        o.tz = z;
        o.vx = vx;
        o.vz = vz;
    }
    for (const [id, o] of astMeshes) {
        if (!seenA.has(id)) {
            if (o.mesh.position.z < 14) explode(o.mesh.position.x, o.mesh.position.z, o.mesh.scale.x * 1.4);
            scene.remove(o.mesh);
            astMeshes.delete(id);
        }
    }

    const seenB = new Set();
    for (const [id, x, z] of s.b) {
        seenB.add(id);
        let o = bulMeshes.get(id);
        if (!o) {
            const mesh = new THREE.Mesh(bulletGeo, bulletMatTeam);
            mesh.position.set(x, 0, z);
            scene.add(mesh);
            o = { mesh, tx: x, tz: z };
            bulMeshes.set(id, o);
        }
        o.tx = x;
        o.tz = z;
    }
    for (const [id, o] of bulMeshes) {
        if (!seenB.has(id)) {
            scene.remove(o.mesh);
            bulMeshes.delete(id);
        }
    }
});

socket.on('coopOver', ({ score, time, level, reason }) => {
    if (gameEnded) return;
    gameEnded = true;
    const why = reason === 'shield'
        ? '🛡️ 護盾耗盡 (Lá chắn đã cạn)'
        : '💥 全員陣亡 (Cả đội đã hy sinh)';
    showMessage(`${why}<br><br>🏆 Điểm: ${score}<br>🌠 Cấp: ${level} &nbsp;|&nbsp; ⏱️ ${time}s`);
});

socket.on('playerLeft', ({ number }) => {
    if (playersInfo[number]) {
        playersInfo[number].alive = false;
        playersInfo[number].name += ' (đã thoát)';
    }
});

socket.on('opponentState', (d) => {
    if (soloMode || !oppShip) return;
    oppTarget.x = -d.x;
    oppTarget.z = -d.z;
    oppRotationTarget = -d.rotation;
    oppHp = d.hp;
});

socket.on('opponentShoot', (d) => {
    if (soloMode || !scene) return;
    spawnBullet(-d.x, -d.z, -d.vx, -d.vz, false);
});

socket.on('gameOver', ({ loser }) => {
    if (soloMode) return;
    if (gameEnded) return;
    gameEnded = true;
    if (loser !== myNumber && oppShip) oppShip.visible = false;
    showMessage(loser === myNumber ? 'THUA - Bạn đã thua' : 'THẮNG - Bạn đã thắng!');
});

socket.on('opponentLeft', () => {
    if (soloMode) return;
    if (gameEnded) return;
    gameEnded = true;
    showMessage('Đối thủ đã rời phòng');
});
