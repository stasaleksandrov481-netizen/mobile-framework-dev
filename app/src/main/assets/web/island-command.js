"use strict";

// Local commands never consume AI tokens and never execute an untrusted model's code.
// They only adjust bounded values that the Android island already supports.
const CortexIslandCommands = (() => {
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const noun = /(?:^|[^а-яё])(?:островок|островка|островке|островку|островком|капсула|капсулу|капсулы|капсуле)(?:$|[^а-яё])/u;
  const imperative = /^(?:кортекс[, ]*)?(?:пожалуйста[, ]*)?(?:уменьши|увеличь|сделай|сдвинь|подвинь|перемести|верни|сбрось|восстанови|включи|выключи|покажи|скрой|убери|добавь|поставь|настрой|измени)(?![а-яё])/u;
  const defaults = Object.freeze({
    background: "#34465a", text: "#ffffff", border: "#ffffff", accent: "#ffffff", faceColor: "#ffffff",
    opacity: 100, size: 100, widthScale: 100, heightScale: 100, offsetX: 0, offsetY: 0, corner: 22,
    borderWidth: .45, motion: "liquid", face: true, status: true, progress: true, results: true, glass: true, mascot: true,
  });

  function parse(text, previous = defaults, mode = "wake") {
    const sentence = String(text || "").toLocaleLowerCase("ru-RU").replace(/\s+/gu, " ").trim();
    if (sentence.length > 180 || sentence.includes("?") || !noun.test(sentence) || !imperative.test(sentence)) return null;
    const style = { ...defaults, ...previous };
    const number = /\b(\d{2,3})\s*%/u.exec(sentence);
    const percent = number ? Number(number[1]) : null;
    let value = "";
    let resultMode;
    if (/^(?:кортекс[, ]*)?(?:пожалуйста[, ]*)?(?:сбрось|восстанови|верни)/u.test(sentence) &&
        /(стандарт|исходн|по умолчанию|как было)/u.test(sentence)) {
      return { style: { ...defaults }, reply: "Вернул стандартное оформление островка." };
    }
    if (/(полоск[ауи]? прогресс|индикатор прогресс|прогресс|статус|результат|смайлик|символ)/u.test(sentence)) {
      const key = /прогресс/u.test(sentence) ? "progress" : /статус/u.test(sentence) ? "status" :
        /результат/u.test(sentence) ? "results" : "face";
      if (key === "face") return { style, reply: "В компактном островке теперь только анимированный логотип CORTEX." };
      if (/(выключи|убери|скрой)/u.test(sentence)) style[key] = false;
      else if (/(включи|добавь|покажи)/u.test(sentence)) style[key] = true;
      else return null;
      value = style[key] ? "Включил" : "Выключил";
      return { style, reply: value + " " + { progress: "прогресс", status: "статус", results: "показ результатов", face: "символ" }[key] + " островка." };
    }
    if (/(рамк|границ)/u.test(sentence)) {
      if (/(выключи|убери|скрой)/u.test(sentence)) style.borderWidth = 0;
      else if (/(включи|добавь|покажи|верни)/u.test(sentence)) style.borderWidth = .45;
      else return null;
      return { style, reply: style.borderWidth ? "Вернул рамку островка." : "Убрал рамку островка." };
    }
    if (/(включи|выключи|скрой|покажи)/u.test(sentence) && !/(размер|ширин|высот|положен)/u.test(sentence)) {
      resultMode = /(выключи|скрой)/u.test(sentence) ? "off" : "wake";
      if (resultMode === mode) return { style, reply: resultMode === "off" ? "Островок уже выключен." : "Островок уже включён." };
      return { style, mode: resultMode, reply: resultMode === "off" ? "Выключаю островок CORTEX." : "Включаю островок CORTEX по вызову." };
    }
    if (/(сдвинь|подвинь|перемести)/u.test(sentence) || /(левее|правее|ниже|выше)/u.test(sentence)) {
      if (/(влево|левее)/u.test(sentence)) { style.offsetX = clamp(style.offsetX - 12, -75, 75); value = "влево"; }
      else if (/(вправо|правее)/u.test(sentence)) { style.offsetX = clamp(style.offsetX + 12, -75, 75); value = "вправо"; }
      else if (/(вниз|ниже)/u.test(sentence)) { style.offsetY = clamp(style.offsetY + 12, 0, 80); value = "ниже"; }
      else if (/(вверх|выше)/u.test(sentence)) { style.offsetY = clamp(style.offsetY - 12, 0, 80); value = "выше"; }
      if (value) return { style, reply: "Сдвинул островок " + value + "." };
    }
    if (/(прозрачн|непрозрачн)/u.test(sentence)) {
      if (percent != null && percent >= 40 && percent <= 100) style.opacity = percent;
      else if (/(прозрачнее|уменьши|более прозрачн)/u.test(sentence)) style.opacity = clamp(style.opacity - 15, 40, 100);
      else if (/(менее прозрачн|увеличь|непрозрачн)/u.test(sentence)) style.opacity = clamp(style.opacity + 15, 40, 100);
      else return null;
      return { style, reply: "Непрозрачность островка: " + style.opacity + "%." };
    }
    if (/(черн|чёрн|темн|тёмн|графит|бел|светл)/u.test(sentence)) {
      if (/(бел|светл)/u.test(sentence)) Object.assign(style, {
        background: "#e7e7e7", text: "#161616", border: "#555555", accent: "#363636", faceColor: "#777777",
      });
      else Object.assign(style, { background: "#000000", text: "#ffffff", border: "#ffffff", accent: "#ffffff", faceColor: "#ffffff" });
      return { style, reply: /(бел|светл)/u.test(sentence) ? "Выбрал светлый островок." : "Выбрал тёмный островок." };
    }
    const decrease = /(уменьши|меньше|поменьше|уже|пониже)/u.test(sentence);
    const increase = /(увеличь|больше|побольше|шире|выше)/u.test(sentence);
    if (!decrease && !increase && percent == null) return null;
    const key = /ширин|уже|шире/u.test(sentence) ? "widthScale" :
      /высот|пониже/u.test(sentence) ? "heightScale" : "size";
    const min = key === "heightScale" ? 90 : 80;
    if (percent != null && (percent < min || percent > 125)) {
      return { style, reply: "Размер островка можно настроить от " + min + "% до 125%." };
    }
    style[key] = percent != null ? percent :
      clamp(style[key] + (decrease ? -10 : 10), min, 125);
    return { style, reply: (key === "size" ? "Масштаб" : key === "widthScale" ? "Ширина" : "Высота") +
      " островка: " + style[key] + "%." };
  }

  return { parse, defaults };
})();
