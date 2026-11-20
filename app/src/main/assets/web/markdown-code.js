"use strict";

// Lightweight syntax highlighting for answer code blocks. One linear scan,
// escaped output, fixed class names: the source text never becomes markup.
const CortexCode = (() => {
  const LIMIT = 24_000;
  const esc = value => String(value).replace(/[&<>"']/g, ch =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

  const keywords = new Set((
    "abstract as async await break case catch class const continue def default del do elif else enum export " +
    "extends false final finally fn for from fun func function go if impl import in instanceof interface is " +
    "lambda let match mod module mut new nil none null object of override package pass private protected pub " +
    "public raise return self static struct super switch this throw throws trait true try type typeof undefined " +
    "use val var void when where while with yield None True False select insert update delete where join left " +
    "right inner outer on group order by having limit values into create table alter drop index and or not " +
    "echo fi then esac done local readonly suspend data sealed companion init inline crate unsafe loop").split(" "));
  const hashComments = new Set(["python", "py", "bash", "sh", "shell", "zsh", "yaml", "yml", "ruby", "rb",
    "toml", "dockerfile", "r", "perl", "powershell", "ps1", "makefile", "ini", "conf"]);
  const dashComments = new Set(["sql", "lua", "haskell", "hs"]);
  const plain = new Set(["", "text", "txt", "plain", "plaintext", "markdown", "md", "log", "output", "console"]);
  const aliases = { js: "JavaScript", javascript: "JavaScript", ts: "TypeScript", typescript: "TypeScript",
    py: "Python", python: "Python", kt: "Kotlin", kotlin: "Kotlin", java: "Java", sh: "Shell", bash: "Bash",
    shell: "Shell", json: "JSON", sql: "SQL", html: "HTML", css: "CSS", yaml: "YAML", yml: "YAML", go: "Go",
    rust: "Rust", rs: "Rust", cpp: "C++", "c++": "C++", c: "C", cs: "C#", csharp: "C#", swift: "Swift",
    php: "PHP", ruby: "Ruby", rb: "Ruby", xml: "XML", dockerfile: "Dockerfile", toml: "TOML", lua: "Lua",
    dart: "Dart", tsx: "TSX", jsx: "JSX", powershell: "PowerShell", ps1: "PowerShell" };

  function label(language) {
    const key = String(language || "").toLowerCase();
    return aliases[key] || (key ? language : "Код");
  }

  function pattern(language) {
    const lang = language.toLowerCase();
    const comment = lang === "html" || lang === "xml" ? "<!--[\\s\\S]*?(?:-->|$)"
      : hashComments.has(lang) ? "#[^\\n]*"
      : dashComments.has(lang) ? "--[^\\n]*|/\\*[\\s\\S]*?(?:\\*/|$)"
      : lang === "css" ? "/\\*[\\s\\S]*?(?:\\*/|$)"
      : "//[^\\n]*|/\\*[\\s\\S]*?(?:\\*/|$)";
    const strings = lang === "python" || lang === "py"
      ? "\"\"\"[\\s\\S]*?(?:\"\"\"|$)|'''[\\s\\S]*?(?:'''|$)|\"(?:\\\\.|[^\"\\\\\\n])*\"?|'(?:\\\\.|[^'\\\\\\n])*'?"
      : "\"(?:\\\\.|[^\"\\\\\\n])*\"?|'(?:\\\\.|[^'\\\\\\n])*'?|`(?:\\\\.|[^`\\\\])*`?";
    return new RegExp(`(${comment})|(${strings})|(\\b(?:0x[0-9a-fA-F]+|\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?)\\b)|` +
      "([A-Za-z_$][\\w$]*)(?=\\s*\\()|([A-Za-z_$][\\w$]*)|(@[A-Za-z_][\\w.]*)", "g");
  }

  function highlight(source, language) {
    const text = String(source ?? "");
    const lang = String(language || "").toLowerCase();
    if (plain.has(lang) || text.length > LIMIT) return esc(text);
    if (lang === "json") {
      return text.replace(/("(?:\\.|[^"\\\n])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)|([^"\w-]+|[\w-])/gi,
        (all, string, colon, literal, number, other) => string ? `<span class="${colon ? "tok-p" : "tok-s"}">${esc(string)}</span>${colon || ""}`
          : literal ? `<span class="tok-k">${literal}</span>` : number ? `<span class="tok-n">${number}</span>` : esc(other ?? all));
    }
    const re = pattern(lang);
    let out = "", last = 0;
    for (const match of text.matchAll(re)) {
      out += esc(text.slice(last, match.index));
      const [all, comment, string, number, call, word, annotation] = match;
      out += comment ? `<span class="tok-c">${esc(all)}</span>`
        : string ? `<span class="tok-s">${esc(all)}</span>`
        : number ? `<span class="tok-n">${esc(all)}</span>`
        : call ? (keywords.has(call) ? `<span class="tok-k">${esc(call)}</span>` : `<span class="tok-f">${esc(call)}</span>`)
        : word ? (keywords.has(word) || keywords.has(word.toLowerCase()) && /sql/.test(lang) ? `<span class="tok-k">${esc(word)}</span>`
          : /^[A-Z][a-z0-9]+[A-Z]?\w*$/.test(word) ? `<span class="tok-t">${esc(word)}</span>` : esc(word))
        : annotation ? `<span class="tok-a">${esc(all)}</span>` : esc(all);
      last = match.index + all.length;
    }
    return out + esc(text.slice(last));
  }

  return { highlight, label };
})();
