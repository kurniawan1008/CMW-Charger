// Modal, dialog konfirmasi, dan sistem toast — satu bahasa motion (scale+fade).
import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type ReactNode,
} from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, CircleCheck, CircleAlert } from 'lucide-react';
import { Button } from './ui';

// ===== Modal =====
export function Modal({
  open, onClose, title, children, wide,
}: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-ink-900/50 p-4 backdrop-blur-[2px]"
          onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ opacity: 0, scale: 0.94, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className={`max-h-[88dvh] w-full overflow-y-auto rounded-card bg-white p-6 shadow-raise ${wide ? 'max-w-2xl' : 'max-w-md'}`}
          >
            <div className="mb-5 flex items-center justify-between">
              <h2 className="font-display text-[17px] font-bold">{title}</h2>
              <button
                onClick={onClose}
                aria-label="Tutup dialog"
                className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl text-ink-400 transition-colors hover:bg-surface-sunken hover:text-ink-600"
              >
                <X size={18} />
              </button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ===== Dialog konfirmasi (aksi destruktif) =====
export function ConfirmDialog({
  open, onClose, onConfirm, title, body, confirmLabel = 'Ya, lanjutkan', danger,
}: {
  open: boolean; onClose: () => void; onConfirm: () => void | Promise<void>;
  title: string; body: string; confirmLabel?: string; danger?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="mb-6 text-sm leading-relaxed text-ink-600">{body}</p>
      <div className="flex justify-end gap-2.5">
        <Button variant="ghost" onClick={onClose}>Batal</Button>
        <Button
          variant={danger ? 'danger' : 'primary'}
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try { await onConfirm(); onClose(); } finally { setBusy(false); }
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

// ===== Toast =====
interface ToastItem { id: number; kind: 'ok' | 'err'; text: string }
const ToastContext = createContext<(kind: 'ok' | 'err', text: string) => void>(() => {});
export const useToast = () => useContext(ToastContext);

let toastSeq = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((kind: 'ok' | 'err', text: string) => {
    const id = toastSeq++;
    setItems((xs) => [...xs, { id, kind, text }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 4000);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-5 right-5 z-[200] flex w-[320px] flex-col gap-2">
        <AnimatePresence>
          {items.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, x: 40, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className={`pointer-events-auto flex items-start gap-2.5 rounded-2xl border p-3.5 shadow-raise backdrop-blur-xl ${t.kind === 'ok' ? 'border-energy-100 bg-white/95' : 'border-danger-50 bg-white/95'}`}
            >
              {t.kind === 'ok'
                ? <CircleCheck size={18} className="mt-0.5 shrink-0 text-energy-600" />
                : <CircleAlert size={18} className="mt-0.5 shrink-0 text-danger-500" />}
              <p className="text-[13px] font-semibold leading-snug text-ink-900">{t.text}</p>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
