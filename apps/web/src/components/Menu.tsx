import { useEffect, useRef, useState } from "react";

import { LAYER_Z_INDEX } from "../../../../packages/ui-kit/layers.ts";
import { Button } from "./Button.tsx";

export interface MenuItem {
  readonly label: string;
  readonly onSelect: () => void;
}

export interface MenuProps {
  readonly label: string;
  readonly dataLabel: string;
  readonly items: readonly MenuItem[];
  readonly emptyLabel: string;
}

/** Small action menu: Escape closes, focus returns to the trigger, arrow keys move. */
export function Menu({ label, dataLabel, items, emptyLabel }: MenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const first = containerRef.current?.querySelector<HTMLElement>("[role=menuitem]");
    first?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") { setOpen(false); triggerRef.current?.focus(); }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const focusable = [...(containerRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
      if (focusable.length === 0) return;
      const index = focusable.indexOf(document.activeElement as HTMLElement);
      const next = event.key === "ArrowDown" ? (index + 1) % focusable.length : (index - 1 + focusable.length) % focusable.length;
      focusable[next]?.focus();
      event.preventDefault();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);
  return (
    <div className="menu" ref={containerRef}>
      <Button ref={triggerRef} variant="ghost" size="card" aria-haspopup="menu" aria-expanded={open} aria-label={label} data-label={dataLabel} onClick={() => setOpen((value) => !value)}>
        {label}
      </Button>
      {open ? (
        <div className="menu-list" role="menu" aria-label={label} style={{ zIndex: LAYER_Z_INDEX["context-menu"] }}>
          {items.length === 0 ? <p className="menu-empty muted small">{emptyLabel}</p> : items.map((item) => (
            <button key={item.label} type="button" role="menuitem" className="menu-item" onClick={() => { setOpen(false); item.onSelect(); }}>
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
