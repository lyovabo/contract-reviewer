"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const TONES = {
  neutral: "border-stone-300 text-stone-600 hover:border-stone-500",
  warning: "border-amber-400 bg-amber-50 text-amber-800 hover:border-amber-600",
  danger: "border-red-300 bg-red-50 text-red-700 hover:border-red-500",
};

const MAX_WIDTH = 288;
const MARGIN = 16;

/**
 * An "i" button that shows details in a tooltip: on hover, on keyboard focus, and on tap/click
 * (touch screens have no hover). Escape, moving away, scrolling or resizing closes it. The
 * tooltip is positioned against the viewport and clamped inside it, so it never overflows the
 * screen, gets clipped by a parent, or sits under another element.
 */
export function InfoTip({
  label,
  tone = "neutral",
  children,
}: {
  label: string;
  tone?: keyof typeof TONES;
  children: ReactNode;
}) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);

  const show = () => {
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(MAX_WIDTH, window.innerWidth - 2 * MARGIN);
    const left = Math.min(Math.max(MARGIN, rect.left), window.innerWidth - width - MARGIN);
    setPosition({ top: rect.bottom + 8, left, width });
  };
  const hide = () => setPosition(null);

  useEffect(() => {
    if (!position) return;
    const close = () => setPosition(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [position]);

  return (
    <span className="relative z-10 inline-flex" onMouseEnter={show} onMouseLeave={hide}>
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-describedby={position ? id : undefined}
        className={`flex h-5 w-5 items-center justify-center rounded-full border text-[11px] font-bold leading-none ${TONES[tone]}`}
        onFocus={show}
        onBlur={hide}
        onClick={show}
        onKeyDown={(e) => {
          if (e.key === "Escape") hide();
        }}
      >
        i
      </button>
      {/* Portaled to <body>: outside every row's stacking context, so nothing on the page
          (such as the next row's "i" button) can paint over it. */}
      {position &&
        createPortal(
          <div
            role="tooltip"
            id={id}
            style={{ top: position.top, left: position.left, width: position.width }}
            className="fixed z-50 space-y-1.5 rounded-lg border border-stone-200 bg-white p-3 text-left text-xs font-normal text-stone-700 shadow-lg"
          >
            {children}
          </div>,
          document.body,
        )}
    </span>
  );
}
