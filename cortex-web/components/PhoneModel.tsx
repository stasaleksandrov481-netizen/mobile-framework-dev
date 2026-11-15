"use client";

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

type Rotation = { x: number; y: number };
const INITIAL: Rotation = { x: -0.095, y: -0.43 };
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function roundedScreenGeometry(width: number, height: number, radius: number) {
  const left = -width / 2;
  const bottom = -height / 2;
  const right = width / 2;
  const top = height / 2;
  const shape = new THREE.Shape();
  shape.moveTo(left + radius, bottom);
  shape.lineTo(right - radius, bottom);
  shape.quadraticCurveTo(right, bottom, right, bottom + radius);
  shape.lineTo(right, top - radius);
  shape.quadraticCurveTo(right, top, right - radius, top);
  shape.lineTo(left + radius, top);
  shape.quadraticCurveTo(left, top, left, top - radius);
  shape.lineTo(left, bottom + radius);
  shape.quadraticCurveTo(left, bottom, left + radius, bottom);
  const geometry = new THREE.ShapeGeometry(shape, 12);
  const positions = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  for (let index = 0; index < positions.count; index++) {
    uv.setXY(index, (positions.getX(index) - left) / width, (positions.getY(index) - bottom) / height);
  }
  return geometry;
}

function createBackMark() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 180;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.textAlign = "center";
    ctx.fillStyle = "#666666";
    ctx.font = "700 58px Arial, sans-serif";
    ctx.fillText("CORTEX", 256, 95);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function buildPhone(scene: THREE.Scene) {
  const phone = new THREE.Group();
  const metal = new THREE.MeshPhysicalMaterial({
    color: 0x0c0c0c, metalness: 0.78, roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.2,
  });
  const polishedBlack = new THREE.MeshPhysicalMaterial({
    color: 0x030303, metalness: 0.38, roughness: 0.19, clearcoat: 0.9, clearcoatRoughness: 0.12,
  });
  const frostedBack = new THREE.MeshPhysicalMaterial({
    color: 0x101010, metalness: 0.5, roughness: 0.34, clearcoat: 0.55,
  });
  const silver = new THREE.MeshPhysicalMaterial({
    color: 0xdedede, metalness: 0.72, roughness: 0.22, clearcoat: 0.6,
  });

  // A slim graphite unibody with real depth and a dark ceramic front.
  phone.add(new THREE.Mesh(new RoundedBoxGeometry(3.15, 6.52, 0.41, 9, 0.31), metal));
  const frame = new THREE.Mesh(new RoundedBoxGeometry(3.095, 6.47, 0.075, 8, 0.292), polishedBlack);
  frame.position.z = 0.211;
  phone.add(frame);
  const back = new THREE.Mesh(new RoundedBoxGeometry(3.065, 6.44, 0.075, 8, 0.29), frostedBack);
  back.position.z = -0.212;
  phone.add(back);

  // The home interface mirrors app/src/main/assets/web/screens.js and style.css.
  const screen = new THREE.TextureLoader().load("/phone-ui.svg");
  screen.colorSpace = THREE.SRGBColorSpace;
  screen.anisotropy = 16;
  const display = new THREE.Mesh(
    roundedScreenGeometry(2.905, 6.36, 0.27),
    new THREE.MeshBasicMaterial({ map: screen, toneMapped: false, depthWrite: false, side: THREE.DoubleSide }),
  );
  display.position.z = 0.254;
  phone.add(display);

  const island = new THREE.Mesh(new RoundedBoxGeometry(0.66, 0.14, 0.028, 5, 0.065), polishedBlack);
  island.position.set(0, 2.99, 0.274);
  phone.add(island);
  const islandLens = new THREE.Mesh(new THREE.SphereGeometry(0.017, 12, 10), new THREE.MeshBasicMaterial({ color: 0x626b72 }));
  islandLens.position.set(0.205, 2.99, 0.29);
  phone.add(islandLens);

  // The raised camera island and individual lenses are physically modeled.
  const cameraIsland = new THREE.Mesh(new RoundedBoxGeometry(1.13, 1.32, 0.16, 7, 0.21), polishedBlack);
  cameraIsland.position.set(-0.76, 2.17, -0.30);
  phone.add(cameraIsland);
  const ringMat = new THREE.MeshStandardMaterial({ color: 0x646464, metalness: 0.89, roughness: 0.22 });
  const lensMat = new THREE.MeshPhysicalMaterial({ color: 0x010307, metalness: 0.63, roughness: 0.065, clearcoat: 1 });
  const glintMat = new THREE.MeshBasicMaterial({ color: 0xb7c2cc, transparent: true, opacity: 0.27 });
  for (const [x, y] of [[-1.02, 2.43], [-0.5, 2.43], [-1.02, 1.94]]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.177, 0.027, 11, 50), ringMat);
    ring.position.set(x, y, -0.394);
    phone.add(ring);
    const optic = new THREE.Mesh(new THREE.CircleGeometry(0.154, 50), lensMat);
    optic.position.set(x, y, -0.401);
    optic.rotation.y = Math.PI;
    phone.add(optic);
    const glint = new THREE.Mesh(new THREE.CircleGeometry(0.03, 20), glintMat);
    glint.position.set(x - 0.05, y + 0.05, -0.405);
    glint.rotation.y = Math.PI;
    phone.add(glint);
  }
  const flash = new THREE.Mesh(new THREE.CircleGeometry(0.075, 32), new THREE.MeshBasicMaterial({ color: 0xdcdacb }));
  flash.position.set(-0.5, 1.94, -0.398);
  flash.rotation.y = Math.PI;
  phone.add(flash);

  const labelTexture = createBackMark();
  const rearMark = new THREE.Mesh(
    new THREE.PlaneGeometry(2.35, 0.83),
    new THREE.MeshBasicMaterial({ map: labelTexture, transparent: true, depthWrite: false }),
  );
  rearMark.position.set(0, -0.40, -0.253);
  rearMark.rotation.y = Math.PI;
  phone.add(rearMark);

  // Distinct white-metal side controls, with curved ends like physical keys.
  for (const [x, y, length] of [[-1.584, 1.5, 0.65], [-1.584, 0.68, 0.65], [1.584, 1.0, 0.84]]) {
    const key = new THREE.Mesh(new RoundedBoxGeometry(0.072, length, 0.18, 5, 0.034), silver);
    key.position.set(x, y, 0);
    phone.add(key);
  }
  scene.add(phone);

  return { phone, screen, labelTexture };
}

export default function PhoneModel() {
  const containerRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<Rotation>({ ...INITIAL });
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
    } catch {
      setFallback(true);
      return;
    }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(39, 1, 0.1, 100);
    camera.position.set(0, 0.1, 10.4);
    camera.lookAt(0, 0, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.3;
    renderer.domElement.setAttribute("aria-hidden", "true");
    container.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 1.55));
    const key = new THREE.DirectionalLight(0xffffff, 4.2);
    key.position.set(-4, 6, 6);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 2.2);
    fill.position.set(5, -1, 4);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 3.3);
    rim.position.set(3, 5, -5);
    scene.add(rim);

    const { phone, screen, labelTexture } = buildPhone(scene);
    phone.rotation.set(INITIAL.x, INITIAL.y, 0);
    const target = targetRef.current;
    const drag = { active: false, x: 0, y: 0 };
    const canvas = renderer.domElement;

    function resize() {
      const width = Math.max(1, container!.clientWidth);
      const height = Math.max(1, container!.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.position.z = width < 430 ? 11.6 : 10.4;
      camera.updateProjectionMatrix();
    }
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    function pointerDown(event: PointerEvent) {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      drag.active = true;
      drag.x = event.clientX;
      drag.y = event.clientY;
      canvas.setPointerCapture(event.pointerId);
      container!.dataset.dragging = "true";
    }
    function pointerMove(event: PointerEvent) {
      if (!drag.active) return;
      target.y += (event.clientX - drag.x) * 0.009;
      target.x = clamp(target.x + (event.clientY - drag.y) * 0.006, -0.48, 0.48);
      drag.x = event.clientX;
      drag.y = event.clientY;
    }
    function pointerEnd() {
      drag.active = false;
      delete container!.dataset.dragging;
    }
    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointermove", pointerMove);
    canvas.addEventListener("pointerup", pointerEnd);
    canvas.addEventListener("pointercancel", pointerEnd);
    canvas.addEventListener("lostpointercapture", pointerEnd);

    let frame = 0;
    const animate = () => {
      phone.rotation.x += (target.x - phone.rotation.x) * 0.13;
      phone.rotation.y += (target.y - phone.rotation.y) * 0.13;
      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerup", pointerEnd);
      canvas.removeEventListener("pointercancel", pointerEnd);
      canvas.removeEventListener("lostpointercapture", pointerEnd);
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        for (const material of (Array.isArray(object.material) ? object.material : [object.material])) material.dispose();
      });
      screen.dispose();
      labelTexture.dispose();
      renderer.dispose();
      canvas.remove();
    };
  }, []);

  function resetView() {
    targetRef.current.x = INITIAL.x;
    targetRef.current.y = INITIAL.y;
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Home") resetView();
    if (event.key === "ArrowLeft") targetRef.current.y -= 0.2;
    if (event.key === "ArrowRight") targetRef.current.y += 0.2;
    if (event.key === "ArrowUp") targetRef.current.x = clamp(targetRef.current.x - 0.15, -0.48, 0.48);
    if (event.key === "ArrowDown") targetRef.current.x = clamp(targetRef.current.x + 0.15, -0.48, 0.48);
  }

  return (
    <div className="phone-stage phone-stage--webgl">
      <div ref={containerRef} className="phone-viewport" role="group" tabIndex={0} onKeyDown={onKeyDown} aria-label="Объёмная 3D-модель CORTEX. Вращайте мышью, пальцем или стрелками на клавиатуре. Клавиша Home возвращает исходный ракурс." />
      {fallback && <img className="phone-fallback" src="/phone-ui.svg" alt="Экран приложения CORTEX" />}
    </div>
  );
}
