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
    setStatus('Đang tạo phòng...');
});

$('btnJoinRoom').addEventListener('click', () => {
    const code = $('roomCodeInput').value.trim();
    if (code.length !== 4) {
        alert('Vui lòng nhập đủ 4 số!');
        return;
    }
    const data = { roomCode: code, userData: getUserData() };
    socket.emit('joinRoom', data);
    setStatus('Đang vào phòng...');
});

function showWaiting(mode) {
    $('homePanel').classList.add('hidden');
    $('waitPanel').classList.remove('hidden');
    $('roomCodeBig').innerText = currentRoomCode;
    $('waitInfo').innerText = mode === 'coop'
        ? 'Gửi mã cho bạn bè, tối đa 4 người. Chủ phòng bấm Bắt đầu khi đủ người.'
        : 'Đang chờ đối thủ, tự bắt đầu khi đủ 2 người.';
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
    currentRoomCode = 'SOLO';
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
    setStatus('Trò chơi bắt đầu!');
    setTimeout(() => {
        $('lobby-menu').style.display = 'none';
        init3DGame(data);
    }, 1200);
});

socket.on('errorMsg', (msg) => {
    const message = String(msg || 'Server error');
    if (/không tồn tại|find room|room does not exist/i.test(message)) setStatus('Phòng không tồn tại');
    else if (/đã đầy|room full|full/i.test(message)) setStatus('Phòng đầy');
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
const SOLO_BALANCE = {
    meteorWarning: 0.65,
    meteorIntervalMin: 2.6,
    meteorIntervalMax: 3.8,
    meteorDamage: 22,
    playerHitRadius: 0.8,
    enemyBulletDamage: 10,
    playerBulletDamage: 10,
    bossBulletDamage: 26,
    enemyHitRadius: 1.5,
    bossHitRadius: 2.7,
    invulnerability: 1.0,
    respawnInvulnerability: 1.6,
    maxPooledBullets: 180,
    maxPooledExplosions: 36,
    powerupDropChance: 0.3,
    powerupLifetime: 24,
    shieldDuration: 8,
    multishotDuration: 12,
    rapidFireDuration: 10,
    healAmount: 30,
    pickupSpeed: 1.2,
    maxPooledParticles: 72,
};
const SHIP_FOLLOW_SPEED = 12;
const SHIP_MAX_SPEED = 18;
const SHIP_ACCEL = 70;
const SHIP_SPEED_BY_CLASS = {
    destroyer: 18,
    corvette: 20,
    frigate: 16,
    cruiser: 13,
    dreadnought: 11,
};
const PLAYER_STOP_RADIUS = 0.28;
const PLAYER_SEND_RATE_MS = 25;
const PLAYER_BANK_AMOUNT = 0.42;
const PLAYER_PITCH_AMOUNT = 0.16;
const PLAYER_CURSOR_BALANCE = {
    followSpeed: SHIP_FOLLOW_SPEED,
    maxSpeed: SHIP_MAX_SPEED,
    maxAccel: SHIP_ACCEL,
    stopRadius: PLAYER_STOP_RADIUS,
    sendRateMs: PLAYER_SEND_RATE_MS,
    bankAmount: PLAYER_BANK_AMOUNT,
    pitchAmount: PLAYER_PITCH_AMOUNT,
};

const SOLO_WAVE_BALANCE = {
    intermission: 1.8,
    enemyHp: 80,
    enemyHpPerWave: 18,
    enemySpeed: 2.2,
    enemySpeedPerWave: 0.12,
    enemyFireInterval: 1.45,
    enemyFireReductionPerWave: 0.055,
    bossEvery: 5,
    bossBaseHp: 520,
    bossHpPerWave: 85,
    maxEnemiesPerWave: 12,
    startingLives: 3,
};
const ENEMY_MIN_DIST = 14;
const ENEMY_MAX_DIST = 28;
const ENEMY_SPEED = { scout: 5.6, fighter: 4.8, bomber: 3.1, boss: 4.5 };
const ENEMY_DODGE_CHANCE = 0.24;
const ENEMY_AIM_ERROR = 0.38;
const ENEMY_COMBAT_Z_MIN = -60;
const ENEMY_COMBAT_Z_MAX = -40;
const ENEMY_AI_BALANCE = {
    maxAccel: { scout: 8.5, fighter: 7.0, bomber: 4.4, boss: 6.0 },
    maxSpeed: ENEMY_SPEED,
    reactionBase: 0.24,
    reactionPerWave: 0.012,
    dodgeBase: 0.18,
    dodgePerWave: 0.035,
    aimErrorBase: 0.5,
    aimErrorPerWave: 0.018,
    separationRadius: 4.1,
    separationStrength: 7.5,
};
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
let soloMeteorTimer = 1.8;
let playerInvulnTimer = 0;
let screenShakeTimer = 0;
let screenShakeStrength = 0;
let cameraBasePosition = null;
const cameraLookTarget = new THREE.Vector3();
const cameraDesiredPosition = new THREE.Vector3();
let soloWave = 0;
let soloScore = 0;
let soloLives = SOLO_WAVE_BALANCE.startingLives;
let soloEnemies = [];
const soloEnemyPool = { scout: [], fighter: [], bomber: [] };
let soloBoss = null;
let soloWaveDelay = 0;
let waveNoticeTimer = 0;
let waveNoticeEl;
let playerVelocity = { x: 0, y: 0, z: 0 };
let playerTarget = { x: 0, y: 0, z: 12, active: false };
let aimMarkerEl = null;
const pointerRaycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();
let activeBuffs = { shield: 0, multishot: 0, rapidFire: 0, multishotLevel: 1 };
let soloPowerups = [];
let powerupPool = [];
let soloParticles = [];
let particlePool = [];
let buffHudEl;
let playerShieldMesh;
let distantPlanet;

const oppTarget = { x: 0, z: -12 };
let oppRotationTarget = 0;
const bullets = [];
const decorRocks = [];
const soloMeteors = [];
const soloMeteorPool = [];
const soloFragments = [];
const soloFragmentPool = [];
const bulletPool = [];
const explosionPool = [];
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
const boomMat = new THREE.MeshBasicMaterial({ color: 0xffaa33, transparent: true, opacity: 0.9 });
const meteorWarningGeo = new THREE.RingGeometry(0.8, 1.15, 24);
const meteorWarningMat = new THREE.MeshBasicMaterial({ color: 0xffbf55, transparent: true, opacity: 0.75, side: THREE.DoubleSide });
const powerupGeo = new THREE.OctahedronGeometry(0.58, 1);
const powerupMaterials = {
    shield: new THREE.MeshStandardMaterial({ color: 0x47dcff, emissive: 0x126a99, metalness: 0.25, roughness: 0.3 }),
    multishot: new THREE.MeshStandardMaterial({ color: 0xff5fe1, emissive: 0x85166f, metalness: 0.25, roughness: 0.3 }),
    heal: new THREE.MeshStandardMaterial({ color: 0x64ff91, emissive: 0x19753a, metalness: 0.15, roughness: 0.35 }),
    rapidFire: new THREE.MeshStandardMaterial({ color: 0xffd34d, emissive: 0x9b5510, metalness: 0.2, roughness: 0.3 }),
};
const particleGeo = new THREE.SphereGeometry(0.12, 6, 6);
const particleMaterials = new Map();
const shipGeometryCache = new Map();
const shipMaterialCache = new Map();
const shipVisuals = [];
const trailLocalPosition = new THREE.Vector3();
const shipArchetypes = {
    player: { span: 2.7, sweep: 1.15, scale: 1, speed: 1, hp: 1 },
    scout: { span: 1.35, sweep: 0.75, scale: 0.72, speed: 1.45, hp: 0.68 },
    fighter: { span: 2, sweep: 1.35, scale: 0.94, speed: 1.12, hp: 1 },
    bomber: { span: 2.8, sweep: 0.8, scale: 1.28, speed: 0.72, hp: 1.7 },
};

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

    camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 500);
    if (soloMode) {
        camera.position.set(0, 8, 30);
        camera.lookAt(0, 0, -14);
    } else {
        camera.position.set(0, 42, 24);
        camera.lookAt(0, 0, -6);
    }
    cameraBasePosition = camera.position.clone();

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.domElement.style.display = 'block';
    document.body.style.margin = '0';
    document.body.style.overflow = 'hidden';
    document.body.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const dirLight = new THREE.DirectionalLight(0x00d2ff, 1.5);
    dirLight.position.set(10, 20, 10);
    scene.add(dirLight);
    scene.fog = new THREE.Fog(currentMap === '2' ? 0x14100a : 0x050515, soloMode ? 42 : 38, soloMode ? 190 : 125);

    if (mode === 'pvp') {
        const opp = data.players.find((p) => p.number !== myNumber);
        oppHp = opp ? (SHIPS[opp.ship] || SHIPS['1']).hp : 100;

        myShip = makeShipMesh(soloMode ? 0x238bff : myStats.color, -1, 'player');
        myShip.position.set(0, 0, 12);
        oppShip = makeShipMesh(OPP_COLOR, 1, 'fighter');
        oppShip.position.set(0, 0, -12);
        if (soloMode) oppShip.visible = false;
        scene.add(oppShip);
        if (!soloMode && (currentMap === '1' || currentMap === '2')) createDecorRocks(currentMap === '2' ? 18 : 12);
    } else {
        myShip = makeShipMesh(myStats.color, -1, 'player');
        myShip.position.set(START_X[myNumber - 1] ?? 0, 0, 12);

        data.players.forEach((p) => {
            if (p.number === myNumber) return;
            const st = SHIPS[p.ship] || SHIPS['1'];
            const mesh = makeShipMesh(st.color, -1, 'player');
            const x = START_X[p.number - 1] ?? 0;
            mesh.position.set(x, 0, 12);
            scene.add(mesh);
            teamShips[p.number] = { mesh, tx: x, tz: 12 };
        });
    }
    scene.add(myShip);
    if (soloMode) {
        playerShieldMesh = new THREE.Mesh(
            new THREE.SphereGeometry(1.7, 16, 12),
            new THREE.MeshBasicMaterial({ color: 0x47dcff, transparent: true, opacity: 0.22, wireframe: true })
        );
        playerShieldMesh.visible = false;
        scene.add(playerShieldMesh);
    }

    createStars();
    createPlanet();
    createHUD();
    if (soloMode) startSoloWave(1);
    setupInput();
    window.addEventListener('resize', onWindowResize);

    lastFrame = performance.now();
    animate();
}

function getShipGeometry(key, create) {
    if (!shipGeometryCache.has(key)) shipGeometryCache.set(key, create());
    return shipGeometryCache.get(key);
}

function getShipMaterial(color, finish = 'hull') {
    const key = `${color}:${finish}`;
    if (!shipMaterialCache.has(key)) {
        const material = ['flame', 'signal'].includes(finish)
            ? new THREE.MeshBasicMaterial({ color })
            : finish === 'glass'
            ? new THREE.MeshStandardMaterial({ color: 0x8beaff, emissive: 0x177ca8, emissiveIntensity: 0.8, metalness: 0.45, roughness: 0.16 })
            : finish === 'core'
            ? new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.5, metalness: 0.2, roughness: 0.25 })
            : new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.12, metalness: 0.72, roughness: 0.28 });
        shipMaterialCache.set(key, material);
    }
    return shipMaterialCache.get(key);
}

function createWingGeometry(type) {
    const { span, sweep } = shipArchetypes[type] || shipArchetypes.fighter;
    const shape = new THREE.Shape();
    shape.moveTo(0, -0.45);
    shape.lineTo(-span * 0.72, -0.2);
    shape.lineTo(-span, sweep);
    shape.lineTo(-span * 0.46, sweep * 0.68);
    shape.lineTo(-0.15, 0.75);
    shape.closePath();
    const geometry = new THREE.ShapeGeometry(shape);
    geometry.rotateX(Math.PI / 2);
    return geometry;
}

function createNavalHullGeometry(length, width, height) {
    const key = `naval-hull:${length}:${width}:${height}`;
    return getShipGeometry(key, () => {
        const bow = length * 0.52;
        const stern = length * 0.42;
        const vertices = new Float32Array([
            -width * 0.2, height * 0.15, -bow, width * 0.2, height * 0.15, -bow,
            -width * 0.5, height * 0.05, -length * 0.12, width * 0.5, height * 0.05, -length * 0.12,
            -width * 0.5, height * 0.05, stern, width * 0.5, height * 0.05, stern,
            -width * 0.2, height * 0.15, -bow, width * 0.2, height * 0.15, -bow,
            -width * 0.5, -height * 0.45, -length * 0.12, width * 0.5, -height * 0.45, -length * 0.12,
            -width * 0.5, -height * 0.45, stern, width * 0.5, -height * 0.45, stern,
        ]);
        const indices = [
            0, 2, 1, 1, 2, 3, 1, 3, 7, 3, 5, 7,
            0, 4, 2, 2, 4, 6, 0, 1, 4, 1, 5, 4,
            2, 6, 3, 3, 6, 5, 3, 5, 9, 5, 11, 9,
            4, 5, 6, 5, 7, 6, 8, 9, 10, 9, 11, 10
        ];
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        return geometry;
    });
}

function addNavalBox(group, size, position, material) {
    const key = `box:${size.join(':')}`;
    const geometry = getShipGeometry(key, () => new THREE.BoxGeometry(size[0], size[1], size[2], 1, 1, 1));
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(position[0], position[1], position[2]);
    group.add(mesh);
    return mesh;
}

function addNavalTurret(group, position, barrelColor, barrelCount = 1, turretRadius = 0.28, barrelLength = 1.05, visual = null) {
    const baseGeometry = getShipGeometry(`turret-base:${turretRadius}`, () => new THREE.CylinderGeometry(turretRadius, turretRadius * 1.18, 0.22, 10));
    const barrelGeometry = getShipGeometry(`turret-barrel:${barrelLength}:${barrelCount}`, () => new THREE.CylinderGeometry(0.055, 0.075, barrelLength, 8));
    const turret = new THREE.Group();
    turret.position.set(position[0], position[1], position[2]);
    const base = new THREE.Mesh(baseGeometry, getShipMaterial(barrelColor));
    base.position.y = 0.11;
    turret.add(base);
    for (let index = 0; index < barrelCount; index++) {
        const barrel = new THREE.Mesh(barrelGeometry, getShipMaterial(barrelColor, 'trim'));
        barrel.rotation.x = Math.PI / 2;
        barrel.position.set((index - (barrelCount - 1) / 2) * 0.13, 0.28, -barrelLength * 0.42);
        turret.add(barrel);
    }
    group.add(turret);
    if (visual) visual.turrets.push(turret);
    return turret;
}

function addNavalBridge(group, color, position, width, height, visual) {
    addNavalBox(group, [width, height, 0.58], position, getShipMaterial(color, 'trim'));
    addNavalBox(group, [width * 1.08, height * 0.24, 0.62], [position[0], position[1] + height * 0.62, position[2]], getShipMaterial(color));
    const windowCount = 5;
    for (let index = 0; index < windowCount; index++) {
        addNavalBox(group, [width * 0.11, 0.09, 0.025], [position[0] - width * 0.38 + index * width * 0.19, position[1] + height * 0.62, position[2] - 0.32], getShipMaterial(0x75dfff, 'glass'));
    }
    addNavalBox(group, [width * 0.12, height * 0.75, width * 0.12], [position[0], position[1] + height + 0.22, position[2] + 0.04], getShipMaterial(color));
    const radar = new THREE.Mesh(getShipGeometry('naval-radar', () => new THREE.CylinderGeometry(width * 0.46, width * 0.46, 0.025, 18)), getShipMaterial(0x9deaff, 'glass'));
    radar.position.set(position[0], position[1] + height * 1.15, position[2] + 0.05);
    group.add(radar);
    if (visual) visual.radars.push(radar);
}

function addNavalEngines(group, color, positions, visual) {
    const engineGeometry = getShipGeometry('naval-engine', () => new THREE.CylinderGeometry(0.16, 0.21, 0.38, 10));
    const flameGeometry = getShipGeometry('naval-flame', () => new THREE.ConeGeometry(0.15, 0.85, 8));
    const flameMaterial = getShipMaterial(0xff8a35, 'flame');
    positions.forEach(([x, y, z]) => {
        const engine = new THREE.Mesh(engineGeometry, getShipMaterial(color, 'trim'));
        engine.rotation.x = Math.PI / 2;
        engine.position.set(x, y, z);
        group.add(engine);
        const flame = new THREE.Mesh(flameGeometry, flameMaterial);
        flame.rotation.x = Math.PI / 2;
        flame.position.set(x, y, z + 0.58);
        group.add(flame);
        visual.flames.push(flame);
    });
}

function addNavigationLights(group, length, width, visual) {
    const geometry = getShipGeometry('navigation-light', () => new THREE.SphereGeometry(0.075, 8, 6));
    const red = new THREE.Mesh(geometry, getShipMaterial(0xff4b55, 'signal'));
    const green = new THREE.Mesh(geometry, getShipMaterial(0x5cff8c, 'signal'));
    red.position.set(-width * 0.52, 0.18, -length * 0.12);
    green.position.set(width * 0.52, 0.18, -length * 0.12);
    group.add(red, green);
    visual.navigationLights.push(red, green);
}

function finalizeNavalShip(group, archetype, forward, visual) {
    group.scale.setScalar(shipArchetypes[archetype].scale);
    if (forward > 0) group.rotation.y = Math.PI;
    visual.archetype = archetype;
    visual.trailTimer = Math.random() * 0.12;
    group.userData = visual;
    shipVisuals.push(group);
    return group;
}

function makeDestroyer(color = 0x72b9d8, forward = -1) {
    // Khu trục hạm: thân dài cân đối, hai tháp pháo và bridge trung tâm.
    const dimensions = { length: 4.8, width: 1.5, height: 0.5 };
    const group = new THREE.Group();
    const visual = { flames: [], radars: [], turrets: [], navigationLights: [], core: null };
    const hull = new THREE.Mesh(createNavalHullGeometry(dimensions.length, dimensions.width, dimensions.height), getShipMaterial(color));
    group.add(hull);
    addNavalBox(group, [dimensions.width * 0.82, 0.12, dimensions.length * 0.58], [0, 0.32, 0.18], getShipMaterial(color, 'trim'));
    addNavalBridge(group, color, [0, 0.42, 0.45], 0.72, 0.48, visual);
    addNavalTurret(group, [0, 0.48, -1.55], color, 2, 0.34, 1.2, visual);
    addNavalTurret(group, [0, 0.42, 1.55], color, 2, 0.34, 1.1, visual);
    for (const x of [-0.4, 0.4]) addNavalBox(group, [0.22, 0.16, 0.32], [x, 0.48, -0.22], getShipMaterial(color, 'trim'));
    addNavalEngines(group, color, [[-0.38, 0, dimensions.length * 0.43], [0.38, 0, dimensions.length * 0.43]], visual);
    addNavigationLights(group, dimensions.length, dimensions.width, visual);
    return finalizeNavalShip(group, 'player', forward, visual);
}

function makeCorvette(color = 0xff873f, forward = 1) {
    // Corvette hộ tống ngắn: mũi sắc, nhẹ, một tháp pháo và radar nhỏ.
    const dimensions = { length: 3.3, width: 1.05, height: 0.42 };
    const group = new THREE.Group();
    const visual = { flames: [], radars: [], turrets: [], navigationLights: [], core: null };
    group.add(new THREE.Mesh(createNavalHullGeometry(dimensions.length, dimensions.width, dimensions.height), getShipMaterial(color)));
    addNavalBox(group, [0.75, 0.1, 1.65], [0, 0.3, 0.15], getShipMaterial(color, 'trim'));
    addNavalBridge(group, color, [0, 0.36, 0.35], 0.48, 0.38, visual);
    addNavalTurret(group, [0, 0.42, -1.05], color, 1, 0.25, 0.85, visual);
    addNavalEngines(group, color, [[-0.28, 0, 1.0], [0.28, 0, 1.0]], visual);
    addNavigationLights(group, dimensions.length, dimensions.width, visual);
    return finalizeNavalShip(group, 'scout', forward, visual);
}

function makeFrigate(color = 0xaa63ed, forward = 1) {
    // Frigate: thân trung dài, hai tháp pháo, radar cao và boong tên lửa.
    const dimensions = { length: 4.25, width: 1.35, height: 0.48 };
    const group = new THREE.Group();
    const visual = { flames: [], radars: [], turrets: [], navigationLights: [], core: null };
    group.add(new THREE.Mesh(createNavalHullGeometry(dimensions.length, dimensions.width, dimensions.height), getShipMaterial(color)));
    addNavalBox(group, [1.05, 0.12, 2.4], [0, 0.34, 0.05], getShipMaterial(color, 'trim'));
    addNavalBridge(group, color, [0, 0.42, 0.48], 0.62, 0.52, visual);
    addNavalTurret(group, [-0.32, 0.44, -1.38], color, 1, 0.3, 1.05, visual);
    addNavalTurret(group, [0.32, 0.44, 1.35], color, 1, 0.3, 0.95, visual);
    addNavalEngines(group, color, [[-0.34, 0, 1.55], [0.34, 0, 1.55]], visual);
    addNavigationLights(group, dimensions.length, dimensions.width, visual);
    return finalizeNavalShip(group, 'fighter', forward, visual);
}

function makeCruiser(color = 0xffcd48, forward = 1) {
    // Tuần dương hạm: thân rộng, nhiều tháp pháo, bệ tên lửa và ống phụt lớn.
    const dimensions = { length: 5.25, width: 1.75, height: 0.62 };
    const group = new THREE.Group();
    const visual = { flames: [], radars: [], turrets: [], navigationLights: [], core: null };
    group.add(new THREE.Mesh(createNavalHullGeometry(dimensions.length, dimensions.width, dimensions.height), getShipMaterial(color)));
    addNavalBox(group, [1.38, 0.14, 3.2], [0, 0.38, 0.1], getShipMaterial(color, 'trim'));
    addNavalBridge(group, color, [0, 0.48, 0.55], 0.8, 0.65, visual);
    addNavalTurret(group, [0, 0.58, -1.65], color, 2, 0.38, 1.35, visual);
    addNavalTurret(group, [-0.48, 0.48, 1.48], color, 1, 0.34, 1.15, visual);
    addNavalTurret(group, [0.48, 0.48, 1.48], color, 1, 0.34, 1.15, visual);
    for (const side of [-1, 1]) {
        for (let index = 0; index < 3; index++) addNavalBox(group, [0.24, 0.12, 0.24], [side * 0.62, 0.54, -0.35 + index * 0.32], getShipMaterial(color, 'trim'));
    }
    addNavalEngines(group, color, [[-0.52, 0, 1.85], [-0.17, 0, 1.85], [0.17, 0, 1.85], [0.52, 0, 1.85]], visual);
    addNavigationLights(group, dimensions.length, dimensions.width, visual);
    return finalizeNavalShip(group, 'bomber', forward, visual);
}

function makeDreadnought(color = 0xe3424c, forward = 1) {
    // Dreadnought: tàu sân bay chiến hạm nhiều tầng, pháo hạng nặng và lõi đuôi phát sáng.
    const dimensions = { length: 7.4, width: 2.4, height: 0.82 };
    const group = new THREE.Group();
    const visual = { flames: [], radars: [], turrets: [], navigationLights: [], core: null };
    group.add(new THREE.Mesh(createNavalHullGeometry(dimensions.length, dimensions.width, dimensions.height), getShipMaterial(color)));
    addNavalBox(group, [1.82, 0.16, 4.7], [0, 0.52, 0.15], getShipMaterial(color, 'trim'));
    addNavalBridge(group, color, [0, 0.68, 1.25], 1.05, 0.82, visual);
    addNavalBridge(group, color, [0, 0.62, -1.05], 0.7, 0.55, visual);
    addNavalTurret(group, [0, 0.68, -2.45], color, 2, 0.48, 1.65, visual);
    addNavalTurret(group, [-0.75, 0.55, 2.05], color, 1, 0.42, 1.45, visual);
    addNavalTurret(group, [0.75, 0.55, 2.05], color, 1, 0.42, 1.45, visual);

    const hangar = addNavalBox(group, [1.35, 0.26, 1.25], [0, 0.72, 0.05], getShipMaterial(0x55dfff, 'glass'));
    hangar.userData.isHangar = true;
    const coreGeometry = getShipGeometry('dreadnought-core', () => new THREE.SphereGeometry(0.66, 18, 12));
    const core = new THREE.Mesh(coreGeometry, getShipMaterial(0xff5a42, 'core'));
    core.position.set(0, 0.52, 2.55);
    group.add(core);
    visual.core = core;
    addNavalEngines(group, color, [[-0.82, 0, 2.48], [-0.28, 0, 2.48], [0.28, 0, 2.48], [0.82, 0, 2.48]], visual);
    addNavigationLights(group, dimensions.length, dimensions.width, visual);
    const dreadnought = finalizeNavalShip(group, 'bomber', forward, visual);
    dreadnought.scale.setScalar(1.65);
    return dreadnought;
}

function makeShipMesh(color, forward = -1, archetype = 'fighter') {
    if (archetype === 'player') return makeDestroyer(color, forward);
    if (archetype === 'scout') return makeCorvette(color, forward);
    if (archetype === 'fighter') return makeFrigate(color, forward);
    return makeCruiser(color, forward);
}

function makeBossMesh() {
    return makeDreadnought(0xe3424c, 1);
}

function emitParticleBurst(x, y, z, color, count = 8, maxSpeed = 5) {
    let material = particleMaterials.get(color);
    if (!material) {
        material = new THREE.MeshBasicMaterial({ color });
        particleMaterials.set(color, material);
    }
    for (let i = 0; i < count; i++) {
        let mesh = particlePool.pop();
        if (!mesh) {
            if (soloParticles.length >= SOLO_BALANCE.maxPooledParticles) break;
            mesh = new THREE.Mesh(particleGeo, material);
        }
        const azimuth = Math.random() * Math.PI * 2;
        const elevation = (Math.random() - 0.5) * Math.PI;
        const speed = 0.7 + Math.random() * maxSpeed;
        const planar = Math.cos(elevation) * speed;
        mesh.material = material;
        mesh.position.set(x, y, z);
        mesh.scale.setScalar(0.65 + Math.random() * 0.75);
        mesh.visible = true;
        scene.add(mesh);
        soloParticles.push({
            mesh,
            vx: Math.cos(azimuth) * planar,
            vy: Math.sin(elevation) * speed,
            vz: Math.sin(azimuth) * planar,
            life: 0.35 + Math.random() * 0.45,
        });
    }
}

function updateShipVisuals(dt) {
    for (const ship of shipVisuals) {
        if (!ship.visible || !ship.parent) continue;
        const visual = ship.userData;
        visual.trailTimer -= dt;
        visual.flames.forEach((flame, index) => {
            flame.scale.z = 0.68 + Math.sin(gameTime * 28 + index) * 0.24 + Math.random() * 0.18;
        });
        visual.radars.forEach((radar, index) => {
            radar.rotation.y += dt * (0.9 + index * 0.25);
        });
        visual.navigationLights.forEach((light, index) => {
            light.scale.setScalar(index === 0 ? 0.75 + Math.sin(gameTime * 6) * 0.25 : 0.75 + Math.cos(gameTime * 6) * 0.25);
        });
        if (visual.turrets.length && myShip && ship !== myShip) {
            ship.updateWorldMatrix(true, false);
            const localTarget = ship.worldToLocal(myShip.position.clone());
            const turretYaw = Math.atan2(localTarget.x, -localTarget.z);
            visual.turrets.forEach((turret) => {
                turret.rotation.y += (clamp(turretYaw, -0.75, 0.75) - turret.rotation.y) * Math.min(1, dt * 6);
            });
        }
        if (visual.trailTimer <= 0) {
            visual.trailTimer = 0.11;
            const trailPoint = ship.localToWorld(trailLocalPosition.set(0, -0.02, 2.15));
            emitParticleBurst(trailPoint.x, trailPoint.y, trailPoint.z, 0xff8a35, 1, 1.1);
        }
        if (visual.core) visual.core.material.emissiveIntensity = 1.35 + Math.sin(gameTime * 4) * 0.55;
    }
}

function updateFollowCamera(dt) {
    if (soloMode) {
        cameraDesiredPosition.set(myShip.position.x * 0.28, myShip.position.y + 7.5, myShip.position.z + 20);
        cameraLookTarget.set(myShip.position.x * 0.2, myShip.position.y * 0.45, myShip.position.z - 18);
    } else {
        cameraDesiredPosition.set(myShip.position.x * 0.18, 42, myShip.position.z + 12);
        cameraLookTarget.set(myShip.position.x * 0.18, 0, -6);
    }
    camera.position.lerp(cameraDesiredPosition, 1 - Math.exp(-dt * 4.5));
    camera.lookAt(cameraLookTarget);
    cameraBasePosition.copy(camera.position);
    if (distantPlanet) distantPlanet.rotation.y += dt * distantPlanet.userData.rotationSpeed;
}

function createStars() {
    const geo = new THREE.BufferGeometry();
    const count = 1800;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        pos[i * 3] = (Math.random() - 0.5) * 180;
        pos[i * 3 + 1] = (Math.random() - 0.5) * 110;
        pos[i * 3 + 2] = camera.position.z - 190 + Math.random() * 230;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    starField = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xd9efff, size: 0.65, sizeAttenuation: true }));
    scene.add(starField);
}

function createPlanet() {
    const geometry = new THREE.SphereGeometry(18, 32, 24);
    const material = new THREE.MeshStandardMaterial({ color: 0x286b83, emissive: 0x082b44, roughness: 0.92, metalness: 0.05 });
    material.fog = false;
    distantPlanet = new THREE.Mesh(geometry, material);
    distantPlanet.position.set(28, 17, -175);
    distantPlanet.userData.rotationSpeed = 0.025;
    scene.add(distantPlanet);
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

function explode(x, z, size, y = 0) {
    let mesh = explosionPool.pop();
    if (!mesh) {
        if (explosions.length >= SOLO_BALANCE.maxPooledExplosions) return;
        mesh = new THREE.Mesh(boomGeo, boomMat.clone());
    }
    mesh.position.set(x, y, z);
    mesh.scale.setScalar(size * 0.6);
    mesh.material.opacity = 0.9;
    mesh.visible = true;
    scene.add(mesh);
    explosions.push({ mesh, life: 0, size });
    emitParticleBurst(x, y, z, 0xffaa55, Math.min(16, 5 + Math.ceil(size * 2)), 5.5);
    if (size >= 2.5) {
        screenShakeTimer = Math.max(screenShakeTimer, 0.28);
        screenShakeStrength = Math.max(screenShakeStrength, Math.min(0.55, size * 0.08));
    }
}

function acquireSoloMeteor() {
    const meteor = soloMeteorPool.pop();
    if (meteor) return meteor;
    const mesh = new THREE.Mesh(rockGeo, rockMat);
    const warning = new THREE.Mesh(meteorWarningGeo, meteorWarningMat);
    warning.position.y = 0.04;
    return { mesh, warning };
}

function spawnSoloMeteor() {
    const meteor = acquireSoloMeteor();
    const edge = Math.floor(Math.random() * 4);
    const startX = edge === 0 ? -ARENA - 1.5 : edge === 1 ? ARENA + 1.5 : (Math.random() - 0.5) * 14;
    const startY = edge === 2 ? -ARENA * 0.62 - 1 : edge === 3 ? ARENA * 0.62 + 1 : (Math.random() - 0.5) * 12;
    const vx = edge < 2 ? -Math.sign(startX) * (7 + Math.random() * 2) : (Math.random() - 0.5) * 3;
    const vy = edge >= 2 ? -Math.sign(startY) * (6 + Math.random() * 2) : -startY * 0.22 + (Math.random() - 0.5) * 2;
    const startZ = 11;
    const radius = 0.72 + Math.random() * 0.18;

    meteor.mesh.scale.setScalar(radius);
    meteor.mesh.position.set(startX, startY, startZ);
    meteor.mesh.rotation.set(Math.random() * 3, Math.random() * 3, 0);
    // Vòng cảnh báo đặt tại vị trí thiên thạch sẽ đi qua sau thời gian báo trước.
    meteor.warning.position.set(startX + vx * SOLO_BALANCE.meteorWarning, startY + vy * SOLO_BALANCE.meteorWarning, startZ - 0.2);
    meteor.warning.scale.setScalar(0.9 + radius * 0.35);
    meteor.warning.material = meteorWarningMat;
    meteor.warning.visible = true;
    scene.add(meteor.mesh, meteor.warning);
    soloMeteors.push({
        ...meteor,
        x: meteor.mesh.position.x,
        y: meteor.mesh.position.y,
        z: startZ,
        vx,
        vy,
        vz: 0,
        radius,
        warningTime: SOLO_BALANCE.meteorWarning,
        warned: false,
    });
}

function releaseSoloMeteor(meteor) {
    scene.remove(meteor.mesh, meteor.warning);
    meteor.mesh.visible = false;
    meteor.warning.visible = false;
    soloMeteorPool.push({ mesh: meteor.mesh, warning: meteor.warning });
}

function damageSoloPlayer(amount, x, y, z) {
    if (!soloMode || !alive || playerInvulnTimer > 0) return false;
    if (activeBuffs.shield > 0) {
        activeBuffs.shield = Math.max(0, activeBuffs.shield - 1.8);
        emitSoloParticles(x, z, 0x47dcff, 6, y);
        playTone({ freq: 620, duration: 0.09, type: 'sine', volume: 0.035, slide: 180 });
        return true;
    }
    myHp = Math.max(0, myHp - amount);
    playerInvulnTimer = SOLO_BALANCE.invulnerability;
    screenShakeTimer = 0.18;
    screenShakeStrength = 0.32;
    explode(x, z, 1.3, y);
    playHitTone();
    if (myHp <= 0) {
        soloLives -= 1;
        if (soloLives > 0) {
            myHp = myStats.hp;
            playerInvulnTimer = SOLO_BALANCE.respawnInvulnerability;
        } else {
            die();
        }
    }
    return true;
}

function dropSoloPowerup(x, y, z) {
    if (Math.random() >= SOLO_BALANCE.powerupDropChance) return;
    const types = ['shield', 'multishot', 'heal', 'rapidFire'];
    const type = types[Math.floor(Math.random() * types.length)];
    const mesh = powerupPool.pop() || new THREE.Mesh(powerupGeo, powerupMaterials[type]);
    mesh.material = powerupMaterials[type];
    mesh.position.set(x, y, z);
    mesh.rotation.set(0, Math.random() * Math.PI, 0);
    mesh.visible = true;
    scene.add(mesh);
    soloPowerups.push({ mesh, type, baseY: y, life: SOLO_BALANCE.powerupLifetime, phase: Math.random() * Math.PI * 2 });
}

function emitSoloParticles(x, z, color, count = 8, y = 0) {
    emitParticleBurst(x, y, z, color, count, 4.5);
}

function collectSoloPowerup(type, x, y, z) {
    if (type === 'shield') activeBuffs.shield = SOLO_BALANCE.shieldDuration;
    if (type === 'multishot') {
        activeBuffs.multishotLevel = Math.min(3, activeBuffs.multishotLevel + 1);
        activeBuffs.multishot = SOLO_BALANCE.multishotDuration;
    }
    if (type === 'heal') myHp = Math.min(myStats.hp, myHp + SOLO_BALANCE.healAmount);
    if (type === 'rapidFire') activeBuffs.rapidFire = SOLO_BALANCE.rapidFireDuration;
    emitSoloParticles(x, z, powerupMaterials[type].color.getHex(), 12, y);
    playTone({ freq: 540, duration: 0.12, type: 'sine', volume: 0.04, slide: 260 });
}

function updateSoloPowerups(dt) {
    for (let i = soloPowerups.length - 1; i >= 0; i--) {
        const pickup = soloPowerups[i];
        pickup.life -= dt;
        pickup.phase += dt * 2.2;
        pickup.mesh.position.z += SOLO_BALANCE.pickupSpeed * dt;
        pickup.mesh.position.x += Math.sin(pickup.phase) * dt * 0.35;
        pickup.mesh.rotation.y += dt * 1.8;
        pickup.mesh.position.y = pickup.baseY + Math.sin(pickup.phase * 1.4) * 0.25;

        const dx = pickup.mesh.position.x - myShip.position.x;
        const dy = pickup.mesh.position.y - myShip.position.y;
        const dz = pickup.mesh.position.z - myShip.position.z;
        if (alive && dx * dx + dy * dy + dz * dz < 2.8) {
            collectSoloPowerup(pickup.type, pickup.mesh.position.x, pickup.mesh.position.y, pickup.mesh.position.z);
            scene.remove(pickup.mesh);
            pickup.mesh.visible = false;
            powerupPool.push(pickup.mesh);
            soloPowerups.splice(i, 1);
            continue;
        }
        if (pickup.life <= 0 || Math.abs(pickup.mesh.position.z) > ARENA + 3) {
            scene.remove(pickup.mesh);
            pickup.mesh.visible = false;
            powerupPool.push(pickup.mesh);
            soloPowerups.splice(i, 1);
        }
    }

}

function updateParticles(dt) {
    for (let i = soloParticles.length - 1; i >= 0; i--) {
        const particle = soloParticles[i];
        particle.life -= dt;
        particle.mesh.position.x += particle.vx * dt;
        particle.mesh.position.y += particle.vy * dt;
        particle.mesh.position.z += particle.vz * dt;
        particle.mesh.scale.multiplyScalar(Math.max(0, 1 - dt * 2.8));
        if (particle.life <= 0) {
            scene.remove(particle.mesh);
            particle.mesh.visible = false;
            particlePool.push(particle.mesh);
            soloParticles.splice(i, 1);
        }
    }
}

function startSoloWave(wave) {
    // Đội hình cố định giúp máy bay bay vào sân mà không chồng lấn ngẫu nhiên.
    soloWave = wave;
    const enemyCount = Math.min(wave, SOLO_WAVE_BALANCE.maxEnemiesPerWave);
    const targets = [];

    if (enemyCount === 1) targets.push({ x: 0, y: 0 });
    else if (enemyCount === 2) targets.push({ x: -3.2, y: 0 }, { x: 3.2, y: 0 });
    else if (enemyCount <= 4) {
        for (let i = 0; i < enemyCount; i++) {
            targets.push({ x: (i - (enemyCount - 1) / 2) * 3.4, y: (i % 2) * 1.4 - 0.7 });
        }
    } else {
        for (let i = 0; i < enemyCount; i++) {
            const angle = (Math.PI * 2 * i) / enemyCount;
            targets.push({ x: Math.cos(angle) * 5.2, y: Math.sin(angle) * 2.4 });
        }
    }

    const waveDifficulty = getMapDifficulty();
    soloEnemies = targets.map((target, index) => {
        const type = wave === 1 ? 'scout' : index % 3 === 0 ? 'scout' : index % 3 === 1 ? 'fighter' : 'bomber';
        const colors = { scout: 0xff873f, fighter: 0xaa63ed, bomber: 0xffcd48 };
        const mesh = soloEnemyPool[type].pop() || makeShipMesh(colors[type], 1, type);
        mesh.position.set(target.x, target.y, -42 - (index % 2) * 3);
        mesh.visible = true;
        scene.add(mesh);
        const archetype = shipArchetypes[type];
        return {
            mesh,
            type,
            targetX: target.x,
            targetY: target.y,
            targetZ: -48,
            hp: (SOLO_WAVE_BALANCE.enemyHp + (wave - 1) * SOLO_WAVE_BALANCE.enemyHpPerWave) * archetype.hp * waveDifficulty,
            maxHp: (SOLO_WAVE_BALANCE.enemyHp + (wave - 1) * SOLO_WAVE_BALANCE.enemyHpPerWave) * archetype.hp * waveDifficulty,
            speed: (SOLO_WAVE_BALANCE.enemySpeed + (wave - 1) * SOLO_WAVE_BALANCE.enemySpeedPerWave) * archetype.speed,
            vx: 0,
            vy: 0,
            vz: 0,
            state: 'ENTRY',
            stateTimer: 0.5 + Math.random() * 1.1,
            phase: Math.random() * Math.PI * 2,
            reactionTimer: 0,
            orbitDir: index % 2 ? 1 : -1,
            dodgeDir: index % 2 ? 1 : -1,
            formationIndex: index,
            formationShape: wave % 3,
            formationTimer: 5.5 + Math.random() * 2.5,
            shield: type === 'bomber' ? Math.min(18, 6 + wave * 1.4) : 0,
            fireTimer: 1.1 + Math.random() * 0.8,
        };
    });

    if (wave % SOLO_WAVE_BALANCE.bossEvery === 0) {
        const mesh = makeBossMesh();
        mesh.position.set(0, 0, -46);
        scene.add(mesh);
        const hp = (SOLO_WAVE_BALANCE.bossBaseHp + wave * SOLO_WAVE_BALANCE.bossHpPerWave) * waveDifficulty;
        soloBoss = { mesh, hp, maxHp: hp, fireTimer: 1, phase: 0 };
        updateBossBar();
    }

    if (waveNoticeEl) {
        waveNoticeEl.textContent = `WAVE ${wave}`;
        waveNoticeEl.style.opacity = '1';
        waveNoticeTimer = 1.8;
    }
    playTone({ freq: 330, duration: 0.16, type: 'triangle', volume: 0.035, slide: 180 });
}

function steerEnemy(enemy, targetX, targetY, targetZ, maxSpeed, dt) {
    let desiredX = targetX - enemy.mesh.position.x;
    let desiredY = targetY - enemy.mesh.position.y;
    let desiredZ = targetZ - enemy.mesh.position.z;
    let length = Math.hypot(desiredX, desiredY, desiredZ) || 1;
    desiredX = desiredX / length * maxSpeed;
    desiredY = desiredY / length * maxSpeed;
    desiredZ = desiredZ / length * maxSpeed;

    for (const other of soloEnemies) {
        if (other === enemy) continue;
        const dx = enemy.mesh.position.x - other.mesh.position.x;
        const dy = enemy.mesh.position.y - other.mesh.position.y;
        const dz = enemy.mesh.position.z - other.mesh.position.z;
        const distance = Math.hypot(dx, dy, dz);
        if (distance > 0 && distance < ENEMY_AI_BALANCE.separationRadius) {
            const strength = ENEMY_AI_BALANCE.separationStrength * (1 - distance / ENEMY_AI_BALANCE.separationRadius);
            desiredX += dx / distance * strength;
            desiredY += dy / distance * strength;
            desiredZ += dz / distance * strength;
        }
    }

    const accel = ENEMY_AI_BALANCE.maxAccel[enemy.type] || 5;
    enemy.vx += clamp(desiredX - enemy.vx, -accel * dt, accel * dt);
    enemy.vy += clamp(desiredY - enemy.vy, -accel * dt, accel * dt);
    enemy.vz += clamp(desiredZ - enemy.vz, -accel * dt, accel * dt);
    const speed = Math.hypot(enemy.vx, enemy.vy, enemy.vz);
    if (speed > maxSpeed) {
        const scale = maxSpeed / speed;
        enemy.vx *= scale;
        enemy.vy *= scale;
        enemy.vz *= scale;
    }
    enemy.mesh.position.x += enemy.vx * dt;
    enemy.mesh.position.y += enemy.vy * dt;
    enemy.mesh.position.z += enemy.vz * dt;
    enemy.mesh.position.x = clamp(enemy.mesh.position.x, -12.5, 12.5);
    enemy.mesh.position.y = clamp(enemy.mesh.position.y, -8.5, 8.5);
    enemy.mesh.position.z = clamp(enemy.mesh.position.z, ENEMY_COMBAT_Z_MIN, ENEMY_COMBAT_Z_MAX);
}

function aimEnemyShot(enemy, shotSpeed, spread = 0, homing = false, homingTime = 0) {
    const travel = Math.hypot(myShip.position.x - enemy.mesh.position.x, myShip.position.y - enemy.mesh.position.y, myShip.position.z - enemy.mesh.position.z) / shotSpeed;
    const aimError = ENEMY_AIM_ERROR + Math.max(0, soloWave - 1) * ENEMY_AI_BALANCE.aimErrorPerWave;
    const aimX = myShip.position.x + playerVelocity.x * travel + (Math.random() - 0.5) * aimError;
    const aimY = myShip.position.y + playerVelocity.y * travel + (Math.random() - 0.5) * aimError;
    const aimZ = myShip.position.z + playerVelocity.z * travel;
    const dx = aimX - enemy.mesh.position.x;
    const dy = aimY - enemy.mesh.position.y;
    const dz = aimZ - enemy.mesh.position.z;
    const length = Math.hypot(dx, dy, dz) || 1;
    const angle = spread;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const x = dx * cos + dz * sin;
    const z = dz * cos - dx * sin;
    const normalized = Math.hypot(x, dy, z) || 1;
    spawnBullet(enemy.mesh.position.x, enemy.mesh.position.z + 1.2, x / normalized * shotSpeed, z / normalized * shotSpeed, false, enemy.mesh.position.y, dy / normalized * shotSpeed, homing, homingTime);
}

function getFormationSlot(enemy, index) {
    const count = soloEnemies.length || 1;
    const shape = enemy.formationShape;
    const depth = -48 - (index % 3) * 4 + Math.sin(enemy.phase * 0.4) * 1.5;
    if (shape === 0) {
        const row = index - (count - 1) / 2;
        return { x: row * 3.8 + Math.sin(enemy.phase * 0.5) * 0.45, y: Math.sin(enemy.phase * 0.75) * 1.2, z: clamp(depth, ENEMY_COMBAT_Z_MIN, ENEMY_COMBAT_Z_MAX) };
    }
    if (shape === 1) {
        const angle = Math.PI * 2 * index / count;
        return { x: Math.cos(angle) * 6.7, y: Math.sin(angle) * 3.6 + Math.sin(enemy.phase) * 0.5, z: clamp(depth + Math.cos(angle) * 2.5, ENEMY_COMBAT_Z_MIN, ENEMY_COMBAT_Z_MAX) };
    }
    const row = Math.floor(index / 3);
    const col = index % 3;
    const width = (col - 1) * 3.6;
    return { x: width, y: 2.0 - row * 2.2 + Math.sin(enemy.phase + col) * 0.5, z: clamp(-52 - row * 4, ENEMY_COMBAT_Z_MIN, ENEMY_COMBAT_Z_MAX) };
}

function updateSoloEnemies(dt, diff) {
    const fireInterval = Math.max(0.48, SOLO_WAVE_BALANCE.enemyFireInterval - (soloWave - 1) * SOLO_WAVE_BALANCE.enemyFireReductionPerWave);
    for (let index = 0; index < soloEnemies.length; index++) {
        const enemy = soloEnemies[index];
        enemy.phase += dt * (0.65 + enemy.speed * 0.12);
        enemy.stateTimer -= dt;
        enemy.reactionTimer -= dt;
        enemy.formationTimer -= dt;
        if (enemy.formationTimer <= 0) {
            enemy.formationShape = (enemy.formationShape + 1) % 3;
            enemy.formationTimer = 6 + Math.random() * 4;
        }

        const slot = getFormationSlot(enemy, index);
        let targetX = slot.x;
        let targetY = slot.y;
        let targetZ = slot.z;
        const maxSpeed = ENEMY_AI_BALANCE.maxSpeed[enemy.type] * (1 + Math.min(0.35, (soloWave - 1) * 0.018));

        if (enemy.type === 'scout') {
            if (enemy.state === 'ENTRY' && enemy.stateTimer <= 0) enemy.state = 'ZIGZAG';
            if (enemy.state === 'ZIGZAG') {
                targetX += Math.sin(enemy.phase * 1.8) * 2.4;
                targetY += Math.cos(enemy.phase * 2.35) * 1.35;
                targetZ = clamp(slot.z - 2, ENEMY_COMBAT_Z_MIN, ENEMY_COMBAT_Z_MAX);
                if (enemy.stateTimer <= -4 - Math.random() * 2) {
                    enemy.state = 'DIVE';
                    enemy.stateTimer = 0.75;
                    enemy.diveX = myShip.position.x;
                    enemy.diveY = myShip.position.y;
                }
            } else if (enemy.state === 'DIVE') {
                targetX = enemy.diveX ?? myShip.position.x;
                targetY = enemy.diveY ?? myShip.position.y;
                targetZ = ENEMY_COMBAT_Z_MAX;
                if (enemy.stateTimer <= 0) enemy.state = 'RECOVER';
            } else if (enemy.state === 'RECOVER') {
                targetX = slot.x;
                targetY = slot.y;
                targetZ = clamp(ENEMY_COMBAT_Z_MIN + 8, ENEMY_COMBAT_Z_MIN, ENEMY_COMBAT_Z_MAX);
                if (enemy.stateTimer <= -1.2) {
                    enemy.state = 'ZIGZAG';
                    enemy.stateTimer = 3 + Math.random() * 3;
                }
            }
        } else if (enemy.type === 'fighter') {
            const dx = enemy.mesh.position.x - myShip.position.x;
            const dz = enemy.mesh.position.z - myShip.position.z;
            const baseAngle = Math.atan2(dz, dx);
            const orbitAngle = baseAngle + enemy.orbitDir * enemy.phase * 0.12;
            const orbitX = Math.max(ENEMY_MIN_DIST, 16) * Math.cos(orbitAngle);
            targetX = myShip.position.x + Math.cos(orbitAngle) * Math.abs(orbitX) + Math.sin(enemy.phase * 0.7) * 2;
            targetY = myShip.position.y + Math.sin(enemy.phase * 0.9) * 1.8;
            targetZ = clamp(slot.z + Math.sin(orbitAngle) * 3, ENEMY_COMBAT_Z_MIN, ENEMY_COMBAT_Z_MAX);

            if (enemy.reactionTimer <= 0) {
                let threatened = false;
                for (const bullet of bullets) {
                    if (!bullet.mine) continue;
                    const bx = bullet.mesh.position.x, by = bullet.mesh.position.y, bz = bullet.mesh.position.z;
                    const vx = bullet.vx, vy = bullet.vy || 0, vz = bullet.vz;
                    const speed2 = vx * vx + vy * vy + vz * vz || 1;
                    let step = 1;
                    for (; step <= 60; step++) {
                        const t = step / 60;
                        const ex = bx + vx * t - enemy.mesh.position.x;
                        const ey = by + vy * t - enemy.mesh.position.y;
                        const ez = bz + vz * t - enemy.mesh.position.z;
                        if (ex * ex + ey * ey + ez * ez < 3.2 * 3.2) { threatened = true; break; }
                        if (t >= 1) break;
                    }
                }
                if (threatened && Math.random() < Math.min(0.78, ENEMY_DODGE_CHANCE + (soloWave - 1) * 0.035)) {
                    enemy.state = 'ROLL';
                    enemy.stateTimer = 0.48;
                    enemy.dodgeDir *= -1;
                }
                enemy.reactionTimer = ENEMY_AI_BALANCE.reactionBase + Math.max(0, soloWave - 1) * ENEMY_AI_BALANCE.reactionPerWave;
            }
            if (enemy.state === 'ROLL' && enemy.stateTimer > 0) {
                targetX += enemy.dodgeDir * 4.5;
                targetY += Math.sin(enemy.phase * 4) * 1.2;
                enemy.mesh.rotation.z += dt * enemy.dodgeDir * 9;
            } else {
                enemy.mesh.rotation.z *= Math.max(0, 1 - dt * 3);
            }
        } else if (enemy.type === 'bomber') {
            const distance = Math.hypot(myShip.position.x - enemy.mesh.position.x, myShip.position.z - enemy.mesh.position.z);
            if (distance < ENEMY_MIN_DIST) {
                targetX = enemy.mesh.position.x + (enemy.mesh.position.x - myShip.position.x) * 1.7;
                targetY = slot.y + Math.sin(enemy.phase) * 1.1;
                targetZ = ENEMY_COMBAT_Z_MIN;
            } else if (distance > ENEMY_MAX_DIST) {
                targetX = myShip.position.x + Math.sin(enemy.phase) * 4;
                targetY = slot.y;
                targetZ = slot.z;
            } else {
                targetX = slot.x + Math.sin(enemy.phase * 0.55) * 2;
                targetY = slot.y;
                targetZ = slot.z;
            }
        }

        steerEnemy(enemy, targetX, targetY, targetZ, maxSpeed, dt);
        enemy.mesh.lookAt(myShip.position.x, myShip.position.y, myShip.position.z);

        enemy.fireTimer -= dt;
        if (enemy.fireTimer <= 0 && enemy.mesh.position.z > -20) {
            enemy.fireTimer = fireInterval * (0.9 + Math.random() * 0.25);
            if (enemy.type === 'fighter') {
                aimEnemyShot(enemy, 19 + Math.min(7, soloWave * 0.6));
            } else if (enemy.type === 'scout') {
                aimEnemyShot(enemy, 16 + Math.min(6, soloWave * 0.55));
            } else {
                const shotSpeed = 12 + Math.min(4, soloWave * 0.35);
                aimEnemyShot(enemy, shotSpeed, 0, true, 3.2);
                aimEnemyShot(enemy, shotSpeed, -0.22);
                aimEnemyShot(enemy, shotSpeed, 0.22);
            }
            playTone({ freq: enemy.type === 'bomber' ? 220 : 360, duration: 0.04, type: 'square', volume: 0.012, slide: -70 });
        }
    }
}

function updateSoloBoss(dt, diff) {
    if (!soloBoss) return;
    soloBoss.phase += dt;
    soloBoss.vx = soloBoss.vx || 0;
    soloBoss.vy = soloBoss.vy || 0;
    soloBoss.vz = 0;
    const ratio = soloBoss.hp / soloBoss.maxHp;
    const phase = ratio > 0.66 ? 1 : ratio > 0.33 ? 2 : 3;
    if (soloBoss.phaseNumber !== phase) {
        soloBoss.phaseNumber = phase;
        soloBoss.state = 'TELEGRAPH';
        soloBoss.stateTimer = 0.9;
        soloBoss.summonTimer = 0;
    }
    soloBoss.stateTimer -= dt;
    soloBoss.fireTimer -= dt;
    soloBoss.summonTimer = (soloBoss.summonTimer || 0) - dt;

    let targetX = Math.sin(soloBoss.phase * (phase === 3 ? 1.15 : 0.75)) * (phase === 3 ? 7.5 : 6);
    let targetY = Math.sin(soloBoss.phase * 0.55) * 1.8;
    let targetZ = clamp(-48 + Math.cos(soloBoss.phase) * 4, ENEMY_COMBAT_Z_MIN, ENEMY_COMBAT_Z_MAX);

    if (soloBoss.state === 'TELEGRAPH') {
        targetX = soloBoss.mesh.position.x;
        targetY = soloBoss.mesh.position.y;
        soloBoss.mesh.scale.setScalar(1 + Math.sin(soloBoss.phase * 18) * 0.04);
        soloBoss.mesh.rotation.z += dt * 3;
        if (soloBoss.stateTimer <= 0) {
            soloBoss.state = phase === 3 ? 'RAPID' : phase === 2 ? 'CHARGE' : 'FAN';
            soloBoss.stateTimer = phase === 3 ? 2.6 : 1.8;
        }
    } else {
        soloBoss.mesh.scale.setScalar(1);
        if (soloBoss.state === 'CHARGE' || soloBoss.state === 'RAPID') {
            targetX = clamp(myShip.position.x, -12, 12);
            targetY = clamp(myShip.position.y, -8, 8);
            targetZ = ENEMY_COMBAT_Z_MIN + 8;
        }
    }

    const bossAccel = ENEMY_AI_BALANCE.maxAccel.boss;
    const bossMaxSpeed = ENEMY_AI_BALANCE.maxSpeed.boss * (1 + (phase - 1) * 0.28);
    const desiredX = clamp(targetX - soloBoss.mesh.position.x, -bossMaxSpeed, bossMaxSpeed);
    const desiredY = clamp(targetY - soloBoss.mesh.position.y, -bossMaxSpeed, bossMaxSpeed);
    const desiredZ = clamp(targetZ - soloBoss.mesh.position.z, -bossMaxSpeed, bossMaxSpeed);
    soloBoss.vx += clamp(desiredX - soloBoss.vx, -bossAccel * dt, bossAccel * dt);
    soloBoss.vy += clamp(desiredY - soloBoss.vy, -bossAccel * dt, bossAccel * dt);
    soloBoss.vz += clamp(desiredZ - soloBoss.vz, -bossAccel * dt, bossAccel * dt);
    soloBoss.mesh.position.x = clamp(soloBoss.mesh.position.x + soloBoss.vx * dt, -12, 12);
    soloBoss.mesh.position.y = clamp(soloBoss.mesh.position.y + soloBoss.vy * dt, -8, 8);
    soloBoss.mesh.position.z = clamp(soloBoss.mesh.position.z + soloBoss.vz * dt, ENEMY_COMBAT_Z_MIN, ENEMY_COMBAT_Z_MAX);
    soloBoss.mesh.rotation.x += dt * 0.65;
    soloBoss.mesh.rotation.y += dt * 0.9;

    if (soloBoss.fireTimer <= 0) {
        soloBoss.fireTimer = Math.max(phase === 3 ? 0.32 : 0.55, (1.15 - soloWave * 0.035) / (phase * 0.65));
        const speed = 19 + Math.min(8, soloWave * 0.5);
        const count = phase === 1 ? 5 : phase === 2 ? 7 : 11;
        for (let i = 0; i < count; i++) {
            const spread = (i - (count - 1) / 2) * (phase === 3 ? 0.11 : 0.16);
            const dummy = { mesh: soloBoss.mesh };
            aimEnemyShot(dummy, speed, spread);
        }
        playBossTone();
    }

    if (phase >= 2 && soloBoss.summonTimer <= 0 && soloEnemies.length < 4) {
        soloBoss.summonTimer = 7;
        const mesh = soloEnemyPool.scout.pop() || makeShipMesh(0xff873f, 1, 'scout');
        mesh.position.set(soloBoss.mesh.position.x + (Math.random() - 0.5) * 4, soloBoss.mesh.position.y, soloBoss.mesh.position.z - 3);
        mesh.visible = true;
        scene.add(mesh);
        soloEnemies.push({ mesh, type: 'scout', targetX: 0, targetY: 0, targetZ: -48, hp: 55, maxHp: 55, vx: 0, vy: 0, vz: 0, state: 'ENTRY', stateTimer: 0.6, phase: Math.random() * 6, reactionTimer: 0, orbitDir: 1, dodgeDir: 1, formationIndex: soloEnemies.length, formationShape: soloWave % 3, formationTimer: 5 + Math.random() * 3, shield: 0, fireTimer: 1.5, speed: 2.2 });
    }

    if (soloBoss.stateTimer <= 0 && soloBoss.state !== 'TELEGRAPH') {
        soloBoss.state = 'TELEGRAPH';
        soloBoss.stateTimer = 0.75 + (phase === 1 ? 0.15 : 0);
    }
    updateBossBar();
}

function updateSoloWaveProgress(dt) {
    if (waveNoticeTimer > 0) {
        waveNoticeTimer = Math.max(0, waveNoticeTimer - dt);
        if (waveNoticeTimer === 0 && waveNoticeEl) waveNoticeEl.style.opacity = '0';
    }
    if (soloEnemies.length || soloBoss) {
        soloWaveDelay = 0;
        return;
    }
    soloWaveDelay += dt;
    if (soloWaveDelay >= SOLO_WAVE_BALANCE.intermission) {
        soloWaveDelay = 0;
        startSoloWave(soloWave + 1);
    }
}

function updateSoloMeteors(dt) {
    soloMeteorTimer -= dt;
    if (soloMeteorTimer <= 0) {
        spawnSoloMeteor();
        soloMeteorTimer = SOLO_BALANCE.meteorIntervalMin + Math.random() * (SOLO_BALANCE.meteorIntervalMax - SOLO_BALANCE.meteorIntervalMin);
    }

    for (let i = soloMeteors.length - 1; i >= 0; i--) {
        const meteor = soloMeteors[i];
        if (!meteor.warned) {
            meteor.warningTime -= dt;
            meteor.warning.material.opacity = 0.42 + Math.sin(gameTime * 18) * 0.28;
            if (meteor.warningTime <= 0) {
                meteor.warned = true;
                meteor.warning.visible = false;
            }
            continue;
        }

        meteor.x += meteor.vx * dt;
        meteor.y += meteor.vy * dt;
        meteor.z += meteor.vz * dt;
        meteor.mesh.position.set(meteor.x, meteor.y, meteor.z);
        meteor.mesh.rotation.x += dt * 0.8;
        meteor.mesh.rotation.y += dt * 1.1;

        const hitRadius = meteor.radius + SOLO_BALANCE.playerHitRadius;
        const dx = meteor.x - myShip.position.x;
        const dy = meteor.y - myShip.position.y;
        const dz = meteor.z - myShip.position.z;
        if (dx * dx + dy * dy + dz * dz < hitRadius * hitRadius) {
            damageSoloPlayer(SOLO_BALANCE.meteorDamage * getMapDifficulty(), meteor.x, meteor.y, meteor.z);
            explode(meteor.x, meteor.z, meteor.radius * 1.5, meteor.y);
            releaseSoloMeteor(meteor);
            soloMeteors.splice(i, 1);
            continue;
        }

        if (Math.abs(meteor.x) > ARENA + 3 || Math.abs(meteor.y) > ARENA + 2) {
            releaseSoloMeteor(meteor);
            soloMeteors.splice(i, 1);
        }
    }

    for (let i = soloFragments.length - 1; i >= 0; i--) {
        const fragment = soloFragments[i];
        fragment.life -= dt;
        fragment.mesh.position.x += fragment.vx * dt;
        fragment.mesh.position.y += fragment.vy * dt;
        fragment.mesh.position.z += fragment.vz * dt;
        fragment.mesh.rotation.x += dt * 4;
        fragment.mesh.rotation.y += dt * 5;
        fragment.mesh.scale.setScalar(fragment.scale * Math.max(0, fragment.life / 0.55));
        if (fragment.life <= 0) {
            scene.remove(fragment.mesh);
            fragment.mesh.visible = false;
            soloFragmentPool.push({ mesh: fragment.mesh });
            soloFragments.splice(i, 1);
        }
    }
}

function createHUD() {
    hudEl = document.createElement('div');
    hudEl.style.cssText = 'position:fixed;top:10px;left:10px;color:#fff;font:18px Arial;text-shadow:0 0 6px #000;z-index:50;line-height:1.6;';
    document.body.appendChild(hudEl);

    waveNoticeEl = document.createElement('div');
    waveNoticeEl.style.cssText = 'position:fixed;top:34%;left:50%;transform:translate(-50%,-50%);color:#fff;font:800 48px Arial;letter-spacing:.08em;text-shadow:0 0 18px #42e8ff,0 3px 12px #000;opacity:0;pointer-events:none;z-index:55;transition:opacity .2s ease;';
    document.body.appendChild(waveNoticeEl);

    buffHudEl = document.createElement('div');
    buffHudEl.className = 'solo-buffs';
    document.body.appendChild(buffHudEl);

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
            <span>Boss</span>
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
    const activeBoss = soloBoss || boss;
    if (!bossHealthWrap || !activeBoss) {
        if (bossHealthWrap) bossHealthWrap.style.display = 'none';
        return;
    }
    const fill = document.getElementById('bossHpFill');
    const text = document.getElementById('bossHpText');
    if (fill) fill.style.width = `${Math.max(0, (activeBoss.hp / activeBoss.maxHp) * 100)}%`;
    if (text) text.textContent = `${Math.max(0, Math.ceil(activeBoss.hp))} / ${Math.ceil(activeBoss.maxHp)}`;
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

    if (soloMode) {
        const aliveEnemies = soloEnemies.length;
        hudEl.innerHTML = `🏆 Điểm: ${soloScore} &nbsp;|&nbsp; 🌠 Wave ${soloWave} &nbsp;|&nbsp; ❤️ Mạng: ${soloLives}` +
            `<br>⚔️ Địch còn lại: ${aliveEnemies}${soloBoss ? ' &nbsp;|&nbsp; 👑 BOSS' : ''}`;
        const buffs = [];
        if (activeBuffs.shield > 0) buffs.push(`<span class="buff-chip shield">🛡 ${activeBuffs.shield.toFixed(1)}s</span>`);
        if (activeBuffs.multishot > 0) buffs.push(`<span class="buff-chip multishot">✦ x${activeBuffs.multishotLevel} ${activeBuffs.multishot.toFixed(1)}s</span>`);
        if (activeBuffs.rapidFire > 0) buffs.push(`<span class="buff-chip rapid">⚡ ${activeBuffs.rapidFire.toFixed(1)}s</span>`);
        buffHudEl.innerHTML = buffs.join('');
        buffHudEl.style.display = buffs.length ? 'flex' : 'none';
        return;
    }
    if (buffHudEl) buffHudEl.style.display = 'none';

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
        `<br>🛡️ Bảo vệ: ${'🟦'.repeat(Math.max(0, coopStats.shield))} &nbsp;|&nbsp; Mã phòng ${currentRoomCode}` +
        `<br>${lines.join('<br>')}` +
        (alive ? '' : '<br>💥 Bạn đã chết, đang xem đội');
}

function showMessage(html) {
    if (!msgEl) return;
    msgEl.innerHTML = `<div>${html}</div><button id="btnAgain" style="padding:12px 28px;font-size:20px;border:none;border-radius:6px;background:#28a745;color:#fff;cursor:pointer;">Chơi lại</button>`;
    msgEl.style.display = 'flex';
    document.getElementById('btnAgain').onclick = () => location.reload();
}

function updatePointerTarget(clientX, clientY) {
    if (!renderer || !camera || !myShip) return;
    pointerNdc.set(clientX / window.innerWidth * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    pointerRaycaster.setFromCamera(pointerNdc, camera);
    const planeNormal = new THREE.Vector3();
    const point = new THREE.Vector3();
    if (soloMode) {
        const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -myShip.position.z);
        if (!pointerRaycaster.ray.intersectPlane(plane, point)) return;
        playerTarget.x = clamp(point.x, -ARENA, ARENA);
        playerTarget.y = clamp(point.y, -ARENA * 0.62, ARENA * 0.62);
        playerTarget.z = myShip.position.z;
    } else {
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        if (!pointerRaycaster.ray.intersectPlane(plane, point)) return;
        playerTarget.x = clamp(point.x, -ARENA, ARENA);
        playerTarget.z = clamp(point.z, -ARENA, ARENA);
        playerTarget.y = 0;
    }
    playerTarget.active = true;
}

function setupInput() {
    if (myShip) {
        playerTarget.x = myShip.position.x;
        playerTarget.y = myShip.position.y;
        playerTarget.z = myShip.position.z;
    }
    document.body.style.touchAction = 'none';
    const block = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    window.addEventListener('keydown', (e) => {
        keys[e.code] = true;
        if (block.includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { keys[e.code] = false; });

    aimMarkerEl = document.createElement('div');
    aimMarkerEl.id = 'playerAimMarker';
    aimMarkerEl.style.cssText = 'position:fixed;width:20px;height:20px;border:2px solid rgba(116,238,255,.95);border-radius:50%;transform:translate(-50%,-50%);pointer-events:none;z-index:65;box-shadow:0 0 12px rgba(116,238,255,.55);display:none;';
    aimMarkerEl.innerHTML = '<div style="position:absolute;left:50%;top:-7px;width:1px;height:32px;background:rgba(116,238,255,.8)"></div><div style="position:absolute;top:50%;left:-7px;height:1px;width:32px;background:rgba(116,238,255,.8)"></div>';
    document.body.appendChild(aimMarkerEl);

    const pointerMove = (event) => {
        if (!alive || event.pointerType === 'touch' && !event.buttons && !event.isPrimary) return;
        updatePointerTarget(event.clientX, event.clientY);
        aimMarkerEl.style.left = `${event.clientX}px`;
        aimMarkerEl.style.top = `${event.clientY}px`;
        aimMarkerEl.style.display = 'block';
    };
    window.addEventListener('pointermove', pointerMove);
    window.addEventListener('pointerdown', (event) => {
        if (event.pointerType === 'touch') event.preventDefault();
        pointerMove(event);
    }, { passive: false });
    window.addEventListener('contextmenu', (event) => event.preventDefault());
    document.body.style.cursor = 'none';
}

function spawnBullet(x, z, vx, vz, mine, y = 0, vy = 0, homing = false, homingTime = 0) {
    let mesh = bulletPool.pop();
    if (!mesh) {
        if (soloMode && bullets.length >= SOLO_BALANCE.maxPooledBullets) return;
        mesh = new THREE.Mesh(bulletGeo, mine ? bulletMatMine : bulletMatOpp);
    }
    mesh.material = mine ? bulletMatMine : bulletMatOpp;
    mesh.position.set(x, y, z);
    mesh.scale.set(0.7, 0.7, Math.min(3.2, 0.8 + Math.hypot(vx, vy, vz) * 0.07));
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(vx, vy, vz).normalize());
    mesh.visible = true;
    scene.add(mesh);
    bullets.push({ mesh, vx, vy, vz, mine, homing, homingTime });
}

function releaseBullet(bullet) {
    scene.remove(bullet.mesh);
    bullet.mesh.visible = false;
    bulletPool.push(bullet.mesh);
}

function breakSoloMeteor(meteor) {
    explode(meteor.x, meteor.z, meteor.radius * 1.8, meteor.y);
    emitSoloParticles(meteor.x, meteor.z, 0xffa855, 10, meteor.y);
    playTone({ freq: 150, duration: 0.14, type: 'sawtooth', volume: 0.035, slide: -110 });
    for (let i = 0; i < 3; i++) {
        let fragment = soloFragmentPool.pop();
        if (!fragment) fragment = { mesh: new THREE.Mesh(rockGeo, rockMat) };
        const angle = (Math.PI * 2 * i) / 3 + Math.random() * 0.45;
        const scale = meteor.radius * (0.25 + Math.random() * 0.12);
        fragment.mesh.position.set(meteor.x, meteor.y, meteor.z);
        fragment.mesh.scale.setScalar(scale);
        fragment.mesh.rotation.set(Math.random() * 3, Math.random() * 3, 0);
        fragment.mesh.visible = true;
        scene.add(fragment.mesh);
        soloFragments.push({
            ...fragment,
            vx: Math.cos(angle) * (2.5 + Math.random() * 2),
            vy: (Math.random() - 0.5) * 4,
            vz: Math.sin(angle) * (2.5 + Math.random() * 2),
            life: 0.55,
            scale,
        });
    }
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
    const shotGeo = new THREE.SphereGeometry(0.55, 10, 10);
    const shotMat = new THREE.MeshBasicMaterial({ color: 0xff6a6a });
    const mesh = new THREE.Mesh(shotGeo, shotMat);
    mesh.position.copy(boss.mesh.position);
    scene.add(mesh);

    const dx = target.x - boss.mesh.position.x;
    const dz = target.z - boss.mesh.position.z;
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
    const mesh = makeBossMesh();
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
    else {
        gameEnded = true;
        showMessage(`💥 Hết mạng<br><br>🏆 Điểm: ${soloScore}<br>🌠 Wave: ${soloWave}`);
    }
}

function update(dt, now) {
    gameTime += dt;
    playerInvulnTimer = Math.max(0, playerInvulnTimer - dt);
    activeBuffs.shield = Math.max(0, activeBuffs.shield - dt);
    activeBuffs.multishot = Math.max(0, activeBuffs.multishot - dt);
    activeBuffs.rapidFire = Math.max(0, activeBuffs.rapidFire - dt);
    if (playerShieldMesh && myShip) {
        playerShieldMesh.position.copy(myShip.position);
        playerShieldMesh.rotation.y += dt * 0.6;
        playerShieldMesh.visible = activeBuffs.shield > 0;
    }
    if (soloMode && alive && playerInvulnTimer > 0) {
        myShip.visible = Math.floor(gameTime * 16) % 2 === 0;
    } else if (alive) {
        myShip.visible = true;
    }

    if (mode === 'coop' && !boss && coopStats.time >= 28) spawnBoss();

    if (alive) {
        const moveMul = mode === 'pvp' ? speedMul() : 1;
        let dx = 0, dz = 0;
        if (keys.ArrowLeft || keys.KeyA) dx -= 1;
        if (keys.ArrowRight || keys.KeyD) dx += 1;
        if (keys.ArrowUp || keys.KeyW) dz -= 1;
        if (keys.ArrowDown || keys.KeyS) dz += 1;

        if (dx || dz) {
            playerTarget.active = false;
            playerTarget.x = clamp(playerTarget.x + dx * 1.8, -ARENA, ARENA);
            playerTarget.y = clamp(playerTarget.y - dz * 1.8, -ARENA * 0.62, ARENA * 0.62);
            playerTarget.z = clamp(playerTarget.z + dz * 1.8, -ARENA, ARENA);
        }

        if (soloMode) {
            if (!playerTarget.active) {
                playerTarget.x = myShip.position.x;
                playerTarget.y = myShip.position.y;
            }
            const targetDx = playerTarget.x - myShip.position.x;
            const targetDy = playerTarget.y - myShip.position.y;
            const distance = Math.hypot(targetDx, targetDy);
            const maxSpeed = SHIP_SPEED_BY_CLASS.destroyer * moveMul;
            const desiredSpeed = distance < PLAYER_STOP_RADIUS ? 0 : Math.min(maxSpeed, distance * SHIP_FOLLOW_SPEED);
            const desiredX = distance > 0 ? targetDx / distance * desiredSpeed : 0;
            const desiredY = distance > 0 ? targetDy / distance * desiredSpeed : 0;
            playerVelocity.x += clamp(desiredX - playerVelocity.x, -SHIP_ACCEL * dt, SHIP_ACCEL * dt);
            playerVelocity.y += clamp(desiredY - playerVelocity.y, -SHIP_ACCEL * dt, SHIP_ACCEL * dt);
            if (distance < PLAYER_STOP_RADIUS) playerVelocity.x *= 0.35, playerVelocity.y *= 0.35;
            myShip.position.x = clamp(myShip.position.x + playerVelocity.x * dt, -ARENA, ARENA);
            myShip.position.y = clamp(myShip.position.y + playerVelocity.y * dt, -ARENA * 0.62, ARENA * 0.62);
            playerVelocity.z = 0;
            const bankTarget = clamp(playerVelocity.x * 0.055, -PLAYER_CURSOR_BALANCE.bankAmount, PLAYER_CURSOR_BALANCE.bankAmount);
            const pitchTarget = clamp(playerVelocity.y * -PLAYER_CURSOR_BALANCE.pitchAmount * 0.055, -PLAYER_CURSOR_BALANCE.pitchAmount, PLAYER_CURSOR_BALANCE.pitchAmount);
            myShip.rotation.z += (bankTarget - myShip.rotation.z) * Math.min(1, dt * 8);
            myShip.rotation.x += (pitchTarget - myShip.rotation.x) * Math.min(1, dt * 8);
        } else {
            if (!playerTarget.active) {
                playerTarget.x = myShip.position.x;
                playerTarget.z = myShip.position.z;
            }
            const targetDx = playerTarget.x - myShip.position.x;
            const targetDz = playerTarget.z - myShip.position.z;
            const distance = Math.hypot(targetDx, targetDz);
            const selectedMaxSpeed = myStats ? SHIP_SPEED_BY_CLASS[({ '1': 'destroyer', '2': 'corvette', '3': 'cruiser' })[String(myStats.ship || '1')]] || SHIP_SPEED_BY_CLASS.destroyer : SHIP_SPEED_BY_CLASS.destroyer;
            const maxSpeed = Math.min(SHIP_MAX_SPEED, selectedMaxSpeed * moveMul);
            const desiredSpeed = distance < PLAYER_STOP_RADIUS ? 0 : Math.min(maxSpeed, distance * SHIP_FOLLOW_SPEED);
            const desiredX = distance > 0 ? targetDx / distance * desiredSpeed : 0;
            const desiredZ = distance > 0 ? targetDz / distance * desiredSpeed : 0;
            playerVelocity.x += clamp(desiredX - playerVelocity.x, -SHIP_ACCEL * dt, SHIP_ACCEL * dt);
            playerVelocity.z += clamp(desiredZ - playerVelocity.z, -SHIP_ACCEL * dt, SHIP_ACCEL * dt);
            if (distance < PLAYER_STOP_RADIUS) playerVelocity.x *= 0.35, playerVelocity.z *= 0.35;
            myShip.position.x = clamp(myShip.position.x + playerVelocity.x * dt, -ARENA, ARENA);
            myShip.position.z = clamp(myShip.position.z + playerVelocity.z * dt, -ARENA, ARENA);
            playerVelocity.y = 0;
            const bankTarget = clamp(playerVelocity.x * 0.055, -PLAYER_CURSOR_BALANCE.bankAmount, PLAYER_CURSOR_BALANCE.bankAmount);
            myShip.rotation.z += (bankTarget - myShip.rotation.z) * Math.min(1, dt * 8);
            myShip.rotation.x += (clamp(playerVelocity.z * -PLAYER_CURSOR_BALANCE.pitchAmount * 0.04, -PLAYER_CURSOR_BALANCE.pitchAmount, PLAYER_CURSOR_BALANCE.pitchAmount) - myShip.rotation.x) * Math.min(1, dt * 8);
        }

        shootCd -= dt;
        if (shootCd <= 0) {
            shootCd = myStats.cooldown * (soloMode && activeBuffs.rapidFire > 0 ? 0.55 : 1);
            playShootTone();
            if (mode === 'pvp') {
                const shotCount = soloMode && activeBuffs.multishot > 0 ? activeBuffs.multishotLevel : 1;
                const spread = shotCount === 3 ? [-1.4, 0, 1.4] : shotCount === 2 ? [-0.8, 0.8] : [0];
                for (const vx of spread) {
                    const b = { x: myShip.position.x, y: myShip.position.y, z: myShip.position.z - 1.8, vx, vy: 0, vz: -30 * speedMul() };
                    spawnBullet(b.x, b.z, b.vx, b.vz, true, b.y, b.vy);
                    if (!soloMode) socket.emit('shoot', b);
                }
            } else {
                if (!soloMode) socket.emit('shoot', { x: myShip.position.x, z: myShip.position.z });
            }
        }
    } else {
        playerVelocity.x = 0;
        playerVelocity.y = 0;
        playerVelocity.z = 0;
    }

    if (mode === 'pvp') updatePvp(dt); else updateCoop(dt);

    const starSpeed = mode === 'coop' ? coopStats.mul : speedMul();
    const arr = starField.geometry.attributes.position.array;
    for (let i = 2; i < arr.length; i += 3) {
        arr[i] += 15 * starSpeed * dt;
        if (arr[i] > camera.position.z + 10) arr[i] = camera.position.z - 190;
    }
    starField.geometry.attributes.position.needsUpdate = true;
    updateShipVisuals(dt);
    updateParticles(dt);
    updateFollowCamera(dt);

    for (let i = explosions.length - 1; i >= 0; i--) {
        const e = explosions[i];
        e.life += dt;
        const t = e.life / 0.35;
        e.mesh.scale.setScalar(e.size * (0.6 + t * 1.2));
        e.mesh.material.opacity = Math.max(0, 0.9 * (1 - t));
        if (t >= 1) {
            scene.remove(e.mesh);
            e.mesh.visible = false;
            explosionPool.push(e.mesh);
            explosions.splice(i, 1);
        }
    }

    if (!soloMode && now - lastSend > PLAYER_CURSOR_BALANCE.sendRateMs) {
        lastSend = now;
        socket.emit('state', {
            x: myShip.position.x,
            z: myShip.position.z,
            targetX: playerTarget.active ? playerTarget.x : myShip.position.x,
            targetZ: playerTarget.active ? playerTarget.z : myShip.position.z,
            targetY: playerTarget.active ? playerTarget.y : 0,
            vx: playerVelocity.x,
            vz: playerVelocity.z,
            rotation: myShip.rotation.z,
            hp: myHp,
        });
    }

    if (screenShakeTimer > 0 && cameraBasePosition) {
        screenShakeTimer = Math.max(0, screenShakeTimer - dt);
        const strength = screenShakeStrength * (screenShakeTimer / 0.18);
        camera.position.set(
            cameraBasePosition.x + (Math.random() - 0.5) * strength,
            cameraBasePosition.y,
            cameraBasePosition.z + (Math.random() - 0.5) * strength
        );
    } else if (cameraBasePosition) {
        camera.position.copy(cameraBasePosition);
    }

    updateHUD();
}

function updatePvp(dt) {
    const k = Math.min(1, dt * 12);
    const diff = getMapDifficulty();

    if (soloMode) {
        updateSoloEnemies(dt, diff);
        updateSoloBoss(dt, diff);
        updateSoloMeteors(dt);
        updateSoloPowerups(dt);
        updateSoloWaveProgress(dt);
    } else {
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
    }

    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        if (!b.mine && b.homing && b.homingTime > 0) {
            b.homingTime -= dt;
            const speed = Math.hypot(b.vx, b.vy || 0, b.vz);
            const dx = myShip.position.x - b.mesh.position.x;
            const dy = myShip.position.y - b.mesh.position.y;
            const dz = myShip.position.z - b.mesh.position.z;
            const length = Math.hypot(dx, dy, dz) || 1;
            const turn = Math.min(1, dt * 1.25);
            b.vx += (dx / length * speed - b.vx) * turn;
            b.vy = (b.vy || 0) + (dy / length * speed - (b.vy || 0)) * turn;
            b.vz += (dz / length * speed - b.vz) * turn;
        }
        b.mesh.position.x += b.vx * dt;
        b.mesh.position.y += (b.vy || 0) * dt;
        b.mesh.position.z += b.vz * dt;

        const depthLimit = soloMode ? 220 : 30;
        let remove = Math.abs(b.mesh.position.x) > 40 || Math.abs(b.mesh.position.y) > 40 || Math.abs(b.mesh.position.z) > depthLimit;

        for (const rock of decorRocks) {
            const dx = b.mesh.position.x - rock.position.x;
            const dz = b.mesh.position.z - rock.position.z;
            if (dx * dx + dz * dz < 1.6) {
                remove = true;
                break;
            }
        }

        if (soloMode && b.mine && !remove) {
            for (let j = soloMeteors.length - 1; j >= 0; j--) {
                const meteor = soloMeteors[j];
                if (!meteor.warned) continue;
                const dx = b.mesh.position.x - meteor.x;
                const dy = b.mesh.position.y - meteor.y;
                const dz = b.mesh.position.z - meteor.z;
                const hitRadius = meteor.radius + 0.3;
                if (dx * dx + dy * dy + dz * dz < hitRadius * hitRadius) {
                    breakSoloMeteor(meteor);
                    releaseSoloMeteor(meteor);
                    soloMeteors.splice(j, 1);
                    remove = true;
                    break;
                }
            }
        }

        if (remove) {
            releaseBullet(b);
            bullets.splice(i, 1);
            continue;
        }

        if (soloMode && b.mine) {
            for (let j = soloEnemies.length - 1; j >= 0; j--) {
                const enemy = soloEnemies[j];
                const dx = b.mesh.position.x - enemy.mesh.position.x;
                const dy = b.mesh.position.y - enemy.mesh.position.y;
                const dz = b.mesh.position.z - enemy.mesh.position.z;
                if (dx * dx + dy * dy + dz * dz >= 2.25) continue;
                const damage = SOLO_BALANCE.playerBulletDamage * diff;
                if (enemy.shield > 0) {
                    const shieldDamage = Math.min(enemy.shield, damage * 0.55);
                    enemy.shield -= shieldDamage;
                    enemy.hp -= Math.max(0, damage - shieldDamage);
                } else {
                    enemy.hp -= damage;
                }
                remove = true;
                playHitTone();
                if (enemy.hp <= 0) {
                    explode(enemy.mesh.position.x, enemy.mesh.position.z, 2.2, enemy.mesh.position.y);
                    emitSoloParticles(enemy.mesh.position.x, enemy.mesh.position.z, 0xff5d54, 12, enemy.mesh.position.y);
                    dropSoloPowerup(enemy.mesh.position.x, enemy.mesh.position.y, enemy.mesh.position.z);
                    scene.remove(enemy.mesh);
                    enemy.mesh.visible = false;
                    soloEnemyPool[enemy.type].push(enemy.mesh);
                    soloEnemies.splice(j, 1);
                    soloScore += 100 * soloWave;
                    screenShakeTimer = 0.12;
                    screenShakeStrength = 0.16;
                }
                break;
            }

            if (!remove && soloBoss) {
                const dx = b.mesh.position.x - soloBoss.mesh.position.x;
                const dy = b.mesh.position.y - soloBoss.mesh.position.y;
                const dz = b.mesh.position.z - soloBoss.mesh.position.z;
                if (dx * dx + dy * dy + dz * dz < SOLO_BALANCE.bossHitRadius ** 2) {
                    soloBoss.hp -= SOLO_BALANCE.bossBulletDamage * diff;
                    remove = true;
                    playHitTone();
                    if (soloBoss.hp <= 0) {
                        explode(soloBoss.mesh.position.x, soloBoss.mesh.position.z, 5, soloBoss.mesh.position.y);
                        emitSoloParticles(soloBoss.mesh.position.x, soloBoss.mesh.position.z, 0xffac54, 24, soloBoss.mesh.position.y);
                        dropSoloPowerup(soloBoss.mesh.position.x, soloBoss.mesh.position.y, soloBoss.mesh.position.z);
                        scene.remove(soloBoss.mesh);
                        soloBoss = null;
                        soloScore += 1000 * soloWave;
                        if (bossHealthWrap) bossHealthWrap.style.display = 'none';
                        screenShakeTimer = 0.35;
                        screenShakeStrength = 0.45;
                        playBossTone();
                    }
                }
            }
        }

        if (!b.mine && alive) {
            const ex = b.mesh.position.x - myShip.position.x;
            const ey = b.mesh.position.y - myShip.position.y;
            const ez = b.mesh.position.z - myShip.position.z;
            if (ex * ex + ey * ey + ez * ez < SOLO_BALANCE.enemyHitRadius ** 2) {
                remove = true;
                if (soloMode) damageSoloPlayer(SOLO_BALANCE.enemyBulletDamage * diff, myShip.position.x, myShip.position.y, myShip.position.z);
                else {
                    myHp -= 10 * diff;
                    playHitTone();
                    if (myHp <= 0) die();
                }
            }
        }
        if (remove) {
            releaseBullet(b);
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
            if (!soloMode && myShip) {
                const serverError = Math.hypot(x - myShip.position.x, z - myShip.position.z);
                if (serverError > 0.5) {
                    const reconcile = Math.min(0.22, serverError * 0.08);
                    myShip.position.x += (x - myShip.position.x) * reconcile;
                    myShip.position.z += (z - myShip.position.z) * reconcile;
                }
            }
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
        ? '🛡️ Lá chắn đã cạn'
        : '💥 Tất cả đã chết';
    showMessage(`${why}<br><br>🏆 Điểm: ${score}<br>🌠 Cấp: ${level} &nbsp;|&nbsp; ⏱️ ${time}s`);
});

socket.on('playerLeft', ({ number }) => {
    if (playersInfo[number]) {
        playersInfo[number].alive = false;
        playersInfo[number].name += ' (đã rời)';
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
