"use client";

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="max-w-2xl w-full max-h-[85vh] overflow-y-auto bg-surface border border-line rounded-sm p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-2xl uppercase tracking-wide">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="font-mono text-xs border border-line rounded-sm px-2 py-1 hover:bg-surface2"
          >
            ESC
          </button>
        </div>
        <div className="text-sm text-[#aeab9f] leading-relaxed space-y-3">{children}</div>
      </div>
    </div>
  );
}
