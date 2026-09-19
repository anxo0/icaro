import { useId, useState, type ReactNode } from 'react';
import IconChevron from '~icons/solar/alt-arrow-down-linear';
import IconCheck from '~icons/solar/check-circle-bold';
import IconError from '~icons/solar/danger-circle-bold';
import IconDot from '~icons/solar/record-circle-linear';
import IconSpinner from '~icons/solar/refresh-circle-linear';

export type StepStatus = 'pending' | 'active' | 'done' | 'error';

export interface Step {
  key: string;
  label: string;
  detail?: string;
  status: StepStatus;
  /** 0–100 si el paso tiene progreso medible. */
  progress?: number;
}

interface Props {
  /** Mientras trabaja: texto con brillo y lista de pasos visible. */
  working: boolean;
  label: string;
  /** Al terminar: resumen plegable. */
  summary: string;
  steps: Step[];
  tone?: 'neutral' | 'bad';
  defaultOpen?: boolean;
  /** Se abre desde fuera (p. ej. al pulsar una cita). */
  forceOpen?: boolean;
  children?: ReactNode;
}

function StepIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case 'done':
      return <IconCheck className="size-4 text-ok" />;
    case 'active':
      return <IconSpinner className="spin size-4 text-accent-ink" />;
    case 'error':
      return <IconError className="size-4 text-bad" />;
    default:
      return <IconDot className="size-4 text-ink-3" />;
  }
}

/** Traza de actividad de Ícaro: qué está haciendo ahora y, al acabar, un resumen plegable. */
export function Activity({ working, label, summary, steps, tone = 'neutral', defaultOpen = false, forceOpen, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const expanded = working || open || !!forceOpen;

  return (
    <div className="w-full text-sm" data-state={working ? 'working' : expanded ? 'open' : 'closed'}>
      {working ? (
        <p role="status" aria-live="polite" className="flex h-7 items-center gap-2">
          <IconSpinner className="spin size-4 text-accent-ink" aria-hidden="true" />
          <span className="shimmer font-medium">{label}</span>
        </p>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={expanded}
          aria-controls={id}
          className={`group flex h-7 min-w-0 items-center gap-1.5 rounded-md text-left transition-colors ${tone === 'bad' ? 'text-bad' : 'text-ink-2 hover:text-ink'}`}
        >
          <span className="truncate">{summary}</span>
          <IconChevron className={`size-3.5 shrink-0 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
      )}

      <div
        id={id}
        role="region"
        aria-busy={working}
        className="grid transition-[grid-template-rows] duration-300 ease-out"
        style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
      >
        <div className="min-h-0 overflow-hidden">
          {steps.length > 0 && (
            <ol role="list" className="space-y-0.5 py-1.5">
              {steps.map((s) => (
                <li key={s.key} className={`settle flex items-start gap-2 py-0.5 ${s.status === 'pending' ? 'text-ink-3' : 'text-ink-2'}`}>
                  <span className="mt-0.5 shrink-0">
                    <StepIcon status={s.status} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={s.status === 'active' ? 'text-ink' : ''}>{s.label}</span>
                    {s.detail && <span className="ml-1.5 text-ink-3">{s.detail}</span>}
                    {s.status === 'active' && typeof s.progress === 'number' && (
                      <span className="mt-1.5 block h-1 max-w-64 overflow-hidden rounded-full bg-line" aria-hidden="true">
                        <span className="block h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${Math.max(2, Math.min(100, s.progress))}%` }} />
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}
