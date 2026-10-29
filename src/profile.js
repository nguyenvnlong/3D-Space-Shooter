const ACCOUNTS_KEY = 'spaceShooter.accounts.v1';
const LAST_USER_KEY = 'spaceShooter.lastUser.v1';

export const AVATARS = ['🚀', '👨‍🚀', '👩‍🚀', '🛸', '🤖', '👾'];

function readAccounts() {
    try {
        return JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || '{}');
    } catch {
        return {};
    }
}

function writeAccounts(accounts) {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

function normalizeUsername(username) {
    return String(username || '').trim();
}

function accountKey(username) {
    return normalizeUsername(username).toLocaleLowerCase();
}

async function hashPin(pin) {
    if (!window.crypto?.subtle) throw new Error('PIN hashing requires a secure context (use HTTPS or localhost).');
    const value = String(pin || '');
    if (!/^\d{4}$/.test(value)) throw new Error('PIN must be exactly 4 digits.');
    const bytes = new TextEncoder().encode(`space-shooter:${value}`);
    const digest = await window.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function createProfile(username, avatar = AVATARS[0], guest = false) {
    return {
        username,
        avatar,
        selectedShip: '1',
        coins: 0,
        XP: 0,
        level: 1,
        createdAt: new Date().toISOString(),
        guest,
        gamesPlayed: 0,
        wins: 0,
        losses: 0,
        totalKills: 0,
        bestScore: 0,
        bestSurvivalTime: 0,
        totalPlayTime: 0,
        soundEnabled: true,
    };
}

function cloneProfile(profile) {
    return JSON.parse(JSON.stringify(profile));
}

function getActiveAccount() {
    const key = localStorage.getItem(LAST_USER_KEY);
    if (!key) return null;
    const accounts = readAccounts();
    return accounts[key]?.profile || null;
}

/** Level formula: each level requires 100 * level total XP. */
export function getXPProgress(profile) {
    const level = Math.max(1, Number(profile?.level) || 1);
    const neededBeforeLevel = ((level - 1) * level / 2) * 100;
    const current = Math.max(0, Number(profile?.XP) || 0);
    const intoLevel = current - neededBeforeLevel;
    const levelGoal = level * 100;
    return { current: Math.max(0, intoLevel), needed: levelGoal, percent: Math.min(100, (intoLevel / levelGoal) * 100) };
}

/** Register an account without storing the PIN itself. */
export async function register(username, pin, avatar = AVATARS[0]) {
    const cleanName = normalizeUsername(username);
    if (cleanName.length < 2 || cleanName.length > 12) throw new Error('Username must be 2-12 characters.');
    const key = accountKey(cleanName);
    const accounts = readAccounts();
    if (accounts[key]) throw new Error('Username is already registered.');
    const pinHash = await hashPin(pin);
    const profile = createProfile(cleanName, avatar, false);
    accounts[key] = { pinHash, profile };
    writeAccounts(accounts);
    localStorage.setItem(LAST_USER_KEY, key);
    return cloneProfile(profile);
}

/** Verify and log in an existing account, then remember it for refresh auto-login. */
export async function login(username, pin) {
    const key = accountKey(username);
    const accounts = readAccounts();
    const account = accounts[key];
    if (!account) throw new Error('Account not found.');
    const pinHash = await hashPin(pin);
    if (account.pinHash !== pinHash) throw new Error('Incorrect PIN.');
    localStorage.setItem(LAST_USER_KEY, key);
    return cloneProfile(account.profile);
}

/** Create a disposable local guest profile and set it as the active user. */
export function playAsGuest() {
    const cleanName = `Guest${Math.floor(1000 + Math.random() * 9000)}`;
    const key = `guest:${cleanName.toLowerCase()}`;
    const accounts = readAccounts();
    const profile = createProfile(cleanName, AVATARS[5], true);
    accounts[key] = { guest: true, profile };
    writeAccounts(accounts);
    localStorage.setItem(LAST_USER_KEY, key);
    return cloneProfile(profile);
}

export function logout() {
    localStorage.removeItem(LAST_USER_KEY);
}

export function getProfile() {
    return cloneProfile(getActiveAccount()) || null;
}

export function saveProfile(partialProfile) {
    const key = localStorage.getItem(LAST_USER_KEY);
    if (!key) throw new Error('No account is logged in.');
    const accounts = readAccounts();
    if (!accounts[key]) throw new Error('Active account not found.');
    accounts[key].profile = {
        ...accounts[key].profile,
        ...partialProfile,
        username: accounts[key].profile.username,
        guest: accounts[key].profile.guest,
    };
    writeAccounts(accounts);
    return cloneProfile(accounts[key].profile);
}

export function addCoins(amount) {
    const profile = getProfile();
    if (!profile) throw new Error('No account is logged in.');
    const value = Math.max(0, Math.floor(Number(amount) || 0));
    return saveProfile({ coins: profile.coins + value });
}

export function spendCoins(amount) {
    const profile = getProfile();
    if (!profile) throw new Error('No account is logged in.');
    const value = Math.max(0, Math.floor(Number(amount) || 0));
    if (profile.coins < value) throw new Error('Not enough coins.');
    return saveProfile({ coins: profile.coins - value });
}

export function addXP(amount) {
    const profile = getProfile();
    if (!profile) throw new Error('No account is logged in.');
    let xp = Math.max(0, Number(profile.XP) || 0) + Math.max(0, Math.floor(Number(amount) || 0));
    let level = Math.max(1, Number(profile.level) || 1);
    while (xp >= totalXPForLevel(level + 1)) {
        level += 1;
    }
    return saveProfile({ XP: xp, level });
}

function totalXPForLevel(level) {
    return ((level - 1) * level / 2) * 100;
}

/** Record a match once and calculate coins from kills, survival, and wins. */
export function recordMatch({ won = false, kills = 0, survivalTime = 0, score = 0, playTime = 0 } = {}) {
    const profile = getProfile();
    if (!profile) throw new Error('No account is logged in.');

    const safeKills = Math.max(0, Math.floor(Number(kills) || 0));
    const safeSurvival = Math.max(0, Math.floor(Number(survivalTime) || 0));
    const safeScore = Math.max(0, Math.floor(Number(score) || 0));
    const safePlayTime = Math.max(0, Math.floor(Number(playTime) || 0));
    const killCoins = safeKills;
    const survivalCoins = Math.floor(safeSurvival / 30);
    const winCoins = won ? 25 : 0;
    const coinReward = killCoins + survivalCoins + winCoins;
    const xpReward = safeKills * 10 + Math.floor(safeSurvival / 10) * 5 + (won ? 50 : 10);

    const updated = saveProfile({
        coins: profile.coins + coinReward,
        gamesPlayed: profile.gamesPlayed + 1,
        wins: profile.wins + (won ? 1 : 0),
        losses: profile.losses + (won ? 0 : 1),
        totalKills: profile.totalKills + safeKills,
        bestScore: Math.max(profile.bestScore, safeScore),
        bestSurvivalTime: Math.max(profile.bestSurvivalTime, safeSurvival),
        totalPlayTime: profile.totalPlayTime + safePlayTime,
    });

    const xpResult = addXP(xpReward);
    return {
        profile: xpResult,
        rewards: { coins: coinReward, xp: xpReward, killCoins, survivalCoins, winCoins },
    };
}

export function resetAccount() {
    const key = localStorage.getItem(LAST_USER_KEY);
    if (!key) throw new Error('No account is logged in.');
    const accounts = readAccounts();
    if (!accounts[key]) throw new Error('Active account not found.');
    const account = accounts[key];
    account.profile = createProfile(account.profile.username, AVATARS[0], account.profile.guest);
    writeAccounts(accounts);
    return cloneProfile(account.profile);
}

export async function profileSelfTest() {
    const oldKey = localStorage.getItem(LAST_USER_KEY);
    const username = `Test${Date.now() % 100000}`;
    const registered = await register(username, '1234');
    await logout();
    await login(username, '1234');
    addCoins(10);
    const match = recordMatch({ won: true, kills: 3, survivalTime: 75, score: 900, playTime: 75 });
    const result = { registered, match, active: getProfile() };
    console.info('[profile.js self-test]', result);
    if (oldKey) localStorage.setItem(LAST_USER_KEY, oldKey);
    else logout();
    return result;
}

window.profile = { register, login, logout, getProfile, saveProfile, addCoins, spendCoins, addXP, recordMatch, profileSelfTest };
