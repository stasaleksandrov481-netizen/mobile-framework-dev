"use client";

import { useEffect, useRef } from "react";

type Ripple = { x: number; y: number; start: number };

/** Event-driven cursor/touch mesh: no WebGL or idle animation loop. */
export default function InteractiveGrid() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const panel = canvas?.parentElement;
    const ctx = canvas?.getContext("2d", { alpha: false });
    if (!canvas || !panel || !ctx) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const pointer = { x: 0, y: 0 };
    const target = { x: 0, y: 0 };
    let width = 0;
    let height = 0;
    let frame = 0;
    let inView = true;
    let active = true;
    let lastDraw = -Infinity;
    const ripples: Ripple[] = [];

    const warp = (x: number, y: number): [number, number] => {
      const dx = x - pointer.x;
      const dy = y - pointer.y;
      const distance = Math.hypot(dx, dy);
      const radius = Math.min(270, Math.max(160, width * .35));
      if (distance >= radius || distance === 0) return [x, y];
      const intensity = Math.pow(1 - distance / radius, 2) * 32;
      return [x + dx / distance * intensity, y + dy / distance * intensity];
    };

    const render = (now: number) => {
      if (!active || !width || !height) return;
      pointer.x += (target.x - pointer.x) * (reducedMotion ? 1 : .085);
      pointer.y += (target.y - pointer.y) * (reducedMotion ? 1 : .085);

      ctx.fillStyle = "#080808";
      ctx.fillRect(0, 0, width, height);

      const glow = ctx.createRadialGradient(pointer.x, pointer.y, 2, pointer.x, pointer.y, Math.max(230, width * .55));
      glow.addColorStop(0, "rgba(91, 91, 91, .18)");
      glow.addColorStop(.55, "rgba(37, 37, 37, .08)");
      glow.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);

      const cell = width < 600 ? 36 : 49;
      const stride = 14;
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(202, 202, 202, .12)";

      for (let x = -cell; x <= width + cell; x += cell) {
        ctx.beginPath();
        for (let y = -cell, first = true; y <= height + cell; y += stride) {
          const [wx, wy] = warp(x, y);
          if (first) { ctx.moveTo(wx, wy); first = false; }
          else ctx.lineTo(wx, wy);
        }
        ctx.stroke();
      }
      for (let y = -cell; y <= height + cell; y += cell) {
        ctx.beginPath();
        for (let x = -cell, first = true; x <= width + cell; x += stride) {
          const [wx, wy] = warp(x, y);
          if (first) { ctx.moveTo(wx, wy); first = false; }
          else ctx.lineTo(wx, wy);
        }
        ctx.stroke();
      }

      for (let x = 0; x < width + cell; x += cell) {
        for (let y = 0; y < height + cell; y += cell) {
          if ((Math.round(x / cell) + Math.round(y / cell)) % 3 !== 0) continue;
          const [wx, wy] = warp(x, y);
          const proximity = Math.max(0, 1 - Math.hypot(x - pointer.x, y - pointer.y) / 230);
          ctx.beginPath();
          ctx.arc(wx, wy, proximity > .15 ? 1.4 : .75, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(235,235,235,${.13 + proximity * .55})`;
          ctx.fill();
        }
      }

      for (let i = ripples.length - 1; i >= 0; i--) {
        const ripple = ripples[i];
        const progress = Math.min(1, (now - ripple.start) / 850);
        if (progress >= 1) { ripples.splice(i, 1); continue; }
        ctx.beginPath();
        ctx.arc(ripple.x, ripple.y, 10 + progress * 145, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(245,245,245,${(1 - progress) * .4})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    };

    const tick = (now: number) => {
      frame = 0;
      if (!active || !inView || document.hidden) return;
      if (now - lastDraw >= 33) { render(now); lastDraw = now; }
      // Once the cursor has settled and all click ripples have faded, stop drawing.
      if (Math.hypot(target.x - pointer.x, target.y - pointer.y) > .6 || ripples.length) schedule();
    };

    const schedule = () => {
      if (!frame && active && inView && !document.hidden) frame = requestAnimationFrame(tick);
    };

    const resize = () => {
      const rect = panel.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!target.x && !target.y) {
        pointer.x = target.x = width * .5;
        pointer.y = target.y = height * .5;
      }
      render(performance.now());
      schedule();
    };

    const move = (clientX: number, clientY: number) => {
      const rect = panel.getBoundingClientRect();
      target.x = clientX - rect.left;
      target.y = clientY - rect.top;
      if (reducedMotion) { render(performance.now()); }
      else schedule();
    };
    const onPointerMove = (event: PointerEvent) => move(event.clientX, event.clientY);
    const onTouchMove = (event: TouchEvent) => {
      if (event.touches.length) move(event.touches[0].clientX, event.touches[0].clientY);
    };
    const onPointerDown = (event: PointerEvent) => {
      move(event.clientX, event.clientY);
      ripples.push({ x: target.x, y: target.y, start: performance.now() });
      schedule();
    };
    const onLeave = () => {
      target.x = width * .5;
      target.y = height * .5;
      schedule();
    };
    const onVisibility = () => schedule();
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      if (!inView && frame) { cancelAnimationFrame(frame); frame = 0; }
      if (inView) schedule();
    }, { threshold: .01 });
    const resizeObserver = new ResizeObserver(resize);

    resizeObserver.observe(panel);
    observer.observe(panel);
    panel.addEventListener("pointermove", onPointerMove);
    panel.addEventListener("pointerdown", onPointerDown);
    panel.addEventListener("pointerleave", onLeave);
    panel.addEventListener("touchmove", onTouchMove, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    resize();

    return () => {
      active = false;
      if (frame) cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      observer.disconnect();
      panel.removeEventListener("pointermove", onPointerMove);
      panel.removeEventListener("pointerdown", onPointerDown);
      panel.removeEventListener("pointerleave", onLeave);
      panel.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas ref={canvasRef} className="interactive-grid" aria-hidden="true" />;
}
