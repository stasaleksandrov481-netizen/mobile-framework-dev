import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../app/src/main/assets/web/", import.meta.url);
const content = file => readFileSync(new URL(file, root), "utf8");

function markdown() {
  const context = vm.createContext({ URL, window: {}, CortexIcons: name => `<svg data-cortex-icon="${name}"></svg>` });
  vm.runInContext(content("vendor/markdown-it-15.0.3.js"), context);
  context.window.markdownit = context.markdownit;
  vm.runInContext(content("markdown-code.js"), context);
  vm.runInContext(content("markdown-math.js"), context);
  vm.runInContext(content("markdown.js"), context);
  return text => vm.runInContext(`CortexMarkdown.render(${JSON.stringify(text)})`, context);
}

test("assistant Markdown renders useful inline SVG icons from a fixed whitelist", () => {
  const render = markdown();
  const result = render("Готово :icon[check]:. Сеть :icon[globe]:. Неизвестно :icon[untrusted]:.");
  assert.match(result, /class="markdown-inline-icon" role="img" aria-label="Готово"/);
  assert.match(result, /data-cortex-icon="check"/);
  assert.match(result, /data-cortex-icon="globe"/);
  assert.match(result, /:icon\[untrusted\]:/);
  assert.doesNotMatch(result, /data-cortex-icon="untrusted"/);
});

test("Markdown keeps callouts legible and does not execute arbitrary markup", () => {
  const render = markdown();
  const result = render("> [!TIP]\n> Могу запускать приложения и создавать напоминания.\n\n" +
    "> [!IMPORTANT] Проверьте доступ к уведомлениям.\n\n" +
    "```text\n:icon[check]:\n```\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))");
  assert.equal((result.match(/class="cortex-callout callout-/g) || []).length, 2);
  assert.match(result, /class="callout-title"/);
  assert.match(result, /Могу запускать приложения/);
  assert.match(result, /Проверьте доступ к уведомлениям/);
  assert.doesNotMatch(result, /<script>/);
  assert.doesNotMatch(result, /href="javascript:/);
  assert.match(result, /<code>:icon\[check\]:/);
});

test("assistant messages render without a bubble background or frame", () => {
  const css = content("style.css");
  assert.match(css, /Chat: the assistant writes on the canvas/);
  assert.match(css, /\.message\.assistant:not\(\.pending\) \.message-body\s*\{[^}]*border:\s*0;/s);
  assert.match(css, /\.markdown \.cortex-callout\s*\{[^}]*width:\s*100%/s);
  const model = content("model.js");
  assert.match(model, /Без эмодзи, HTML и SVG/);
  assert.match(model, /:icon\[check\|info\|alert/);
  assert.match(model, /```cortex-chart/);
});

test("the entire app uses compact spacing and the composer exposes an accessible quota ring", () => {
  const screens = content("screens.js");
  const app = content("app.js");
  const css = content("style.css");
  assert.match(screens, /class="quota-ring"[^>]*aria-label="Лимиты ИИ"/);
  assert.match(app, /quotaRing\.style\.setProperty\("--quota-fraction"/);
  assert.match(app, /quotaRing\.setAttribute\("aria-label", label/);
  assert.match(css, /\.quota-ring-art\s*\{[^}]*conic-gradient/s);
  for (const selector of [".section-header", ".profile-scroll", ".tile", ".switch-row", ".navigation button", ".chat-header"]) {
    assert.ok(css.includes(selector), `missing application-wide density rule: ${selector}`);
  }
  assert.match(css, /\.app-shell \.tile\s*\{[^}]*min-height:\s*51px/s);
  assert.match(css, /\.app-shell \.switch-row, \.app-shell \.access-row\s*\{[^}]*min-height:\s*52px/s);
});

test("rich metrics are rendered as safe accessible progress bars", () => {
  const render = markdown();
  const result = render('```cortex-metrics\n' + JSON.stringify({
    title: "Сжатие голосовых", rows: [
      { label: "Раньше, PCM", value: "48 КБ/с", percent: 100 },
      { label: "Теперь, ADPCM", value: "12 КБ/с", percent: 25, tone: "success" },
    ], note: "На 75% меньше данных",
  }) + '\n```');
  assert.match(result, /class="cortex-metrics"/);
  assert.match(result, /aria-valuenow="25"/);
  assert.match(result, /width:25%/);
  assert.match(result, /cortex-metric-note/);
});

test("metrics reject untrusted markup, impossible values and oversized content", () => {
  const render = markdown();
  const bad = [
    { title: '<img src=x onerror=alert(1)>', rows: [{ label: '<script>', value: 'a', percent: 80 }] },
    { title: "Test", rows: [{ label: "A", value: "B", percent: '100; background:url(https://x)' }] },
    { title: "Test", rows: [{ label: "A", value: "B", percent: 200 }] },
  ];
  const escaped = render('```cortex-metrics\n' + JSON.stringify(bad[0]) + '\n```');
  assert.doesNotMatch(escaped, /<script>|<img src=x/);
  assert.match(escaped, /&lt;script&gt;/);
  for (const entry of bad.slice(1)) {
    const result = render('```cortex-metrics\n' + JSON.stringify(entry) + '\n```');
    assert.doesNotMatch(result, /class="cortex-metrics"/);
    assert.match(result, /class="code-block"/);
  }
});

test("rich metric cards and timelines render only trusted fields", () => {
  const render = markdown();
  const cards = render('```cortex-cards\n' + JSON.stringify({ cards: [
    { title: "Экономия", value: "75%", note: '<img src=x onerror=alert(1)>', tone: "success" },
  ] }) + '\n```');
  assert.match(cards, /cortex-answer-cards/);
  assert.match(cards, /75%/);
  assert.match(cards, /&lt;img src=x/);
  assert.doesNotMatch(cards, /<img src=x/);
  const steps = render('```cortex-steps\n' + JSON.stringify({ steps: [
    { title: "Поиск", state: "done", detail: "Данные проверены" },
    { title: "Ответ", state: "active" },
  ] }) + '\n```');
  assert.match(steps, /cortex-answer-steps/);
  assert.match(steps, /class="done"/);
  assert.match(steps, /class="active"/);
  assert.doesNotMatch(render('```cortex-steps\n{"steps":[{"title":"a","state":"anything"}]}\n```'), /cortex-answer-steps/);
});

test("Markdown adds same-origin site icon to safe citation links only", () => {
  const result = markdown()('[OpenRouter](https://openrouter.ai/docs) [unsafe](javascript:alert(1))');
  assert.doesNotMatch(result, /\/favicons\//);
  assert.doesNotMatch(result, /\/favicons\/javascript/);
  assert.doesNotMatch(result, /href="javascript:/);
});

test("assistant links are clickable only when Android can open them (HTTPS)", () => {
  const render = markdown();
  const result = render("[safe](https://cortexapp.ru/help) [plain](http://example.com/) http://example.org/x");
  const links = Array.from(result.matchAll(/href="([^"]*)"/g), match => match[1]);
  assert.deepEqual(links, ["https://cortexapp.ru/help"]);
  assert.match(result, /example\.com/);
});

function markdownStream() {
  const context = vm.createContext({ URL, window: {}, CortexIcons: name => `<svg data-cortex-icon="${name}"></svg>` });
  vm.runInContext(content("vendor/markdown-it-15.0.3.js"), context);
  context.window.markdownit = context.markdownit;
  for (const file of ["markdown-code.js", "markdown-math.js", "markdown.js"]) vm.runInContext(content(file), context);
  return text => vm.runInContext(`CortexMarkdown.renderStream(${JSON.stringify(text)})`, context);
}

test("code blocks are highlighted with escaped tokens and a readable language label", () => {
  const result = markdown()("```js\nconst greet = name => \"<b>\" + name; // hi\nfetch(42)\n```");
  assert.match(result, /<span>JavaScript<\/span>/);
  assert.match(result, /<span class="tok-k">const<\/span>/);
  assert.match(result, /<span class="tok-s">&quot;&lt;b&gt;&quot;<\/span>/);
  assert.match(result, /<span class="tok-c">\/\/ hi<\/span>/);
  assert.match(result, /<span class="tok-f">fetch<\/span>\(<span class="tok-n">42<\/span>\)/);
  assert.doesNotMatch(result, /<b>/);
});

test("formulas become MathML, prices stay text and TeX cannot inject markup", () => {
  const render = markdown();
  const inline = render("Площадь $S = \\pi r^2$ и дробь \\(\\frac{a}{b}\\). Цена $5 и $10.");
  assert.match(inline, /<math[^>]*class="math-inline"/);
  assert.match(inline, /<mi>π<\/mi>/);
  assert.match(inline, /<msup><mi>r<\/mi><mn>2<\/mn><\/msup>/);
  assert.match(inline, /<mfrac><mrow><mi>a<\/mi><\/mrow><mrow><mi>b<\/mi><\/mrow><\/mfrac>/);
  assert.match(inline, /Цена \$5 и \$10\./);
  const block = render("$$\n\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}\n$$");
  assert.match(block, /display="block"/);
  assert.match(block, /<munderover><mo largeop="true" movablelimits="true">∑<\/mo>/);
  const fence = render("```math\n\\begin{pmatrix} 1 & 0 \\\\ 0 & 1 \\end{pmatrix}\n```");
  assert.match(fence, /<mtable><mtr><mtd><mn>1<\/mn><\/mtd><mtd><mn>0<\/mn><\/mtd><\/mtr>/);
  const hostile = render("$\\text{<img src=x onerror=alert(1)>} \\href{javascript:x}$");
  assert.doesNotMatch(hostile, /<img|<a /);
  assert.match(hostile, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test("badges, highlight and underline use fixed classes and keep C++ literal", () => {
  const result = markdown()(":badge[success]{Готово} :badge[evil]{X} ==важно== ++подчёркнуто++ C++ и C++ a==b");
  assert.match(result, /<span class="md-badge success">Готово<\/span>/);
  assert.match(result, /<span class="md-badge neutral">X<\/span>/);
  assert.match(result, /<mark>важно<\/mark>/);
  assert.match(result, /<u>подчёркнуто<\/u>/);
  assert.match(result, /C\+\+ и C\+\+ a==b/);
});

test("hero, chart, flow and details render only validated data", () => {
  const render = markdown();
  const hero = render("```cortex-hero\n" + JSON.stringify({ eyebrow: "DEMO", title: "CORTEX", subtitle: "Текст",
    icon: "core", status: { text: "Online", tone: "success" }, tags: [{ text: "AI", tone: "info" }],
    stats: [{ label: "Запросы", value: "12 840", note: "+24%", tone: "success" }] }) + "\n```");
  assert.match(hero, /<section class="md-hero">/);
  assert.match(hero, /md-hero-status success/);
  assert.match(hero, /<dd>12 840<\/dd>/);
  const chart = render("```cortex-chart\n" + JSON.stringify({ type: "bar", title: "Нагрузка", unit: "мс",
    labels: ["Пн", "\"><script>"], series: [{ name: "A", values: [3, 7] }] }) + "\n```");
  assert.match(chart, /<svg viewBox="0 0 320 150" class="md-plot"/);
  assert.equal((chart.match(/<rect /g) || []).length, 2);
  assert.doesNotMatch(chart, /<script\b/i);
  assert.match(chart, /&quot;&gt;&lt;script&gt;/);
  const donut = render("```cortex-chart\n" + JSON.stringify({ type: "donut", labels: ["A", "B"], series: [{ values: [1, 3] }] }) + "\n```");
  assert.match(donut, /class="md-donut"/);
  assert.match(render("```cortex-chart\n{\"type\":\"bar\",\"labels\":[\"A\"],\"series\":[{\"values\":[\"x\"]}]}\n```"), /class="code-block"/);
  const flow = render("```cortex-flow\n" + JSON.stringify({ nodes: [{ title: "Голос" }, { title: "Действие", tone: "success" }] }) + "\n```");
  assert.match(flow, /<figure class="md-flow"><ol><li class="neutral"><strong>Голос<\/strong>/);
  const details = render("```details Подробнее о шаге\n**Жирный** текст\n```");
  assert.match(details, /<details class="md-details"><summary>Подробнее о шаге<\/summary>/);
  assert.match(details, /<strong>Жирный<\/strong>/);
});

test("streaming typed blocks show a placeholder instead of raw JSON", () => {
  const result = markdownStream()("Смотрите:\n\n```cortex-chart\n{\"type\":\"bar\",\"labels\":[\"A\"");
  assert.match(result, /class="cortex-block-pending"/);
  assert.doesNotMatch(result, /&quot;labels&quot;/);
});

test("every GitHub-style callout kind gets a title and a tone class", () => {
  const result = markdown()("> [!WARNING]\n> Осторожно\n\n> [!success]\n> Сделано");
  assert.match(result, /class="cortex-callout callout-warning"/);
  assert.match(result, /class="cortex-callout callout-success"/);
  assert.match(result, /<strong>Внимание<\/strong>/);
  assert.match(result, /<strong>Готово<\/strong>/);
});
