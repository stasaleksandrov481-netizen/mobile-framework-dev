"use strict";

const CortexMotion = (() => {
  const ease = "cubic-bezier(.2,.76,.24,1)";
  const coreDuration = 640;

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

  function core(app, from, to) {
    if (!from?.w || !to?.w) return null;
    const glass = document.createElement("div");
    glass.className = "transition-core";
    glass.setAttribute("aria-hidden", "true");
    const mark = document.createElement("img");
    mark.src = "art/mark.svg";
    mark.alt = "";
    glass.append(mark);
    const x = from.x + from.w / 2, y = from.y + from.h / 2;
    const dx = to.x + to.w / 2 - x, dy = to.y + to.h / 2 - y;
    glass.style.cssText = `left:${x}px;top:${y}px;width:${from.w}px`;
    app.append(glass);
    const transform = (travel, width, height, angle, bend = 0) =>
      `translate(-50%,-50%) translate3d(${dx * travel + bend}px,${dy * travel}px,0) rotate(${angle}deg) scale(${width},${height})`;
    const end = to.w / from.w;
    const curve = Math.min(33, Math.abs(dy) * .07);
    const flight = glass.animate([
      { transform: transform(0, 1.06, 1.06, 0), opacity: 1, borderRadius: "50%", easing: "ease-out" },
      { transform: transform(.05, 1.36, .84, -9, -7), opacity: 1, borderRadius: "44% 56% 49% 51%", offset: .16, easing: ease },
      { transform: transform(.55, .84, 1.47, -15, curve), opacity: .98, borderRadius: "54% 46% 48% 52%", offset: .51, easing: "ease-in-out" },
      { transform: transform(.97, end * 1.83, end * 1.48, 4, 6), opacity: .95, borderRadius: "50%", offset: .76, easing: ease },
      { transform: transform(1, end * 1.46, end * 1.46, 0), opacity: 0, borderRadius: "50%" }
    ], { duration: coreDuration, fill: "both" });
    const clear = () => { flight.cancel(); glass.remove(); };
    flight.finished.then(() => glass.remove(), () => glass.remove());
    return clear;
  }

  function page(surface, direction, tab) {
    return surface.animate([
      { opacity: .68, transform: `translate3d(${tab ? 13 * direction : 0}px,${tab ? 5 : 9}px,0) scale(.991)` },
      { opacity: 1, transform: "none" }
    ], { duration: tab ? 277 : 235, easing: ease });
  }

  function revealChat(conversation) {
    return conversation?.animate([
      { opacity: 0, transform: "translateY(17px) scale(.987)" },
      { opacity: 1, transform: "none" }
    ], { duration: 475, delay: 122, fill: "backwards", easing: ease });
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
    presses.set(control, control.animate([
      { transform: base + "scale(.965,.95)" },
      { transform }
    ], { duration: 255, easing: ease }));
  }

  return { dock, core, coreDuration, page, revealChat, reply, press };
})();
