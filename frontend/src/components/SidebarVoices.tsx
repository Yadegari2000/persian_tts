import { useMemo, useState } from 'react';
import { Loader2, Pencil, Plus, Trash2, Users, Volume2, X } from 'lucide-react';
import { getSpeakerColorForVoice, SPEAKER_PALETTE } from '../config/config';
import { useTts } from '../context/TtsContext';
import type { Voice } from '../types/tts';
import * as audioEngine from '../utils/audioEngine';

interface SidebarVoicesProps {
  drawerOpen: boolean;
  onCloseDrawer: () => void;
  onAddVoice: () => void;
  onEditVoice: (voice: Voice) => void;
}

export function SidebarVoices({ drawerOpen, onCloseDrawer, onAddVoice, onEditVoice }: SidebarVoicesProps) {
  const {
    voices,
    allTags,
    tagFilter,
    segments,
    setTagFilter,
    deleteVoice,
    showConfirm,
    showToast,
    registerPlayingAudio,
  } = useTts();

  const [previewingId, setPreviewingId] = useState<string | null>(null);

  const filteredVoices = useMemo(() => {
    const { selectedTags, mode, untagged } = tagFilter;
    if (untagged) {
      return voices.filter((v) => !v.tags || v.tags.length === 0);
    }
    if (selectedTags.length === 0) return voices;
    return voices.filter((voice) => {
      const vTags = voice.tags || [];
      return mode === 'AND'
        ? selectedTags.every((t) => vTags.includes(t))
        : selectedTags.some((t) => vTags.includes(t));
    });
  }, [voices, tagFilter]);

  const toggleTag = (tag: string) => {
    const current = tagFilter.selectedTags;
    const next = current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag];
    setTagFilter({ selectedTags: next, untagged: false });
  };

  const selectAllTags = () => {
    setTagFilter({ selectedTags: [], untagged: false });
  };

  const handlePreviewVoice = async (voice: Voice) => {
    setPreviewingId(voice.id);
    try {
      const sampleText = `این پیش‌شنود نمونه برای صدای ${voice.name} است.`;
      const url = await audioEngine.previewVoiceAudio(voice.engineVoice, sampleText);
      const audio = new Audio(url);
      registerPlayingAudio(audio);
      await audio.play();
    } catch (err: unknown) {
      showToast(`خطا در پیش‌شنود: ${(err as Error).message}`, 'error');
    } finally {
      setPreviewingId(null);
    }
  };

  const handleDeleteVoice = async (voice: Voice) => {
    if (voices.length <= 1) {
      showToast('حداقل یک صدا باید در سیستم باقی بماند.', 'warning');
      return;
    }

    const affected = segments.filter((s) => s.voiceId === voice.id);
    let confirmMsg = `آیا از حذف صدای «${voice.name}» اطمینان دارید؟`;
    if (affected.length > 0) {
      const dialogueCount = affected.filter((s) => s.characterName).length;
      confirmMsg =
        `این صدا در ${affected.length} پاراگراف استفاده شده است. پس از حذف، پاراگراف‌های عادی به صدای پیش‌فرض تغییر می‌یابند.` +
        (dialogueCount > 0
          ? ` همچنین ${dialogueCount} پاراگراف دیالوگ «بدون صدا» می‌شوند و تا انتخاب صدای جدید برای شخصیت‌ها تبدیل نخواهند شد.`
          : '') +
        ' کلیپ‌های قبلی کتابخانه دست‌نخورده باقی می‌مانند. آیا ادامه می‌دهید؟';
    }

    const ok = await showConfirm({
      title: 'حذف صدا',
      message: confirmMsg,
      confirmText: 'حذف صدا',
      danger: true,
    });

    if (ok) {
      const res = deleteVoice(voice.id);
      const notes: string[] = [];
      if (res.remappedCount) notes.push(`${res.remappedCount} پاراگراف به صدای پیش‌فرض رفت`);
      if (res.unassignedCount) notes.push(`${res.unassignedCount} پاراگراف دیالوگ بدون صدا شد`);
      showToast(
        `صدای «${voice.name}» حذف شد.${notes.length ? ` (${notes.join('، ')})` : ''}`,
        res.unassignedCount ? 'warning' : 'info'
      );
    }
  };

  const isAllActive = tagFilter.selectedTags.length === 0 && !tagFilter.untagged;

  return (
    <>
      {drawerOpen && (
        <div
          onClick={onCloseDrawer}
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          aria-hidden="true"
        />
      )}

      <aside
        aria-label="بانک گویندگان"
        className={`fixed inset-y-0 right-0 z-50 flex w-[300px] flex-col gap-4 overflow-y-auto border-l border-[#182338] bg-[#0b1220] p-4 transition-transform duration-200 lg:sticky lg:top-[116px] lg:z-10 lg:h-[calc(100vh-116px)] lg:w-[290px] lg:translate-x-0 ${
          drawerOpen ? 'translate-x-0 shadow-2xl' : 'translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Sidebar Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-amber-400" />
            <h2 className="text-sm font-extrabold text-slate-50">بانک گویندگان</h2>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onAddVoice}
              className="inline-flex items-center gap-1 rounded-lg bg-gradient-to-l from-cyan-500 to-sky-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition-all hover:brightness-110 whitespace-nowrap shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>صدای جدید</span>
            </button>
            <button
              type="button"
              onClick={onCloseDrawer}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-[#131d35] hover:text-slate-100 lg:hidden"
              aria-label="بستن پنل"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Smart Tag Filter Card */}
        <section className="flex flex-col gap-3 rounded-2xl border border-[#1d2b46] bg-[#10192d] p-3.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-300">فیلتر هوشمند تگ‌ها:</span>
            <div className="flex items-center gap-2 text-[11px] text-slate-400">
              <button
                type="button"
                onClick={() => setTagFilter({ mode: tagFilter.mode === 'OR' ? 'AND' : 'OR' })}
                title="تغییر منطق فیلتر (OR / AND)"
                className="rounded border border-[#223254] bg-[#0b1329] px-1.5 py-0.5 font-mono text-[10px] text-sky-300 hover:border-sky-400"
              >
                {tagFilter.mode}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={selectAllTags}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-all whitespace-nowrap shrink-0 ${
                isAllActive
                  ? 'bg-gradient-to-l from-cyan-500 to-sky-500 text-slate-950 shadow-sm'
                  : 'border border-[#223254] bg-[#0b1329] text-slate-300 hover:border-sky-400/60 hover:text-white'
              }`}
            >
              همه
            </button>

            {allTags.map((tag) => {
              const active = tagFilter.selectedTags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-all whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-gradient-to-l from-cyan-500 to-sky-500 text-slate-950 font-semibold'
                      : 'border border-[#223254] bg-[#0b1329] text-slate-300 hover:border-sky-400/60 hover:text-white'
                  }`}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </section>

        {/* Voice List */}
        <section className="flex flex-col gap-2.5">
          {filteredVoices.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[#223254] p-5 text-center text-xs text-slate-400">
              صدایی با تگ‌های انتخابی یافت نشد.
            </div>
          ) : (
            filteredVoices.map((voice, idx) => {
              const colorKey = voice.color || getSpeakerColorForVoice(voice.id || idx);
              const pal = SPEAKER_PALETTE[colorKey];

              return (
                <div
                  key={voice.id}
                  className="flex flex-col gap-2 rounded-xl border border-[#1d2b46] bg-[#10192d] p-3 transition-colors hover:border-sky-400/40"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 min-w-0">
                      <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${pal.dot}`} />
                      <div className="min-w-0">
                        <div className="truncate text-xs font-bold text-slate-100">{voice.name}</div>
                        <div className="mt-0.5 truncate font-mono text-[10px] text-slate-400">
                          {voice.engineVoice}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handlePreviewVoice(voice)}
                        disabled={previewingId === voice.id}
                        title="پیش‌شنود صدا"
                        aria-label="پیش‌شنود صدا"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-300 transition-colors hover:bg-[#0b1329] hover:text-cyan-400"
                      >
                        {previewingId === voice.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-400" />
                        ) : (
                          <Volume2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => onEditVoice(voice)}
                        title="ویرایش صدا"
                        aria-label="ویرایش صدا"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-300 transition-colors hover:bg-[#0b1329] hover:text-slate-100"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteVoice(voice)}
                        title="حذف صدا"
                        aria-label="حذف صدا"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-rose-400/80 transition-colors hover:bg-rose-500/10 hover:text-rose-400"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>

                  {voice.tags && voice.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pr-4">
                      {voice.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-md border border-[#223254] bg-[#0b1329] px-2 py-0.5 text-[10px] text-slate-300"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </section>
      </aside>
    </>
  );
}
