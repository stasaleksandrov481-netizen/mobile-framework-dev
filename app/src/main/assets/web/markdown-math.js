"use strict";

// A small, dependency-free LaTeX → MathML converter for AI answers.
// It understands the subset models actually write (fractions, roots, scripts,
// Greek letters, operators, functions, matrices, cases) and never emits markup
// taken from the input: every character is escaped and every element name is fixed.
const CortexMath = (() => {
  const LIMIT = 1500;
  const esc = value => String(value).replace(/[&<>"']/g, ch =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

  const greek = {
    alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ϵ", varepsilon: "ε", zeta: "ζ", eta: "η",
    theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π",
    varpi: "ϖ", rho: "ρ", varrho: "ϱ", sigma: "σ", varsigma: "ς", tau: "τ", upsilon: "υ", phi: "ϕ",
    varphi: "φ", chi: "χ", psi: "ψ", omega: "ω", Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ",
    Xi: "Ξ", Pi: "Π", Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω"
  };
  const operators = {
    pm: "±", mp: "∓", times: "×", cdot: "⋅", div: "÷", ast: "∗", star: "⋆", circ: "∘", bullet: "∙",
    le: "≤", leq: "≤", ge: "≥", geq: "≥", ne: "≠", neq: "≠", approx: "≈", equiv: "≡", sim: "∼", simeq: "≃",
    cong: "≅", propto: "∝", ll: "≪", gg: "≫", to: "→", rightarrow: "→", leftarrow: "←", gets: "←",
    leftrightarrow: "↔", Rightarrow: "⇒", Leftarrow: "⇐", Leftrightarrow: "⇔", implies: "⟹", iff: "⟺",
    mapsto: "↦", in: "∈", notin: "∉", ni: "∋", subset: "⊂", subseteq: "⊆", supset: "⊃", supseteq: "⊇",
    cup: "∪", cap: "∩", setminus: "∖", emptyset: "∅", varnothing: "∅", forall: "∀", exists: "∃",
    nexists: "∄", neg: "¬", lnot: "¬", land: "∧", wedge: "∧", lor: "∨", vee: "∨", oplus: "⊕", otimes: "⊗",
    perp: "⊥", parallel: "∥", angle: "∠", degree: "°", prime: "′", infty: "∞", partial: "∂", nabla: "∇",
    hbar: "ℏ", ell: "ℓ", Re: "ℜ", Im: "ℑ", aleph: "ℵ", ldots: "…", cdots: "⋯", vdots: "⋮", ddots: "⋱",
    dots: "…", colon: ":", mid: "∣", vert: "|", Vert: "‖", langle: "⟨", rangle: "⟩", lfloor: "⌊",
    rfloor: "⌋", lceil: "⌈", rceil: "⌉", lbrace: "{", rbrace: "}", backslash: "∖", triangle: "△",
    therefore: "∴", because: "∵"
  };
  const largeOps = { sum: "∑", prod: "∏", coprod: "∐", int: "∫", iint: "∬", iiint: "∭", oint: "∮",
    bigcup: "⋃", bigcap: "⋂", bigoplus: "⨁", bigotimes: "⨂" };
  const functions = new Set(["sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan", "sinh",
    "cosh", "tanh", "log", "ln", "lg", "exp", "lim", "max", "min", "sup", "inf", "det", "deg", "dim", "gcd",
    "arg", "ker", "Pr", "mod"]);
  const limitsUnder = new Set(["lim", "max", "min", "sup", "inf"]);
  const accents = { hat: "^", bar: "¯", overline: "¯", vec: "→", dot: "˙", ddot: "¨", tilde: "~", widehat: "^",
    widetilde: "~", overrightarrow: "→" };
  const fonts = { mathbf: "bold", boldsymbol: "bold-italic", mathit: "italic", mathrm: "normal",
    mathsf: "sans-serif", mathtt: "monospace", mathbb: "double-struck", mathcal: "script", mathfrak: "fraktur" };
  const spaces = { ",": "0.17em", ":": "0.22em", ";": "0.28em", " ": "0.25em", quad: "1em", qquad: "2em", "!": "0em" };
  const envs = { matrix: ["", ""], pmatrix: ["(", ")"], bmatrix: ["[", "]"], Bmatrix: ["{", "}"],
    vmatrix: ["|", "|"], Vmatrix: ["‖", "‖"], cases: ["{", ""], aligned: ["", ""], align: ["", ""],
    "align*": ["", ""], array: ["", ""], gathered: ["", ""], split: ["", ""] };

  function tokenize(src) {
    const tokens = [];
    for (let i = 0; i < src.length;) {
      const ch = src[i];
      if (ch === "\\") {
        const word = /^\\([A-Za-z]+\*?)/.exec(src.slice(i));
        if (word) { tokens.push({ t: "cmd", v: word[1] }); i += word[0].length; continue; }
        tokens.push({ t: "cmd", v: src[i + 1] || "\\" }); i += 2; continue;
      }
      if (/\s/.test(ch)) { i++; continue; }
      if (/[0-9]/.test(ch)) {
        const num = /^[0-9]+(?:[.,][0-9]+)?/.exec(src.slice(i))[0];
        tokens.push({ t: "num", v: num }); i += num.length; continue;
      }
      tokens.push({ t: "ch", v: ch }); i++;
    }
    return tokens;
  }

  function parse(src) {
    const tokens = tokenize(src);
    let pos = 0;
    const peek = () => tokens[pos];
    const next = () => tokens[pos++];

    function group() {
      // Argument of a command: {...} or a single atom.
      const token = peek();
      if (!token) return "<mrow></mrow>";
      if (token.t === "ch" && token.v === "{") { next(); return "<mrow>" + list("}") + "</mrow>"; }
      return atom();
    }

    function rawGroup() {
      // Plain text argument for \text{...} and \begin{...}.
      if (peek()?.t !== "ch" || peek().v !== "{") return "";
      next();
      let depth = 1, out = "";
      while (pos < tokens.length) {
        const token = next();
        if (token.t === "ch" && token.v === "{") depth++;
        if (token.t === "ch" && token.v === "}" && --depth === 0) break;
        out += token.t === "cmd" ? (token.v === " " ? " " : "\\" + token.v) : token.v;
      }
      return out;
    }

    function optional() {
      if (peek()?.t !== "ch" || peek().v !== "[") return null;
      next();
      return "<mrow>" + list("]") + "</mrow>";
    }

    function scripts(base, under = false) {
      let sub = null, sup = null;
      while (peek()?.t === "ch" && (peek().v === "_" || peek().v === "^")) {
        const kind = next().v;
        const value = group();
        if (kind === "_") sub = value; else sup = value;
      }
      while (peek()?.t === "ch" && peek().v === "'") { next(); sup = (sup || "") + "<mo>′</mo>"; }
      if (sub && sup) return under ? `<munderover>${base}${sub}${sup}</munderover>` : `<msubsup>${base}${sub}${sup}</msubsup>`;
      if (sub) return under ? `<munder>${base}${sub}</munder>` : `<msub>${base}${sub}</msub>`;
      if (sup) return under ? `<mover>${base}${sup}</mover>` : `<msup>${base}${sup}</msup>`;
      return base;
    }

    function environment(name) {
      const [open, close] = envs[name];
      if (name === "array" && peek()?.t === "ch" && peek().v === "{") rawGroup();
      const rows = [[[]]];
      while (pos < tokens.length) {
        const token = peek();
        if (token.t === "cmd" && token.v === "end") { next(); rawGroup(); break; }
        if (token.t === "ch" && token.v === "&") { next(); rows.at(-1).push([]); continue; }
        if (token.t === "cmd" && token.v === "\\") { next(); rows.push([[]]); continue; }
        rows.at(-1).at(-1).push(item());
      }
      const body = rows.filter(row => row.some(cell => cell.length)).map(row => "<mtr>" +
        row.map(cell => "<mtd>" + cell.join("") + "</mtd>").join("") + "</mtr>").join("");
      const align = name === "cases" || name.startsWith("align") || name === "split" ? ' columnalign="left"' : "";
      const table = `<mtable${align}>${body}</mtable>`;
      if (!open && !close) return table;
      return "<mrow>" + (open ? `<mo fence="true">${esc(open)}</mo>` : "") + table +
        (close ? `<mo fence="true">${esc(close)}</mo>` : "") + "</mrow>";
    }

    function command(name) {
      if (Object.hasOwn(greek, name)) return scripts(`<mi>${greek[name]}</mi>`);
      if (Object.hasOwn(largeOps, name)) {
        const display = !name.includes("int");
        return scripts(`<mo largeop="true"${display ? ' movablelimits="true"' : ""}>${largeOps[name]}</mo>`, display);
      }
      if (Object.hasOwn(operators, name)) return scripts(`<mo>${operators[name]}</mo>`);
      if (functions.has(name)) return scripts(`<mi mathvariant="normal">${name}</mi>`, limitsUnder.has(name));
      if (Object.hasOwn(spaces, name)) return `<mspace width="${spaces[name]}"></mspace>`;
      switch (name) {
        case "frac": case "dfrac": case "tfrac": return scripts(`<mfrac>${group()}${group()}</mfrac>`);
        case "binom": return scripts(`<mrow><mo>(</mo><mfrac linethickness="0">${group()}${group()}</mfrac><mo>)</mo></mrow>`);
        case "sqrt": {
          const index = optional();
          const body = group();
          return scripts(index ? `<mroot>${body}${index}</mroot>` : `<msqrt>${body}</msqrt>`);
        }
        case "text": case "textrm": case "mbox": case "operatorname": {
          const text = rawGroup();
          return scripts(name === "operatorname" ? `<mi mathvariant="normal">${esc(text)}</mi>` : `<mtext>${esc(text)}</mtext>`);
        }
        case "textbf": return scripts(`<mtext mathvariant="bold">${esc(rawGroup())}</mtext>`);
        case "left": case "right": case "big": case "Big": case "bigl": case "bigr": case "Bigl": case "Bigr": {
          const token = next();
          if (!token || token.v === ".") return "";
          const symbol = token.t === "cmd" ? (operators[token.v] ?? token.v) : token.v;
          return `<mo fence="true" stretchy="true">${esc(symbol)}</mo>`;
        }
        case "begin": {
          const env = rawGroup();
          return Object.hasOwn(envs, env) ? environment(env) : `<mtext>${esc(env)}</mtext>`;
        }
        case "\\": return "<mspace linebreak=\"newline\"></mspace>";
        case "{": case "}": case "%": case "$": case "#": case "&": case "_":
          return scripts(`<mo>${esc(name)}</mo>`);
        case "displaystyle": case "textstyle": case "limits": case "nolimits": return "";
      }
      if (Object.hasOwn(accents, name)) {
        return scripts(`<mover accent="true">${group()}<mo>${accents[name]}</mo></mover>`);
      }
      if (name === "underline") return scripts(`<munder>${group()}<mo>_</mo></munder>`);
      if (Object.hasOwn(fonts, name)) {
        const body = group().replace(/<mi>/g, `<mi mathvariant="${fonts[name]}">`);
        return scripts(body);
      }
      // Unknown command: show it literally instead of guessing.
      return scripts(`<mtext>\\${esc(name)}</mtext>`);
    }

    function atom() {
      const token = next();
      if (!token) return "";
      if (token.t === "num") return scripts(`<mn>${esc(token.v)}</mn>`);
      if (token.t === "cmd") return command(token.v);
      const ch = token.v;
      if (ch === "{") return scripts("<mrow>" + list("}") + "</mrow>");
      if (/[A-Za-z]/.test(ch)) return scripts(`<mi>${esc(ch)}</mi>`);
      if (ch === "'") return "<mo>′</mo>";
      if (ch === "_" || ch === "^") { pos--; return scripts("<mrow></mrow>"); }
      return scripts(`<mo>${esc(ch === "-" ? "−" : ch === "*" ? "∗" : ch)}</mo>`);
    }

    function item() {
      const token = peek();
      if (token?.t === "ch" && (token.v === "_" || token.v === "^")) return scripts("<mrow></mrow>");
      return atom();
    }

    function list(end) {
      let out = "";
      while (pos < tokens.length) {
        const token = peek();
        if (end && token.t === "ch" && token.v === end) { next(); return out; }
        if (token.t === "cmd" && token.v === "end") return out;
        out += item();
      }
      return out;
    }

    return list(null);
  }

  /** Returns MathML for a TeX source, or null when it is too long to convert safely. */
  function render(source, display) {
    const src = String(source ?? "").trim();
    if (!src || src.length > LIMIT) return null;
    let body;
    try { body = parse(src); } catch { return null; }
    return `<math xmlns="http://www.w3.org/1998/Math/MathML" class="${display ? "math-block" : "math-inline"}"` +
      (display ? ' display="block"' : "") + `><semantics><mrow>${body}</mrow>` +
      `<annotation encoding="application/x-tex">${esc(src)}</annotation></semantics></math>`;
  }

  return { render };
})();
