"use client";

import { useState } from "react";
import type { KeyboardEvent } from "react";
import LandingPhone from "@/components/LandingPhone";
import UiIcon from "@/components/UiIcon";

const examples = [
  { id: "open", icon: "phone", label: "Приложения", prompt: "Открой калькулятор", result: "Калькулятор открыт" },
  { id: "reminder", icon: "bell", label: "Напоминания", prompt: "Напомни завтра в 9:00 позвонить", result: "Напоминание на завтра, 09:00" },
  { id: "brightness", icon: "bolt", label: "Настройки", prompt: "Установи яркость на 30 процентов", result: "Яркость экрана — 30%" },
] as const;

export default function CommandShowcase() {
  const [selected, setSelected] = useState(0);
  const example = examples[selected];

  function moveTab(event: KeyboardEvent<HTMLDivElement>) {
    const key = event.key;
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(key)) return;
    event.preventDefault();
    const next = key === "Home" ? 0 : key === "End" ? examples.length - 1
      : (selected + (key === "ArrowRight" ? 1 : -1) + examples.length) % examples.length;
    setSelected(next);
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }

  return (
    <div className="command-showcase">
      <div className="command-tabs" role="tablist" aria-label="Примеры голосовых команд" onKeyDown={moveTab}>
        {examples.map((item, index) => (
          <button
            id={`command-tab-${item.id}`}
            key={item.id}
            type="button"
            role="tab"
            tabIndex={selected === index ? 0 : -1}
            aria-selected={selected === index}
            aria-controls="command-example"
            onClick={() => setSelected(index)}
          >
            <UiIcon name={item.icon} size={19} />
            <span>{item.label}</span>
          </button>
        ))}
      </div>

      <div className="command-example" id="command-example" role="tabpanel"
        aria-labelledby={`command-tab-${example.id}`} tabIndex={0}>
        <div className="command-example-copy" key={example.id}>
          <div className="command-voice" aria-hidden="true">
            <span /><span /><span /><span /><span /><span /><span />
          </div>
          <p className="landing-label">Пример команды</p>
          <blockquote>«{example.prompt}»</blockquote>
          <p className="command-result">
            <span className="command-result-icon"><UiIcon name="check" size={15} /></span>
            <span>{example.result}</span>
          </p>
        </div>

        <div className="command-visual" aria-hidden="true">
          <LandingPhone className="command-phone" screen={`/landing/${example.id}.webp`} alt="" />
        </div>
      </div>
    </div>
  );
}
