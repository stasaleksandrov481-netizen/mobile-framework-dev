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

  // ==highlight== and ++underline++. A word character right before the opener or
  // after the closer keeps text like "C++" or "a==b" literal.
  function wrapped(marker, name, tag) {
    parser.inline.ruler.before("emphasis", name, (state, silent) => {
      const start = state.pos, src = state.src;
      if (!src.startsWith(marker, start) || /[\p{L}\p{N}]/u.test(src[start - 1] || "")) return false;
      const end = src.indexOf(marker, start + marker.length);
      if (end < 0 || end > state.posMax - marker.length) return false;
      const inner = src.slice(start + marker.length, end);
      if (!inner || /^\s|\s$|\n/.test(inner) || /[\p{L}\p{N}]/u.test(src[end + marker.length] || "")) return false;
      if (!silent) {
        state.push(name + "_open", tag, 1);
        const pos = state.pos, max = state.posMax;
        state.pos = start + marker.length;
        state.posMax = end;
        state.md.inline.tokenize(state);
        state.pos = pos;
        state.posMax = max;
        state.push(name + "_close", tag, -1);
      }
      state.pos = end + marker.length;
      return true;
    });
  }
  wrapped("==", "cortex_mark", "mark");
  wrapped("++", "cortex_ins", "u");

  // :badge[success]{Готово} — tone from a fixed list, text is escaped.
  parser.inline.ruler.before("text", "cortex_badge", (state, silent) => {
    if (!state.src.startsWith(":badge[", state.pos)) return false;
    const match = /^:badge\[([a-z]{3,8})\]\{([^{}\n]{1,40})\}/.exec(state.src.slice(state.pos, state.posMax));
    if (!match) return false;
    if (!silent) {
      const token = state.push("cortex_badge", "", 0);
      token.meta = { tone: tone(match[1]), text: match[2] };
    }
    state.pos += match[0].length;
    return true;
  });
  parser.renderer.rules.cortex_badge = (tokens, index) => badge(tokens[index].meta.text, tokens[index].meta.tone);

  // Inline $x^2$ / \(x^2\) and block $$…$$ / \[…\] formulas. "$5 и $10" stays text:
  // the opener must not be followed by a space and the closer must not precede a digit.
  parser.inline.ruler.before("escape", "cortex_math_inline", (state, silent) => {
    const src = state.src, start = state.pos;
    let open, close;
    if (src.startsWith("$$", start)) { open = "$$"; close = "$$"; }
    else if (src.startsWith("\\(", start)) { open = "\\("; close = "\\)"; }
    else if (src.startsWith("\\[", start)) { open = "\\["; close = "\\]"; }
    else if (src[start] === "$") { open = "$"; close = "$"; }
    else return false;
    const from = start + open.length;
    if (open === "$" && (/\s/.test(src[from] || " ") || /\d/.test(src[start - 1] || ""))) return false;
    let end = src.indexOf(close, from);
    while (end > 0 && src[end - 1] === "\\" && open === "$") end = src.indexOf(close, end + 1);
    if (end < 0 || end > state.posMax || end === from) return false;
    if (open === "$" && (/\s/.test(src[end - 1]) || /\d/.test(src[end + 1] || ""))) return false;
    const body = src.slice(from, end);
    if (open === "$" && body.includes("\n")) return false;
    if (!silent) {
      const token = state.push("cortex_math", "", 0);
      token.content = body;
      token.meta = { display: open === "$$" || open === "\\[" };
    }
    state.pos = end + close.length;
    return true;
  });
  parser.renderer.rules.cortex_math = (tokens, index) => {
    const token = tokens[index];
    const out = mathml?.render(token.content, token.meta.display);
    if (!out) return "<code>" + escape(token.content) + "</code>";
    return token.meta.display ? '<span class="math-scroll" tabindex="0">' + out + "</span>" : out;
  };

  const highlighter = typeof CortexCode === "object" ? CortexCode : null;
  const mathml = typeof CortexMath === "object" ? CortexMath : null;

  function codeBlock(token) {
    const info = token.info.trim().split(/\s+/u)[0];
    const language = /^[a-z0-9_.+#-]{1,24}$/i.test(info) ? info : "";
    const code = highlighter ? highlighter.highlight(token.content, language) : escape(token.content);
    const name = highlighter ? highlighter.label(language) : language || "Код";
    return '<figure class="code-block"><figcaption><span>' + escape(name) + '</span>' +
      '<button type="button" class="code-copy" data-action="copy-code" aria-label="Копировать код">' +
      CortexIcons("copy", 17) + '<span>Копировать</span></button></figcaption>' +
      '<pre tabindex="0"><code>' + code + "</code></pre></figure>\n";
  }

  const tones = new Set(["success", "warning", "error", "info", "neutral", "accent"]);
  const tone = value => tones.has(value) ? value : "neutral";
  const text = (value, max) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
  const optionalText = (value, max) => value === undefined || text(value, max);
  const icons = new Set(["spark", "check", "info", "alert", "shield", "bolt", "bell", "heart", "star", "search",
    "globe", "note", "file", "link", "history", "settings", "core", "mic", "memory", "message", "target",
    "signal", "layers", "grid", "user", "home", "folder", "image", "play", "wave", "eye", "refresh"]);

  function json(token, limit) {
    if (token.content.length > limit) return null;
    try {
      const data = JSON.parse(token.content);
      return data && typeof data === "object" && !Array.isArray(data) ? data : null;
    } catch { return null; }
  }

  // While a typed block is still streaming its JSON is incomplete; show a quiet
  // placeholder instead of flashing raw JSON. Final render falls back to code.
  const pending = (token, env) => env?.streaming
    ? '<div class="cortex-block-pending" role="status">' + CortexIcons("spark", 15) + "<span>Готовлю блок…</span></div>\n"
    : codeBlock(token);

  const badge = (value, kind) => '<span class="md-badge ' + tone(kind) + '">' + escape(value) + "</span>";

  // ```cortex-hero {"eyebrow","title","subtitle","icon","status":{"text","tone"},"tags":[{"text","tone"}],
  //   "stats":[{"label","value","note","tone"}],"note"}
  function heroBlock(token, env) {
    const data = json(token, 3000);
    const valid = data && text(data.title, 90) && optionalText(data.subtitle, 220) && optionalText(data.eyebrow, 60) &&
      optionalText(data.note, 200) && (data.icon === undefined || icons.has(data.icon)) &&
      (data.status === undefined || data.status && text(data.status.text, 30)) &&
      (data.tags === undefined || Array.isArray(data.tags) && data.tags.length <= 6 && data.tags.every(tag => tag && text(tag.text, 28))) &&
      (data.stats === undefined || Array.isArray(data.stats) && data.stats.length <= 4 &&
        data.stats.every(stat => stat && text(stat.label, 40) && text(stat.value, 24) && optionalText(stat.note, 40)));
    if (!valid) return pending(token, env);
    return '<section class="md-hero">' +
      '<header class="md-hero-head">' + (data.icon ? '<span class="md-hero-icon">' + CortexIcons(data.icon, 22) + "</span>" : "") +
      '<div class="md-hero-titles">' + (data.eyebrow || data.status ? '<div class="md-hero-meta">' +
        (data.eyebrow ? '<span class="md-hero-eyebrow">' + escape(data.eyebrow) + "</span>" : "<span></span>") +
        (data.status ? '<span class="md-hero-status ' + tone(data.status.tone) + '"><i aria-hidden="true"></i>' + escape(data.status.text) + "</span>" : "") +
        "</div>" : "") + "<strong>" + escape(data.title) + "</strong></div></header>" + (data.subtitle ? "<p>" + escape(data.subtitle) + "</p>" : "") +
      (data.tags?.length ? '<div class="md-hero-tags">' + data.tags.map(tag => badge(tag.text, tag.tone)).join("") + "</div>" : "") +
      (data.stats?.length ? '<dl class="md-hero-stats">' + data.stats.map(stat => "<div><dt>" + escape(stat.label) + "</dt>" +
        "<dd>" + escape(stat.value) + "</dd>" + (stat.note ? '<small class="' + tone(stat.tone) + '">' + escape(stat.note) + "</small>" : "") +
        "</div>").join("") + "</dl>" : "") +
      (data.note ? '<footer class="md-hero-note">' + escape(data.note) + "</footer>" : "") + "</section>\n";
  }

  // ```cortex-chart {"type":"bar|line|donut","title","unit","labels":[...],"series":[{"name","values":[...]}]}
  function chartBlock(token, env) {
    const data = json(token, 4000);
    const type = data?.type ?? "bar";
    const labels = data?.labels;
    const series = data?.series;
    const valid = data && ["bar", "line", "donut"].includes(type) && optionalText(data.title, 90) && optionalText(data.unit, 12) &&
      Array.isArray(labels) && labels.length >= 1 && labels.length <= (type === "donut" ? 8 : 12) &&
      labels.every(label => text(label, 24)) && Array.isArray(series) && series.length >= 1 &&
      series.length <= (type === "donut" ? 1 : 3) && series.every(item => item && optionalText(item.name, 30) &&
        Array.isArray(item.values) && item.values.length === labels.length &&
        item.values.every(value => typeof value === "number" && Number.isFinite(value) && Math.abs(value) < 1e12 &&
          (type !== "donut" || value >= 0)));
    if (!valid) return pending(token, env);
    const unit = data.unit ? " " + data.unit : "";
    const format = value => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value) + unit;
    const legend = series.length > 1 || type === "donut"
      ? '<ul class="md-chart-legend">' + (type === "donut" ? labels.map((label, i) => '<li><i class="c' + (i % 8) + '"></i>' +
        escape(label) + " · " + escape(format(series[0].values[i])) + "</li>")
        : series.map((item, i) => '<li><i class="c' + i + '"></i>' + escape(item.name || "Ряд " + (i + 1)) + "</li>")).join("") + "</ul>"
      : "";
    let svg;
    if (type === "donut") {
      const values = series[0].values, total = values.reduce((sum, value) => sum + value, 0) || 1;
      let angle = -Math.PI / 2;
      const arcs = values.map((value, i) => {
        const sweep = Math.min(value / total, .9999) * Math.PI * 2;
        const x1 = 60 + 46 * Math.cos(angle), y1 = 60 + 46 * Math.sin(angle);
        angle += sweep;
        const x2 = 60 + 46 * Math.cos(angle), y2 = 60 + 46 * Math.sin(angle);
        return value > 0 ? '<path class="s c' + (i % 8) + '" d="M' + x1.toFixed(2) + " " + y1.toFixed(2) + "A46 46 0 " +
          (sweep > Math.PI ? 1 : 0) + " 1 " + x2.toFixed(2) + " " + y2.toFixed(2) + '"/>' : "";
      }).join("");
      svg = '<svg viewBox="0 0 120 120" class="md-donut" role="img" aria-label="' + escape(data.title || "Диаграмма") + '">' + arcs + "</svg>";
    } else {
      const all = series.flatMap(item => item.values);
      const max = Math.max(0, ...all), min = Math.min(0, ...all), span = max - min || 1;
      const W = 320, H = 150, left = 6, top = 10, bottom = 128;
      const y = value => bottom - (value - min) / span * (bottom - top);
      const step = (W - left * 2) / labels.length;
      const grid = [0, .5, 1].map(f => '<line class="g" x1="0" x2="' + W + '" y1="' + (top + f * (bottom - top)).toFixed(1) +
        '" y2="' + (top + f * (bottom - top)).toFixed(1) + '"/>').join("");
      let marks = "";
      if (type === "bar") {
        const width = Math.max(3, step * .72 / series.length);
        series.forEach((item, s) => item.values.forEach((value, i) => {
          const x = left + i * step + step * .14 + s * width, top0 = Math.min(y(value), y(0));
          marks += '<rect class="c' + s + '" rx="2" x="' + x.toFixed(1) + '" y="' + top0.toFixed(1) + '" width="' +
            (width - 1.5).toFixed(1) + '" height="' + Math.max(1, Math.abs(y(value) - y(0))).toFixed(1) + '"/>';
        }));
      } else {
        series.forEach((item, s) => {
          const points = item.values.map((value, i) => (left + i * step + step / 2).toFixed(1) + "," + y(value).toFixed(1));
          marks += '<polyline class="l c' + s + '" points="' + points.join(" ") + '"/>' +
            points.map(point => '<circle class="c' + s + '" r="2.4" cx="' + point.split(",")[0] + '" cy="' + point.split(",")[1] + '"/>').join("");
        });
      }
      const axis = labels.map((label, i) => '<text x="' + (left + i * step + step / 2).toFixed(1) + '" y="144">' +
        escape(label.length > 9 ? label.slice(0, 8) + "…" : label) + "</text>").join("");
      svg = '<svg viewBox="0 0 ' + W + " " + H + '" class="md-plot" role="img" aria-label="' + escape(data.title || "График") + '">' +
        grid + marks + axis + "</svg>";
    }
    // The data table keeps the numbers readable for screen readers and copy.
    const table = '<details class="md-chart-data"><summary>Данные</summary><div class="table-scroll"><table><thead><tr><th></th>' +
      series.map((item, i) => "<th>" + escape(item.name || (series.length > 1 ? "Ряд " + (i + 1) : "Значение")) + "</th>").join("") +
      "</tr></thead><tbody>" + labels.map((label, i) => "<tr><td>" + escape(label) + "</td>" +
        series.map(item => "<td>" + escape(format(item.values[i])) + "</td>").join("") + "</tr>").join("") + "</tbody></table></div></details>";
    return '<figure class="md-chart">' + (data.title ? "<figcaption>" + escape(data.title) + "</figcaption>" : "") +
      svg + legend + table + "</figure>\n";
  }

  // ```cortex-flow {"title","nodes":[{"title","detail","tone"}]}
  function flowBlock(token, env) {
    const data = json(token, 2600);
    const valid = data && optionalText(data.title, 90) && Array.isArray(data.nodes) && data.nodes.length >= 2 &&
      data.nodes.length <= 8 && data.nodes.every(node => node && text(node.title, 60) && optionalText(node.detail, 140));
    if (!valid) return pending(token, env);
    return '<figure class="md-flow">' + (data.title ? "<figcaption>" + escape(data.title) + "</figcaption>" : "") +
      "<ol>" + data.nodes.map(node => '<li class="' + tone(node.tone) + '"><strong>' + escape(node.title) + "</strong>" +
        (node.detail ? "<small>" + escape(node.detail) + "</small>" : "") + "</li>").join("") + "</ol></figure>\n";
  }

  // ```details Заголовок  — collapsible section whose body is ordinary Markdown.
  function detailsBlock(token, env) {
    const title = token.info.trim().replace(/^details\s*/i, "").slice(0, 90) || "Подробнее";
    const depth = (env?.depth || 0) + 1;
    const body = depth > 2 || token.content.length > 12_000 ? "<pre><code>" + escape(token.content) + "</code></pre>"
      : parser.render(token.content, { ...env, depth });
    return '<details class="md-details"><summary>' + escape(title) + '</summary><div class="md-details-body">' + body + "</div></details>\n";
  }

  function mathBlock(token, env) {
    const out = mathml?.render(token.content, true);
    return out ? '<div class="math-scroll" tabindex="0">' + out + "</div>\n" : pending(token, env);
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
  const fences = {
    "cortex-metrics": metricsBlock, "cortex-cards": cardsBlock, "cortex-steps": stepsBlock,
    "cortex-hero": heroBlock, "cortex-chart": chartBlock, "cortex-flow": flowBlock,
    math: mathBlock, latex: mathBlock, tex: mathBlock, katex: mathBlock
  };
  parser.renderer.rules.fence = (tokens, index, options, env) => {
    const token = tokens[index];
    const kind = token.info.trim();
    if (/^details(?:\s|$)/i.test(kind)) return detailsBlock(token, env);
    const block = Object.hasOwn(fences, kind.toLowerCase()) ? fences[kind.toLowerCase()] : null;
    return block ? block(token, env) : codeBlock(token);
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

  const callouts = { NOTE: ["Заметка", "info"], INFO: ["Информация", "info"], TIP: ["Совет", "spark"],
    IMPORTANT: ["Важно", "alert"], WARNING: ["Внимание", "alert"], CAUTION: ["Осторожно", "alert"],
    SUCCESS: ["Готово", "check"], SECURITY: ["Безопасность", "shield"] };
  parser.core.ruler.after("inline", "cortex_callout", state => {
    for (let index = 0; index + 2 < state.tokens.length; index++) {
      const [quote, paragraph, inline] = state.tokens.slice(index, index + 3);
      if (quote.type !== "blockquote_open" || paragraph.type !== "paragraph_open" || inline.type !== "inline") continue;
      const first = inline.children?.[0];
      const mark = first?.type === "text" &&
        /^\[!(NOTE|INFO|TIP|IMPORTANT|WARNING|CAUTION|SUCCESS|SECURITY)\](?:\s+|$)/iu.exec(first.content);
      if (!mark) continue;
      quote.meta = { callout: mark[1].toUpperCase() };
      quote.attrJoin("class", "cortex-callout callout-" + mark[1].toLowerCase());
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

  const render = (value, env = {}) => parser.render(String(value ?? ""), env);

  function renderStream(value) {
    const source = String(value ?? "");
    const start = source.lastIndexOf("\n") + 1;
    const tail = source.slice(start);
    const live = { streaming: true };
    if ((source.match(/^ {0,3}(?:\x60{3,}|~{3,})/gm) || []).length % 2) return render(source, live);
    if (/^ {0,3}[#*_\x60>|\-]{1,6}\s*$/.test(tail)) return render(source.slice(0, start), live);
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
    return render(code || strong ? source.trimEnd() + code + (strong ? "**" : "") : source, live);
  }

  return { render, renderStream, webUrl };
})();
