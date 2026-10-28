import { useEffect, useRef, type ReactNode } from "react";

import { LAYER_Z_INDEX } from "../../../../packages/ui-kit/layers.ts";

export interface DialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly closeLabel: string;
  readonly children: ReactNode;
  readonly onClose: () => void;
}

/** Modal dialog with a focus trap, Escape-to-close and focus restoration. */
export function Dialog({ open, title, closeLabel, children, onClose }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusable = (): HTMLElement[] => [...(panel?.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])") ?? [])];
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) { event.preventDefault(); return; }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      returnFocus.current?.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="dialog-backdrop" style={{ zIndex: LAYER_Z_INDEX.dialogs }} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} ref={panelRef}>
        <div className="dialog-header">
          <h2 className="section-title">{title}</h2>
          <button type="button" className="button button-ghost button-card" aria-label={closeLabel} data-label={closeLabel} onClick={onClose}>{closeLabel}</button>
        </div>
        <div className="dialog-body">{children}</div>
      </div>
    </div>
  );
}
