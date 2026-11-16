import { useEffect, useRef, useState } from 'react';
import { ClipLibrarySection } from './components/ClipLibrarySection';
import { FinalAudioSection } from './components/FinalAudioSection';
import { Header } from './components/Header';
import {
  ConfirmModal,
  DictionaryModal,
  SplitTextModal,
  VoiceModal,
} from './components/Modals';
import { ParagraphsSection } from './components/ParagraphsSection';
import { SidebarVoices } from './components/SidebarVoices';
import { ToastContainer } from './components/ToastContainer';
import { TtsProvider, useTts } from './context/TtsContext';
import type { Voice } from './types/tts';

function isTextEditingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName === 'INPUT') {
    const type = ((el as HTMLInputElement).type || '').toLowerCase();
    return !['range', 'checkbox', 'radio', 'button', 'submit', 'file', 'color'].includes(type);
  }
  return false;
}

function StudioWorkspace() {
  const {
    segments,
    confirmState,
    undo,
    redo,
    convertSegmentById,
    handleConvertAll,
    showToast,
  } = useTts();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [voiceModalOpen, setVoiceModalOpen] = useState(false);
  const [editingVoice, setEditingVoice] = useState<Voice | null>(null);
  const [splitModalOpen, setSplitModalOpen] = useState(false);
  const [dictModalOpen, setDictModalOpen] = useState(false);

  const lastActiveSegmentIdRef = useRef<string | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;

      const mod = e.ctrlKey || e.metaKey;
      const target = e.target as HTMLElement | null;
      const anyModalOpen =
        !!confirmState || voiceModalOpen || splitModalOpen || dictModalOpen;

      if (e.code === 'Escape') {
        if (confirmState) return;
        if (voiceModalOpen) {
          e.preventDefault();
          setVoiceModalOpen(false);
        } else if (splitModalOpen) {
          e.preventDefault();
          setSplitModalOpen(false);
        } else if (dictModalOpen) {
          e.preventDefault();
          setDictModalOpen(false);
        }
        return;
      }

      if (anyModalOpen) return;

      if (mod && !e.altKey && (e.code === 'KeyZ' || e.code === 'KeyY')) {
        if (isTextEditingTarget(target)) return;
        e.preventDefault();
        if (e.code === 'KeyY' || e.shiftKey) {
          if (redo()) showToast('عملیات مجدداً اعمال شد (Redo).', 'info');
        } else {
          if (undo()) showToast('عملیات به حالت قبل بازگردانده شد (Undo).', 'info');
        }
        return;
      }

      if (mod && !e.altKey && (e.code === 'Enter' || e.code === 'NumpadEnter')) {
        const card = target?.closest?.('[data-segment-id]') as HTMLElement | null;
        if (!card && isTextEditingTarget(target)) return;

        e.preventDefault();
        if (e.repeat) return;

        if (e.shiftKey) {
          handleConvertAll();
          return;
        }

        const id = card?.dataset.segmentId || lastActiveSegmentIdRef.current;
        if (!id || !segments.some((s) => s.id === id)) {
          showToast('ابتدا روی یک پاراگراف کلیک کنید، سپس Ctrl+Enter را بزنید.', 'info');
          return;
        }
        convertSegmentById(id);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    confirmState,
    voiceModalOpen,
    splitModalOpen,
    dictModalOpen,
    segments,
    undo,
    redo,
    convertSegmentById,
    handleConvertAll,
    showToast,
  ]);

  return (
    <div className="min-h-screen bg-[#070b14] text-slate-50">
      <Header
        onToggleDrawer={() => setDrawerOpen((prev) => !prev)}
        onOpenDict={() => setDictModalOpen(true)}
      />

      <div className="mx-auto grid max-w-[1440px] grid-cols-1 lg:grid-cols-[290px_1fr]">
        <SidebarVoices
          drawerOpen={drawerOpen}
          onCloseDrawer={() => setDrawerOpen(false)}
          onAddVoice={() => {
            setEditingVoice(null);
            setVoiceModalOpen(true);
          }}
          onEditVoice={(voice) => {
            setEditingVoice(voice);
            setVoiceModalOpen(true);
          }}
        />

        <main className="flex w-full flex-col gap-7 p-4 sm:p-6">
          <ParagraphsSection
            onOpenSplitModal={() => setSplitModalOpen(true)}
            onFocusSegment={(id) => {
              lastActiveSegmentIdRef.current = id;
            }}
          />

          <ClipLibrarySection />

          <FinalAudioSection />
        </main>
      </div>

      {/* Modals & Toasts */}
      <ConfirmModal />
      <VoiceModal
        open={voiceModalOpen}
        editingVoice={editingVoice}
        onClose={() => setVoiceModalOpen(false)}
      />
      <SplitTextModal open={splitModalOpen} onClose={() => setSplitModalOpen(false)} />
      <DictionaryModal open={dictModalOpen} onClose={() => setDictModalOpen(false)} />
      <ToastContainer />
    </div>
  );
}

export default function App() {
  return (
    <TtsProvider>
      <StudioWorkspace />
    </TtsProvider>
  );
}
