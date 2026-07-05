import { type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, forwardRef, useId } from 'react';

// ===== Button =====
type BtnVariant = 'primary' | 'energy' | 'ghost' | 'danger' | 'outline';
const btnStyles: Record<BtnVariant, string> = {
  primary:
    'bg-cmw-600 text-white shadow-glow hover:bg-cmw-700 active:scale-[0.97]',
  energy:
    'bg-grad-energy text-white shadow-glow-energy hover:brightness-105 active:scale-[0.97]',
  ghost:
    'bg-transparent text-ink-600 hover:bg-surface-sunken active:scale-[0.97]',
  outline:
    'bg-white border border-line text-ink-900 hover:border-cmw-500 hover:text-cmw-600 active:scale-[0.97]',
  danger:
    'bg-white border border-danger-500 text-danger-500 hover:bg-danger-500 hover:text-white active:scale-[0.97]',
};

export function Button({
  variant = 'primary',
  loading,
  className = '',
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; loading?: boolean }) {
  return (
    <button
      disabled={disabled || loading}
      className={`inline-flex cursor-pointer items-center justify-center gap-2 rounded-control px-5 py-3 text-sm font-bold transition-all duration-200 disabled:pointer-events-none disabled:opacity-45 ${btnStyles[variant]} ${className}`}
      {...props}
    >
      {loading && (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
      {children}
    </button>
  );
}

// ===== Card =====
export function Card({ className = '', children, ...props }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`rounded-card bg-white p-5 shadow-card ${className}`} {...props}>
      {children}
    </div>
  );
}

// ===== Input =====
export const Field = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string }>(
  ({ label, error, hint, id, className = '', ...props }, ref) => {
    // useId cegah tabrakan id bila dua field berlabel sama di satu halaman (audit L1).
    const autoId = useId();
    const fieldId = id || autoId;
    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={fieldId} className="text-[13px] font-bold text-ink-700">
          {label}
        </label>
        <input
          ref={ref}
          id={fieldId}
          className={`rounded-control border bg-white px-4 py-3 text-sm font-medium text-ink-900 outline-none transition-colors placeholder:text-ink-300 focus:border-cmw-500 focus:ring-2 focus:ring-cmw-100 ${error ? 'border-danger-500' : 'border-line'} ${className}`}
          {...props}
        />
        {error ? (
          <p className="text-xs font-semibold text-danger-500" role="alert">{error}</p>
        ) : hint ? (
          <p className="text-xs text-ink-400">{hint}</p>
        ) : null}
      </div>
    );
  },
);
Field.displayName = 'Field';

// ===== Badge status =====
type Tone = 'blue' | 'energy' | 'amber' | 'danger' | 'neutral' | 'sky';
const tones: Record<Tone, string> = {
  blue: 'bg-cmw-100 text-cmw-700',
  energy: 'bg-energy-100 text-energy-700',
  sky: 'bg-sky-100 text-sky-700',
  amber: 'bg-amber-100 text-amber-700',
  danger: 'bg-danger-50 text-danger-700',
  neutral: 'bg-surface-sunken text-ink-600',
};

export function Badge({ tone = 'neutral', pulse, children }: { tone?: Tone; pulse?: boolean; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${tones[tone]}`}>
      {pulse && <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

// ===== Empty state =====
export function Empty({ icon, title, body, action }: { icon: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <div className="mb-1 flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-sunken text-ink-400">
        {icon}
      </div>
      <p className="font-display text-sm font-bold text-ink-700">{title}</p>
      {body && <p className="max-w-xs text-[13px] text-ink-400">{body}</p>}
      {action}
    </div>
  );
}
