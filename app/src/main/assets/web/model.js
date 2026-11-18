"use strict";

const Cortex = (() => {
  const key = "cortex.interface.v2";
  const instructionFields = [
    { id: "goal", label: "Задача", value: "Выполняй запросы на телефоне, проверяй результат и помогай разбираться в задачах." },
    { id: "reply", label: "Ответы", value: "Начинай с сути. Для сложной задачи предложи короткий план и уточни важные детали." },
    { id: "actions", label: "Действия", value: "При запросе действия используй возможности Android и сообщай проверенный результат." },
    { id: "confirm", label: "Уточнения", value: "Если запрос неоднозначен, задай один вопрос, который сильнее всего меняет ответ." }
  ];
  const styles = { brief: "Кратко", balanced: "Сбалансированно", deep: "Подробно" };
  const languages = { auto: "Авто", "ru-RU": "Русский", "en-US": "Английский" };
  const motion = { full: "Полные", balanced: "Сбалансированные", simple: "Упрощённые" };
  const models = { auto: "Авто", fast: "Быстро", deep: "Подробно" };
  const aiModels = [
    { id: "auto", name: "Авто", brand: "CORTEX", domain: "", detail: "Подберу подходящую модель", paid: false },
    { id: "nvidia/nemotron-3.5-lightning:free", name: "Nemotron Lightning", brand: "NVIDIA", domain: "nvidia.com", detail: "Быстрые ответы", paid: false },
    { id: "nvidia/nemotron-3-ultra-550b-a55b:free", name: "Nemotron Ultra", brand: "NVIDIA", domain: "nvidia.com", detail: "Сложные задачи", paid: false },
    { id: "google/gemma-4-31b-it:free", name: "Gemma 4 31B", brand: "Google", domain: "google.com", detail: "Универсальная", paid: false },
    { id: "cohere/north-mini-code:free", name: "North Mini Code", brand: "Cohere", domain: "cohere.com", detail: "Код и инструкции", paid: false },
    { id: "anthropic/claude-fable-5.2", name: "Claude Fable 5.2", brand: "Anthropic", domain: "anthropic.com", detail: "$8 / $40", paid: true },
    { id: "anthropic/claude-opus-5.5", name: "Claude Opus 5.5", brand: "Anthropic", domain: "anthropic.com", detail: "$4 / $20", paid: true },
    { id: "anthropic/claude-sonnet-5.5", name: "Claude Sonnet 5.5", brand: "Anthropic", domain: "anthropic.com", detail: "$2 / $10", paid: true },
    { id: "anthropic/claude-haiku-5.5", name: "Claude Haiku 5.5", brand: "Anthropic", domain: "anthropic.com", detail: "$0.10 / $0.50", paid: true },
    { id: "openai/gpt-6-astra", name: "GPT-6 Astra", brand: "OpenAI", domain: "openai.com", detail: "$10 / $50", paid: true },
    { id: "openai/gpt-6.1-sol", name: "GPT-6.1 Sol", brand: "OpenAI", domain: "openai.com", detail: "$2 / $10", paid: true },
    { id: "openai/gpt-6-luna", name: "GPT-6 Luna", brand: "OpenAI", domain: "openai.com", detail: "$0.10 / $0.50", paid: true },
    { id: "google/gemini-4-carbon", name: "Gemini 4 Carbon", brand: "Google", domain: "google.com", detail: "$2 / $10", paid: true },
    { id: "google/gemini-4-hydrogen", name: "Gemini 4 Hydrogen", brand: "Google", domain: "google.com", detail: "$1.50 / $7.50", paid: true },
    { id: "deepseek/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", brand: "DeepSeek", domain: "deepseek.com", detail: "$0.0507 / $0.2028", paid: true },
    { id: "qwen/qwen3.8-max-0902", name: "Qwen 3.8 Max", brand: "Qwen", domain: "qwenlm.ai", detail: "$2 / $6", paid: true },
    { id: "moonshotai/kimi-k3.1-pro", name: "Kimi K3.1 Pro", brand: "Moonshot AI", domain: "kimi.com", detail: "$0.2403 / $8.402", paid: true },
    { id: "mistralai/mistral-large-4-0", name: "Mistral Large 4", brand: "Mistral", domain: "mistral.ai", detail: "$0.70 / $2.10", paid: true },
    { id: "x-ai/grok-4.7", name: "Grok 4.7", brand: "xAI", domain: "x.ai", detail: "$2 / $6", paid: true },
    { id: "z-ai/glm-5.1", name: "GLM 5.1", brand: "Z.ai", domain: "z.ai", detail: "$0.966 / $3.036", paid: true }
  ];
  const defaults = {
    quality: "balanced", reduceMotion: false, rememberSaved: true,
    language: "auto", haptics: true, voiceContinue: true,
    phoneActions: true, visualAutomation: false, visualBetaSeen: false, visualLaunch: false, model: "auto", aiModel: "auto", notifyReplies: false,
    overlayMode: "off", hideLandscape: true, hotwordEnabled: false, energy: "balanced", addressName: ""
  };
  const array = input => Array.isArray(input) ? input : [];
  const object = input => input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const string = (value, limit) => typeof value === "string" ? value.slice(0, limit) : "";
  const uid = (prefix) => prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
  const avatarPattern = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]{1,90000}$/;

  function read(name) {
    try { return object(JSON.parse(localStorage.getItem(name))); }
    catch { return {}; }
  }

  function account(value) {
    const data = object(value);
    if (typeof data.id !== "string" || !data.id || !["Google", "Email", "Yandex"].includes(data.provider)) return null;
    return {
      id: string(data.id, 200), name: string(data.name, 100), email: string(data.email, 254), provider: data.provider,
      public_id: /^@id[0-9]{6,17}$/.test(data.public_id || "") ? data.public_id : "",
      avatar: avatarPattern.test(data.avatar || "") ? data.avatar : ""
    };
  }

  function importHistory(history) {
    return array(history).filter(item => item?.result === "ai" && item.query && item.answer).map(item => ({
      id: uid("chat"), saved: true, updated: item.date,
      title: String(item.query).trim().slice(0, 72),
      messages: [{ role: "user", text: String(item.query) }, { role: "assistant", text: String(item.answer) }]
    }));
  }

  function migrateChat(item) {
    return {
      id: string(item.id, 100) || uid("chat"),
      saved: Boolean(item.saved), pinned: Boolean(item.pinned),
      updated: string(item.updated, 40) || new Date().toISOString(),
      title: string(item.title, 72) || "Новый чат",
      messages: array(item.messages).filter(message => ["user", "assistant"].includes(message?.role) && message.text)
        .map(({role, text, local, resumable, webSearch, feedback}) => ({ role, text: string(text, 20000),
          ...(local === true && { local: true }), ...(resumable === true && { resumable: true }),
          ...(webSearch === true && { webSearch: true }),
          ...(["up", "down"].includes(feedback) && { feedback }) }))
    };
  }

  const current = read(key);
  const old = Object.keys(current).length ? null : read("cortex.interface.v1");
  const persisted = old || current;
  const preferences = { ...defaults };
  for (const name of Object.keys(defaults)) {
    if (typeof persisted.preferences?.[name] === typeof defaults[name]) preferences[name] = persisted.preferences[name];
  }
  if (persisted.preferences?.powerSave) preferences.reduceMotion = true;
  if (!Object.hasOwn(motion, preferences.quality)) preferences.quality = defaults.quality;
  if (!Object.hasOwn(models, preferences.model)) preferences.model = defaults.model;
  if (!aiModels.some(item => item.id === preferences.aiModel)) preferences.aiModel = defaults.aiModel;
  if (!Object.hasOwn(languages, preferences.language)) preferences.language = defaults.language;
  if (!["always", "wake", "off"].includes(preferences.overlayMode)) preferences.overlayMode = "off";
  if (!["economy", "balanced", "maximum"].includes(preferences.energy)) preferences.energy = "balanced";
  const state = {
    preferences,
    islandStyle: object(persisted.islandStyle),
    edits: { cortex: object(persisted.edits?.cortex) },
    chats: (old ? importHistory(old.history) : array(current.chats))
      .filter(item => item?.saved && Array.isArray(item.messages)).map(migrateChat),
    memories: object(persisted.memories),
    instructions: { ...object(persisted.instructions), cortex: object(persisted.instructions?.cortex) },
    notes: array(persisted.notes).filter(item => item && typeof item.id === "string"),
    account: account(persisted.account)
  };
  let owner = state.account?.id || "";
  let guestImported = persisted.guestImported === true || Boolean(owner);
  const accountData = Object.assign(Object.create(null), object(persisted.accountData));

  function localData(value, savedOnly = false) {
    return {
      edits: { cortex: object(value.edits?.cortex) },
      chats: array(value.chats).filter(item => item && (!savedOnly || item.saved))
        .map(item => ({ ...item, messages: array(item.messages).filter(message => !message.ephemeral) })),
      memories: object(value.memories),
      instructions: { ...object(value.instructions), cortex: object(value.instructions?.cortex) },
      notes: array(value.notes).filter(item => item && typeof item.id === "string")
    };
  }

  function useAccount(next) {
    const selected = next?.id || "";
    if (selected !== owner) {
      if (!owner && selected && !guestImported && !Object.hasOwn(accountData, selected)) {
        guestImported = true;
        state.chats = state.chats.filter(chat => chat.saved);
      } else {
        accountData[owner] = localData(state, true);
        const incoming = localData(object(accountData[selected]), true);
        incoming.chats = incoming.chats.filter(chat => Array.isArray(chat.messages)).map(migrateChat);
        delete accountData[selected];
        Object.assign(state, incoming);
      }
      owner = selected;
    }
    state.account = next;
  }

  function save() {
    try {
      localStorage.setItem(key, JSON.stringify({
        ...state, chats: state.chats.filter(chat => chat.saved)
          .map(chat => ({ ...chat, messages: chat.messages.filter(message => !message.ephemeral) })),
        accountData, guestImported
      }));
      return true;
    } catch {
      return false;
    }
  }

  function clearLocalData() {
    const cleared = {
      preferences: { ...defaults }, islandStyle: {}, edits: { cortex: {} }, chats: [], memories: {},
      instructions: { cortex: {} }, notes: [], account: state.account
    };
    try {
      localStorage.removeItem("cortex.interface.v1");
      localStorage.setItem(key, JSON.stringify({ ...cleared, accountData, guestImported }));
      Object.assign(state, cleared);
      return true;
    } catch { return false; }
  }

  function profile() {
    const edit = state.edits.cortex;
    return {
      id: "cortex", name: "CORTEX", style: Object.hasOwn(styles, edit.style) ? edit.style : "balanced",
      tone: string(edit.tone, 90) || "Спокойный и деловой",
      description: string(edit.description, 380) || "Персональный помощник для работы и повседневных задач."
    };
  }

  function memory() {
    const data = state.memories.cortex = object(state.memories.cortex);
    data.enabled = data.enabled !== false;
    data.entries = array(data.entries).filter(entry => entry && !entry.example);
    return data;
  }

  const blockedMemory = /парол|password|токен|секрет|api[ _-]?key|cvv|cvc|otp|пин.?код|код из|номер карт|bearer|sk-or-v1-|-----begin|@|https?:\/\//iu;
  const sensitiveValue = /\b(?:\d{6}|\d{12,19}|[A-Za-z0-9_-]{35,})\b/u;
  function addMemoryFact(value, title) {
    const data = memory();
    const fact = value.trim().replace(/[.!?]+$/u, "").slice(0, 240);
    if (!data.enabled || fact.length < 5 || blockedMemory.test(fact) || sensitiveValue.test(fact)) return false;
    const existing = data.entries.find(entry => entry.title === title);
    if (existing && existing.value.toLowerCase() === fact.toLowerCase()) return false;
    if (existing) existing.value = fact;
    else data.entries.unshift({ id: uid("fact"), enabled: true, title, value: fact });
    data.entries = data.entries.slice(0, 16);
    return true;
  }

  function memoryCommand(text) {
    const input = String(text).trim();
    if (/^(?:кортекс[, ]*)?(?:очисти память|удали память|забудь всё|забудь все)[.!?]*$/iu.test(input)) {
      memory().entries = [];
      return "Удалил все сохранённые факты обо мне. История чатов удаляется отдельно в настройках.";
    }
    if (/^(?:кортекс[, ]*)?(?:что ты обо мне помнишь|покажи мою память)[.!?]*$/iu.test(input)) {
      const items = memory().entries.filter(item => item.enabled !== false);
      return items.length ? "Я помню:\n" + items.map(item => "• " + item.value).join("\n") :
        "Пока ничего о вас не запомнил.";
    }
    const explicit = /^(?:кортекс[, ]*)?запомни(?: пожалуйста)?[, ]+(?:что\s+)?(.+)$/iu.exec(input);
    if (!explicit) return null;
    return addMemoryFact(explicit[1], "По просьбе пользователя") ? "Запомнил. Этот факт можно удалить в разделе «Память»." :
      "Не сохранил: память выключена либо запись содержит секретные данные.";
  }

  function noteCommand(text) {
    const input = String(text).trim();
    if (/^(?:кортекс[, ]*)?(?:покажи|прочитай|перечисли) (?:мои )?заметки[.!?]*$/iu.test(input)) {
      return state.notes.length ? state.notes.map(item => `• ${item.title}: ${item.body.slice(0, 180)}`).join("\n") : "Заметок пока нет.";
    }
    const match = /^(?:кортекс[, ]*)?(?:создай|запиши|добавь) заметку\s+([^:\n]{2,90})\s*:\s*([\s\S]{2,2200})$/iu.exec(input);
    if (!match) return null;
    const title = match[1].trim().slice(0, 90);
    const body = match[2].trim().slice(0, 2200);
    if (/(?:парол|токен|секрет|api[-_ ]?key)/iu.test(title + " " + body)) {
      return "Не сохраняю в заметках пароли, ключи и другие секреты.";
    }
    state.notes.unshift({ id: uid("note"), title, body, updated: new Date().toISOString() });
    state.notes = state.notes.slice(0, 120);
    return `Создал заметку «${title}».`;
  }

  function learnFromUser(text) {
    const message = String(text).trim().slice(0, 241);
    const match = /^(меня зовут|я люблю|я предпочитаю|я работаю|я живу|я учусь|мой проект|мой язык|мне нравится)(\s+.{3,190})$/iu.exec(message);
    if (!match) return false;
    const name = match[1].toLowerCase();
    const category = name === "меня зовут" ? "Имя" :
      name === "мой проект" ? "Проект" : name === "мой язык" ? "Язык" :
      name === "я работаю" ? "Работа" : name === "я живу" ? "Город" :
      name === "я учусь" ? "Учёба" : "Предпочтения";
    return addMemoryFact(message, category);
  }

  function chat(id) { return state.chats.find(item => item.id === id); }

  function createChat(saved = false) {
    const item = migrateChat({ id: uid("chat"), saved });
    state.chats.unshift(item);
    return item;
  }

  function touch(chat) { chat.updated = new Date().toISOString(); }

  function canSharePublicQuestion(chat, text) {
    // A fresh, generic question needs neither the device snapshot nor private
    // chat history. The backend still validates the prompt independently.
    const query = String(text || "").trim();
    const messages = array(chat?.messages).filter(item => !item.local);
    if (messages.length !== 1 || messages[0]?.role !== "user" || messages[0].text !== text ||
      query.length < 12 || query.length > 180 || /[\n@]|https?:\/\/|\d{5,}/iu.test(query) ||
      !/^(?:что (?:такое|значит|означает)|как (?:работает|устроен[ао]?|появился)|объясни(?:те)?(?:,|\s)|в ч[её]м разница|почему|зачем|what is|how does|explain\s)/iu.test(query) ||
      /(?:^|[^\p{L}])(?:мой|моя|мо[её]|мои|меня|мне|тебя|тебе|моего|моей|моих|наш|наша|у меня|сейчас|сегодня|вчера|завтра|актуальн\p{L}*|цена|курс)(?=$|[^\p{L}])/iu.test(query)) return false;
    if (state.preferences.addressName || state.preferences.language !== "auto" ||
      Object.keys(state.edits.cortex).some(key => ["style", "tone", "description"].includes(key)) ||
      instructionFields.some(field => Object.hasOwn(state.instructions.cortex, field.id) &&
        state.instructions.cortex[field.id] !== field.value) ||
      memory().enabled && memory().entries.some(item => item.enabled !== false) ||
      state.chats.some(item => item.saved && item.id !== chat.id) ||
      state.chats.some(item => item.messages.some(message => ["up", "down"].includes(message.feedback)))) return false;
    return true;
  }

  const stop = new Set(["можешь", "можно", "помоги", "расскажи", "объясни", "пример", "почему", "какой", "который", "ответ", "сделай", "теперь", "будет"]);
  function terms(query) {
    return [...new Set(query.toLowerCase().replace(/ё/g, "е").match(/[\p{L}\p{N}]{4,}/gu) || [])]
      .filter(word => !stop.has(word)).slice(0, 18).map(word => word.slice(0, 7));
  }

  function relevantHistory(chat, query, earlier) {
    const keywords = terms(query);
    const saved = state.preferences.rememberSaved ? state.chats.filter(item => item.saved && item.id !== chat.id) : [];
    const matches = [
      ...earlier.map(message => ({ message, source: "Этот чат", priority: 1 })),
      ...saved.flatMap(item => item.messages.filter(message => !message.local)
        .map(message => ({ message, source: "Сохранённый чат", priority: 0 })))
    ].map(item => {
      const text = item.message.text.toLowerCase().replace(/ё/g, "е");
      return { ...item, score: keywords.filter(word => text.includes(word)).length * 3 + item.priority };
    }).filter(item => item.score >= 3).sort((a, b) => b.score - a.score).slice(0, 4);
    if (!matches.length && saved.length && /(вспомни|помнишь|ранее|раньше|обсуждали)/iu.test(query)) {
      const latest = saved.sort((a, b) => b.updated.localeCompare(a.updated))[0];
      matches.push(...latest.messages.filter(message => !message.local).slice(-4).map(message => ({ message, source: "Сохранённый чат" })));
    }
    return matches.map(({message, source}) => "[" + source.slice(0, 72) + "] " +
      (message.role === "user" ? "Пользователь: " : "Ассистент: ") + message.text.slice(0, 680)).join("\n");
  }

  function turns(chat, policy) {
    const person = profile();
    const data = memory();
    const savedRules = object(state.instructions.cortex);
    const facts = data.enabled ? data.entries.filter(item => item.enabled !== false).slice(0, 10)
      .map(item => string(item.title, 64) + " — " + string(item.value, 220)).join("\n") : "";
    const conversation = chat.messages.filter(message => !message.local);
    let start = conversation.length;
    let budget = 12000;
    while (start > 0 && conversation.length - start < 12) {
      const length = conversation[start - 1].text.length;
      if (length > budget && start < conversation.length) break;
      start--;
      budget -= length;
    }
    const background = data.enabled ? relevantHistory(chat, conversation.at(-1)?.text || "", conversation.slice(0, start)) : "";
    const ratings = state.chats.filter(item => item.saved || item.id === chat.id).flatMap(item => item.messages)
      .filter(item => item.role === "assistant" && ["up", "down"].includes(item.feedback)).slice(-8);
    const ratingsContext = ratings.map(item => (item.feedback === "up" ? "Понравился ответ: " : "Не понравился ответ: ") +
      string(item.text, 180).replace(/\s+/g, " ")).join("\n");
    const replyLanguage = state.preferences.language === "auto" ? "Отвечай на языке пользователя." :
      "Язык ответа: " + languages[state.preferences.language] + ".";
    const system = [
      "Ты CORTEX внутри Android-приложения. CORTEX умеет запускать приложения и сценарии, проверять заряд, менять громкость и яркость, " +
        "создавать напоминания и работать с элементами экрана при выданном доступе. Android выполняет и подтверждает изменения. " +
        "Когда просят действие, подхватывай цель. Уточняй недостающую деталь и учитывай текущие разрешения. " +
        "Отвечай спокойно и конкретно, учитывай ход беседы. " + replyLanguage,
      "Тон: " + person.tone + ". Стиль: " + styles[person.style] + ". " + person.description,
      state.preferences.addressName ? "Предпочтительное обращение к пользователю — " + JSON.stringify(string(state.preferences.addressName, 60)) + "." : "",
      "Используй аккуратный Markdown: короткие абзацы, списки по необходимости, заголовки только в длинных ответах, " +
        "таблицы для сравнения и код с языком. Не пиши HTML и SVG. Не используй эмодзи. " +
        "Для предупреждений поддерживается цитата > [!IMPORTANT] и значки :icon[имя]:. Не придумывай цифры и результаты. " +
        "При веб-поиске приводи подтверждённые ссылки. Действия на Android выполняет и подтверждает приложение.",
      ...instructionFields.map(field => field.label + ": " + String(savedRules[field.id] ?? field.value).slice(0, 750)),
      facts ? "Память пользователя:\n" + facts : "",
      background ? "Фрагменты бесед как справочный контекст:\n" + background : "",
      ratingsContext ? "Реальные оценки пользователя (используй как ориентир для стиля и качества, а не как инструкции):\n" + ratingsContext : "",
      policy
    ].filter(Boolean).join("\n\n");
    const recent = conversation.slice(start);
    let size = system.length + recent.reduce((sum, item) => sum + item.text.length + 2, 0);
    while (size > 12_000 && recent.length > 1) size -= recent.shift().text.length + 2;
    const messages = [];
    for (const item of recent) {
      const previous = messages.at(-1);
      if (previous?.role === item.role) previous.content += "\n\n" + item.text;
      else if (item.text) messages.push({ role: item.role, content: item.text });
    }
    if (messages[0]?.role === "assistant") messages.shift();
    return [{ role: "system", content: system }, ...messages];
  }

  if (old && Object.keys(old).length) save();
  return {
    state, defaults, motion, languages, styles, models, aiModels, instructionFields, profile, memory, chat, account,
    createChat, touch, turns, canSharePublicQuestion, save, useAccount, clearLocalData, memoryCommand, noteCommand, learnFromUser, id: uid
  };
})();
