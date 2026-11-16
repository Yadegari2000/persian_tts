import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync('./index.html', 'utf8').replace(/<script[^>]*main\.js[^>]*><\/script>/, '');
const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
const w = dom.window;
for (const k of ['window','document','localStorage','Element','HTMLElement','KeyboardEvent','Event','Audio','DOMException','navigator']) {
  try { globalThis[k] = k === 'window' ? w : w[k]; } catch { Object.defineProperty(globalThis, k, { value: w[k], configurable: true }); }
}
globalThis.CSS = { escape: s => String(s).replace(/([^\w-])/g, '\\$1') };
w.HTMLElement.prototype.scrollIntoView = () => {};
w.HTMLAnchorElement.prototype.click = function () { globalThis.__lastDownload = { href: this.href, name: this.download }; };
const blobs = new Map();
const origCreate = URL.createObjectURL.bind(URL);
URL.createObjectURL = (b) => { const u = origCreate(b); blobs.set(u, b); return u; };

const { CONFIG } = await import('./js/config.js');
const store = await import('./js/state.js');
const ui = await import('./js/ui.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const toasts = () => $$('.toast-message').map(e => e.textContent);
let n = 0; const ok = m => console.log('✓', ++n, m);

function key(target, code, opts = {}) {
  const ev = new w.KeyboardEvent('keydown', { code, key: opts.key ?? code, bubbles: true, cancelable: true, ...opts });
  target.dispatchEvent(ev);
  return ev;
}

store.loadState();
ui.initUI();

assert.equal($('#btn-download-srt').disabled, true);
ok('SRT button disabled before a final audio exists');

// ---- dialogue
const [v1, v2] = store.getState().voices;
store.setCharacterVoice('علی', v1.id);
store.applyDialogueLines([
  { character: 'علی', text: 'سلام' },
  { character: 'سارا', text: 'خوبی؟' },
  { character: 'علی', text: 'مرسی' }
]);
await sleep(10);
assert.ok(!$('#character-panel').classList.contains('hidden'));
assert.match($('#character-panel').textContent, /1 پاراگراف بدون صدا/);
const cards = $$('.segment-card');
assert.equal(cards.length, 3);
assert.equal(cards[1].querySelector('.btn-convert-segment').disabled, true);
assert.match(cards[1].textContent, /بدون صدا/);
assert.equal(cards[0].querySelector('.btn-convert-segment').disabled, false);
ok('unassigned character: panel warning, badge, convert button disabled');

// Ctrl+Enter on the unassigned paragraph → warning, nothing converted
let ev = key(cards[1].querySelector('.segment-textarea'), 'Enter', { ctrlKey: true });
assert.equal(ev.defaultPrevented, true);
await sleep(30);
assert.equal(store.getState().clips.length, 0);
assert.ok(toasts().some(t => /سارا.*صدا/.test(t)));
ok('Ctrl+Enter on unassigned paragraph is refused with a clear message');

// Ctrl+Enter on assigned paragraph, with typed-but-not-yet-saved text (debounce flush) and Persian layout key
const ta0 = $$('.segment-card')[0].querySelector('.segment-textarea');
ta0.focus();
ta0.value = 'سلام، حالت چطوره؟';
key(ta0, 'Enter', { ctrlKey: true, key: 'Enter' });
await sleep(1600);
let clips = store.getState().clips;
assert.equal(clips.length, 1);
assert.equal(clips[0].text, 'سلام، حالت چطوره؟');
ok('Ctrl+Enter flushes unsaved text and converts the active paragraph');

// repeat is ignored, IME ignored
key($$('.segment-card')[2].querySelector('.segment-textarea'), 'Enter', { ctrlKey: true, repeat: true });
key($$('.segment-card')[2].querySelector('.segment-textarea'), 'Enter', { ctrlKey: true, isComposing: true });
await sleep(1300);
assert.equal(store.getState().clips.length, 1);
ok('held key / IME composition do not trigger conversion');

// undo/redo: Persian layout (key is a Persian char, code is KeyZ). Not inside textareas.
store.addSegment();                         // pushes history
const before = store.getState().segments.length;
ev = key(document.body, 'KeyZ', { ctrlKey: true, key: 'ظ' });
assert.equal(ev.defaultPrevented, true);
assert.equal(store.getState().segments.length, before - 1);
ev = key(document.body, 'KeyZ', { ctrlKey: true, shiftKey: true, key: 'ظ' });
assert.equal(store.getState().segments.length, before);
ev = key($$('.segment-textarea')[0], 'KeyZ', { ctrlKey: true, key: 'z' });
assert.equal(ev.defaultPrevented, false);
ev = key($$('.segment-textarea')[0], 'KeyZ', { ctrlKey: true, shiftKey: true, key: 'Z' });
assert.equal(ev.defaultPrevented, false);
ok('Undo/Redo work on Persian layout outside fields and never hijack native textarea undo/redo');

// ---- panel: choose voice for سارا → convertible
const sel = $('#character-panel .char-voice-select[data-character="سارا"]');
sel.value = v2.id;
sel.dispatchEvent(new w.Event('change', { bubbles: true }));
await sleep(10);
assert.equal(store.getState().segments.find(s => s.characterName === 'سارا').voiceId, v2.id);
assert.match($('#character-panel').textContent, /همه شخصیت‌ها صدا دارند/);
assert.equal($$('.segment-card')[1].querySelector('.btn-convert-segment').disabled, false);
ok('choosing a voice in the panel unlocks the character paragraphs');

// ---- batch with cache: all lines; "مرسی" etc.
key(document.body, 'Enter', { ctrlKey: true, shiftKey: true });
await sleep(3500);
clips = store.getState().clips;
assert.equal(clips.length, 3);
assert.equal(new Set(clips.map(c => c.id)).size, 3);
ok('Ctrl+Shift+Enter converts all remaining paragraphs');

// same text again → cache hit, new clip id, same audio file
const firstAudio = clips.find(c => c.text === 'خوبی؟').audioId;
store.addSegment(); const extra = store.getState().segments.at(-1);
store.updateSegment(extra.id, { text: 'خوبی؟', voiceId: v2.id });
await sleep(10);
$$('.segment-card').at(-1).querySelector('.btn-convert-segment').click();
await sleep(300);
clips = store.getState().clips;
assert.equal(clips.length, 4);
assert.equal(clips[0].audioId, firstAudio);
assert.ok(toasts().some(t => /از کش/.test(t)));
ok('repeat conversion: reused audio (از کش) but a new independent clip');

// delete one of two clips sharing audio
const delBtn = () => $$('.clip-card')[0].querySelector('.btn-clip-del');
delBtn().click(); await sleep(10);
$('#confirm-modal-ok').click(); await sleep(20);
assert.equal(store.getState().clips.length, 3);
assert.ok(store.getState().clips.some(c => c.audioId === firstAudio));
assert.ok(toasts().some(t => /مشترک/.test(t)));
ok('deleting a card keeps the shared audio of the other card');

// ---- merge → SRT
$$('.clip-card').forEach(() => {});
store.selectAllClips(true);
await sleep(10);
$('#btn-merge-final').click();
await sleep(1500);
assert.ok(store.getState().finalAudio);
assert.equal($('#btn-download-srt').disabled, false);
$('#btn-download-srt').click();
await sleep(20);
const dl = globalThis.__lastDownload;
assert.match(dl.name, /\.srt$/);
const bytes = new Uint8Array(await blobs.get(dl.href).arrayBuffer());
assert.deepEqual(Array.from(bytes.slice(0, 3)), [0xEF, 0xBB, 0xBF]);          // UTF-8 BOM present
const text = new TextDecoder('utf-8', { ignoreBOM: false }).decode(bytes);   // decoder strips BOM
assert.ok(text.startsWith('1\n00:00:00,000 -->'));
const fa = store.getState().finalAudio;
const lastEnd = text.trim().split('\n\n').at(-1).split('\n')[1].split(' --> ')[1];
const [h, m, rest] = lastEnd.split(':'); const [sec, ms] = rest.split(',');
const endSec = (+h) * 3600 + (+m) * 60 + (+sec) + (+ms) / 1000;
assert.ok(Math.abs(endSec - fa.durationSec) < 0.01, `srt end ${endSec} vs merged ${fa.durationSec}`);
ok('merge → SRT enabled, downloads UTF-8 SRT whose last cue ends at the merged duration');

// ---- Esc / Ctrl+/ modals
$('#btn-open-dialogue-modal').click();
assert.ok(!$('#dialogue-modal').classList.contains('hidden'));
key(document.body, 'Escape');
assert.ok($('#dialogue-modal').classList.contains('hidden'));
assert.ok($('#modal-backdrop').classList.contains('hidden'));
key(document.body, 'Slash', { ctrlKey: true, key: '/' });
assert.ok(!$('#shortcuts-modal').classList.contains('hidden'));
key(document.body, 'Slash', { ctrlKey: true, key: '/' });
assert.ok($('#shortcuts-modal').classList.contains('hidden'));
ok('Esc closes dialogs; Ctrl+/ toggles help');

// no app shortcuts behind an open dialog
$('#btn-open-dialogue-modal').click();
const cl = store.getState().clips.length;
key($('#dialogue-textarea'), 'Enter', { ctrlKey: true });
await sleep(30);
assert.equal(store.getState().clips.length, cl);
key(document.body, 'Escape');
ok('Ctrl+Enter inside a dialog is ignored');

// ---- dialogue modal flow: parse → suggestion by tag → apply w/ unmapped
store.addVoice({ name: 'صدای راوی', engineVoice: 'fa-male-narrator-1', tags: ['راوی'] });
$('#btn-open-dialogue-modal').click();
$('#dialogue-textarea').value = 'علی: سلام\nمریم: درود\nیک جمله روایی';
$('#btn-dialogue-parse').click();
await sleep(10);
const rows = $$('#dialogue-char-rows .dialogue-char-row');
assert.equal(rows.length, 3);
const narratorRow = rows.find(r => r.querySelector('.char-name').textContent === 'راوی');
assert.ok(narratorRow.querySelector('.btn-suggest-voice'), 'suggestion by tag shown');
assert.equal(narratorRow.querySelector('.char-voice-select').value, '', 'not auto-assigned');
assert.equal($('#btn-dialogue-apply').disabled, false);
ok('dialogue modal: parse, tag-based suggestion (not auto-assigned), apply enabled');

$('#btn-dialogue-apply').click(); await sleep(10);
assert.ok(!$('#confirm-modal').classList.contains('hidden'));       // unmapped warning
$('#confirm-modal-ok').click(); await sleep(20);
const segs = store.getState().segments;
assert.equal(segs.length, 3);
assert.deepEqual(segs.map(s => s.voiceId === ''), [false, true, true]); // علی mapped earlier; مریم & راوی not
ok('apply with unmapped characters requires confirmation and leaves them unassigned');

console.log('UI ALL OK');
process.exit(0);
