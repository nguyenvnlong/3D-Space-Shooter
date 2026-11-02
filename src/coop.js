import * as THREE from 'three';
import { getCoopViewMode, setCoopViewMode, recordMatch } from './profile.js';

// Co-op server-authoritative tuning. PvP uses none of these values.
const COOP_CONFIG = {
    maxPlayers: 4, // Lobby limit.
    winScore: 10, // Match ends when a player reaches this score.
    matchSeconds: 300, // Match time limit.
    shootCooldownMs: 220, // Client-side visual cooldown; server remains authoritative.
    cameraTransition: 7.5, // Camera interpolation speed.
};

export function initCoopLobby(loadLegacyGame) {
    const $ = (id) => document.getElementById(id);
    let selectedMode = 'pvp';
    let socket = null;
    let currentRoom = null;
    let playerNumber = null;
    let scene = null;
    let camera = null;
    let renderer = null;
    let animationId = 0;
    let viewMode = getCoopViewMode();
    let players = new Map();
    let bullets = new Map();
    let snapshotPlayers = [];
    let target = { x: 0, z: 12 };
    let keys = {};
    let lastShot = 0;
    let matchRecorded = false;
    let messageTimer = 0;
    let legacyActionInProgress = false;
    let gameStartTimeout = 0;

    const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    const serverUrl = isLocal ? 'http://localhost:3000' : window.location.origin;

    function setMode(mode) {
        selectedMode = mode;
        $('modeCoop')?.classList.toggle('active', mode === 'coop');
        $('modePvp')?.classList.toggle('active', mode === 'pvp');
    }

    function setLobbyStatus(text, state = '') {
        const status = $('statusText');
        if (status) {
            status.textContent = text;
            status.dataset.state = state;
        }
    }

    function ensureSocket() {
        if (socket) return socket;
        socket = io(serverUrl, { reconnection: true, timeout: 20000 });
        socket.on('connect', () => {
            console.log('[COOP] connected', socket.id);
            setLobbyStatus('Connected', 'connected');
            $('btnCreateRoom')?.removeAttribute('disabled');
            $('btnJoinRoom')?.removeAttribute('disabled');
        });
        socket.on('disconnect', (reason) => {
            console.warn('[COOP] disconnected', reason);
            setLobbyStatus('Reconnecting...', 'reconnecting');
            $('btnCreateRoom')?.setAttribute('disabled', '');
            $('btnJoinRoom')?.setAttribute('disabled', '');
        });
        socket.on('connect_error', (error) => {
            console.warn('[COOP] connect_error', error?.message || error);
            setLobbyStatus('Connecting to Render...', 'connecting');
            $('btnCreateRoom')?.setAttribute('disabled', '');
            $('btnJoinRoom')?.setAttribute('disabled', '');
        });
        socket.on('roomCreated', (data) => {
            console.log('[COOP] roomCreated', data.roomCode);
            currentRoom = data.roomCode;
            playerNumber = data.playerNumber;
            $('homePanel')?.classList.add('hidden');
            $('waitPanel')?.classList.remove('hidden');
            $('roomCodeBig').textContent = currentRoom;
            $('waitInfo').textContent = 'Đã vào phòng. Chờ chủ phòng bắt đầu.';
            setLobbyStatus('Đã vào phòng', 'connected');
        });
        socket.on('roomJoined', (data) => {
            console.log('[COOP] roomJoined', data.roomCode);
            currentRoom = data.roomCode;
            playerNumber = data.playerNumber;
            $('homePanel')?.classList.add('hidden');
            $('waitPanel')?.classList.remove('hidden');
            $('roomCodeBig').textContent = currentRoom;
            $('waitInfo').textContent = 'Đã vào phòng. Chờ chủ phòng bắt đầu.';
            setLobbyStatus('Đã vào phòng. Chờ chủ phòng bắt đầu.', 'connected');
        });
        socket.on('lobbyUpdate', (data) => {
            $('playerList').innerHTML = data.players.map((p) =>
                `<li>${p.number === data.host ? '👑 ' : ''}${escapeHtml(p.name)}${p.number === playerNumber ? ' (bạn)' : ''}</li>`
            ).join('');
            $('btnStart')?.classList.toggle('hidden', !(playerNumber === data.host));
        });
        socket.on('errorMsg', (message) => setLobbyStatus(friendlyCoopError(message), 'error'));
        socket.on('gameStart', (data) => {
            if (data.mode !== 'coop') return;
            if (scene) {
                console.log('[COOP] duplicate gameStart ignored');
                return;
            }
            console.log('[COOP] gameStart received', data.players?.length || 0);
            window.clearTimeout(gameStartTimeout);
            startCoopScene(data);
        });
        socket.on('coop:snapshot', applySnapshot);
        socket.on('coop:killed', (data) => {
            showKillFeed(`${data.killer?.name || 'Unknown'} hạ gục ${data.victim?.name || 'Unknown'}`);
        });
        socket.on('coop:matchEnd', (data) => {
            showMatchEnd(data);
        });
        return socket;
    }

    function escapeHtml(value) {
        return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
    }

    function friendlyCoopError(message) {
        const text = String(message || '').toLowerCase();
        if (text.includes('không tồn tại') || text.includes('not exist')) return 'Room not found. Check the 4-digit code.';
        if (text.includes('đã đầy') || text.includes('full')) return 'Room full. This Co-op lobby allows up to 4 players.';
        if (text.includes('bắt đầu') || text.includes('started')) return 'The match has already started.';
        return String(message || 'Unable to join the Co-op room.');
    }

    function getUserData() {
        return {
            name: $('playerName')?.value || 'Player',
            ship: $('shipSelect')?.value || '1',
            map: $('mapSelect')?.value || '1',
            mode: selectedMode,
        };
    }

    async function loadLegacyAction(button) {
        if (legacyActionInProgress) return;
        legacyActionInProgress = true;
        await loadLegacyGame();
        window.setTimeout(() => {
            button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            legacyActionInProgress = false;
        }, 0);
    }

    $('modeCoop')?.addEventListener('click', () => setMode('coop'));
    $('modePvp')?.addEventListener('click', () => {
        setMode('pvp');
        loadLegacyGame();
    });

    $('btnSolo')?.addEventListener('click', (event) => {
        if (!window.__spaceShooterLegacyLoaded) loadLegacyAction(event.currentTarget);
    }, true);

    $('btnCreateRoom')?.addEventListener('click', async (event) => {
        if (legacyActionInProgress) return;
        if (selectedMode !== 'coop') {
            await loadLegacyAction(event.currentTarget);
            return;
        }
        const activeSocket = ensureSocket();
        if (!activeSocket.connected) {
            setLobbyStatus('Connecting to Render...', 'connecting');
            return;
        }
        $('btnCreateRoom').disabled = true;
        setLobbyStatus('Đang tạo phòng...', 'connecting');
        console.log('[COOP] createRoom emit', selectedMode);
        activeSocket.emit('createRoom', getUserData());
        window.setTimeout(() => { $('btnCreateRoom').disabled = false; }, 700);
    });

    $('waitPanel')?.insertAdjacentHTML('beforeend', '<button id="coop-back-home" class="act start" type="button">Về trang chủ</button>');
    $('coop-back-home')?.addEventListener('click', () => window.location.reload(), { once: true });

    $('btnJoinRoom')?.addEventListener('click', async (event) => {
        if (legacyActionInProgress) return;
        if (selectedMode !== 'coop') {
            await loadLegacyAction(event.currentTarget);
            return;
        }
        const code = ($('roomCodeInput')?.value || '').trim();
        if (!/^\d{4}$/.test(code)) {
            setLobbyStatus('Enter a 4-digit room code.', 'error');
            return;
        }
        const activeSocket = ensureSocket();
        if (!activeSocket.connected) {
            setLobbyStatus('Connecting to Render...', 'connecting');
            return;
        }
        $('btnJoinRoom').disabled = true;
        setLobbyStatus('Đang vào phòng...', 'connecting');
        console.log('[COOP] joinRoom emit', code);
        activeSocket.emit('joinRoom', { roomCode: code, userData: getUserData() });
        window.setTimeout(() => { $('btnJoinRoom').disabled = false; }, 700);
    });

    $('btnStart')?.addEventListener('click', () => {
        if (selectedMode !== 'coop') return;
        $('btnStart').disabled = true;
        $('waitInfo').textContent = 'Đang bắt đầu trận Co-op...';
        setLobbyStatus('Đang bắt đầu trận Co-op...', 'connecting');
        console.log('[COOP] startGame emit');
        socket?.emit('startGame');
        window.clearTimeout(gameStartTimeout);
        gameStartTimeout = window.setTimeout(() => {
            if (!$('lobby-menu')?.classList.contains('hidden')) {
                $('waitInfo').textContent = 'Không nhận được phản hồi bắt đầu trận. Thử lại hoặc về trang chủ.';
                $('btnStart').disabled = false;
                setLobbyStatus('Lỗi: không nhận được gameStart từ server.', 'error');
                console.error('[COOP] gameStart timeout');
            }
        }, 8000);
    });

    ensureSocket();

    function makeHud() {
        let hud = $('coop-hud');
        if (!hud) {
            hud = document.createElement('div');
            hud.id = 'coop-hud';
            document.body.appendChild(hud);
        }
        if (!$('coop-scoreboard')) {
            const board = document.createElement('div');
            board.id = 'coop-scoreboard';
            board.className = 'hidden';
            document.body.appendChild(board);
        }
        if (!$('coop-view-toggle')) {
            const button = document.createElement('button');
            button.id = 'coop-view-toggle';
            button.type = 'button';
            button.className = 'coop-view-toggle';
            document.body.appendChild(button);
            button.addEventListener('click', toggleView);
        }
        if (!$('coop-kill-feed')) {
            const feed = document.createElement('div');
            feed.id = 'coop-kill-feed';
            document.body.appendChild(feed);
        }
        if (!$('coop-match-end')) {
            const end = document.createElement('div');
            end.id = 'coop-match-end';
            end.className = 'hidden';
            document.body.appendChild(end);
        }
        updateViewButton();
    }

    function toggleView() {
        viewMode = viewMode === 'first' ? 'third' : 'first';
        setCoopViewMode(viewMode);
        updateViewButton();
    }

    function updateViewButton() {
        const button = $('coop-view-toggle');
        if (button) button.textContent = viewMode === 'first' ? 'Third Person' : 'First Person';
    }

    function createShip(color = 0x55d8ff) {
        const group = new THREE.Group();
        const body = new THREE.Mesh(
            new THREE.ConeGeometry(0.75, 2.8, 8),
            new THREE.MeshStandardMaterial({ color, metalness: 0.45, roughness: 0.32 })
        );
        body.rotation.x = -Math.PI / 2;
        group.add(body);
        const wing = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 0.8), new THREE.MeshStandardMaterial({ color, metalness: 0.5, roughness: 0.35 }));
        wing.position.z = 0.3;
        group.add(wing);
        return group;
    }

    function startCoopScene(data) {
        console.log('[COOP] startCoopScene begin');
        try {
            makeHud();
        $('lobby-menu')?.classList.add('hidden');
        $('home-screen')?.classList.add('hidden');
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x020611);
        camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 300);
        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(window.innerWidth, window.innerHeight);
        document.body.appendChild(renderer.domElement);
        scene.add(new THREE.HemisphereLight(0x9dcfff, 0x07101a, 1.6));
        const grid = new THREE.GridHelper(28, 28, 0x315b78, 0x183244);
        grid.position.y = -1;
        scene.add(grid);
        snapshotPlayers = data.players || [];
        snapshotPlayers.forEach((player, index) => {
            const ship = createShip(index === playerNumber - 1 ? 0x55d8ff : 0xff7658);
            ship.position.set(index === playerNumber - 1 ? 0 : (index - 2) * 4, 0, 12);
            scene.add(ship);
            players.set(player.number, ship);
        });
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('resize', onResize);
        renderer.domElement.addEventListener('pointerdown', shoot);
        window.__coopDisconnectViewCleanup = () => stopCoopScene();
        console.log('[COOP] startCoopScene ready');
        animate();
        } catch (error) {
            console.error('[COOP] startCoopScene failed', error);
            $('lobby-menu')?.classList.remove('hidden');
            $('waitPanel')?.classList.remove('hidden');
            $('homePanel')?.classList.add('hidden');
            $('waitInfo').textContent = 'Lỗi khởi tạo màn chơi Co-op. Bạn có thể về trang chủ hoặc thử lại.';
            setLobbyStatus(`Lỗi Co-op: ${error.message || 'không thể dựng scene'}`, 'error');
            if (renderer?.domElement?.parentNode) renderer.domElement.remove();
        }
    }

    function stopCoopScene() {
        cancelAnimationFrame(animationId);
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('resize', onResize);
    }

    function onResize() {
        if (!camera || !renderer) return;
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }

    function onKeyDown(event) {
        keys[event.code] = true;
        if (event.code === 'KeyV' && !event.repeat) toggleView();
        if (event.code === 'Space' && !event.repeat) shoot();
        if (event.code === 'Tab') {
            event.preventDefault();
            $('coop-scoreboard')?.classList.remove('hidden');
        }
    }

    function onKeyUp(event) {
        keys[event.code] = false;
        if (event.code === 'Tab') $('coop-scoreboard')?.classList.add('hidden');
    }

    function onPointerMove(event) {
        if (!camera || !playerNumber) return;
        const raycaster = new THREE.Raycaster();
        const ndc = new THREE.Vector2(event.clientX / window.innerWidth * 2 - 1, -(event.clientY / window.innerHeight) * 2 + 1);
        raycaster.setFromCamera(ndc, camera);
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const point = new THREE.Vector3();
        if (raycaster.ray.intersectPlane(plane, point)) {
            target.x = Math.max(-COOP_CONFIG.maxPlayers * 3.5, Math.min(COOP_CONFIG.maxPlayers * 3.5, point.x));
            target.z = Math.max(-14, Math.min(14, point.z));
        }
    }

    function shoot() {
        if (!socket?.connected || !playerNumber || !scene) return;
        const now = Date.now();
        if (now - lastShot < COOP_CONFIG.shootCooldownMs) return;
        lastShot = now;
        const own = players.get(playerNumber);
        if (!own) return;
        let vx = 0;
        let vz = -28;
        if (viewMode === 'first') {
            const direction = new THREE.Vector3();
            camera.getWorldDirection(direction);
            vx = direction.x * 28;
            vz = direction.z * 28;
        }
        socket.emit('coop:shoot', { x: own.position.x, z: own.position.z, vx, vz });
    }

    function applySnapshot(data) {
        snapshotPlayers = data.players || [];
        for (const state of snapshotPlayers) {
            let ship = players.get(state.number);
            if (!ship) {
                ship = createShip(state.number === playerNumber ? 0x55d8ff : 0xff7658);
                scene?.add(ship);
                players.set(state.number, ship);
            }
            ship.userData.target = { x: state.x, z: state.z };
            ship.visible = !!state.alive && !(state.number === playerNumber && viewMode === 'first');
        }
        for (const bullet of data.bullets || []) {
            let mesh = bullets.get(bullet.id);
            if (!mesh) {
                mesh = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffd66b }));
                scene?.add(mesh);
                bullets.set(bullet.id, mesh);
            }
            mesh.userData.target = { x: bullet.x, z: bullet.z };
        }
        const seen = new Set((data.bullets || []).map((b) => b.id));
        for (const [id, mesh] of bullets) {
            if (!seen.has(id)) {
                scene?.remove(mesh);
                bullets.delete(id);
            }
        }
        updateHud();
    }

    function updateHud() {
        const own = snapshotPlayers.find((player) => player.number === playerNumber);
        if (!$('coop-hud') || !own) return;
        $('coop-hud').innerHTML = `
            <div><b>${escapeHtml(own.name)}</b></div>
            <div class="coop-bar"><span>HP</span><i style="width:${Math.max(0, own.hp)}%"></i></div>
            <div class="coop-bar armor"><span>ARMOR</span><i style="width:${Math.max(0, Math.min(100, own.armor * 2))}%"></i></div>
            <div class="coop-score">Score ${own.score}</div>
            ${own.respawnIn ? `<div class="coop-respawn">Respawning in ${own.respawnIn}s</div>` : ''}
        `;
        const board = $('coop-scoreboard');
        if (board) {
            const ranked = [...snapshotPlayers].sort((a, b) => b.score - a.score);
            board.innerHTML = `<strong>SCOREBOARD</strong>` + ranked.map((p) => `<div><span>${p.number === playerNumber ? 'You ' : ''}${escapeHtml(p.name)}</span><b>${p.score}</b></div>`).join('');
        }
    }

    function showKillFeed(text) {
        const feed = $('coop-kill-feed');
        if (!feed) return;
        feed.textContent = text;
        feed.classList.add('visible');
        window.clearTimeout(messageTimer);
        messageTimer = window.setTimeout(() => feed.classList.remove('visible'), 2600);
    }

    function showMatchEnd(data) {
        const end = $('coop-match-end');
        if (!end) return;
        const ranked = [...data.players].sort((a, b) => b.score - a.score);
        end.classList.remove('hidden');
        end.innerHTML = `<strong>Co-op Match Complete</strong>${ranked.map((p, index) => `<div>${index + 1}. ${escapeHtml(p.name)} - ${p.score}</div>`).join('')}<button id="coop-end-home" type="button">Back to Home</button>`;
        $('coop-end-home')?.addEventListener('click', () => window.location.reload(), { once: true });

        if (!matchRecorded) {
            matchRecorded = true;
            const own = ranked.find((p) => p.number === playerNumber);
            recordMatch({ won: own === ranked[0], kills: own?.score || 0, survivalTime: data.time || 0, score: own?.score || 0, playTime: data.time || 0 });
        }
    }

    function animate() {
        animationId = requestAnimationFrame(animate);
        if (!scene || !camera || !renderer) return;
        const speed = keys.ArrowLeft || keys.KeyA ? -1 : keys.ArrowRight || keys.KeyD ? 1 : 0;
        if (keys.ArrowLeft || keys.KeyA || keys.ArrowRight || keys.KeyD) target.x += speed * 0.35;
        if (keys.ArrowUp || keys.KeyW) target.z -= 0.35;
        if (keys.ArrowDown || keys.KeyS) target.z += 0.35;
        target.x = Math.max(-14, Math.min(14, target.x));
        target.z = Math.max(-14, Math.min(14, target.z));
        if (socket?.connected) socket.emit('coop:state', { targetX: target.x, targetZ: target.z });

        const blend = 1 - Math.exp(-0.12 * COOP_CONFIG.cameraTransition);
        for (const [number, ship] of players) {
            if (!ship.userData.target) continue;
            ship.position.x += (ship.userData.target.x - ship.position.x) * blend;
            ship.position.z += (ship.userData.target.z - ship.position.z) * blend;
        }
        for (const [id, mesh] of bullets) {
            if (!mesh.userData.target) continue;
            mesh.position.x += (mesh.userData.target.x - mesh.position.x) * 0.45;
            mesh.position.z += (mesh.userData.target.z - mesh.position.z) * 0.45;
        }
        const own = players.get(playerNumber);
        if (own) {
            const desired = viewMode === 'first'
                ? new THREE.Vector3(own.position.x, own.position.y + 1.15, own.position.z - 2.0)
                : new THREE.Vector3(own.position.x * 0.18, 42, own.position.z + 12);
            camera.position.lerp(desired, 1 - Math.exp(-0.12 * COOP_CONFIG.cameraTransition));
            if (viewMode === 'first') camera.lookAt(own.position.x, own.position.y + 1.15, own.position.z - 30);
            else camera.lookAt(own.position.x * 0.18, 0, -6);
        }
        renderer.render(scene, camera);
    }
}
