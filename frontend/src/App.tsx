import { useCallback, useEffect, useRef, useState } from 'react';
import { MotionConfig } from 'motion/react';
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

  const [voiceModalOpen, setVoiceModalOpen] = useState(false);
  const [editingVoice, setEditingVoice] = useState<Voice | null>(null);
  const [splitModalOpen, setSplitModalOpen] = useState(false);
  const [dictModalOpen, setDictModalOpen] = useState(false);

  const lastActiveSegmentIdRef = useRef<string | null>(null);
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;

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
        if (!id || !segmentsRef.current.some((s) => s.id === id)) {
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
    undo,
    redo,
    convertSegmentById,
    handleConvertAll,
    showToast,
  ]);

  const handleScrollToVoices = useCallback(() => {
    const el = document.getElementById('sidebar-voices');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  const handleOpenSplitModal = useCallback(() => setSplitModalOpen(true), []);
  const handleFocusSegment = useCallback((id: string) => {
    lastActiveSegmentIdRef.current = id;
  }, []);
  const handleAddVoice = useCallback(() => {
    setEditingVoice(null);
    setVoiceModalOpen(true);
  }, []);
  const handleEditVoice = useCallback((voice: Voice) => {
    setEditingVoice(voice);
    setVoiceModalOpen(true);
  }, []);
  const handleOpenDict = useCallback(() => setDictModalOpen(true), []);
  const handleCloseVoiceModal = useCallback(() => setVoiceModalOpen(false), []);
  const handleCloseSplitModal = useCallback(() => setSplitModalOpen(false), []);
  const handleCloseDictModal = useCallback(() => setDictModalOpen(false), []);

  return (
    <div className="relative min-h-screen text-[var(--text-primary)]">
      {/* Exactly ONE soft ambient glow spot (white-blue, opacity ~0.05, blur 160px, top-center, pointer-events: none) */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed left-1/2 -top-40 -translate-x-1/2 z-0 h-[480px] w-[680px] rounded-full blur-[160px]"
        style={{ background: 'radial-gradient(circle, rgba(233, 237, 245, 0.05), transparent 70%)' }}
      />

      <div className="relative z-10">
        <Header
          onScrollToVoices={handleScrollToVoices}
          onOpenDict={handleOpenDict}
        />

        <div className="mx-auto grid max-w-[1440px] grid-cols-1 gap-6 px-4 py-6 min-[900px]:grid-cols-[340px_1fr] min-[900px]:gap-[28px] min-[900px]:px-8 min-[900px]:py-8">
          <div className="order-2 min-[900px]:order-1">
            <SidebarVoices
              onAddVoice={handleAddVoice}
              onEditVoice={handleEditVoice}
            />
          </div>

          <main className="order-1 flex w-full min-w-0 flex-col gap-6 min-[900px]:order-2">
            <ParagraphsSection
              onOpenSplitModal={handleOpenSplitModal}
              onFocusSegment={handleFocusSegment}
            />

            <div className="h-[1px] bg-[var(--border-subtle)]" aria-hidden="true" />

            <ClipLibrarySection />

            <div className="h-[1px] bg-[var(--border-subtle)]" aria-hidden="true" />

            <FinalAudioSection />
          </main>
        </div>
      </div>

      {/* Modals & Toasts */}
      <ConfirmModal />
      <VoiceModal
        open={voiceModalOpen}
        editingVoice={editingVoice}
        onClose={handleCloseVoiceModal}
      />
      <SplitTextModal open={splitModalOpen} onClose={handleCloseSplitModal} />
      <DictionaryModal open={dictModalOpen} onClose={handleCloseDictModal} />
      <ToastContainer />
    </div>
  );
}

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <TtsProvider>
        <StudioWorkspace />
      </TtsProvider>
    </MotionConfig>
  );
}
