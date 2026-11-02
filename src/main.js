import './ui-home.js';
import { initCoopLobby } from './coop.js';

// Load the legacy PvP/Solo implementation only after a non-Co-op action is selected.
window.__spaceShooterLegacyLoaded = false;
export async function loadLegacyGame() {
    if (window.__spaceShooterLegacyLoaded) return;
    window.__spaceShooterLegacyLoaded = true;
    await import('../3D-Space-Shooter-main/src/main.js');
}

initCoopLobby(loadLegacyGame);
