// Kết nối tới Server Socket.io Online
const socket = io('https://space-shooter-server-z9th.onrender.com');

let currentRoomCode = null;
let myPlayerNumber = 1;

// Lấy phần tử giao diện
const lobbyMenu = document.getElementById('lobby-menu');
const btnCreateRoom = document.getElementById('btnCreateRoom');
const btnJoinRoom = document.getElementById('btnJoinRoom');
const roomCodeInput = document.getElementById('roomCodeInput');
const statusText = document.getElementById('statusText');

// Lắng nghe sự kiện Tạo Phòng
if (btnCreateRoom) {
    btnCreateRoom.addEventListener('click', () => {
        const userData = {
            name: document.getElementById('playerName').value,
            ship: document.getElementById('shipSelect').value,
            map: document.getElementById('mapSelect').value
        };
        socket.emit('createRoom', userData);
        statusText.innerText = "正在建立房間... (Đang tạo phòng...)";
    });
}

// Nhận mã phòng từ Server
socket.on('roomCreated', (data) => {
    currentRoomCode = data.roomCode;
    myPlayerNumber = data.playerNumber;
    statusText.innerText = `房間已建立！房號: ${currentRoomCode} (Mã phòng: ${currentRoomCode})`;
});

// Lắng nghe sự kiện Vào Phòng
if (btnJoinRoom) {
    btnJoinRoom.addEventListener('click', () => {
        const code = roomCodeInput.value.trim();
        if (code.length !== 4) {
            alert("請輸入4位數房號！ (Vui lòng nhập đủ 4 số!)");
            return;
        }
        const userData = {
            name: document.getElementById('playerName').value,
            ship: document.getElementById('shipSelect').value
        };
        socket.emit('joinRoom', { roomCode: code, userData: userData });
        statusText.innerText = "正在加入房間... (Đang vào phòng...)";
    });
}

// Nhận phản hồi vào phòng
socket.on('roomJoined', (data) => {
    currentRoomCode = data.roomCode;
    myPlayerNumber = data.playerNumber;
    statusText.innerText = `成功加入房間 ${currentRoomCode}！`;
});

// Khi đủ 2 người chơi -> Ẩn Menu
socket.on('playerJoined', (data) => {
    statusText.innerText = "玩家已齊聚！遊戲開始！";
    setTimeout(() => {
        if (lobbyMenu) lobbyMenu.style.display = 'none';
    }, 1200);
});

// Báo lỗi
socket.on('errorMsg', (msg) => {
    alert(msg);
    statusText.innerText = "";
});
// ==========================================
// 1. KHỞI TẠO SCENE, CAMERA & RENDERER (THREE.JS)
// ==========================================
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x000000, 0.015);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 3, 10);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// ==========================================
// 2. THÊM ÁNH SÁNG (LIGHTING)
// ==========================================
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0x00aaff, 1);
dirLight.position.set(5, 10, 7);
scene.add(dirLight);

// ==========================================
// 3. TẠO CÁC ĐỐI TƯỢNG 3D (PLAYER & STARS)
// ==========================================

// Tàu vũ trụ của người chơi (Player)
const playerGroup = new THREE.Group();
const bodyGeo = new THREE.ConeGeometry(0.8, 2.5, 4);
const bodyMat = new THREE.MeshStandardMaterial({ color: 0x00ffcc, roughness: 0.3 });
const playerMesh = new THREE.Mesh(bodyGeo, bodyMat);
playerMesh.rotation.x = Math.PI / 2;
playerGroup.add(playerMesh);
scene.add(playerGroup);
playerGroup.position.set(0, 0, 0);

// Nền vũ trụ sao (Starfield Background)
const starsGeo = new THREE.BufferGeometry();
const starsCount = 800;
const starPositions = new Float32Array(starsCount * 3);
for (let i = 0; i < starsCount * 3; i++) {
    starPositions[i] = (Math.random() - 0.5) * 200;
}
starsGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
const starsMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.5 });
const starField = new THREE.Points(starsGeo, starsMat);
scene.add(starField);

// Biến quản lý trạng thái Game (Có thêm Nâng cấp HP/Máu)
let bullets = [];
let asteroids = [];
let score = 0;
let health = 3; // NÂNG CẤP: Cho tàu 3 máu
let isGameOver = false;

// ==========================================
// 4. BẮT SỰ KIỆN ĐIỀU KHIỂN (CONTROLS)
// ==========================================
const keys = {};
window.addEventListener('keydown', (e) => keys[e.code] = true);
window.addEventListener('keyup', (e) => keys[e.code] = false);

window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !isGameOver) {
        shootBullet();
    }
    if (e.code === 'KeyR' && isGameOver) {
        resetGame();
    }
});

function shootBullet() {
    const bulletGeo = new THREE.SphereGeometry(0.2, 8, 8);
    const bulletMat = new THREE.MeshBasicMaterial({ color: 0xff0055 });
    const bullet = new THREE.Mesh(bulletGeo, bulletMat);
    bullet.position.set(playerGroup.position.x, playerGroup.position.y, playerGroup.position.z - 1.5);
    scene.add(bullet);
    bullets.push(bullet);
}

// NÂNG CẤP: Sinh thiên thạch với màu sắc ngẫu nhiên
function spawnAsteroid() {
    if (isGameOver) return;
    const size = Math.random() * 0.8 + 0.5;
    const geo = new THREE.DodecahedronGeometry(size, 1);
    
    // Đổi màu ngẫu nhiên cho thiên thạch
    const randomColor = Math.random() * 0xffffff;
    const mat = new THREE.MeshStandardMaterial({ color: randomColor, flatShading: true });
    const asteroid = new THREE.Mesh(geo, mat);
    
    asteroid.position.x = (Math.random() - 0.5) * 18;
    asteroid.position.y = 0;
    asteroid.position.z = -60;
    
    scene.add(asteroid);
    asteroids.push(asteroid);
}
setInterval(spawnAsteroid, 800);

// ==========================================
// 5. VÒNG LẶP GAME (GAME LOOP & ANIMATION)
// ==========================================
function animate() {
    requestAnimationFrame(animate);

    if (isGameOver) return;

    // Chuyển động nền sao
    starField.position.z += 0.8;
    if (starField.position.z > 50) starField.position.z = 0;

    // Di chuyển Tàu
    if ((keys['ArrowLeft'] || keys['KeyA']) && playerGroup.position.x > -9) playerGroup.position.x -= 0.2;
    if ((keys['ArrowRight'] || keys['KeyD']) && playerGroup.position.x < 9) playerGroup.position.x += 0.2;

    // Cập nhật Đạn
    for (let i = bullets.length - 1; i >= 0; i--) {
        bullets[i].position.z -= 0.8;
        if (bullets[i].position.z < -70) {
            scene.remove(bullets[i]);
            bullets.splice(i, 1);
        }
    }

    // Cập nhật Thiên thạch & Va chạm
    for (let i = asteroids.length - 1; i >= 0; i--) {
        asteroids[i].position.z += 0.3;
        asteroids[i].rotation.x += 0.01;
        asteroids[i].rotation.y += 0.02;

        // Va chạm giữa Đạn và Thiên thạch
        for (let j = bullets.length - 1; j >= 0; j--) {
            if (bullets[j] && asteroids[i] && bullets[j].position.distanceTo(asteroids[i].position) < 1.2) {
                scene.remove(bullets[j]);
                scene.remove(asteroids[i]);
                bullets.splice(j, 1);
                asteroids.splice(i, 1);
                score += 10;
                document.getElementById('score').innerText = `SCORE: ${score} | HP: ${health}`;
                break;
            }
        }

        // NÂNG CẤP: Va chạm Tàu và Thiên thạch -> Trừ 1 Máu (Hết máu mới Game Over)
        if (asteroids[i] && playerGroup.position.distanceTo(asteroids[i].position) < 1.2) {
            scene.remove(asteroids[i]);
            asteroids.splice(i, 1);
            health--;
            document.getElementById('score').innerText = `SCORE: ${score} | HP: ${health}`;
            
            if (health <= 0) {
                endGame();
            }
        }

        // Xóa thiên thạch trôi qua khỏi màn hình
        if (asteroids[i] && asteroids[i].position.z > 10) {
            scene.remove(asteroids[i]);
            asteroids.splice(i, 1);
        }
    }

    renderer.render(scene, camera);
}

function endGame() {
    isGameOver = true;
    document.getElementById('game-over').classList.remove('hidden');
}

function resetGame() {
    asteroids.forEach(a => scene.remove(a));
    bullets.forEach(b => scene.remove(b));
    asteroids = [];
    bullets = [];
    score = 0;
    health = 3; // Reset lại 3 máu
    document.getElementById('score').innerText = `SCORE: ${score} | HP: ${health}`;
    playerGroup.position.set(0, 0, 0);
    isGameOver = false;
    document.getElementById('game-over').classList.add('hidden');
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Chạy Game
animate();// ===================================================
// 1. KẾT NỐI SERVER SOCKET.IO ONLINE
// ===================================================
const socket = io('https://space-shooter-server-z9th.onrender.com');

let currentRoomCode = null;
let myPlayerNumber = 1;

// Lấy các phần tử Giao diện từ index.html
const lobbyMenu = document.getElementById('lobby-menu');
const btnCreateRoom = document.getElementById('btnCreateRoom');
const btnJoinRoom = document.getElementById('btnJoinRoom');
const roomCodeInput = document.getElementById('roomCodeInput');
const statusText = document.getElementById('statusText');

// Xử lý khi nhấn nút "Tạo phòng" (建立房間)
btnCreateRoom.addEventListener('click', () => {
    const userData = {
        name: document.getElementById('playerName').value,
        ship: document.getElementById('shipSelect').value,
        map: document.getElementById('mapSelect').value
    };
    socket.emit('createRoom', userData);
    statusText.innerText = "正在建立房間... (Đang tạo phòng...)";
});

// Nhận phản hồi Tạo phòng thành công
socket.on('roomCreated', (data) => {
    currentRoomCode = data.roomCode;
    myPlayerNumber = data.playerNumber;
    statusText.innerText = `房間已建立！房號: ${currentRoomCode} (Mã phòng: ${currentRoomCode} - Đang chờ P2...)`;
});

// Xử lý khi nhấn nút "Vào phòng" (加入房間)
btnJoinRoom.addEventListener('click', () => {
    const code = roomCodeInput.value.trim();
    if (code.length !== 4) {
        alert("請輸入4位數房號！ (Vui lòng nhập đủ 4 số!)");
        return;
    }
    const userData = {
        name: document.getElementById('playerName').value,
        ship: document.getElementById('shipSelect').value
    };
    socket.emit('joinRoom', { roomCode: code, userData: userData });
    statusText.innerText = "正在加入房間... (Đang vào phòng...)";
});

// Nhận phản hồi Vào phòng thành công
socket.on('roomJoined', (data) => {
    currentRoomCode = data.roomCode;
    myPlayerNumber = data.playerNumber;
    statusText.innerText = `成功加入房間 ${currentRoomCode}！ (Đã vào phòng, đang vào game...)`;
});

// Đủ 2 người chơi -> Ẩn Menu & Bắt đầu Game 3D
socket.on('playerJoined', (data) => {
    statusText.innerText = "玩家已齊聚！遊戲開始！ (Đã đủ 2 người! Game bắt đầu!)";
    setTimeout(() => {
        if (lobbyMenu) lobbyMenu.style.display = 'none';
        // Gọi hàm bắt đầu Game 3D của bạn ở đây (nếu có)
    }, 1200);
});

// Báo lỗi nếu sai mã phòng / phòng đầy
socket.on('errorMsg', (msg) => {
    alert(msg);
    statusText.innerText = "";
});