// ==========================================
// 1. KHỞI TẠO SCENE, CAMERA & RENDERER (THREE.JS)
// ==========================================
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x000000, 0.015); // Hiệu ứng sương mù không gian

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

// Biến quản lý trạng thái Game
let bullets = [];
let asteroids = [];
let score = 0;
let isGameOver = false;

// ==========================================
// 4. BẮT SỰ KIỆN ĐIỀU KHIỂN (CONTROLS)
// ==========================================
const keys = {};
window.addEventListener('keydown', (e) => keys[e.code] = true);
window.addEventListener('keyup', (e) => keys[e.code] = false);

window.addEventListener('keydown', (e) => {
    // Bấm Spacebar để bắn
    if (e.code === 'Space' && !isGameOver) {
        shootBullet();
    }
    // Bấm phím R để chơi lại khi Game Over
    if (e.code === 'KeyR' && isGameOver) {
        resetGame();
    }
});

// Hàm tạo đạn
function shootBullet() {
    const bulletGeo = new THREE.SphereGeometry(0.2, 8, 8);
    const bulletMat = new THREE.MeshBasicMaterial({ color: 0xff0055 });
    const bullet = new THREE.Mesh(bulletGeo, bulletMat);
    bullet.position.set(playerGroup.position.x, playerGroup.position.y, playerGroup.position.z - 1.5);
    scene.add(bullet);
    bullets.push(bullet);
}

// Hàm sinh Thiên Thạch ngẫu nhiên
function spawnAsteroid() {
    if (isGameOver) return;
    const size = Math.random() * 0.8 + 0.5;
    const geo = new THREE.DodecahedronGeometry(size, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0x888888, flatShading: true });
    const asteroid = new THREE.Mesh(geo, mat);
    
    asteroid.position.x = (Math.random() - 0.5) * 18;
    asteroid.position.y = 0;
    asteroid.position.z = -60;
    
    scene.add(asteroid);
    asteroids.push(asteroid);
}
setInterval(spawnAsteroid, 800); // Cứ mỗi 0.8s tạo 1 thiên thạch mới

// ==========================================
// 5. VÒNG LẶP GAME (GAME LOOP & ANIMATION)
// ==========================================
function animate() {
    requestAnimationFrame(animate);

    if (isGameOver) return;

    // Hiệu ứng chuyển động không gian sao
    starField.position.z += 0.8;
    if (starField.position.z > 50) starField.position.z = 0;

    // Di chuyển tàu bằng mũi tên Trái/Phải hoặc A/D
    if ((keys['ArrowLeft'] || keys['KeyA']) && playerGroup.position.x > -9) playerGroup.position.x -= 0.2;
    if ((keys['ArrowRight'] || keys['KeyD']) && playerGroup.position.x < 9) playerGroup.position.x += 0.2;

    // Cập nhật vị trí Đạn
    for (let i = bullets.length - 1; i >= 0; i--) {
        bullets[i].position.z -= 0.8;
        if (bullets[i].position.z < -70) {
            scene.remove(bullets[i]);
            bullets.splice(i, 1);
        }
    }

    // Cập nhật vị trí & Xử lý va chạm Thiên Thạch
    for (let i = asteroids.length - 1; i >= 0; i--) {
        asteroids[i].position.z += 0.3;
        asteroids[i].rotation.x += 0.01;
        asteroids[i].rotation.y += 0.02;

        // Va chạm між Đạn và Thiên Thạch
        for (let j = bullets.length - 1; j >= 0; j--) {
            if (bullets[j] && asteroids[i] && bullets[j].position.distanceTo(asteroids[i].position) < 1.2) {
                scene.remove(bullets[j]);
                scene.remove(asteroids[i]);
                bullets.splice(j, 1);
                asteroids.splice(i, 1);
                score += 10;
                document.getElementById('score').innerText = score;
                break;
            }
        }

        // Va chạm giữa Tàu và Thiên Thạch (Game Over)
        if (asteroids[i] && playerGroup.position.distanceTo(asteroids[i].position) < 1.2) {
            endGame();
        }

        // Tự xóa thiên thạch đã trôi qua khỏi màn hình
        if (asteroids[i] && asteroids[i].position.z > 10) {
            scene.remove(asteroids[i]);
            asteroids.splice(i, 1);
        }
    }

    renderer.render(scene, camera);
}

// Kết thúc trò chơi
function endGame() {
    isGameOver = true;
    document.getElementById('game-over').classList.remove('hidden');
}

// Khôi phục trạng thái chơi lại
function resetGame() {
    asteroids.forEach(a => scene.remove(a));
    bullets.forEach(b => scene.remove(b));
    asteroids = [];
    bullets = [];
    score = 0;
    document.getElementById('score').innerText = score;
    playerGroup.position.set(0, 0, 0);
    isGameOver = false;
    document.getElementById('game-over').classList.add('hidden');
}

// Tự động căn chỉnh lại khung hình khi thay đổi kích thước trình duyệt
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Chạy Game
animate();