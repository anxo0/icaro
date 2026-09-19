import { useEffect, useId, useRef, useState } from 'react';
import IconChevron from '~icons/solar/alt-arrow-down-linear';
import IconCheck from '~icons/solar/check-read-linear';
import IconChip from '~icons/solar/cpu-bolt-linear';
import type { AppStrings } from '@/i18n';
import { LLM_MODELS, type LlmKey } from '@/lib/models';
import type { Device } from '@/lib/types';
import type { DevicePref } from './useIcaro';

interface Props {
  t: AppStrings;
  value: LlmKey;
  onChange: (key: LlmKey) => void;
  device: Device;
  devicePref: DevicePref;
  gpuAvailable: boolean;
  onDevicePref: (pref: DevicePref) => void;
  disabled?: boolean;
}

const KEYS = Object.keys(LLM_MODELS) as LlmKey[];

/** Selector de modelo: botón compacto que abre un menú propio (el <select> nativo desentona). */
export function ModelMenu({ t, value, onChange, device, devicePref, gpuAvailable, onDevicePref, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  void devicePref;
  const current = t.models.options[value];
  const [name] = current.split(' · ');

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        title={`${t.prompt.model} · ${device === 'webgpu' ? t.device.webgpu : t.device.wasm}`}
        className="inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-50"
      >
        <IconChip className={`size-3.5 ${device === 'webgpu' ? 'text-ok' : 'text-warn'}`} aria-hidden="true" />
        <span>{name}</span>
        <IconChevron className={`size-3 text-ink-3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {open && (
        <ul
          id={id}
          role="listbox"
          aria-label={t.prompt.model}
          className="settle hairline absolute bottom-full left-0 z-30 mb-2 w-64 rounded-xl bg-surface p-1 shadow-card"
        >
          {KEYS.map((k) => {
            const [label, note] = t.models.options[k].split(' · ');
            const selected = k === value;
            return (
              <li key={k} role="option" aria-selected={selected}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(k);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-surface-2 ${selected ? 'text-ink' : 'text-ink-2'}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block">{label}</span>
                    <span className="block text-xs text-ink-3">
                      {note} · ≈ {LLM_MODELS[k].sizeMB} MB
                    </span>
                  </span>
                  {selected && <IconCheck className="size-4 shrink-0 text-accent-ink" aria-hidden="true" />}
                </button>
              </li>
            );
          })}
          <li role="presentation" className="hairline-t mt-1 pt-1">
            <p className="label px-2.5 pt-1 pb-1">{t.device.title}</p>
            {(['webgpu', 'wasm'] as const).map((d) => {
              const available = d === 'wasm' || gpuAvailable;
              const selected = device === d;
              return (
                <button
                  key={d}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  disabled={!available}
                  onClick={() => {
                    onDevicePref(d);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-surface-2 disabled:opacity-50 disabled:hover:bg-transparent ${selected ? 'text-ink' : 'text-ink-2'}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block">{d === 'webgpu' ? t.device.gpuOption : t.device.wasmOption}</span>
                    {d === 'webgpu' && !gpuAvailable && <span className="block text-xs text-ink-3">{t.device.unavailable}</span>}
                  </span>
                  {selected && <IconCheck className="size-4 shrink-0 text-accent-ink" aria-hidden="true" />}
                </button>
              );
            })}
            <p className="px-2.5 pt-1 pb-1 text-[11px] text-ink-3">{t.device.reload}</p>
          </li>
        </ul>
      )}
    </div>
  );
}
