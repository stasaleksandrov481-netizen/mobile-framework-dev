"use client";

import { useEffect, useRef } from "react";

type Ripple = { x: number; y: number; start: number };

/** Canvas mesh with adaptive geometry: full resolution only near interaction. */
export default function InteractiveGrid() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const panel = canvas?.parentElement;
    const ctx = canvas?.getContext("2d", { alpha: false, desynchronized: true });
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
    let bounds = panel.getBoundingClientRect();
    let lastDpr = 0;
    const ripples: Ripple[] = [];

    const warp = (x: number, y: number, radius: number, radiusSq: number): [number, number] => {
      const dx = x - pointer.x;
      const dy = y - pointer.y;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq >= radiusSq || distanceSq < .01) return [x, y];
      const distance = Math.sqrt(distanceSq);
      const proximity = 1 - distance / radius;
      const intensity = proximity * proximity * 30;
      return [x + dx / distance * intensity, y + dy / distance * intensity];
    };

    const render = (now: number) => {
      if (!active || !width || !height) return;
      pointer.x += (target.x - pointer.x) * (reducedMotion ? 1 : .16);
      pointer.y += (target.y - pointer.y) * (reducedMotion ? 1 : .16);

      ctx.fillStyle = "#080808";
      ctx.fillRect(0, 0, width, height);

      const glow = ctx.createRadialGradient(pointer.x, pointer.y, 2, pointer.x, pointer.y, Math.max(230, width * .55));
      glow.addColorStop(0, "rgba(91, 91, 91, .18)");
      glow.addColorStop(.55, "rgba(37, 37, 37, .08)");
      glow.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);

      const cell = width < 600 ? 36 : 49;
      const radius = reducedMotion ? 0 : Math.min(270, Math.max(160, width * .35));
      const radiusSq = radius * radius;
      const stride = width < 900 ? 24 : 18;
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(202, 202, 202, .115)";
      ctx.beginPath();

      // Straight segments outside the warp radius need only two vertices.
      // Before this optimization every line sampled the entire viewport.
      const trace = (fixed: number, vertical: boolean) => {
        const focus = vertical ? pointer.y : pointer.x;
        const distance = Math.abs(fixed - (vertical ? pointer.x : pointer.y));
        const end = (vertical ? height : width) + cell;
        const start = -cell;
        const vertex = (variable: number): [number, number] =>
          vertical ? [fixed, variable] : [variable, fixed];
        const moveTo = (variable: number) => {
          const [x, y] = vertex(variable);
          ctx.lineTo(x, y);
        };

        const [startX, startY] = vertex(start);
        ctx.moveTo(startX, startY);
        if (distance >= radius) { moveTo(end); return; }

        const halfSpan = Math.sqrt(radiusSq - distance * distance);
        const from = Math.max(start, focus - halfSpan);
        const to = Math.min(end, focus + halfSpan);
        if (to <= from) { moveTo(end); return; }

        moveTo(from);
        for (let v = from + stride; v < to; v += stride) {
          const [x, y] = vertex(v);
          const [wx, wy] = warp(x, y, radius, radiusSq);
          ctx.lineTo(wx, wy);
        }
        moveTo(to);
        moveTo(end);
      };

      for (let x = -cell; x <= width + cell; x += cell) trace(x, true);
      for (let y = -cell; y <= height + cell; y += cell) trace(y, false);
      ctx.stroke();

      for (let x = 0; x < width + cell; x += cell) {
        for (let y = 0; y < height + cell; y += cell) {
          if ((Math.round(x / cell) + Math.round(y / cell)) % 3 !== 0) continue;
          const [wx, wy] = warp(x, y, radius, radiusSq);
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
      const interval = width < 900 ? 32 : 16;
      if (now - lastDraw >= interval) { render(now); lastDraw = now; }
      // Once the cursor has settled and all click ripples have faded, stop drawing.
      if (Math.hypot(target.x - pointer.x, target.y - pointer.y) > .6 || ripples.length) schedule();
    };

    const schedule = () => {
      if (!frame && active && inView && !document.hidden) frame = requestAnimationFrame(tick);
    };

    const resize = () => {
      const rect = panel.getBoundingClientRect();
      bounds = rect;
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      const dpr = Math.min(window.devicePixelRatio || 1, width < 900 ? 1.25 : 1.5);
      if (Math.abs(canvas.width - Math.round(width * dpr)) < 1 &&
          Math.abs(canvas.height - Math.round(height * dpr)) < 1 && lastDpr === dpr) return;
      lastDpr = dpr;
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
      if (reducedMotion) return;
      target.x = clientX - bounds.left;
      target.y = clientY - bounds.top;
      schedule();
    };
    const onPointerMove = (event: PointerEvent) => move(event.clientX, event.clientY);
    const onPointerDown = (event: PointerEvent) => {
      if (reducedMotion) return;
      move(event.clientX, event.clientY);
      if (ripples.length >= 3) ripples.shift();
      ripples.push({ x: target.x, y: target.y, start: performance.now() });
      schedule();
    };
    const onLeave = () => {
      target.x = width * .5;
      target.y = height * .5;
      schedule();
    };
    const onVisibility = () => {
      if (document.hidden && frame) { cancelAnimationFrame(frame); frame = 0; }
      else schedule();
    };
    const onScroll = () => { bounds = panel.getBoundingClientRect(); };
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
    window.addEventListener("scroll", onScroll, { passive: true });
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
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas ref={canvasRef} className="interactive-grid" aria-hidden="true" />;
}
