"use client";

import { useEffect } from "react";

/**
 * Moves the specular highlight of liquid-glass controls with the pointer.
 * One delegated, rAF-throttled listener; skipped on touch and reduced motion.
 */
export default function GlassPointer() {
  useEffect(() => {
    if (!window.matchMedia?.("(hover: hover) and (pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    let last: PointerEvent | null = null;
    const apply = () => {
      frame = 0;
      const event = last;
      const target = event?.target instanceof Element ? event.target.closest<HTMLElement>(".glass") : null;
      if (!event || !target) return;
      const box = target.getBoundingClientRect();
      target.style.setProperty("--mx", `${Math.round(event.clientX - box.left)}px`);
      target.style.setProperty("--my", `${Math.round(event.clientY - box.top)}px`);
    };
    const onMove = (event: PointerEvent) => {
      last = event;
      if (!frame) frame = window.requestAnimationFrame(apply);
    };
    document.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      document.removeEventListener("pointermove", onMove);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);
  return null;
}
