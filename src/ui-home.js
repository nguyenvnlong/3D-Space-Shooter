import {
    getProfile,
    register,
    login,
    logout,
    playAsGuest,
    saveProfile,
} from './profile.js';

const lobbyId = 'lobby-menu';

function setLobbyVisible(visible) {
    const lobby = document.getElementById(lobbyId);
    if (lobby) lobby.style.display = visible ? 'flex' : 'none';
}

function starfield(canvas) {
    const ctx = canvas.getContext('2d');
    let stars = [];
    let animationId;

    function resize() {
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = window.innerWidth * ratio;
        canvas.height = window.innerHeight * ratio;
        canvas.style.width = `${window.innerWidth}px`;
        canvas.style.height = `${window.innerHeight}px`;
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        stars = Array.from({ length: Math.min(220, Math.floor(window.innerWidth / 5) + 70) }, () => ({
            x: Math.random() * window.innerWidth,
            y: Math.random() * window.innerHeight,
            size: Math.random() * 1.8 + 0.2,
            speed: Math.random() * 0.12 + 0.03,
            alpha: Math.random(),
        }));
    }

    function draw() {
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        for (const star of stars) {
            star.y += star.speed;
            if (star.y > window.innerHeight) star.y = 0;
            star.alpha += (Math.random() - 0.5) * 0.03;
            star.alpha = Math.max(0.15, Math.min(1, star.alpha));
            ctx.globalAlpha = star.alpha;
            ctx.fillStyle = '#d8efff';
            ctx.beginPath();
            ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
            ctx.fill();
        }
        animationId = requestAnimationFrame(draw);
    }

    resize();
    window.addEventListener('resize', resize);
    draw();
    return () => {
        cancelAnimationFrame(animationId);
        window.removeEventListener('resize', resize);
    };
}

function animateCoins(element, from, to) {
    const start = performance.now();
    const duration = 500;
    function frame(now) {
        const progress = Math.min(1, (now - start) / duration);
        const value = Math.round(from + (to - from) * (1 - Math.pow(1 - progress, 3)));
        element.textContent = String(value);
        if (progress < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
}

function createHomeMarkup() {
    const home = document.createElement('div');
    home.id = 'home-screen';
    home.innerHTML = `
        <canvas id="home-starfield" aria-hidden="true"></canvas>
        <header class="home-topbar hidden" id="home-topbar">
            <button class="home-profile-chip" id="top-profile" type="button" aria-label="Open profile">
                <span class="home-avatar" id="top-avatar">🚀</span>
                <span>
                    <strong id="top-username">Player</strong>
                    <small id="top-level">Level 1</small>
                </span>
            </button>
            <div class="home-top-actions">
                <span class="coin-balance"><span aria-hidden="true">🪙</span> <b id="top-coins">0</b></span>
                <button class="home-secondary-button" id="logout-button" type="button">Logout / Switch</button>
            </div>
        </header>

        <main class="home-content">
            <div class="home-title-wrap">
                <div class="home-orbit" aria-hidden="true"></div>
                <p class="home-kicker">GALACTIC COMMAND</p>
                <h1>3D SPACE<br><span>SHOOTER</span></h1>
            </div>
            <div class="home-main-actions" id="home-actions">
                <button class="play-button" id="play-button" type="button">PLAY <span>›</span></button>
                <div class="home-button-row">
                    <button class="home-action-button" id="profile-button" type="button"><span>👤</span> Profile</button>
                    <button class="home-action-button" id="shop-button" type="button"><span>🛒</span> Shop</button>
                    <button class="home-action-button" id="settings-button" type="button"><span>⚙️</span> Settings</button>
                </div>
            </div>
        </main>

        <section class="auth-overlay hidden" id="auth-overlay" role="dialog" aria-modal="true" aria-labelledby="auth-title">
            <div class="auth-card">
                <div class="auth-brand">🚀</div>
                <h2 id="auth-title">Pilot Access</h2>
                <p class="auth-subtitle">Sign in or create your game account</p>
                <div class="auth-tabs" role="tablist">
                    <button class="auth-tab active" data-auth-tab="login" type="button">Login</button>
                    <button class="auth-tab" data-auth-tab="register" type="button">Register</button>
                </div>
                <form id="auth-form" autocomplete="off">
                    <label>Username
                        <input id="auth-username" type="text" maxlength="12" minlength="2" autocomplete="username" required>
                    </label>
                    <label>4-digit PIN
                        <input id="auth-pin" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="current-password" required>
                    </label>
                    <p class="auth-error" id="auth-error" role="alert"></p>
                    <button class="auth-submit" id="auth-submit" type="submit">Login</button>
                </form>
                <button class="guest-button" id="guest-button" type="button">Play as Guest</button>
            </div>
        </section>

        <div class="home-toast hidden" id="home-toast" role="status" aria-live="polite"></div>
        <div class="settings-popover hidden" id="settings-popover">
            <strong>Sound</strong>
            <button id="sound-toggle" class="sound-toggle" type="button" aria-label="Toggle sound">ON</button>
        </div>
    `;
    document.body.appendChild(home);
}

function showToast(message) {
    const toast = document.getElementById('home-toast');
    toast.textContent = message;
    toast.classList.remove('hidden');
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => toast.classList.add('hidden'), 2600);
}

function showAuth() {
    document.getElementById('home-topbar').classList.add('hidden');
    document.getElementById('auth-overlay').classList.remove('hidden');
    setLobbyVisible(false);
}

function updateHomeProfile(previousCoins = null) {
    const profile = getProfile();
    if (!profile) {
        showAuth();
        return;
    }
    document.getElementById('auth-overlay').classList.add('hidden');
    document.getElementById('home-topbar').classList.remove('hidden');
    document.getElementById('top-avatar').textContent = profile.avatar;
    document.getElementById('top-username').textContent = profile.username;
    document.getElementById('top-level').textContent = `Level ${profile.level}`;

    const coinElement = document.getElementById('top-coins');
    if (previousCoins === null || previousCoins === profile.coins) {
        coinElement.textContent = String(profile.coins);
    } else {
        animateCoins(coinElement, previousCoins, profile.coins);
    }

    const soundToggle = document.getElementById('sound-toggle');
    soundToggle.textContent = profile.soundEnabled ? 'ON' : 'OFF';
    soundToggle.classList.toggle('off', !profile.soundEnabled);

    const playerName = document.getElementById('playerName');
    const shipSelect = document.getElementById('shipSelect');
    if (playerName) {
        playerName.value = profile.username;
        playerName.readOnly = true;
    }
    if (shipSelect && !profile.guest) {
        shipSelect.value = profile.selectedShip || '1';
    }
}

function addLobbyBackButton() {
    const lobby = document.getElementById(lobbyId);
    if (!lobby || document.getElementById('back-home-button')) return;

    const button = document.createElement('button');
    button.id = 'back-home-button';
    button.className = 'back-home-button';
    button.type = 'button';
    button.textContent = '← Back to Home';
    lobby.appendChild(button);
    button.addEventListener('click', showHome);
}

function showHome() {
    setLobbyVisible(false);
    document.getElementById('waitPanel')?.classList.add('hidden');
    document.getElementById('homePanel')?.classList.remove('hidden');
    document.getElementById('home-screen').classList.remove('hidden');
    updateHomeProfile();
}

export function initHomeUI() {
    createHomeMarkup();
    addLobbyBackButton();
    setLobbyVisible(false);

    let authMode = 'login';
    const authOverlay = document.getElementById('auth-overlay');
    const form = document.getElementById('auth-form');
    const submit = document.getElementById('auth-submit');
    const error = document.getElementById('auth-error');

    document.querySelectorAll('[data-auth-tab]').forEach((tab) => {
        tab.addEventListener('click', () => {
            authMode = tab.dataset.authTab;
            document.querySelectorAll('[data-auth-tab]').forEach((item) => item.classList.toggle('active', item === tab));
            submit.textContent = authMode === 'login' ? 'Login' : 'Create Account';
            error.textContent = '';
        });
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const username = document.getElementById('auth-username').value.trim();
        const pin = document.getElementById('auth-pin').value.trim();
        submit.disabled = true;
        error.textContent = '';
        try {
            if (authMode === 'register') await register(username, pin);
            else await login(username, pin);
            updateHomeProfile();
        } catch (reason) {
            error.textContent = reason.message || 'Unable to access account.';
        } finally {
            submit.disabled = false;
        }
    });

    document.getElementById('guest-button').addEventListener('click', () => {
        playAsGuest();
        updateHomeProfile();
    });

    document.getElementById('logout-button').addEventListener('click', () => {
        logout();
        setLobbyVisible(false);
        authOverlay.classList.remove('hidden');
        document.getElementById('home-topbar').classList.add('hidden');
    });

    document.getElementById('play-button').addEventListener('click', () => {
        document.getElementById('home-screen').classList.add('hidden');
        setLobbyVisible(true);
        document.getElementById('homePanel')?.classList.remove('hidden');
        document.getElementById('waitPanel')?.classList.add('hidden');
        updateHomeProfile();
    });

    document.getElementById('shop-button').addEventListener('click', () => showToast('Shop — Coming soon'));
    document.getElementById('profile-button').addEventListener('click', () => showToast('Profile — Coming soon'));
    document.getElementById('top-profile').addEventListener('click', () => showToast('Profile — Coming soon'));

    const settingsButton = document.getElementById('settings-button');
    const settingsPopover = document.getElementById('settings-popover');
    settingsButton.addEventListener('click', () => settingsPopover.classList.toggle('hidden'));

    document.getElementById('sound-toggle').addEventListener('click', () => {
        const profile = getProfile();
        if (!profile) return;
        const updated = saveProfile({ soundEnabled: !profile.soundEnabled });
        document.getElementById('sound-toggle').textContent = updated.soundEnabled ? 'ON' : 'OFF';
        document.getElementById('sound-toggle').classList.toggle('off', !updated.soundEnabled);
    });

    starfield(document.getElementById('home-starfield'));
    if (getProfile()) updateHomeProfile();
    else showAuth();
}

initHomeUI();
