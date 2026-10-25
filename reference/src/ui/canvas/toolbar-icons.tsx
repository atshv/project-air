import type { ReactNode } from "react";

/** Icon names of the canvas toolbar, one per tool. */
export type ToolIconName =
  | "note"
  | "source"
  | "image"
  | "file"
  | "zone"
  | "checklist"
  | "palette"
  | "columns"
  | "timeline"
  | "table";

/** 24×24 stroke paths; colour comes from `currentColor`. */
const PATHS: Record<ToolIconName, ReactNode> = {
  note: (
    <>
      <path d="M5 4h14v10l-5 6H5z" />
      <path d="M14 20v-6h5" />
      <path d="M8.5 8.5h7M8.5 12h4" />
    </>
  ),
  source: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </>
  ),
  image: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M20.5 16l-5-5-8.5 8" />
    </>
  ),
  file: (
    <>
      <path d="M7 3.5h6.5L18 8v12.5H7z" />
      <path d="M13.5 3.5V8H18" />
      <path d="M9.5 13h6M9.5 16.5h4" />
    </>
  ),
  zone: (
    <rect
      x="3.5"
      y="4.5"
      width="17"
      height="15"
      rx="3"
      strokeDasharray="3 2.5"
    />
  ),
  checklist: (
    <>
      <path d="M4 7l1.6 1.6L8.5 5.5" />
      <path d="M4 15l1.6 1.6 2.9-3.1" />
      <path d="M11.5 7h8.5M11.5 15h8.5" />
    </>
  ),
  palette: (
    <>
      <path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.3 0 2-.8 2-1.8 0-1.4-1.2-1.7-1.2-2.9 0-1 .8-1.8 1.8-1.8h2.2a3.7 3.7 0 0 0 3.7-3.7C20.5 6.6 16.7 3.5 12 3.5z" />
      <circle cx="7.8" cy="11" r="1" />
      <circle cx="10.5" cy="7.3" r="1" />
      <circle cx="15" cy="7.8" r="1" />
    </>
  ),
  columns: (
    <>
      <rect x="3.5" y="4.5" width="4.5" height="15" rx="1.5" />
      <rect x="9.75" y="4.5" width="4.5" height="10" rx="1.5" />
      <rect x="16" y="4.5" width="4.5" height="12.5" rx="1.5" />
    </>
  ),
  timeline: (
    <>
      <path d="M3 12h18" />
      <circle cx="6.5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="17.5" cy="12" r="1.8" />
      <path d="M6.5 6.5v3.7M17.5 6.5v3.7M12 13.8v3.7" />
    </>
  ),
  table: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M3.5 9.5h17M3.5 14.5h17M9.5 9.5v10" />
    </>
  ),
};

/** Decorative tool icon; the button around it carries the accessible name. */
export function ToolIcon({ name, size = 20 }: { name: ToolIconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
