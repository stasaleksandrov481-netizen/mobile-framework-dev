"use strict";

const CortexMotion = (() => {
  const ease = "cubic-bezier(.2,.76,.24,1)";

  function dock(control) {
    const icon = control?.querySelector(".nav-icon");
    if (!icon?.animate) return;
    icon.getAnimations().forEach(animation => animation.cancel());
    icon.animate([
      { transform: "translateY(2px) scale(.93)" },
      { transform: "translateY(-2px) scale(1.06)", offset: .64 },
      { transform: "none" }
    ], { duration: 260, easing: ease });
  }

  function core(app) {
    const curtain = document.createElement("div");
    curtain.className = "transition-screen";
    curtain.setAttribute("aria-hidden", "true");
    app.append(curtain);
    const flow = curtain.animate([
      { transform: "translateY(0)", opacity: 1 },
      { transform: "translateY(-18%)", opacity: .94, offset: .27 },
      { transform: "translateY(-105%)", opacity: 0 }
    ], { duration: 495, easing: ease });
    flow.finished.then(() => curtain.remove(), () => curtain.remove());
    return () => { flow.cancel(); curtain.remove(); };
  }

  function page(surface, direction, tab) {
    return surface.animate([
      { opacity: .68, transform: `translate3d(${tab ? 13 * direction : 0}px,${tab ? 5 : 9}px,0) scale(.991)` },
      { opacity: 1, transform: "none" }
    ], { duration: tab ? 277 : 235, easing: ease });
  }

  function revealChat(surface) {
    return surface.animate([
      { opacity: .25, transform: "translateY(18px) scale(.985)" },
      { opacity: 1, transform: "none" }
    ], { duration: 489, easing: ease });
  }

  function reply(body) {
    body.animate([
      { opacity: .48, transform: "translateY(5px)" },
      { opacity: 1, transform: "none" }
    ], { duration: 245, easing: ease });
  }

  const presses = new WeakMap();
  function press(control) {
    if (typeof control.animate !== "function" || control.disabled) return;
    presses.get(control)?.cancel();
    const transform = getComputedStyle(control).transform;
    const base = transform === "none" ? "" : transform + " ";
    const touch = control.matches("summary,.tile,.thread-row") ? "translateX(3px) scale(.993)"
      : control.matches(".icon-btn,.action.primary") ? "scale(.93)" : "translateY(2px) scale(.975)";
    presses.set(control, control.animate([
      { transform: base + touch, filter: "brightness(.86)" },
      { transform, filter: "brightness(1)" }
    ], { duration: 235, easing: ease }));
  }

  return { dock, core, page, revealChat, reply, press };
})();
