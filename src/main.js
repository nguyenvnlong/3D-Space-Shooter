 // Kết nối tới Server Socket.io Render chính xác của bạn
 const socket = io('https://space-shooter-server-z9th.onrender.com');

let currentRoomCode = null;
let myPlayerNumber = 1;

// Lấy phần tử giao diện
const lobbyMenu = document.getElementById('lobby-menu');
const btnCreateRoom = document.getElementById('btnCreateRoom');
const btnJoinRoom = document.getElementById('btnJoinRoom');
const roomCodeInput = document.getElementById('roomCodeInput');
const statusText = document.getElementById('statusText');

// Lắng nghe sự kiện Bấm Tạo Phòng
if (btnCreateRoom) {
    btnCreateRoom.addEventListener('click', () => {
        const userData = {
            name: document.getElementById('playerName')?.value || 'Player',
            ship: document.getElementById('shipSelect')?.value || '1',
            map: document.getElementById('mapSelect')?.value || '1'
        };
        socket.emit('createRoom', userData);
        if (statusText) statusText.innerText = "正在建立房間... (Đang tạo phòng...)";
    });
}

// Nhận mã phòng từ Server
socket.on('roomCreated', (data) => {
    currentRoomCode = data.roomCode;
    myPlayerNumber = data.playerNumber;
    if (statusText) statusText.innerText = `房間已建立！房號: ${currentRoomCode} (Mã phòng: ${currentRoomCode})`;
});

// Lắng nghe sự kiện Bấm Vào Phòng
if (btnJoinRoom) {
    btnJoinRoom.addEventListener('click', () => {
        const code = roomCodeInput ? roomCodeInput.value.trim() : '';
        if (code.length !== 4) {
            alert("請輸入4位數房號！ (Vui lòng nhập đủ 4 số!)");
            return;
        }
        const userData = {
            name: document.getElementById('playerName')?.value || 'Player',
            ship: document.getElementById('shipSelect')?.value || '1'
        };
        socket.emit('joinRoom', { roomCode: code, userData: userData });
        if (statusText) statusText.innerText = "正在加入房間... (Đang vào phòng...)";
    });
}

// Nhận phản hồi vào phòng thành công
socket.on('roomJoined', (data) => {
    currentRoomCode = data.roomCode;
    myPlayerNumber = data.playerNumber;
    if (statusText) statusText.innerText = `成功加入房間 ${currentRoomCode}！`;
});

// Khi đủ 2 người chơi -> Ẩn Menu
socket.on('playerJoined', (data) => {
    if (statusText) statusText.innerText = "玩家已齊聚！遊戲開始！";
    setTimeout(() => {
        if (lobbyMenu) lobbyMenu.style.display = 'none';
    }, 1200);
});

// Báo lỗi từ Server
socket.on('errorMsg', (msg) => {
    alert(msg);
    if (statusText) statusText.innerText = "";
});
