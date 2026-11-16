let draggedClipId = null;
/**
 * UI Renderer and Event Controller (Phase 3)
 * Adds: Dialogue/Screenplay modal, SRT subtitle download, keyboard shortcuts,
 * and cache-hit toast notifications.
 */

import { CONFIG } from './config.js';
import * as api from './api.js';
import * as store from './state.js';
import { prepareText, parseDialogueScript, generateSrtContent } from './text.js';

// Currently active playing audio element
let currentPlayingAudio = null;

// Track active batch conversion controller
let activeBatchController = null;

/**
 * Toast Notification Manager
 */
export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type} animate-slide-in`;
  toast.setAttribute('role', 'alert');

  const icons = {
    info: 'ℹ️',
    success: '✅',
    error: '❌',
    warning: '⚠️'
  };

  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || 'ℹ️'}</span>
    <span class="toast-message">${escapeHtml(message)}</span>
    <button class="toast-close" aria-label="بستن پیام">×</button>
  `;

  toast.querySelector('.toast-close').addEventListener('click', () => {
    toast.remove();
  });

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-fade-out');
    toast.addEventListener('animationend', () => toast.remove());
  }, 4000);
}

/**
 * Custom Accessible Confirmation Dialog
 */
export function showConfirm({ title, message, confirmText = 'تأیید', cancelText = 'انصراف', danger = false }) {
  return new Promise((resolve) => {
    const backdrop = document.getElementById('modal-backdrop');
    const modal = document.getElementById('confirm-modal');
    if (!backdrop || !modal) {
      resolve(window.confirm(message));
      return;
    }

    const titleEl = document.getElementById('confirm-modal-title');
    const msgEl = document.getElementById('confirm-modal-message');
    const btnConfirm = document.getElementById('confirm-modal-ok');
    const btnCancel = document.getElementById('confirm-modal-cancel');

    titleEl.textContent = title || 'تأیید عملیات';
    msgEl.innerHTML = message;

    btnConfirm.textContent = confirmText;
    btnConfirm.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
    btnCancel.textContent = cancelText;

    const cleanup = (result) => {
      backdrop.classList.add('hidden');
      modal.classList.add('hidden');
      btnConfirm.removeEventListener('click', onConfirm);
      btnCancel.removeEventListener('click', onCancel);
      document.removeEventListener('keydown', onKeyDown);
      resolve(result);
    };

    const onConfirm = () => cleanup(true);
    const onCancel = () => cleanup(false);
    const onKeyDown = (e) => {
      if (e.key === 'Escape') cleanup(false);
    };

    btnConfirm.addEventListener('click', onConfirm);
    btnCancel.addEventListener('click', onCancel);
    document.addEventListener('keydown', onKeyDown);

    backdrop.classList.remove('hidden');
    modal.classList.remove('hidden');
    btnCancel.focus();
  });
}

/**
 * Global single-audio player supervisor.
 */
export function registerAudioElement(audioEl) {
  audioEl.addEventListener('play', () => {
    if (currentPlayingAudio && currentPlayingAudio !== audioEl) {
      currentPlayingAudio.pause();
    }
    currentPlayingAudio = audioEl;
  });

  audioEl.addEventListener('ended', () => {
    if (currentPlayingAudio === audioEl) {
      currentPlayingAudio = null;
    }
  });

  audioEl.addEventListener('pause', () => {
    if (currentPlayingAudio === audioEl) {
      currentPlayingAudio = null;
    }
  });
}

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatTime(isoString) {
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

/**
 * Initialize all UI listeners and initial render.
 */
export function initUI() {
  bindGlobalEvents();
  renderAll();

  store.subscribe((state, changeType) => {
    renderAll(changeType);
  });
}

/**
 * Bind global static DOM buttons
 */
function bindGlobalEvents() {
  // Mobile drawer toggle
  const toggleDrawerBtn = document.getElementById('btn-toggle-drawer');
  const sidebar = document.getElementById('app-sidebar');
  const drawerOverlay = document.getElementById('drawer-overlay');

  if (toggleDrawerBtn && sidebar) {
    toggleDrawerBtn.addEventListener('click', () => {
      sidebar.classList.toggle('drawer-open');
      drawerOverlay?.classList.toggle('hidden');
    });

    drawerOverlay?.addEventListener('click', () => {
      sidebar.classList.remove('drawer-open');
      drawerOverlay.classList.add('hidden');
    });
  }

  // Undo / Redo buttons
  document.getElementById('btn-undo')?.addEventListener('click', () => {
    if (store.undo()) {
      showToast('عملیات به حالت قبل بازگردانده شد (Undo).', 'info');
    }
  });

  document.getElementById('btn-redo')?.addEventListener('click', () => {
    if (store.redo()) {
      showToast('عملیات مجدداً اعمال شد (Redo).', 'info');
    }
  });

  // (Undo/Redo shortcuts live in handleGlobalKeydown)

  // Project Export
  document.getElementById('btn-export-project')?.addEventListener('click', () => {
    try {
      const jsonStr = store.exportProjectJSON();
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      downloadBlob(url, `persian-tts-project-${new Date().toISOString().slice(0, 10)}.json`);
      URL.revokeObjectURL(url);
      showToast('پروژه با موفقیت به صورت JSON صادر شد.', 'success');
    } catch (err) {
      showToast(`خطا در صادرات پروژه: ${err.message}`, 'error');
    }
  });

  // Project Import
  const fileInput = document.getElementById('file-import-project');
  document.getElementById('btn-import-project')?.addEventListener('click', () => {
    fileInput?.click();
  });

  fileInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const ok = await showConfirm({
      title: 'بازیابی پروژه (Import)',
      message: 'بارگذاری این فایل، تمام داده‌های فعلی را جایگزین خواهد کرد.<br><small class="text-muted">توجه: فایل‌های صوتی باید روی همان سرور باقی مانده باشند.</small><br>آیا ادامه می‌دهید؟',
      confirmText: 'جایگزینی و بارگذاری',
      danger: true
    });

    if (!ok) {
      fileInput.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const res = store.importProjectJSON(event.target.result);
        showToast(`پروژه (نسخه ${res.version}) با ${res.segmentCount} پاراگراف و ${res.clipCount} کلیپ بازیابی شد.`, 'success');
      } catch (err) {
        showToast(`خطا در بازیابی پروژه: ${err.message}`, 'error');
      } finally {
        fileInput.value = '';
      }
    };
    reader.readAsText(file);
  });

  // Add paragraph button
  document.getElementById('btn-add-segment')?.addEventListener('click', () => {
    store.addSegment();
  });

  // Auto split text modal triggers
  const splitModal = document.getElementById('split-modal');
  const splitBackdrop = document.getElementById('modal-backdrop');
  const btnOpenSplit = document.getElementById('btn-open-split-modal');
  const btnCancelSplit = document.getElementById('btn-split-cancel');
  const btnApplySplit = document.getElementById('btn-split-apply');
  const splitTextarea = document.getElementById('split-textarea');

  btnOpenSplit?.addEventListener('click', () => {
    if (splitTextarea) splitTextarea.value = '';
    splitModal?.classList.remove('hidden');
    splitBackdrop?.classList.remove('hidden');
    splitTextarea?.focus();
  });

  const closeSplitModal = () => {
    splitModal?.classList.add('hidden');
    splitBackdrop?.classList.add('hidden');
  };

  btnCancelSplit?.addEventListener('click', closeSplitModal);
  btnApplySplit?.addEventListener('click', () => {
    const text = splitTextarea?.value || '';
    if (!text.trim()) {
      showToast('لطفاً متنی برای تقسیم خودکار وارد کنید.', 'warning');
      return;
    }
    store.autoSplitText(text);
    closeSplitModal();
    showToast('متن با موفقیت به پاراگراف‌ها تقسیم شد.', 'success');
  });

  // Pronunciation Dictionary Modal
  const dictModal = document.getElementById('dict-modal');
  document.getElementById('btn-open-dict-modal')?.addEventListener('click', () => {
    renderDictionaryModal();
    dictModal?.classList.remove('hidden');
    splitBackdrop?.classList.remove('hidden');
  });

  document.getElementById('btn-dict-close')?.addEventListener('click', () => {
    dictModal?.classList.add('hidden');
    splitBackdrop?.classList.add('hidden');
  });

  // Batch conversion buttons
  document.getElementById('btn-convert-all')?.addEventListener('click', handleConvertAll);
  document.getElementById('btn-cancel-batch')?.addEventListener('click', handleCancelBatch);

  // Library bulk selection buttons
  document.getElementById('btn-select-all')?.addEventListener('click', () => store.selectAllClips(true));
  document.getElementById('btn-select-none')?.addEventListener('click', () => store.selectAllClips(false));
  document.getElementById('btn-select-invert')?.addEventListener('click', () => store.invertClipSelection());

  // Clear library
  document.getElementById('btn-clear-library')?.addEventListener('click', async () => {
    const state = store.getState();
    if (state.clips.length === 0) return;
    const ok = await showConfirm({
      title: 'پاک‌سازی کتابخانه',
      message: 'آیا از حذف تمام کلیپ‌های موجود در کتابخانه اطمینان دارید؟ این عمل غیرقابل بازگشت است.',
      confirmText: 'حذف همه',
      danger: true
    });
    if (ok) {
      const releasable = store.clearAllClips(); // the final audio keeps its own file
      releasable.forEach(audioId => api.revokeAudioObjectUrl(audioId));
      showToast('کتابخانه ویس‌ها پاک‌سازی شد.', 'info');
    }
  });

  // Merge clips into final audio
  document.getElementById('btn-merge-final')?.addEventListener('click', handleMergeClips);

  // Add voice modal triggers
  const voiceModal = document.getElementById('voice-modal');
  const btnOpenAddVoice = document.getElementById('btn-open-add-voice');
  const btnCancelVoice = document.getElementById('btn-voice-cancel');
  const voiceForm = document.getElementById('voice-form');

  btnOpenAddVoice?.addEventListener('click', async () => {
    await populateTechnicalVoiceSelect();
    voiceForm?.reset();
    renderModalTagChips([]);
    voiceModal?.classList.remove('hidden');
    splitBackdrop?.classList.remove('hidden');
  });

  btnCancelVoice?.addEventListener('click', () => {
    voiceModal?.classList.add('hidden');
    splitBackdrop?.classList.add('hidden');
  });

  voiceForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('voice-display-name')?.value;
    const engineVoice = document.getElementById('voice-engine-select')?.value;
    const tags = Array.from(document.querySelectorAll('#voice-tag-chips .chip')).map(c => c.dataset.tag);

    if (!name?.trim()) {
      showToast('نام نمایشی صدا الزامی است.', 'warning');
      return;
    }

    store.addVoice({ name, engineVoice, tags });
    voiceModal?.classList.add('hidden');
    splitBackdrop?.classList.add('hidden');
    showToast(`صدای «${name}» با موفقیت افزوده شد.`, 'success');
  });

  setupTagInputHandler();

  // ---- Paragraph Mode Switch (Normal / Dialogue) ----
  setupParagraphModeSwitch();

  // ---- SRT Download ----
  document.getElementById('btn-download-srt')?.addEventListener('click', handleDownloadSrt);

  // ---- Global Keyboard Shortcuts ----
  document.addEventListener('keydown', handleGlobalKeydown);
  bindShortcutsUI();
}

// ============================================================
// KEYBOARD SHORTCUTS
// ============================================================
//   Ctrl/⌘ + Enter          convert the active paragraph
//   Ctrl/⌘ + Shift + Enter  convert all ready paragraphs
//   Ctrl/⌘ + Z / Y (Shift+Z) undo / redo of paragraphs — only OUTSIDE text fields
//   Ctrl/⌘ + /              shortcut help
//   Esc                     close the open dialog
// Letter/Enter shortcuts use e.code (physical key) so they also work on the Persian layout.
// Nothing fires while an IME is composing, while a dialog is open (except Esc, Ctrl+/),
// and native text editing (incl. Ctrl+Z inside textareas/inputs) is never intercepted.

// Segment card that last had focus (target of Ctrl+Enter when focus is not inside a card)
let lastActiveSegmentId = null;

function getOpenModal() {
  return Array.from(document.querySelectorAll('.modal')).find(m => !m.classList.contains('hidden')) || null;
}

function closeModalElement(modal) {
  modal.classList.add('hidden');
  document.getElementById('modal-backdrop')?.classList.add('hidden');
}

function isTextEditingTarget(el) {
  if (!el || !el.tagName) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName === 'INPUT') {
    return !['range', 'checkbox', 'radio', 'button', 'submit', 'file', 'color'].includes((el.type || '').toLowerCase());
  }
  return false;
}

function openShortcutsModal() {
  document.getElementById('shortcuts-modal')?.classList.remove('hidden');
  document.getElementById('modal-backdrop')?.classList.remove('hidden');
  document.getElementById('btn-shortcuts-close')?.focus();
}

function bindShortcutsUI() {
  document.getElementById('btn-open-shortcuts')?.addEventListener('click', openShortcutsModal);
  document.getElementById('btn-shortcuts-close')?.addEventListener('click', () => {
    const modal = document.getElementById('shortcuts-modal');
    if (modal) closeModalElement(modal);
  });

  // Remember the last paragraph the user worked in
  document.getElementById('segment-list')?.addEventListener('focusin', (e) => {
    const card = e.target.closest?.('.segment-card');
    if (card) lastActiveSegmentId = card.dataset.id;
  });
}

function handleGlobalKeydown(e) {
  if (e.isComposing || e.keyCode === 229) return; // IME composition

  const mod = e.ctrlKey || e.metaKey;
  const target = e.target instanceof Element ? e.target : document.body;
  const openModal = getOpenModal();

  // Esc → close dialog (the confirm dialog handles its own Esc)
  if (e.code === 'Escape') {
    if (openModal && openModal.id !== 'confirm-modal') {
      e.preventDefault();
      closeModalElement(openModal);
    }
    return;
  }

  // Ctrl+/ → shortcut help
  if (mod && !e.altKey && e.code === 'Slash') {
    e.preventDefault();
    if (openModal?.id === 'shortcuts-modal') closeModalElement(openModal);
    else if (!openModal) openShortcutsModal();
    return;
  }

  if (openModal) return; // no app shortcuts behind an open dialog

  // Undo / Redo of paragraphs — never steal them from text fields (native undo stays)
  if (mod && !e.altKey && (e.code === 'KeyZ' || e.code === 'KeyY')) {
    if (isTextEditingTarget(target)) return;
    e.preventDefault();
    if (e.code === 'KeyY' || e.shiftKey) store.redo();
    else store.undo();
    return;
  }

  // Ctrl+Enter → convert active paragraph; Ctrl+Shift+Enter → convert all
  if (mod && !e.altKey && (e.code === 'Enter' || e.code === 'NumpadEnter')) {
    const card = target.closest?.('.segment-card');
    if (!card && isTextEditingTarget(target)) return; // some other text field: leave it alone

    e.preventDefault();
    if (e.repeat) return;

    if (e.shiftKey) {
      handleConvertAll();
      return;
    }

    const id = card?.dataset.id || lastActiveSegmentId;
    if (!id || !store.getState().segments.some(s => s.id === id)) {
      showToast('ابتدا روی یک پاراگراف کلیک کنید، سپس Ctrl+Enter را بزنید.', 'info');
      return;
    }
    convertSegmentById(id);
  }
}

// ============================================================
// SINGLE-SEGMENT CONVERSION (button, Ctrl+Enter and batch all use this)
// ============================================================

/**
 * The textarea saves with a 300ms debounce: write what is typed right now into the store
 * before converting, so Ctrl+Enter right after typing never converts stale text.
 */
function flushPendingSegmentText(id) {
  const textarea = document.querySelector(`#segment-list .segment-card[data-id="${CSS.escape(id)}"] .segment-textarea`);
  const seg = store.getState().segments.find(s => s.id === id);
  if (textarea && seg && textarea.value !== seg.text) {
    store.updateSegment(id, { text: textarea.value }, true);
  }
}

/**
 * Why this paragraph cannot be converted right now (null = it can).
 * A paragraph without a valid voice is NEVER converted with a guessed voice.
 */
function getSegmentBlockReason(seg) {
  if (!seg.text.trim()) return 'متن این پاراگراف خالی است.';
  if (seg.text.length > CONFIG.MAX_CHAR_COUNT) return `متن بیشتر از ${CONFIG.MAX_CHAR_COUNT} نویسه است.`;
  if (!store.isVoiceValid(seg.voiceId)) {
    return seg.characterName
      ? `برای شخصیت «${seg.characterName}» هنوز صدای معتبری انتخاب نشده است. ابتدا یک صدا انتخاب کنید.`
      : 'صدای این پاراگراف معتبر نیست. یک صدا انتخاب کنید.';
  }
  return null;
}

/**
 * @returns {Promise<{ok: boolean, skipped?: boolean, blocked?: boolean, reason?: string, clip?: object, fromCache?: boolean, cacheInvalidated?: boolean, error?: Error}>}
 *          Throws only AbortError (when `signal` is aborted).
 */
async function convertSegmentById(id, { signal = null, quiet = false } = {}) {
  flushPendingSegmentText(id);

  const state = store.getState();
  const seg = state.segments.find(s => s.id === id);
  if (!seg || seg.status === 'loading') return { ok: false, skipped: true };

  const reason = getSegmentBlockReason(seg);
  if (reason) {
    if (!quiet) showToast(reason, 'warning');
    return { ok: false, blocked: true, reason };
  }

  store.setSegmentStatus(id, 'loading');
  try {
    const voice = state.voices.find(v => v.id === seg.voiceId);

    // Exactly the pipeline shown in the preview box
    const preparedText = prepareText(seg.text, state.dictionary);

    const result = await api.synthesizeSegment({
      text: preparedText,
      voice: voice.engineVoice,
      rate: seg.rate
    }, signal);

    store.setSegmentStatus(id, 'done');
    const clip = store.addClipFromSegment(seg, result, preparedText); // always a NEW clip id

    if (!quiet) {
      if (result.cacheInvalidated) {
        showToast('فایل صوتی کش‌شده روی سرور نبود؛ ورودی کش نامعتبر شد و دوباره ساخته شد. کلیپ‌های قبلی حذف نشدند.', 'warning');
      }
      showToast(`پاراگراف تبدیل شد${result.fromCache ? ' (از کش)' : ''}. (مدت زمان: ${clip.durationSec} ثانیه)`, 'success');
    }
    return { ok: true, clip, fromCache: !!result.fromCache, cacheInvalidated: !!result.cacheInvalidated };
  } catch (err) {
    if (err.name === 'AbortError') {
      store.setSegmentStatus(id, 'idle');
      throw err;
    }
    store.setSegmentStatus(id, 'error', err.message);
    if (!quiet) showToast(`خطا در تبدیل پاراگراف: ${err.message}`, 'error');
    return { ok: false, error: err };
  }
}

/**
 * Render Pronunciation Dictionary Modal Table & Add Form
 */
function renderDictionaryModal() {
  const container = document.getElementById('dict-items-list');
  const form = document.getElementById('dict-add-form');
  if (!container || !form) return;

  const state = store.getState();
  const dict = state.dictionary || [];

  if (dict.length === 0) {
    container.innerHTML = '<p class="text-sm text-muted text-center py-2">هنوز مدخلی در دیکشنری ثبت نشده است.</p>';
  } else {
    container.innerHTML = dict.map(entry => `
      <div class="dict-row card" data-id="${escapeHtml(entry.id)}">
        <div class="dict-phrase"><strong>${escapeHtml(entry.phrase)}</strong></div>
        <div class="dict-arrow">➔</div>
        <div class="dict-replacement text-accent">${escapeHtml(entry.replacement)}</div>
        <div class="dict-actions">
          <button type="button" class="btn-icon btn-dict-del text-danger" title="حذف مدخل">🗑️</button>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('.btn-dict-del').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const row = e.target.closest('.dict-row');
        const id = row?.dataset.id;
        if (id) {
          store.deleteDictionaryEntry(id);
          renderDictionaryModal();
        }
      });
    });
  }

  form.onsubmit = (e) => {
    e.preventDefault();
    const phraseInput = document.getElementById('dict-input-phrase');
    const replInput = document.getElementById('dict-input-replacement');
    const phrase = phraseInput?.value.trim();
    const replacement = replInput?.value.trim();

    if (!phrase) {
      showToast('کلمه یا عبارت مبدأ الزامی است.', 'warning');
      return;
    }

    store.addDictionaryEntry(phrase, replacement);
    phraseInput.value = '';
    replInput.value = '';
    renderDictionaryModal();
    showToast(`مدخل «${phrase}» به دیکشنری افزوده شد.`, 'success');
  };
}

/**
 * Handle Batch Conversion with Concurrency Pool and AbortController.
 * Paragraphs without a valid voice are skipped (and reported), never converted with a guessed voice.
 */
async function handleConvertAll() {
  if (store.getState().batch.active) return;

  const activeCard = document.activeElement?.closest?.('.segment-card');
  if (activeCard) flushPendingSegmentText(activeCard.dataset.id);

  const state = store.getState();
  const candidates = state.segments.filter(s =>
    (s.status === 'idle' || s.status === 'error') &&
    s.text.trim().length > 0 &&
    s.text.length <= CONFIG.MAX_CHAR_COUNT
  );
  const targets = candidates.filter(s => store.isVoiceValid(s.voiceId));
  const skippedNoVoice = candidates.length - targets.length;

  if (targets.length === 0) {
    if (skippedNoVoice > 0) {
      showToast(`${skippedNoVoice} پاراگراف صدای معتبر ندارد و تبدیل نمی‌شود. ابتدا برای آن‌ها صدا انتخاب کنید.`, 'warning');
    } else {
      showToast('هیچ پاراگراف آماده‌ای برای تبدیل وجود ندارد.', 'info');
    }
    return;
  }

  activeBatchController = new AbortController();
  const signal = activeBatchController.signal;

  store.setBatchState({
    active: true,
    total: targets.length,
    completed: 0,
    errors: 0,
    controller: activeBatchController
  });

  const queue = [...targets];
  let completedCount = 0;
  let errorCount = 0;
  let cacheHits = 0;
  let cacheInvalidatedCount = 0;

  async function worker() {
    while (queue.length > 0) {
      if (signal.aborted) break;
      const segment = queue.shift();
      if (!segment) break;

      try {
        const res = await convertSegmentById(segment.id, { signal, quiet: true });
        if (res.ok) {
          completedCount++;
          if (res.fromCache) cacheHits++;
          if (res.cacheInvalidated) cacheInvalidatedCount++;
        } else if (!res.skipped) {
          errorCount++;
        }
      } catch (err) {
        if (err.name === 'AbortError') break;
        errorCount++;
      }

      store.setBatchState({ completed: completedCount, errors: errorCount });
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(CONFIG.BATCH_CONCURRENCY, targets.length); i++) {
    workers.push(worker());
  }

  await Promise.all(workers);

  const wasCancelled = signal.aborted;
  store.setBatchState({ active: false, controller: null });
  activeBatchController = null;

  const extras = [];
  if (cacheHits > 0) extras.push(`${cacheHits} مورد از کش`);
  if (cacheInvalidatedCount > 0) extras.push(`${cacheInvalidatedCount} ورودی کش نامعتبر و بازسازی شد`);
  if (skippedNoVoice > 0) extras.push(`${skippedNoVoice} پاراگراف بدون صدا رد شد`);
  const extraText = extras.length ? ` (${extras.join('، ')})` : '';

  if (wasCancelled) {
    showToast('تبدیل دسته‌ای لغو شد.', 'warning');
  } else if (errorCount > 0 || skippedNoVoice > 0) {
    showToast(`تبدیل دسته‌ای با ${completedCount} موفق و ${errorCount} خطا به پایان رسید${extraText}.`, 'warning');
  } else {
    showToast(`تمام ${completedCount} پاراگراف با موفقیت به ویس تبدیل شدند${extraText}.`, 'success');
  }
}

function handleCancelBatch() {
  if (activeBatchController) {
    activeBatchController.abort();
    activeBatchController = null;
  }
}

/**
 * Handle merging selected clips into final audio using gapAfterMs array.
 */
async function handleMergeClips() {
  const state = store.getState();
  const selectedClips = state.clips.filter(c => c.selected);

  if (selectedClips.length < 2) {
    showToast('برای ادغام، حداقل ۲ کلیپ از کتابخانه باید انتخاب شوند.', 'warning');
    return;
  }

  const btnMerge = document.getElementById('btn-merge-final');
  if (btnMerge) {
    btnMerge.disabled = true;
    btnMerge.textContent = 'در حال ساخت ویس کامل...';
  }

  try {
    const audioIds = selectedClips.map(c => c.audioId);

    // Aligned gapAfterMs array; last pause is explicitly 0
    const gapAfterMs = selectedClips.map((c, idx) =>
      idx === selectedClips.length - 1 ? 0 : (c.pauseAfterMs ?? CONFIG.DEFAULT_PAUSE_AFTER_MS)
    );

    const result = await api.mergeClips({
      audioIds,
      gapAfterMs
    });

    store.setFinalAudio(result, selectedClips, gapAfterMs);
    showToast('ویس کامل با موفقیت ساخته شد!', 'success');
  } catch (err) {
    showToast(`خطا در ساخت ویس کامل: ${err.message}`, 'error');
  } finally {
    if (btnMerge) {
      btnMerge.disabled = false;
      btnMerge.textContent = '🧩 ساخت ویس کامل';
    }
  }
}

let modalCurrentTags = [];

function setupTagInputHandler() {
  const tagInput = document.getElementById('voice-tag-input');
  if (!tagInput) return;

  tagInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === '،' || e.key === ',') {
      e.preventDefault();
      const val = tagInput.value.replace(/[،,]/g, '').trim();
      if (val && !modalCurrentTags.includes(val)) {
        modalCurrentTags.push(val);
        renderModalTagChips(modalCurrentTags);
        tagInput.value = '';
      }
    }
  });

  updateTagDatalist();
}

function updateTagDatalist() {
  const datalist = document.getElementById('tag-suggestions');
  if (!datalist) return;
  const allTags = store.getState().allTags;
  datalist.innerHTML = allTags.map(t => `<option value="${escapeHtml(t)}"></option>`).join('');
}

function renderModalTagChips(tags) {
  modalCurrentTags = [...tags];
  const container = document.getElementById('voice-tag-chips');
  if (!container) return;

  container.innerHTML = modalCurrentTags.map(tag => `
    <span class="chip chip-tag" data-tag="${escapeHtml(tag)}">
      ${escapeHtml(tag)}
      <button type="button" class="chip-remove" aria-label="حذف تگ">&times;</button>
    </span>
  `).join('');

  container.querySelectorAll('.chip-remove').forEach((btn, idx) => {
    btn.addEventListener('click', () => {
      modalCurrentTags.splice(idx, 1);
      renderModalTagChips(modalCurrentTags);
    });
  });
}

async function populateTechnicalVoiceSelect(selectedVal = '') {
  const select = document.getElementById('voice-engine-select');
  if (!select) return;

  select.innerHTML = '<option value="">در حال دریافت صداهای سرور...</option>';
  try {
    const voices = await api.getVoices();
    select.innerHTML = voices.map(v => `
      <option value="${escapeHtml(v.engineVoice)}" ${v.engineVoice === selectedVal ? 'selected' : ''}>
        ${escapeHtml(v.name)} (${escapeHtml(v.engineVoice)})
      </option>
    `).join('');
  } catch (err) {
    select.innerHTML = '<option value="default">صدای پیش‌فرض</option>';
    showToast(err.message, 'error');
  }
}

// ============================================================
// SRT SUBTITLE DOWNLOAD
// ============================================================

/**
 * SRT is generated only from the CURRENT finalAudio snapshots (the merged file's own timing).
 * Without a merged final audio nothing is offered.
 */
function handleDownloadSrt() {
  const final = store.getState().finalAudio;

  if (!final || !Array.isArray(final.clipSnapshots) || final.clipSnapshots.length === 0) {
    showToast('ابتدا ویس کامل را بسازید؛ زیرنویس فقط از روی ویس کامل ساخته‌شده تولید می‌شود.', 'warning');
    return;
  }

  const srtContent = generateSrtContent(final.clipSnapshots);
  if (!srtContent) {
    showToast('تولید زیرنویس ناموفق بود: مدت یا متن کلیپ‌های ویس کامل ثبت نشده است.', 'error');
    return;
  }

  // UTF-8 BOM so Windows players/editors detect Persian text correctly
  const blob = new Blob(['\ufeff' + srtContent], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const stamp = new Date(final.createdAt).getTime() || Date.now();
  downloadBlob(url, `subtitle-persian-tts-${stamp}.srt`);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  showToast('فایل زیرنویس SRT دانلود شد.', 'success');
}

// ============================================================
// DIALOGUE / SCREENPLAY (modal + character panel)
// ============================================================

// Parsed lines kept in module scope between "parse" and "apply"
let _parsedDialogueLines = [];
let _parsedCharacters = [];
let _dialogueTagFilter = '';

/**
 * <option>s for a voice select. Optionally narrowed by a tag (the selected voice always stays listed).
 */
function voiceOptionsHtml(selectedId, filterTag = '') {
  const voices = store.getState().voices;
  const shown = voices.filter(v => !filterTag || v.id === selectedId || (v.tags || []).includes(filterTag));
  return '<option value="">— انتخاب صدا —</option>' + shown.map(v => `
    <option value="${escapeHtml(v.id)}" ${v.id === selectedId ? 'selected' : ''}>
      ${escapeHtml(v.name)}${v.tags?.length ? ` (${escapeHtml(v.tags.join('، '))})` : ''}
    </option>`).join('');
}

/**
 * A voice whose tag equals the character name (e.g. character «راوی» ↔ tag «راوی»).
 * Only a SUGGESTION — the user must click it; nothing is assigned automatically.
 */
function findVoiceSuggestion(characterName) {
  return store.getState().voices.find(v => (v.tags || []).some(t => t.trim() === characterName)) || null;
}

export let currentParagraphMode = 'normal'; // 'normal' | 'dialogue'

export function setParagraphMode(mode) {
  currentParagraphMode = mode === 'dialogue' ? 'dialogue' : 'normal';
  updateParagraphModeUI();
  if (currentParagraphMode === 'dialogue') {
    document.getElementById('dialogue-textarea-inline')?.focus();
  }
}
window.setParagraphMode = setParagraphMode;

export function updateParagraphModeUI() {
  const tabNormal = document.getElementById('tab-mode-normal');
  const tabDialogue = document.getElementById('tab-mode-dialogue');
  const segmentList = document.getElementById('segment-list');
  const dialoguePanel = document.getElementById('dialogue-panel');
  const normalActions = document.querySelectorAll('.normal-mode-action');

  const isDialogue = currentParagraphMode === 'dialogue';

  // Toggle active tab classes & aria attributes
  if (tabNormal) {
    tabNormal.classList.toggle('active', !isDialogue);
    tabNormal.setAttribute('aria-selected', !isDialogue ? 'true' : 'false');
  }
  if (tabDialogue) {
    tabDialogue.classList.toggle('active', isDialogue);
    tabDialogue.setAttribute('aria-selected', isDialogue ? 'true' : 'false');
  }

  // Toggle visibility of panels & normal-mode-specific actions
  if (segmentList) {
    segmentList.classList.toggle('hidden', isDialogue);
  }
  if (dialoguePanel) {
    dialoguePanel.classList.toggle('hidden', !isDialogue);
  }
  normalActions.forEach(el => el.classList.toggle('hidden', isDialogue));

  if (isDialogue) {
    renderInlineDialogueChars();
  }
}

function setupParagraphModeSwitch() {
  const tabNormal = document.getElementById('tab-mode-normal');
  const tabDialogue = document.getElementById('tab-mode-dialogue');
  const dialogueTextarea = document.getElementById('dialogue-textarea-inline');
  const btnApply = document.getElementById('btn-dialogue-apply-inline');

  tabNormal?.addEventListener('click', (e) => {
    e.preventDefault();
    setParagraphMode('normal');
  });

  tabDialogue?.addEventListener('click', (e) => {
    e.preventDefault();
    setParagraphMode('dialogue');
  });

  // Realtime parse on typing in dialogue textarea
  let parseTimer = null;
  dialogueTextarea?.addEventListener('input', () => {
    clearTimeout(parseTimer);
    parseTimer = setTimeout(() => {
      renderInlineDialogueChars();
    }, 150);
  });

  // Apply button inside dialogue panel
  btnApply?.addEventListener('click', async () => {
    const raw = dialogueTextarea?.value || '';
    if (!raw.trim()) {
      showToast('لطفاً متن دیالوگ یا فیلمنامه را وارد کنید.', 'warning');
      return;
    }

    const { characters, lines } = parseDialogueScript(raw);
    if (lines.length === 0) {
      showToast('هیچ خط دیالوگی با فرمت «نام: دیالوگ» یافت نشد.', 'warning');
      return;
    }

    const map = store.getState().characterVoices;
    const unmapped = characters.filter(c => !store.isVoiceValid(map[c]));
    if (unmapped.length > 0) {
      const ok = await showConfirm({
        title: 'شخصیت‌های بدون صدا',
        message: `شخصیت‌های زیر هنوز صدای معتبری ندارند:<br><strong>${unmapped.map(escapeHtml).join('، ')}</strong><br><br>پاراگراف‌های این شخصیت‌ها تا زمان انتخاب صدا تبدیل نخواهند شد.<br>آیا اعمال شود؟`,
        confirmText: 'اعمال و ادامه',
        danger: false
      });
      if (!ok) return;
    }

    store.applyDialogueLines(lines);
    setParagraphMode('normal');
    showToast(`${lines.length} پاراگراف دیالوگ با موفقیت اضافه شد.`, 'success');
  });

  // Initial sync
  updateParagraphModeUI();
}

function renderInlineDialogueChars() {
  const container = document.getElementById('dialogue-inline-char-list');
  const textarea = document.getElementById('dialogue-textarea-inline');
  if (!container || !textarea) return;

  const raw = textarea.value || '';
  const { characters } = parseDialogueScript(raw);

  if (characters.length === 0) {
    container.innerHTML = '<span class="text-xs text-muted">با نوشتن دیالوگ (مانند «علی: سلام»)، شخصیت‌ها اینجا لیست می‌شوند تا برای هر کدام گوینده انتخاب کنید.</span>';
    return;
  }

  const state = store.getState();

  container.innerHTML = characters.map(char => {
    const mapped = state.characterVoices[char];
    const hasVoice = store.isVoiceValid(mapped);
    const suggestion = hasVoice ? null : findVoiceSuggestion(char);
    return `
      <div class="dialogue-char-row ${hasVoice ? '' : 'char-no-voice'}">
        <span class="char-name font-semibold">${escapeHtml(char)}</span>
        <span class="char-arrow">←</span>
        <select class="input-select char-voice-select" data-character="${escapeHtml(char)}" aria-label="صدای ${escapeHtml(char)}">
          ${voiceOptionsHtml(hasVoice ? mapped : '')}
        </select>
        ${hasVoice
          ? '<span class="char-status char-ok">✅</span>'
          : '<span class="char-status char-warn">⚠️ بدون صدا</span>'}
        ${suggestion ? `<button type="button" class="btn btn-secondary btn-sm btn-suggest-voice" data-character="${escapeHtml(char)}" data-voice-id="${escapeHtml(suggestion.id)}" title="تگ «${escapeHtml(char)}» روی این صدا ثبت شده است">پیشنهاد: ${escapeHtml(suggestion.name)}</button>` : ''}
      </div>
    `;
  }).join('');

  container.querySelectorAll('.char-voice-select').forEach(sel => {
    sel.addEventListener('change', (e) => {
      const charName = e.target.dataset.character;
      if (e.target.value) store.setCharacterVoice(charName, e.target.value);
      else store.removeCharacterVoice(charName);
      renderInlineDialogueChars();
    });
  });

  container.querySelectorAll('.btn-suggest-voice').forEach(btn => {
    btn.addEventListener('click', () => {
      store.setCharacterVoice(btn.dataset.character, btn.dataset.voiceId);
      renderInlineDialogueChars();
    });
  });
}

function renderCharacterPanel(state) {
  const panel = document.getElementById('character-panel');
  if (!panel) return;

  const chars = store.getCharacterSummary();
  if (chars.length === 0) {
    panel.classList.add('hidden');
    panel.innerHTML = '';
    panel.dataset.sig = '';
    return;
  }

  // Re-render only when something relevant changed (keeps an open <select> usable during batch ticks)
  const sig = JSON.stringify([chars, state.voices.map(v => [v.id, v.name, v.tags])]);
  panel.classList.remove('hidden');
  if (panel.dataset.sig === sig) return;
  panel.dataset.sig = sig;

  const unresolved = chars.reduce((n, c) => n + c.unresolved, 0);

  panel.innerHTML = `
    <div class="character-panel-header">
      <strong>🎭 شخصیت‌ها و صداها</strong>
      ${unresolved > 0
        ? `<span class="badge badge-warning">⚠️ ${unresolved} پاراگراف بدون صدا؛ تا انتخاب صدا تبدیل نمی‌شوند</span>`
        : '<span class="badge badge-done">همه شخصیت‌ها صدا دارند</span>'}
    </div>
    <div class="dialogue-char-rows">
      ${chars.map(c => `
        <div class="dialogue-char-row ${c.voiceId ? '' : 'char-no-voice'}">
          <span class="char-name">${escapeHtml(c.name)}</span>
          <span class="text-xs text-muted">${c.total} پاراگراف</span>
          <select class="input-select char-voice-select" data-character="${escapeHtml(c.name)}" aria-label="صدای ${escapeHtml(c.name)}">
            ${voiceOptionsHtml(c.voiceId)}
          </select>
          ${c.voiceId ? '' : '<span class="char-status char-warn">⚠️ بدون صدا</span>'}
        </div>
      `).join('')}
    </div>
  `;

  panel.querySelectorAll('.char-voice-select').forEach(sel => {
    sel.addEventListener('change', (e) => {
      const charName = e.target.dataset.character;
      if (e.target.value) store.setCharacterVoice(charName, e.target.value);
      else store.removeCharacterVoice(charName);
    });
  });
}

/**
 * Re-rendering the paragraph list replaces the DOM; keep keyboard focus and caret where they were.
 */
function captureSegmentFocus() {
  const el = document.activeElement;
  const card = el?.closest?.('#segment-list .segment-card');
  if (!card) return null;
  const cls = ['segment-textarea', 'select-voice', 'range-rate', 'range-pause'].find(c => el.classList.contains(c));
  if (!cls) return null;
  return { id: card.dataset.id, cls, start: el.selectionStart ?? null, end: el.selectionEnd ?? null };
}

function restoreSegmentFocus(info) {
  if (!info) return;
  const el = document.querySelector(`#segment-list .segment-card[data-id="${CSS.escape(info.id)}"] .${info.cls}`);
  if (!el || el.disabled) return;
  el.focus({ preventScroll: true });
  if (info.cls === 'segment-textarea' && info.start != null) {
    try { el.setSelectionRange(info.start, info.end); } catch { /* ignore */ }
  }
}

export function renderAll(changeType = '') {
  const state = store.getState();

  renderTagFilter(state);
  renderVoiceList(state);
  renderCharacterPanel(state);
  const segmentFocus = captureSegmentFocus();
  renderSegments(state);
  restoreSegmentFocus(segmentFocus);
  renderClips(state, changeType === 'CLIP_ADDED');
  renderFinalAudio(state);
  renderBatchProgress(state);
  updateTagDatalist();
  updateUndoRedoButtons();
  updateParagraphModeUI();
}

function updateUndoRedoButtons() {
  const btnUndo = document.getElementById('btn-undo');
  const btnRedo = document.getElementById('btn-redo');
  if (btnUndo) btnUndo.disabled = !store.canUndo();
  if (btnRedo) btnRedo.disabled = !store.canRedo();
}

function renderTagFilter(state) {
  const container = document.getElementById('tag-filter-list');
  if (!container) return;

  const { allTags, tagFilter } = state;
  if (allTags.length === 0) {
    container.innerHTML = '<span class="text-muted text-sm">هنوز تگی ثبت نشده است.</span>';
    return;
  }

  container.innerHTML = allTags.map(tag => {
    const isSelected = tagFilter.selectedTags.includes(tag);
    return `
      <button type="button" class="chip chip-filter ${isSelected ? 'active' : ''}" data-tag="${escapeHtml(tag)}">
        ${escapeHtml(tag)}
      </button>
    `;
  }).join('');

  container.querySelectorAll('.chip-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      const tag = btn.dataset.tag;
      const current = [...tagFilter.selectedTags];
      const idx = current.indexOf(tag);
      if (idx === -1) current.push(tag);
      else current.splice(idx, 1);
      store.setTagFilter({ selectedTags: current });
    });
  });

  const modeOr = document.getElementById('filter-mode-or');
  const modeAnd = document.getElementById('filter-mode-and');
  const checkUntagged = document.getElementById('filter-untagged');

  if (modeOr) modeOr.checked = tagFilter.mode === 'OR';
  if (modeAnd) modeAnd.checked = tagFilter.mode === 'AND';
  if (checkUntagged) checkUntagged.checked = tagFilter.untagged;

  modeOr?.addEventListener('change', () => store.setTagFilter({ mode: 'OR' }));
  modeAnd?.addEventListener('change', () => store.setTagFilter({ mode: 'AND' }));
  checkUntagged?.addEventListener('change', (e) => store.setTagFilter({ untagged: e.target.checked }));
}

function getFilteredVoices(state) {
  const { voices, tagFilter } = state;
  const { selectedTags, mode, untagged } = tagFilter;

  if (untagged) {
    return voices.filter(v => !v.tags || v.tags.length === 0);
  }

  if (selectedTags.length === 0) {
    return voices;
  }

  return voices.filter(voice => {
    const vTags = voice.tags || [];
    if (mode === 'AND') {
      return selectedTags.every(t => vTags.includes(t));
    }
    return selectedTags.some(t => vTags.includes(t));
  });
}

function renderVoiceList(state) {
  const container = document.getElementById('voice-list');
  if (!container) return;

  const filteredVoices = getFilteredVoices(state);

  if (filteredVoices.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>صدایی با تگ‌های انتخابی یافت نشد.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filteredVoices.map(voice => `
    <div class="voice-card card" data-id="${escapeHtml(voice.id)}">
      <div class="voice-card-header">
        <div class="voice-title">
          <strong>${escapeHtml(voice.name)}</strong>
          <span class="text-muted text-xs">${escapeHtml(voice.engineVoice)}</span>
        </div>
        <div class="voice-actions">
          <button type="button" class="btn-icon btn-preview-voice" title="پیش‌شنود صدا" aria-label="پیش‌شنود صدا">🔊</button>
          <button type="button" class="btn-icon btn-edit-voice" title="ویرایش" aria-label="ویرایش صدا">✏️</button>
          <button type="button" class="btn-icon btn-delete-voice text-danger" title="حذف" aria-label="حذف صدا">🗑️</button>
        </div>
      </div>
      <div class="voice-tags">
        ${(voice.tags || []).map(t => `<span class="chip chip-sm">${escapeHtml(t)}</span>`).join('')}
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.voice-card').forEach(card => {
    const voiceId = card.dataset.id;
    const voice = state.voices.find(v => v.id === voiceId);
    if (!voice) return;

    card.querySelector('.btn-preview-voice')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.textContent = '⏳';
      try {
        const sampleText = `این پیش‌شنود نمونه برای صدای ${voice.name} است.`;
        const res = await api.synthesizeSegment({
          text: sampleText,
          voice: voice.engineVoice,
          rate: 1.0
        });
        const audioUrl = await api.getAudioObjectUrl(res.audioId);
        const audio = new Audio(audioUrl);
        registerAudioElement(audio);
        await audio.play();
      } catch (err) {
        showToast(`خطا در پیش‌شنود: ${err.message}`, 'error');
      } finally {
        btn.textContent = '🔊';
      }
    });

    card.querySelector('.btn-edit-voice')?.addEventListener('click', () => openEditVoiceModal(voice));

    card.querySelector('.btn-delete-voice')?.addEventListener('click', async () => {
      if (state.voices.length <= 1) {
        showToast('حداقل یک صدا باید در سیستم باقی بماند.', 'warning');
        return;
      }

      const affectedSegments = state.segments.filter(s => s.voiceId === voice.id);
      let confirmMsg = `آیا از حذف صدای «${voice.name}» اطمینان دارید؟`;
      if (affectedSegments.length > 0) {
        const dialogueCount = affectedSegments.filter(s => s.characterName).length;
        confirmMsg = `این صدا در <strong>${affectedSegments.length} پاراگراف</strong> استفاده شده است. پس از حذف، پاراگراف‌های عادی به صدای پیش‌فرض تغییر می‌یابند.` +
          (dialogueCount > 0 ? `<br><strong>${dialogueCount} پاراگراف دیالوگ «بدون صدا» می‌شوند</strong> و تا انتخاب صدای جدید برای شخصیت‌ها تبدیل نخواهند شد.` : '') +
          `<br>کلیپ‌های قبلی کتابخانه دست‌نخورده باقی می‌مانند.<br>آیا ادامه می‌دهید؟`;
      }

      const ok = await showConfirm({
        title: 'حذف صدا',
        message: confirmMsg,
        confirmText: 'حذف صدا',
        danger: true
      });

      if (ok) {
        const res = store.deleteVoice(voice.id);
        const notes = [];
        if (res?.remappedCount) notes.push(`${res.remappedCount} پاراگراف به صدای پیش‌فرض رفت`);
        if (res?.unassignedCount) notes.push(`${res.unassignedCount} پاراگراف دیالوگ بدون صدا شد`);
        showToast(`صدای «${voice.name}» حذف شد.${notes.length ? ` (${notes.join('، ')})` : ''}`, res?.unassignedCount ? 'warning' : 'info');
      }
    });
  });
}

function openEditVoiceModal(voice) {
  const modal = document.getElementById('voice-modal');
  const backdrop = document.getElementById('modal-backdrop');
  const nameInput = document.getElementById('voice-display-name');
  const modalTitle = document.getElementById('voice-modal-title');

  if (modalTitle) modalTitle.textContent = 'ویرایش صدا';
  if (nameInput) nameInput.value = voice.name;

  populateTechnicalVoiceSelect(voice.engineVoice);
  renderModalTagChips(voice.tags || []);

  modal?.classList.remove('hidden');
  backdrop?.classList.remove('hidden');

  const form = document.getElementById('voice-form');
  const originalOnSubmit = form.onsubmit;

  form.onsubmit = (e) => {
    e.preventDefault();
    const newName = nameInput.value.trim();
    if (!newName) {
      showToast('نام نمایشی الزامی است.', 'warning');
      return;
    }
    store.updateVoice(voice.id, {
      name: newName,
      tags: modalCurrentTags
    });
    modal?.classList.add('hidden');
    backdrop?.classList.add('hidden');
    form.onsubmit = originalOnSubmit;
    showToast('صدای مورد نظر به‌روزرسانی شد.', 'success');
  };
}

/**
 * Render Segments (Paragraphs) with Prepared Text Preview & Pause Control
 */
function renderSegments(state) {
  const container = document.getElementById('segment-list');
  if (!container) return;

  const voices = state.voices;
  const dict = state.dictionary || [];

  container.innerHTML = state.segments.map((segment, idx) => {
    const charCount = segment.text.length;
    const isOverLimit = charCount > CONFIG.MAX_CHAR_COUNT;
    const isEmpty = charCount === 0;

    // Realtime Persian Text Preparation Preview
    const prepared = prepareText(segment.text, dict);
    const hasModifications = prepared !== segment.text && segment.text.trim().length > 0;
    const voiceOk = store.isVoiceValid(segment.voiceId);

    const statusBadges = {
      idle: '<span class="badge badge-idle">آماده</span>',
      loading: '<span class="badge badge-loading">در حال تبدیل...</span>',
      done: '<span class="badge badge-done">تبدیل‌شده</span>',
      error: '<span class="badge badge-error">خطا</span>'
    };

    return `
      <div class="segment-card card animate-fade-in" data-id="${escapeHtml(segment.id)}">
        <div class="segment-card-header">
          <div class="segment-header-left">
            <span class="segment-index">پاراگراف ${idx + 1}</span>
            ${statusBadges[segment.status] || ''}
            ${segment.characterName ? `<span class="badge badge-accent text-xs" title="شخصیت">🎭 ${escapeHtml(segment.characterName)}</span>` : ''}
            ${voiceOk ? '' : '<span class="badge badge-warning text-xs" title="تا انتخاب صدا قابل تبدیل نیست">⚠️ بدون صدا</span>'}
          </div>
          <div class="segment-controls">
            <button type="button" class="btn-icon btn-seg-up" title="انتقال به بالا" ${idx === 0 ? 'disabled' : ''}>↑</button>
            <button type="button" class="btn-icon btn-seg-down" title="انتقال به پایین" ${idx === state.segments.length - 1 ? 'disabled' : ''}>↓</button>
            <button type="button" class="btn-icon btn-seg-dup" title="تکثیر پاراگراف">📋</button>
            <button type="button" class="btn-icon btn-seg-del text-danger" title="حذف پاراگراف">🗑️</button>
          </div>
        </div>

        <div class="segment-body">
          <textarea
            class="segment-textarea ${isOverLimit ? 'input-error' : ''}"
            placeholder="متن فارسی این پاراگراف را اینجا بنویسید..."
            rows="3"
            maxlength="${CONFIG.MAX_CHAR_COUNT}"
            ${segment.status === 'loading' ? 'disabled' : ''}
          >${escapeHtml(segment.text)}</textarea>

          <!-- Realtime Prepared Text Preview Box -->
          <div class="prepared-preview-box">
            <div class="prepared-preview-header">
              <span class="text-xs text-muted">متن ارسالی به موتور (پیش‌پردازش‌شده):</span>
              ${hasModifications ? '<span class="badge badge-accent text-xs">نرمال‌سازی شده</span>' : ''}
            </div>
            <div class="prepared-preview-content ${!prepared ? 'text-muted' : ''}">
              ${escapeHtml(prepared || '—')}
            </div>
          </div>

          <div class="segment-meta-row">
            <div class="segment-settings">
              <label class="control-group">
                <span class="control-label">گوینده:</span>
                <select class="input-select select-voice ${voiceOk ? '' : 'select-voice-missing'}" ${voiceOk ? '' : 'aria-invalid="true"'} ${segment.status === 'loading' ? 'disabled' : ''}>
                  ${voiceOk ? '' : '<option value="" selected disabled>— انتخاب صدا —</option>'}
                  ${voices.map(v => `
                    <option value="${escapeHtml(v.id)}" ${v.id === segment.voiceId ? 'selected' : ''}>
                      ${escapeHtml(v.name)}
                    </option>
                  `).join('')}
                </select>
              </label>

              <label class="control-group">
                <span class="control-label">سرعت: <b class="rate-value">${segment.rate.toFixed(1)}x</b></span>
                <input
                  type="range"
                  class="range-rate"
                  min="0.5"
                  max="2.0"
                  step="0.1"
                  value="${segment.rate}"
                  ${segment.status === 'loading' ? 'disabled' : ''}
                />
              </label>

              <!-- Pause After Ms Slider -->
              <label class="control-group">
                <span class="control-label">وقفه بعد: <b class="pause-value">${segment.pauseAfterMs || 0}ms</b></span>
                <input
                  type="range"
                  class="range-pause"
                  min="0"
                  max="2000"
                  step="50"
                  value="${segment.pauseAfterMs ?? CONFIG.DEFAULT_PAUSE_AFTER_MS}"
                  ${segment.status === 'loading' ? 'disabled' : ''}
                />
              </label>
            </div>

            <div class="segment-status-row">
              <span class="char-counter ${isOverLimit ? 'text-danger' : 'text-muted'}">
                ${charCount} / ${CONFIG.MAX_CHAR_COUNT}
              </span>

              ${segment.status === 'error' && segment.error ? `
                <span class="error-tooltip text-danger text-xs" title="${escapeHtml(segment.error)}">
                  ⚠️ ${escapeHtml(segment.error.slice(0, 30))}...
                </span>
              ` : ''}

              <button
                type="button"
                class="btn ${segment.status === 'error' ? 'btn-warning' : 'btn-primary'} btn-convert-segment"
                ${segment.status === 'loading' || isEmpty || isOverLimit || !voiceOk ? 'disabled' : ''}
                aria-keyshortcuts="Control+Enter"
                title="${voiceOk ? 'تبدیل این پاراگراف (Ctrl+Enter)' : 'ابتدا یک صدا برای این پاراگراف انتخاب کنید'}"
              >
                ${segment.status === 'loading' ? 'در حال تبدیل...' : segment.status === 'error' ? 'تلاش مجدد' : 'تبدیل به ویس'}
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.segment-card').forEach(card => {
    const id = card.dataset.id;
    const seg = state.segments.find(s => s.id === id);
    if (!seg) return;

    // Realtime smooth text input without re-rendering card
    let inputTimeout = null;
    const segTextarea = card.querySelector('.segment-textarea');
    segTextarea?.addEventListener('input', (e) => {
      clearTimeout(inputTimeout);
      const val = e.target.value;
      const charCount = val.length;

      // Update char counter in DOM immediately
      const counterEl = card.querySelector('.char-counter');
      if (counterEl) {
        counterEl.textContent = `${charCount} / ${CONFIG.MAX_CHAR_COUNT}`;
        counterEl.className = `char-counter ${charCount > CONFIG.MAX_CHAR_COUNT ? 'text-danger' : 'text-muted'}`;
      }

      // Update realtime preview in DOM immediately
      const prepEl = card.querySelector('.prepared-preview-content');
      if (prepEl) {
        const prep = prepareText(val, store.getState().dictionary);
        prepEl.textContent = prep || '—';
      }

      inputTimeout = setTimeout(() => {
        store.updateSegmentQuiet(id, { text: val });
      }, 300);
    });

    segTextarea?.addEventListener('blur', () => {
      store.pushHistory();
    });

    card.querySelector('.select-voice')?.addEventListener('change', (e) => {
      store.updateSegment(id, { voiceId: e.target.value }, true);
    });

    // Smooth speed slider without card reload or flickering
    card.querySelector('.range-rate')?.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      card.querySelector('.rate-value').textContent = `${val.toFixed(1)}x`;
      store.updateSegmentQuiet(id, { rate: val });
    });
    card.querySelector('.range-rate')?.addEventListener('change', (e) => {
      const val = parseFloat(e.target.value);
      store.updateSegmentQuiet(id, { rate: val });
      store.pushHistory();
    });

    // Smooth pause slider without card reload or flickering
    card.querySelector('.range-pause')?.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      card.querySelector('.pause-value').textContent = `${val}ms`;
      store.updateSegmentQuiet(id, { pauseAfterMs: val });
    });
    card.querySelector('.range-pause')?.addEventListener('change', (e) => {
      const val = parseInt(e.target.value, 10);
      store.updateSegmentQuiet(id, { pauseAfterMs: val });
      store.pushHistory();
    });

    card.querySelector('.btn-seg-up')?.addEventListener('click', () => store.moveSegment(id, 'up'));
    card.querySelector('.btn-seg-down')?.addEventListener('click', () => store.moveSegment(id, 'down'));
    card.querySelector('.btn-seg-dup')?.addEventListener('click', () => store.duplicateSegment(id));
    card.querySelector('.btn-seg-del')?.addEventListener('click', () => store.removeSegment(id));

    // Convert single paragraph (same code path as Ctrl+Enter and batch)
    card.querySelector('.btn-convert-segment')?.addEventListener('click', () => convertSegmentById(id));
  });
}

/**
 * Render Library Clips with Editable Pause
 */
function renderClips(state, shouldScrollToTop = false) {
  const container = document.getElementById('clip-list');
  const countBadge = document.getElementById('library-count-badge');
  const summaryEl = document.getElementById('library-summary-stats');
  if (!container) return;

  const clips = state.clips;
  const selectedClips = clips.filter(c => c.selected);
  const totalDuration = selectedClips.reduce((acc, c) => acc + (c.durationSec || 0), 0);

  if (countBadge) countBadge.textContent = clips.length;
  if (summaryEl) {
    summaryEl.innerHTML = `
      انتخاب‌شده: <strong>${selectedClips.length}</strong> از <strong>${clips.length}</strong>
      &nbsp;|&nbsp;
      مجموع زمان: <strong>${totalDuration.toFixed(1)} ثانیه</strong>
    `;
  }

  if (clips.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>کتابخانه خالی است. پاراگراف‌ها را به ویس تبدیل کنید تا کلیپ‌های صوتی اینجا نمایش داده شوند.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = clips.map((clip, idx) => `
    <div class="clip-card card animate-fade-in ${clip.selected ? 'selected' : ''}" data-id="${escapeHtml(clip.id)}" draggable="true">
      <div class="clip-header">
        <span class="clip-drag-handle" title="جابه‌جایی با کشیدن (Drag & Drop)" aria-hidden="true">⋮⋮</span>
        <label class="clip-checkbox-label">
          <input type="checkbox" class="clip-select-check" ${clip.selected ? 'checked' : ''} />
          <span class="clip-order-badge">#${idx + 1}</span>
          <strong class="clip-voice-name">${escapeHtml(clip.voiceName)}</strong>
        </label>

        <div class="clip-meta-chips">
          <span class="chip chip-sm">سرعت ${clip.rate.toFixed(1)}x</span>
          <span class="chip chip-sm">⏱️ ${(clip.durationSec || 0).toFixed(1)}s</span>
          <!-- Editable Pause After Ms inside Clip -->
          <label class="clip-pause-badge" title="تنظیم وقفه پس از این کلیپ در ادغام">
            وقفه: <input type="number" class="input-clip-pause" min="0" max="2000" step="50" value="${clip.pauseAfterMs ?? 0}" /> ms
          </label>
          <span class="text-muted text-xs">${formatTime(clip.createdAt)}</span>
        </div>

        <div class="clip-actions">
          <button type="button" class="btn-icon btn-clip-up" title="انتقال به بالا" ${idx === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" class="btn-icon btn-clip-down" title="انتقال به پایین" ${idx === clips.length - 1 ? 'disabled' : ''}>↓</button>
          <button type="button" class="btn-icon btn-clip-resynth" title="ساخت دوباره با همان متن و صدا">🔄</button>
          <button type="button" class="btn-icon btn-clip-download" title="دانلود فایل صوتی MP3">⬇️</button>
          <button type="button" class="btn-icon btn-clip-del text-danger" title="حذف کلیپ">🗑️</button>
        </div>
      </div>

      <div class="clip-text-container">
        <div class="clip-text-collapsed">${escapeHtml(clip.preparedText || clip.text)}</div>
        <button type="button" class="btn-link btn-toggle-expand">نمایش کامل متن</button>
      </div>

      <div class="clip-player-row">
        <audio class="clip-audio-player" controls preload="none" data-audio-id="${escapeHtml(clip.audioId)}"></audio>
      </div>
    </div>
  `).join('');

  if (shouldScrollToTop) {
    const firstCard = container.querySelector('.clip-card');
    firstCard?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  container.querySelectorAll('.clip-card').forEach(card => {
    const id = card.dataset.id;
    const clip = state.clips.find(c => c.id === id);
    if (!clip) return;

    // Drag & Drop reordering
    card.addEventListener('dragstart', (e) => {
      draggedClipId = id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
      card.classList.add('is-dragging');
    });

    card.addEventListener('dragend', () => {
      card.classList.remove('is-dragging');
      container.querySelectorAll('.clip-card').forEach(c => {
        c.classList.remove('drag-over-top', 'drag-over-bottom');
      });
      draggedClipId = null;
    });

    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (!draggedClipId || draggedClipId === id) return;

      const rect = card.getBoundingClientRect();
      const relY = e.clientY - rect.top;
      const isBottom = relY > rect.height / 2;

      card.classList.toggle('drag-over-top', !isBottom);
      card.classList.toggle('drag-over-bottom', isBottom);
    });

    card.addEventListener('dragleave', () => {
      card.classList.remove('drag-over-top', 'drag-over-bottom');
    });

    card.addEventListener('drop', (e) => {
      e.preventDefault();
      card.classList.remove('drag-over-top', 'drag-over-bottom');
      const sourceId = draggedClipId || e.dataTransfer.getData('text/plain');
      if (!sourceId || sourceId === id) return;

      const fromIndex = state.clips.findIndex(c => c.id === sourceId);
      const toIndex = state.clips.findIndex(c => c.id === id);
      if (fromIndex === -1 || toIndex === -1) return;

      const rect = card.getBoundingClientRect();
      const relY = e.clientY - rect.top;
      let targetIndex = toIndex;
      if (relY > rect.height / 2 && fromIndex < toIndex) {
        targetIndex = toIndex;
      } else if (relY > rect.height / 2 && fromIndex > toIndex) {
        targetIndex = toIndex + 1;
      } else if (relY <= rect.height / 2 && fromIndex < toIndex) {
        targetIndex = Math.max(0, toIndex - 1);
      }

      store.moveClipToIndex(sourceId, targetIndex);
    });

    card.querySelector('.clip-select-check')?.addEventListener('change', () => {
      store.toggleClipSelect(id);
    });

    // Editable pause in clip
    card.querySelector('.input-clip-pause')?.addEventListener('change', (e) => {
      const val = parseInt(e.target.value, 10);
      store.updateClipPause(id, isNaN(val) ? 0 : val);
    });

    const textEl = card.querySelector('.clip-text-collapsed');
    const toggleBtn = card.querySelector('.btn-toggle-expand');
    toggleBtn?.addEventListener('click', () => {
      textEl?.classList.toggle('expanded');
      toggleBtn.textContent = textEl?.classList.contains('expanded') ? 'بستن متن' : 'نمایش کامل متن';
    });

    card.querySelector('.btn-clip-up')?.addEventListener('click', () => store.moveClip(id, 'up'));
    card.querySelector('.btn-clip-down')?.addEventListener('click', () => store.moveClip(id, 'down'));

    // Re-synthesize using exact preparedText and snapshot voice
    card.querySelector('.btn-clip-resynth')?.addEventListener('click', async () => {
      try {
        showToast(`در حال تولید مجدد با صدای «${clip.voiceName}»...`, 'info');
        const textToSynth = clip.preparedText || clip.text;
        const res = await api.synthesizeSegment({
          text: textToSynth,
          voice: clip.engineVoice,
          rate: clip.rate
        });

        store.addClipDirect({
          segmentId: clip.segmentId,
          text: clip.text,
          preparedText: textToSynth,
          voiceName: clip.voiceName,
          engineVoice: clip.engineVoice,
          voiceTags: [...clip.voiceTags],
          rate: clip.rate,
          pauseAfterMs: clip.pauseAfterMs,
          audioId: res.audioId,
          audioUrl: res.url,
          durationSec: res.durationSec
        });

        if (res.cacheInvalidated) {
          showToast('فایل کش‌شده روی سرور نبود؛ ورودی کش نامعتبر شد و دوباره ساخته شد.', 'warning');
        }
        showToast(
          res.fromCache
            ? 'کلیپ جدید (با همان فایل صوتی کش‌شده) در ابتدای کتابخانه قرار گرفت.'
            : 'کلیپ جدید ساخته شد و در ابتدای کتابخانه قرار گرفت.',
          'success'
        );
      } catch (err) {
        showToast(`خطا در ساخت دوباره: ${err.message}`, 'error');
      }
    });

    card.querySelector('.btn-clip-del')?.addEventListener('click', async () => {
      const ok = await showConfirm({
        title: 'حذف کلیپ',
        message: 'آیا از حذف این کلیپ از کتابخانه مطمئن هستید؟',
        confirmText: 'حذف',
        danger: true
      });
      if (ok) {
        const res = store.removeClip(id);
        // Only this card goes away. The audio file/blob is released locally only if nothing else uses it.
        if (res.removed && !res.audioStillReferenced) api.revokeAudioObjectUrl(res.audioId);
        showToast(
          res.sharedWithClips
            ? 'کلیپ حذف شد؛ فایل صوتی مشترک با کلیپ‌های دیگر دست‌نخورده ماند.'
            : 'کلیپ حذف شد.',
          'info'
        );
      }
    });

    const audioEl = card.querySelector('.clip-audio-player');
    if (audioEl) {
      registerAudioElement(audioEl);
      audioEl.addEventListener('play', async () => {
        if (!audioEl.src && clip.audioId) {
          try {
            audioEl.src = await api.getAudioObjectUrl(clip.audioId);
            await audioEl.play();
          } catch (err) {
            showToast(err.message, 'error');
            audioEl.pause();
          }
        }
      });
    }

    card.querySelector('.btn-clip-download')?.addEventListener('click', async () => {
      try {
        const objUrl = await api.getAudioObjectUrl(clip.audioId);
        const fileName = `clip-${String(state.clips.indexOf(clip) + 1).padStart(2, '0')}-${clip.voiceName.replace(/\s+/g, '_')}.mp3`;
        downloadBlob(objUrl, fileName);
      } catch (err) {
        showToast(`خطا در دانلود صوت: ${err.message}`, 'error');
      }
    });
  });
}

function renderFinalAudio(state) {
  const container = document.getElementById('final-audio-container');
  const btnMerge = document.getElementById('btn-merge-final');
  if (!container) return;

  const selectedClips = state.clips.filter(c => c.selected);
  if (btnMerge) {
    btnMerge.disabled = selectedClips.length < 2 || state.batch.active;
  }

  const final = state.finalAudio;

  // SRT is only offered once a final audio with clip snapshots exists
  const btnSrt = document.getElementById('btn-download-srt');
  if (btnSrt) {
    btnSrt.disabled = !(final && Array.isArray(final.clipSnapshots) && final.clipSnapshots.length > 0);
  }

  if (!final) {
    container.innerHTML = `
      <div class="empty-state text-sm">
        <p>هنوز ویس کاملی ساخته نشده است. حداقل ۲ کلیپ از کتابخانه انتخاب کرده و روی «ساخت ویس کامل» بزنید.</p>
      </div>
    `;
    return;
  }

  const currentSelectedIds = selectedClips.map(c => c.id);
  const isOutOfSync = !arraysEqual(currentSelectedIds, final.clipIds);

  container.innerHTML = `
    <div class="final-audio-card card animate-fade-in">
      <div class="final-header">
        <div class="final-title-group">
          <strong>ویس نهایی ادغام‌شده</strong>
          <span class="text-muted text-xs">ساخته‌شده در ${formatTime(final.createdAt)}</span>
        </div>
        ${isOutOfSync ? `
          <span class="badge badge-warning" title="ترتیب یا انتخاب کلیپ‌ها در کتابخانه تغییر یافته است">
            ⚠️ با ویس کامل فعلی همخوانی ندارد
          </span>
        ` : `
          <span class="badge badge-done">همگام با کتابخانه</span>
        `}
      </div>

      <div class="final-player-row">
        <audio class="final-audio-player" controls preload="none" data-audio-id="${escapeHtml(final.id)}"></audio>
        <button type="button" class="btn btn-secondary btn-download-final">
          ⬇️ دانلود ویس کامل (MP3)
        </button>
      </div>

      <div class="final-summary-details">
        <div class="text-sm text-muted">
          تعداد کلیپ‌های ترکیب‌شده: <strong>${final.clipSnapshots?.length || final.clipIds.length}</strong> | 
          مجموع مدت زمان: <strong>${(final.durationSec || 0).toFixed(1)} ثانیه</strong>
        </div>
        <ol class="final-snapshots-list">
          ${(final.clipSnapshots || []).map((snap, i) => `
            <li>
              <span>${i + 1}. ${escapeHtml(snap.voiceName || 'صدا')}</span>: 
              <span class="text-muted">${escapeHtml((snap.preparedText || snap.text || '').slice(0, 45))}...</span>
              <span class="text-xs">(${snap.durationSec}s${snap.pauseAfterMs ? ` + وقفه ${snap.pauseAfterMs}ms` : ''})</span>
            </li>
          `).join('')}
        </ol>
      </div>
    </div>
  `;

  const audioEl = container.querySelector('.final-audio-player');
  if (audioEl) {
    registerAudioElement(audioEl);
    audioEl.addEventListener('play', async () => {
      if (!audioEl.src && final.id) {
        try {
          audioEl.src = await api.getAudioObjectUrl(final.id);
          await audioEl.play();
        } catch (err) {
          showToast(err.message, 'error');
          audioEl.pause();
        }
      }
    });
  }

  container.querySelector('.btn-download-final')?.addEventListener('click', async () => {
    try {
      const objUrl = await api.getAudioObjectUrl(final.id);
      downloadBlob(objUrl, `final-audio-persian-tts-${Date.now()}.mp3`);
    } catch (err) {
      showToast(`خطا در دانلود ویس کامل: ${err.message}`, 'error');
    }
  });
}

function renderBatchProgress(state) {
  const container = document.getElementById('batch-progress-bar-container');
  const textEl = document.getElementById('batch-progress-text');
  const barEl = document.getElementById('batch-progress-fill');
  const btnConvertAll = document.getElementById('btn-convert-all');
  const btnCancelBatch = document.getElementById('btn-cancel-batch');

  if (!container) return;

  const { active, total, completed } = state.batch;

  if (!active) {
    container.classList.add('hidden');
    if (btnConvertAll) btnConvertAll.disabled = false;
    if (btnCancelBatch) btnCancelBatch.classList.add('hidden');
    return;
  }

  container.classList.remove('hidden');
  if (btnConvertAll) btnConvertAll.disabled = true;
  if (btnCancelBatch) btnCancelBatch.classList.remove('hidden');

  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  if (textEl) textEl.textContent = `در حال تبدیل ${completed} از ${total} پاراگراف (${percent}٪)...`;
  if (barEl) barEl.style.width = `${percent}%`;
}

function downloadBlob(objectUrl, filename) {
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function arraysEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; ++i) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
