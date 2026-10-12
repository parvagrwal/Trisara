// Inline SVG glyphs. Every glyph is paired with a text label wherever it is
// used, so these are aria-hidden.

import type { ActionName } from "@/lib/types";

type GlyphProps = { className?: string; size?: number };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 16 16",
  "aria-hidden": true as const,
  focusable: "false" as const,
});

/** ALLOW: filled circle. */
export function AllowGlyph({ className, size = 12 }: GlyphProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="8" cy="8" r="5.5" fill="currentColor" />
    </svg>
  );
}

/** CAP: a bar with an end stop. */
export function CapGlyph({ className, size = 12 }: GlyphProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="1.5" y="6.5" width="10" height="3" fill="currentColor" />
      <rect x="12.5" y="2.5" width="2" height="11" fill="currentColor" />
    </svg>
  );
}

/** COLLAR: two brackets. */
export function CollarGlyph({ className, size = 12 }: GlyphProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M5.5 2.5H2.5V13.5H5.5M10.5 2.5H13.5V13.5H10.5" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

/** DEFER: hourglass. */
export function DeferGlyph({ className, size = 12 }: GlyphProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M3 1.75H13M3 14.25H13" stroke="currentColor" strokeWidth="1.75" />
      <path d="M4.25 2.5H11.75L8 8L11.75 13.5H4.25L8 8Z" fill="currentColor" />
    </svg>
  );
}

/** HALT: octagon. */
export function HaltGlyph({ className, size = 12 }: GlyphProps) {
  return (
    <svg {...base(size)} className={className}>
      {/* Octagon with a bar cut out, so it never reads as ALLOW's filled circle. */}
      <path d="M5.4 1.5H10.6L14.5 5.4V10.6L10.6 14.5H5.4L1.5 10.6V5.4Z M4 6.75V9.25H12V6.75Z" fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}

/** Unknown action: dashed square. */
export function UnknownGlyph({ className, size = 12 }: GlyphProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="2" y="2" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.75" strokeDasharray="2.5 2" />
    </svg>
  );
}

export function ActionGlyph({ action, className, size }: GlyphProps & { action: ActionName }) {
  switch (action) {
    case "ALLOW":
      return <AllowGlyph className={className} size={size} />;
    case "CAP":
      return <CapGlyph className={className} size={size} />;
    case "COLLAR":
      return <CollarGlyph className={className} size={size} />;
    case "DEFER":
      return <DeferGlyph className={className} size={size} />;
    case "HALT":
      return <HaltGlyph className={className} size={size} />;
    default:
      return <UnknownGlyph className={className} size={size} />;
  }
}

/** Session OPEN: a running escapement tick (circle with a notch). */
export function OpenGlyph({ className, size = 12 }: GlyphProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="8" cy="8" r="2.5" fill="currentColor" />
    </svg>
  );
}

/** Session CLOSED: padlock (the held tick). */
export function LockGlyph({ className, size = 12 }: GlyphProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" strokeWidth="1.75" />
      <rect x="3" y="7" width="10" height="7.5" rx="1" fill="currentColor" />
    </svg>
  );
}

/** Chain down: a broken link. */
export function DownGlyph({ className, size = 12 }: GlyphProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M2.5 2.5L13.5 13.5M13.5 2.5L2.5 13.5" stroke="currentColor" strokeWidth="2.25" />
    </svg>
  );
}

export function CheckGlyph({ className, size = 12 }: GlyphProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M2.5 8.5L6.5 12.5L13.5 3.5" fill="none" stroke="currentColor" strokeWidth="2.25" />
    </svg>
  );
}

export function CopyGlyph({ className, size = 12 }: GlyphProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="5" y="5" width="9" height="9" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M11 3V2H2V11H3" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function ExternalGlyph({ className, size = 10 }: GlyphProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M6 3H3V13H13V10M9 3H13V7M13 3L7 9" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
