"use client";

import { useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";

type Rotation = { x: number; y: number };
type Drag = { x: number; y: number; rotation: Rotation };

const INITIAL_ROTATION: Rotation = { x: -7, y: -23 };
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function CortexSymbol({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path d="M36 13.7 23 10 11 17v14l12 7 13-3.7" stroke="currentColor" strokeWidth="4.3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="29" cy="24" r="2.4" fill="currentColor" />
      <circle cx="38" cy="24" r="1.55" fill="currentColor" />
    </svg>
  );
}

function PhoneInterface() {
  return (
    <div className="phone-interface">
      <div className="phone-statusbar" aria-hidden="true">
        <span>9:41</span>
        <div className="phone-system-icons"><span className="phone-signal" /><span className="phone-wifi" /><span className="phone-battery" /></div>
      </div>
      <div className="phone-appbar">
        <span className="phone-app-brand"><CortexSymbol size={23} /><b>CORTEX</b></span>
        <span className="phone-avatar" aria-label="Профиль пользователя">К</span>
      </div>
      <div className="phone-content">
        <div className="phone-section-label">ГЛАВНЫЙ ЭКРАН <span>01 / 04</span></div>
        <div className="phone-greeting">Привет, Константин.</div>
        <p className="phone-question">Чем займёмся сегодня?</p>
        <div className="phone-assistant-core" aria-hidden="true">
          <div className="phone-core-halo" />
          <div className="phone-core-ring phone-core-ring--outer" />
          <div className="phone-core-ring phone-core-ring--inner" />
          <div className="phone-core-ball" />
          <span className="phone-wave phone-wave--left" /><span className="phone-wave phone-wave--right" />
        </div>
        <div className="phone-listening"><span className="phone-listening-dot" /> CORTEX слушает</div>
        <p className="phone-listening-hint">Произнесите команду</p>
        <div className="phone-task">
          <span className="phone-task-check">✓</span>
          <div><strong>Готов к действию</strong><p>«Напомни позвонить завтра»</p><small>Голос · сценарии · автоматизация</small></div>
        </div>
      </div>
      <div className="phone-bottom">
        <div className="phone-voice"><span className="phone-mic"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3" stroke="currentColor" strokeWidth="1.8" /><path d="M6 12a6 6 0 0012 0M12 18v3m-4 0h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg></span><span>Говорить с CORTEX</span><b>↗</b></div>
        <nav className="phone-tabbar" aria-label="Демонстрационное меню приложения"><span className="phone-tab-active">●<small>Домой</small></span><span>▤<small>Сценарии</small></span><span>⊕<small>Создать</small></span><span>○<small>Ещё</small></span></nav>
      </div>
      <div className="phone-home-indicator" aria-hidden="true" />
    </div>
  );
}

export default function InteractivePhone() {
  const [rotation, setRotation] = useState<Rotation>(INITIAL_ROTATION);
  const drag = useRef<Drag | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    drag.current = { x: event.clientX, y: event.clientY, rotation };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsDragging(true);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    const { x, y, rotation: start } = drag.current;
    setRotation({ x: clamp(start.x - (event.clientY - y) * 0.24, -35, 35), y: start.y + (event.clientX - x) * 0.55 });
  }

  function endDrag() {
    drag.current = null;
    setIsDragging(false);
  }

  function handleKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      setRotation((old) => ({ ...old, y: old.y + (event.key === "ArrowLeft" ? -15 : 15) }));
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      setRotation((old) => ({ ...old, x: clamp(old.x + (event.key === "ArrowUp" ? 10 : -10), -35, 35) }));
    } else if (event.key === "Home") {
      event.preventDefault();
      setRotation(INITIAL_ROTATION);
    }
  }

  const phoneStyle = {
    "--phone-x": `${rotation.x}deg`,
    "--phone-y": `${rotation.y}deg`,
  } as CSSProperties;

  return (
    <div className="phone-stage">
      <div className="phone-scene-grid" aria-hidden="true" />
      <span className="scene-orbit scene-orbit--one" aria-hidden="true" />
      <span className="scene-orbit scene-orbit--two" aria-hidden="true" />
      <div className="phone-pointer-area" role="group" tabIndex={0} aria-label="3D-телефон CORTEX. Вращайте мышью, пальцем или клавишами со стрелками. Home возвращает исходный ракурс." onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag} onKeyDown={handleKeyboard} data-dragging={isDragging}>
        <div className="phone-model" style={phoneStyle}>
          <div className="phone-edge phone-edge--left" aria-hidden="true" />
          <div className="phone-edge phone-edge--right" aria-hidden="true" />
          <div className="phone-edge phone-edge--top" aria-hidden="true" />
          <div className="phone-edge phone-edge--bottom" aria-hidden="true" />
          <div className="phone-back" aria-hidden="true">
            <div className="phone-camera-bump"><span /><span /><span /><i /></div>
            <div className="phone-rear-symbol"><CortexSymbol size={68} /><span>CORTEX</span></div>
            <div className="phone-rear-metadata">DESIGNED FOR ANDROID</div>
          </div>
          <div className="phone-front">
            <PhoneInterface />
            <div className="phone-island" aria-hidden="true" />
          </div>
          <span className="phone-button phone-button--volume" aria-hidden="true" />
          <span className="phone-button phone-button--power" aria-hidden="true" />
        </div>
      </div>
      <div className="scene-caption">
        <span className="scene-caption-icon" aria-hidden="true">↻</span>
        <span>ВРАЩАЙТЕ ТЕЛЕФОН</span>
        <button type="button" aria-label="Показать обратную сторону телефона" onClick={() => setRotation({ x: -7, y: 157 })}>ВИД СЗАДИ</button>
        <button type="button" aria-label="Вернуть исходный ракурс телефона" onClick={() => setRotation(INITIAL_ROTATION)}>СБРОСИТЬ</button>
      </div>
    </div>
  );
}
