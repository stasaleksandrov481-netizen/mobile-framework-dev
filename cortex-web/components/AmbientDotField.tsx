"use client";

import { useEffect, useRef } from "react";

/** An unobtrusive, transparent full-page dot field with a slow travelling wave. */
export default function AmbientDotField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    const ctx = canvas?.getContext("2d", { alpha: true, desynchronized: true });
    if (!canvas || !host || !ctx) return;

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let active = true;
    let visible = true;
    let frame = 0;
    let width = 0;
    let height = 0;
    let lastDraw = -Infinity;

    const draw = (now: number) => {
      if (!width || !height) return;
      ctx.clearRect(0, 0, width, height);
      const spacing = Math.max(width < 600 ? 30 : 34, width / 96);
      const amplitude = motion.matches ? 0 : width < 600 ? 3.5 : 7.5;
      const phase = now * .00048;
      ctx.fillStyle = "#c7c7c7";

      for (let y = spacing / 2, row = 0; y < height; y += spacing, row++) {
        // Keep the dots faint. The centre fades further via a CSS mask so copy
        // remains legible even as the wave crosses the hero.
        ctx.globalAlpha = .205 + .045 * Math.sin(row * .31 + phase * .4) ** 2;
        ctx.beginPath();
        for (let x = spacing / 2; x < width; x += spacing) {
          const wave = Math.sin(x * .012 - phase + Math.sin(y * .009 + phase * .6));
          const dx = amplitude * .34 * Math.cos(y * .014 + phase * .8);
          const dy = amplitude * wave;
          ctx.moveTo(x + dx + 1.2, y + dy);
          ctx.arc(x + dx, y + dy, 1.2, 0, Math.PI * 2);
        }
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    const tick = (now: number) => {
      frame = 0;
      if (!active || !visible || document.hidden || motion.matches) return;
      // 24fps on desktop, 16fps on phones; no extra work offscreen.
      if (now - lastDraw >= (width < 700 ? 62 : 42)) {
        draw(now);
        lastDraw = now;
      }
      frame = requestAnimationFrame(tick);
    };

    const schedule = () => {
      if (!frame && active && visible && !document.hidden && !motion.matches) frame = requestAnimationFrame(tick);
    };

    const resize = () => {
      const bounds = host.getBoundingClientRect();
      const nextWidth = Math.max(1, Math.round(bounds.width));
      const nextHeight = Math.max(1, Math.round(bounds.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      if (canvas.width !== Math.round(nextWidth * dpr) || canvas.height !== Math.round(nextHeight * dpr)) {
        width = nextWidth;
        height = nextHeight;
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      draw(performance.now());
      schedule();
    };

    const onVisibility = () => {
      if (document.hidden && frame) { cancelAnimationFrame(frame); frame = 0; }
      else schedule();
    };
    const onMotion = () => {
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
      draw(performance.now());
      schedule();
    };
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (!visible && frame) { cancelAnimationFrame(frame); frame = 0; }
      else schedule();
    }, { threshold: .01 });
    const size = new ResizeObserver(resize);
    intersection.observe(host);
    size.observe(host);
    document.addEventListener("visibilitychange", onVisibility);
    motion.addEventListener("change", onMotion);
    resize();

    return () => {
      active = false;
      if (frame) cancelAnimationFrame(frame);
      intersection.disconnect();
      size.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      motion.removeEventListener("change", onMotion);
    };
  }, []);

  return <canvas className="ambient-dot-field" ref={canvasRef} aria-hidden="true" />;
}
