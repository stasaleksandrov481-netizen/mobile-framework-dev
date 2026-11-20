"use strict";

const CortexMarkdown = (() => {
  const parser = window.markdownit({ html: false, linkify: true });
  const escape = parser.utils.escapeHtml;

  function webUrl(value) {
    if (typeof value !== "string" || value.length > 2048) return "";
    try {
      const url = new URL(value);
      // Android opens only HTTPS links (CortexSafeUrl); an http link would render but always fail.
      return url.protocol === "https:" && url.hostname &&
        !url.username && !url.password ? url.href : "";
    } catch { return ""; }
  }

  parser.validateLink = value => Boolean(webUrl(value));
  parser.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
    const token = tokens[index];
    token.attrSet("target", "_blank");
    token.attrSet("rel", "noopener noreferrer");
    const href = webUrl(token.attrGet("href"));
    if (!href) return renderer.renderToken(tokens, index, options);
    const host = new URL(href).hostname.toLowerCase();
    const safe = host.length <= 253 && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host);
    return renderer.renderToken(tokens, index, options) + (safe
      ? '<img class="cortex-site-favicon" src="/favicons/' + escape(host) + '" alt="" aria-hidden="true" loading="lazy" decoding="async">'
      : '');
  };
  parser.renderer.rules.image = (tokens, index, options, env, renderer) => {
    const token = tokens[index];
    const href = webUrl(token.attrGet("src"));
    const alt = renderer.renderInlineAsText(token.children || [], options, env) || "Открыть изображение";
    return href ? '<a href="' + escape(href) + '" target="_blank" rel="noopener noreferrer">' +
      escape(alt) + "</a>" : escape(alt);
  };

  // Icons are a tiny trusted vocabulary, not arbitrary SVG/HTML from the AI.
  // Example: "Готово :icon[check]:". Unrecognised names remain plain text.
  const inlineIcons = Object.freeze({
    spark: "Подсказка", check: "Готово", info: "Информация", alert: "Внимание",
    shield: "Безопасность", bolt: "Быстро", bell: "Уведомление", heart: "Важно",
    star: "Рекомендация", search: "Поиск", globe: "Интернет", note: "Заметка",
    file: "Файл", link: "Ссылка", history: "История", settings: "Настройки",
  });
  parser.inline.ruler.before("text", "cortex_inline_icon", (state, silent) => {
    if (!state.src.startsWith(":icon[", state.pos)) return false;
    const match = /^:icon\[([a-z]{2,16})\]:/.exec(state.src.slice(state.pos));
    if (!match || !Object.hasOwn(inlineIcons, match[1])) return false;
    if (!silent) {
      const token = state.push("cortex_inline_icon", "", 0);
      token.content = match[1];
    }
    state.pos += match[0].length;
    return true;
  });
  parser.renderer.rules.cortex_inline_icon = (tokens, index) => {
    const name = tokens[index].content;
    return '<span class="markdown-inline-icon" role="img" aria-label="' + inlineIcons[name] + '">' +
      CortexIcons(name, 17) + "</span>";
  };

  function codeBlock(token) {
    const info = token.info.trim().split(/\s+/u)[0];
    const language = /^[a-z0-9_.+-]{1,24}$/i.test(info) ? info : "Код";
    return '<figure class="code-block"><figcaption><span>' + escape(language) + '</span>' +
      '<button type="button" class="code-copy" data-action="copy-code" aria-label="Копировать код">' +
      CortexIcons("copy", 17) + '<span>Копировать</span></button></figcaption>' +
      '<pre tabindex="0"><code>' + escape(token.content) + "</code></pre></figure>\n";
  }
  // A small, typed Markdown extension. Never render model-provided HTML, CSS or URLs.
  // ```cortex-metrics {"title":"...","rows":[{"label":"PCM","value":"48 КБ/с","percent":100},...]}
  function metricsBlock(token) {
    if (token.content.length > 2400) return codeBlock(token);
    let data;
    try { data = JSON.parse(token.content); } catch { return codeBlock(token); }
    if (!data || typeof data !== "object" || Array.isArray(data) ||
        !Array.isArray(data.rows) || data.rows.length < 1 || data.rows.length > 5 ||
        typeof data.title !== "string" || data.title.length > 90 ||
        data.rows.some(row => !row || typeof row !== "object" ||
          typeof row.label !== "string" || row.label.length > 70 ||
          typeof row.value !== "string" || row.value.length > 40 ||
          typeof row.percent !== "number" || !Number.isFinite(row.percent) ||
          row.percent < 0 || row.percent > 100 ||
          (row.tone !== undefined && !["success", "neutral", "warning"].includes(row.tone))) ||
        (data.note !== undefined && (typeof data.note !== "string" || data.note.length > 120))) return codeBlock(token);
    const rows = data.rows.map(row => '<div class="cortex-metric">' +
      '<div class="cortex-metric-heading"><span>' + escape(row.label) + '</span><strong>' +
      escape(row.value) + '</strong></div>' +
      '<div class="cortex-metric-track" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' +
      row.percent + '" aria-label="' + escape(row.label) + '"><div class="cortex-metric-fill ' +
      (row.tone || "neutral") + '" style="width:' + row.percent + '%"></div></div></div>').join("");
    return '<figure class="cortex-metrics"><figcaption>' + escape(data.title) + '</figcaption>' + rows +
      (data.note ? '<div class="cortex-metric-note">' + CortexIcons("check", 14) + escape(data.note) + '</div>' : "") + '</figure>\n';
  }
  function cardsBlock(token) {
    if (token.content.length > 2500) return codeBlock(token);
    let data;
    try { data = JSON.parse(token.content); } catch { return codeBlock(token); }
    if (!data || typeof data !== "object" || !Array.isArray(data.cards) || data.cards.length < 1 ||
      data.cards.length > 6 || data.cards.some(card => !card || typeof card !== "object" ||
      typeof card.title !== "string" || card.title.length > 65 ||
      typeof card.value !== "string" || card.value.length > 75 ||
      (card.note !== undefined && (typeof card.note !== "string" || card.note.length > 150)) ||
      (card.tone !== undefined && !["success", "neutral", "warning"].includes(card.tone)))) return codeBlock(token);
    return '<div class="cortex-answer-cards">' + data.cards.map(card =>
      '<div class="cortex-answer-card ' + (card.tone || "neutral") + '"><span>' + escape(card.title) +
      '</span><strong>' + escape(card.value) + '</strong>' +
      (card.note ? '<small>' + escape(card.note) + '</small>' : "") + '</div>').join("") + '</div>\n';
  }
  function stepsBlock(token) {
    if (token.content.length > 2600) return codeBlock(token);
    let data;
    try { data = JSON.parse(token.content); } catch { return codeBlock(token); }
    if (!data || typeof data !== "object" || !Array.isArray(data.steps) || data.steps.length < 1 ||
      data.steps.length > 7 || data.steps.some(step => !step || typeof step !== "object" ||
      typeof step.title !== "string" || step.title.length > 85 ||
      (step.detail !== undefined && (typeof step.detail !== "string" || step.detail.length > 170)) ||
      !["done", "active", "pending", "error"].includes(step.state))) return codeBlock(token);
    return '<ol class="cortex-answer-steps">' + data.steps.map(step =>
      '<li class="' + step.state + '"><span class="cortex-step-symbol" aria-hidden="true">' +
      (step.state === "done" ? CortexIcons("check", 15) : step.state === "error" ? CortexIcons("alert", 15) : "") +
      '</span><div><strong>' + escape(step.title) + '</strong>' +
      (step.detail ? '<small>' + escape(step.detail) + '</small>' : "") + '</div></li>').join("") + '</ol>\n';
  }
  parser.renderer.rules.fence = (tokens, index) => {
    const token = tokens[index];
    const kind = token.info.trim();
    return kind === "cortex-metrics" ? metricsBlock(token) : kind === "cortex-cards" ? cardsBlock(token)
      : kind === "cortex-steps" ? stepsBlock(token) : codeBlock(token);
  };
  parser.renderer.rules.code_block = (tokens, index) => codeBlock(tokens[index]);
  parser.renderer.rules.table_open = () => '<div class="table-scroll" tabindex="0" role="region" aria-label="Таблица"><table>\n';
  parser.renderer.rules.table_close = () => "</table></div>\n";

  parser.core.ruler.after("inline", "cortex_task_list", state => {
    for (let i = 2; i < state.tokens.length; i++) {
      const inline = state.tokens[i], item = state.tokens[i - 2];
      if (inline.type !== "inline" || state.tokens[i - 1].type !== "paragraph_open" || item.type !== "list_item_open") continue;
      const first = inline.children?.[0];
      const marker = first?.type === "text" && /^\[([ x])]\s+/i.exec(first.content);
      if (!marker) continue;
      item.attrJoin("class", "task-item");
      first.content = first.content.slice(marker[0].length);
      const check = new state.Token("cortex_task", "", 0);
      check.meta = { checked: marker[1] !== " " };
      inline.children.unshift(check);
    }
  });
  parser.renderer.rules.cortex_task = (tokens, index) => tokens[index].meta.checked
    ? '<span class="task-check" role="img" aria-label="Выполнено">' + CortexIcons("check", 13) + "</span>"
    : '<span class="task-check" role="img" aria-label="В процессе"></span>';

  const callouts = { NOTE: ["Заметка", "info"], TIP: ["Совет", "spark"], IMPORTANT: ["Важно", "alert"] };
  parser.core.ruler.after("inline", "cortex_callout", state => {
    for (let index = 0; index + 2 < state.tokens.length; index++) {
      const [quote, paragraph, inline] = state.tokens.slice(index, index + 3);
      if (quote.type !== "blockquote_open" || paragraph.type !== "paragraph_open" || inline.type !== "inline") continue;
      const first = inline.children?.[0];
      const mark = first?.type === "text" && /^\[!(NOTE|TIP|IMPORTANT)\](?:\s+|$)/u.exec(first.content);
      if (!mark) continue;
      quote.meta = { callout: mark[1] };
      quote.attrJoin("class", "cortex-callout");
      first.content = first.content.slice(mark[0].length);
      if (!first.content) {
        inline.children.shift();
        if (["softbreak", "hardbreak"].includes(inline.children[0]?.type)) inline.children.shift();
      }
    }
  });
  parser.renderer.rules.blockquote_open = (tokens, index, options, env, renderer) => {
    const token = tokens[index];
    const open = renderer.renderToken(tokens, index, options);
    const kind = token.meta?.callout;
    if (!kind || !Object.hasOwn(callouts, kind)) return open;
    const [title, icon] = callouts[kind];
    return open + '<div class="callout-title">' + CortexIcons(icon, 16) + "<strong>" + title + "</strong></div>\n";
  };

  const render = value => parser.render(String(value ?? ""));

  function renderStream(value) {
    const source = String(value ?? "");
    const start = source.lastIndexOf("\n") + 1;
    const tail = source.slice(start);
    if ((source.match(/^ {0,3}(?:\x60{3,}|~{3,})/gm) || []).length % 2) return render(source);
    if (/^ {0,3}[#*_\x60>|\-]{1,6}\s*$/.test(tail)) return render(source.slice(0, start));
    let strong = false, code = "";
    for (const token of tail.matchAll(/\\[\s\S]|\*{2,}|\x60+/g)) {
      const mark = token[0], index = token.index;
      if (mark[0] === "\x60") {
        if (!code) code = mark;
        else if (code === mark) code = "";
      } else if (mark === "**" && !code) {
        if (strong && /\S/.test(tail[index - 1] || "")) strong = false;
        else if (!strong && /\S/.test(tail[index + 2] || "")) strong = true;
      }
    }
    return render(code || strong ? source.trimEnd() + code + (strong ? "**" : "") : source);
  }

  return { render, renderStream, webUrl };
})();
