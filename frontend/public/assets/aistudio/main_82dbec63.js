/**
 * Application Entry Point
 * Bootstraps state store, loads remote voices if available, and mounts the UI.
 */

import { CONFIG } from './config_ee5ea529.js';
import * as store from './state_d8f7fb5f.js';
import * as ui from './ui_9ebf09b5.js';
import * as api from './api_f8b62fe8.js';

document.addEventListener('DOMContentLoaded', async () => {
  // Load persisted state from localStorage
  store.loadState();

  // Try fetching voices from backend to enrich technical voice options
  try {
    const remoteVoices = await api.getVoices();
    if (Array.isArray(remoteVoices) && remoteVoices.length > 0) {
      // Sync engine voices if newly discovered
      const currentVoices = store.getState().voices;
      if (currentVoices.length === 0) {
        for (const rv of remoteVoices) {
          store.addVoice({
            name: rv.name,
            engineVoice: rv.engineVoice,
            tags: []
          });
        }
      }
    }
  } catch (err) {
    console.info('Running in standalone or offline mode:', err.message);
  }

  // Mount UI components and event subscribers
  ui.initUI();

  // Log readiness
  console.log(`%c[Persian TTS]%c آماده به کار (حالت MOCK: ${CONFIG.MOCK ? 'فعال' : 'غیرفعال'})`, 'color: #38bdf8; font-weight: bold;', 'color: inherit;');
});

