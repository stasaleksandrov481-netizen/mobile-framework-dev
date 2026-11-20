"use client";

import { useEffect, useRef } from "react";

function drawWave(context: CanvasRenderingContext2D, width: number, height: number, time: number) {
  context.clearRect(0, 0, width, height);
  const gradient = context.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, "rgba(255,255,255,0)");
  gradient.addColorStop(.26, "rgba(240,240,240,.65)");
  gradient.addColorStop(.49, "rgba(215,215,215,.2)");
  gradient.addColorStop(.72, "rgba(240,240,240,.66)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");

  const drift = Math.sin(time * .67) * .075;
  const curl = Math.sin(time * .53 + 1.4) * .12;
  for (let strand = 0; strand < 19; strand += 1) {
    const ratio = strand / 18;
    const offset = (ratio - .5) * .21;
    const spread = Math.sin(ratio * Math.PI);
    context.beginPath();
    context.moveTo(-width * .07, height * (.78 + offset + drift));
    context.bezierCurveTo(
      width * .26, height * (.99 + offset),
      width * .22, height * (.22 + curl + offset),
      width * .52, height * (.39 + drift + offset * .3),
    );
    context.bezierCurveTo(
      width * .7, height * (.54 - drift + offset * .65),
      width * .82, height * (.11 + curl + offset),
      width * 1.09, height * (.37 - drift + offset * 1.5),
    );
    context.strokeStyle = gradient;
    context.globalAlpha = .07 + spread * .16;
    context.lineWidth = Math.max(1, height * (.009 + spread * .013));
    context.stroke();
  }
  context.globalAlpha = 1;
}

export default function LandingMotion() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const root = canvas?.closest(".landing");
    if (!canvas || !root) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const gallery = root.querySelector<HTMLElement>(".landing-command-grid");
    const context = canvas.getContext("2d");
    let width = 0;
    let height = 0;
    let visible = false;
    let galleryVisible = false;
    let waveFrame = 0;
    let scrollFrame = 0;
    let lastPaint = 0;

    function paint(time: number) {
      if (context && width && height) drawWave(context, width, height, time);
    }

    function animate(now: number) {
      waveFrame = 0;
      if (!visible || reducedMotion.matches || document.hidden) return;
      if (now - lastPaint >= 31) {
        paint(now / 1000);
        lastPaint = now;
      }
      waveFrame = window.requestAnimationFrame(animate);
    }

    function updateGallery() {
      scrollFrame = 0;
      if (!gallery || !galleryVisible || reducedMotion.matches) return;
      const bounds = gallery.getBoundingClientRect();
      const viewport = window.innerHeight;
      const progress = Math.max(-1, Math.min(1, (viewport / 2 - bounds.top) / viewport));
      gallery.style.setProperty("--gallery-shift", `${Math.round(progress * 48)}px`);
    }

    function scroll() {
      if (!scrollFrame && galleryVisible && !reducedMotion.matches) {
        scrollFrame = window.requestAnimationFrame(updateGallery);
      }
    }

    function syncMotion() {
      window.cancelAnimationFrame(waveFrame);
      waveFrame = 0;
      if (visible && !reducedMotion.matches && !document.hidden && context) {
        waveFrame = window.requestAnimationFrame(animate);
      } else if (reducedMotion.matches) {
        gallery?.style.removeProperty("--gallery-shift");
        paint(0);
      }
      scroll();
    }

    const resizeObserver = new ResizeObserver(() => {
      if (!context) return;
      const density = Math.min(window.devicePixelRatio || 1, 1.5);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * density);
      canvas.height = Math.round(height * density);
      context.setTransform(density, 0, 0, density, 0, 0);
      paint(reducedMotion.matches ? 0 : performance.now() / 1000);
      scroll();
    });
    const visibilityObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.target === canvas) {
          visible = entry.isIntersecting;
          syncMotion();
        } else if (entry.target === gallery) {
          galleryVisible = entry.isIntersecting;
          scroll();
        }
      }
    });
    const revealObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting || reducedMotion.matches) continue;
        entry.target.classList.add("landing-motion-seen");
        revealObserver.unobserve(entry.target);
      }
    }, { threshold: .15 });

    resizeObserver.observe(canvas);
    visibilityObserver.observe(canvas);
    if (gallery) visibilityObserver.observe(gallery);
    root.querySelectorAll("[data-landing-reveal]").forEach(element => revealObserver.observe(element));
    window.addEventListener("scroll", scroll, { passive: true });
    window.addEventListener("resize", scroll);
    document.addEventListener("visibilitychange", syncMotion);
    reducedMotion.addEventListener("change", syncMotion);

    return () => {
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      revealObserver.disconnect();
      window.cancelAnimationFrame(waveFrame);
      window.cancelAnimationFrame(scrollFrame);
      window.removeEventListener("scroll", scroll);
      window.removeEventListener("resize", scroll);
      document.removeEventListener("visibilitychange", syncMotion);
      reducedMotion.removeEventListener("change", syncMotion);
    };
  }, []);

  return <canvas ref={canvasRef} className="landing-wave" aria-hidden="true" />;
}
