import { type ReactNode, useEffect } from 'react';

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export default function Modal({ open, title, onClose, children }: ModalProps) {
  useEffect(() => {
    if (!open) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-modal-backdrop p-4"
      onClick={onClose}
    >
      <div
        className="pc-card animate-modal-in max-w-md w-full p-7"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <h3 className="text-lg font-bold text-[var(--color-ink-900)] mb-4">{title}</h3>
        <div className="text-sm text-[var(--color-ink-600)] mb-6 leading-relaxed">{children}</div>
        <div className="flex justify-end">
          <button
            onClick={onClose}
            autoFocus
            className="pc-btn-primary"
          >
            确定
          </button>
        </div>
      </div>
    </div>
  );
}
