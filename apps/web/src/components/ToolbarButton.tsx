import { useEffect, useRef, useState } from "react";

// L00 (P6-04): icon button with a 300 ms tooltip. The tooltip is a real element
// (role=tooltip, aria-describedby) shown after hover/focus, hidden on leave/blur
// or Escape; the label comes from the message catalog.
export interface ToolbarButtonProps {
  readonly icon: string;
  readonly label: string;
  readonly pressed: boolean;
  readonly onSelect: () => void;
}
export function ToolbarButton({ icon, label, pressed, onSelect }: ToolbarButtonProps) {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);
  const id = useIdRef();
  const clear = () => { if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; } };
  const show = () => { clear(); timer.current = window.setTimeout(() => setOpen(true), 300); };
  const hide = () => { clear(); setOpen(false); };
  useEffect(() => () => clear(), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") hide(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <span className="toolbar-button-wrap">
      <button type="button" className={pressed ? "icon-button icon-button-bar active" : "icon-button icon-button-bar"} aria-label={label} data-label={label} aria-pressed={pressed} aria-describedby={open ? id : undefined} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide} onClick={() => { hide(); onSelect(); }}>
        <img className="icon" src={icon} alt="" aria-hidden="true" />
      </button>
      {open ? <span role="tooltip" id={id} className="tooltip">{label}</span> : null}
    </span>
  );
}
function useIdRef(): string {
  const [id] = useState(() => `tooltip-${Math.random().toString(36).slice(2, 10)}`);
  return id;
}
