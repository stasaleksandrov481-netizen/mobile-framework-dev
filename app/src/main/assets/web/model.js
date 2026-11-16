"use strict";

const Cortex = (() => {
  const key = "cortex.interface.v2";
  const instructionFields = [
    { id: "goal", label: "Задача", value: "Выполняй запросы на телефоне, проверяй результат и помогай разбираться в задачах." },
    { id: "reply", label: "Ответы", value: "Начинай с сути. Для сложной задачи предложи короткий план и уточни важные детали." },
    { id: "actions", label: "Действия", value: "При запросе действия используй возможности Android и сообщай проверенный результат." },
    { id: "confirm", label: "Уточнения", value: "Если запрос неоднозначен, задай один вопрос, который сильнее всего меняет ответ." }
  ];
  const styles = { brief: "Коротко", deep: "Длинно", balanced: "Авто" };
  const languages = { auto: "Авто", "ru-RU": "Русский", "en-US": "Английский" };
  const motion = { full: "Полные", balanced: "Сбалансированные", simple: "Упрощённые" };
  const defaults = {
    quality: "balanced", reduceMotion: false, rememberSaved: true,
    language: "auto", haptics: true, voiceContinue: true,
    phoneActions: true, visualBeta: false, visualBetaNotice: false, visualLaunch: false, notifyReplies: false,
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

  function usage(value) {
    const { input, output, total } = object(value);
    if (![input, output, total].every(x => Number.isSafeInteger(x) && x >= 0) || input + output !== total) return null;
    return { input, output, total };
  }

  function migrateChat(item) {
    return {
      id: string(item.id, 100) || uid("chat"),
      saved: Boolean(item.saved), pinned: Boolean(item.pinned),
      updated: string(item.updated, 40) || new Date().toISOString(),
      title: string(item.title, 72) || "Новый чат",
      messages: array(item.messages).filter(message => ["user", "assistant"].includes(message?.role) && message.text)
        .map(({role, text, local, resumable, usage: measured}) => ({ role, text: string(text, 20000),
          ...(usage(measured) && { usage: usage(measured) }),
          ...(local === true && { local: true }), ...(resumable === true && { resumable: true }) }))
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
      tone: string(edit.tone, 90) || "Спокойный и дружелюбный",
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

  function assistantOptions() {
    const edit = state.edits.cortex;
    return { style: profile().style, tone: string(edit.tone, 90), character: string(edit.description, 380),
      language: state.preferences.language };
  }

  function automaticProfile(text) {
    if (/коротко|кратко|в двух словах|briefly/iu.test(text)) return "auto";
    return text.length > 700 || /(?:подробно|пошагово|сравни|спроектируй|разбери|напиши код|проанализируй|step by step|in detail|analy[sz]e)/iu.test(text)
      ? "deep" : "auto";
  }

  function replyStyle(text) {
    const style = profile().style;
    if (style !== "balanced") return style;
    if (/коротко|кратко|в двух словах|briefly/iu.test(text)) return "brief";
    return automaticProfile(text) === "deep" ? "deep" : "balanced";
  }

  function smallTalk(text) {
    const words = text.toLowerCase().replaceAll("ё", "е").replace(/^\s*(?:кортекс|cortex)[,\s]+/u, "")
      .trim().replace(/[.!?…]+$/u, "").replace(/\s+/gu, " ");
    const status = /^(?:(?:привет(?:ик)?|здарова|здорова|хай|йо)[!, ]+)?(?:как (?:у тебя )?(?:дела|дила|делишки)|как ты|как жизнь|как оно|чо как|че как|что как|как сам)$/u.test(words);
    const hello = /^(?:привет(?:ик)?|здарова|здорова|хай|здравствуйте|добрый день|добрый вечер|доброе утро|йо)$/u.test(words);
    const statusEn = /^(?:how are you|how are you doing|how.s it going)$/u.test(words);
    const helloEn = /^(?:hi|hello|hey)$/u.test(words);
    if (!status && !hello && !statusEn && !helloEn) return null;
    const english = state.preferences.language === "en-US" || state.preferences.language === "auto" && (statusEn || helloEn);
    const formal = /официальн|формальн|на вы/iu.test(assistantOptions().tone);
    if (status || statusEn) return english ? "Doing well. How about you?" : formal ? "Всё хорошо. А у вас как?" : "Всё хорошо. А у тебя как?";
    return english ? (formal ? "Hello! How can I help?" : "Hey! What’s up?") : (formal ? "Здравствуйте! Чем помочь?" : "Привет! Что нового?");
  }

  function turns(chat, policy) {
    const person = assistantOptions();
    const data = memory();
    const savedRules = object(state.instructions.cortex);
    const conversation = chat.messages.filter(message => !message.local);
    const request = conversation.at(-1)?.text || "";
    const termsInRequest = terms(request);
    const recallsMemory = /вспомни|помнишь|раньше|обсуждали|продолжи|про меня|обо мне|remember|earlier/iu.test(request);
    const facts = data.enabled ? data.entries.filter(item => item.enabled !== false).map(item => {
      const fact = string(item.title, 48) + ": " + string(item.value, 170);
      return { fact, matches: termsInRequest.filter(word => fact.toLowerCase().replaceAll("ё", "е").includes(word)).length };
    }).filter(item => item.matches || recallsMemory).sort((a, b) => b.matches - a.matches).slice(0, 4)
      .map(item => item.fact).join("\n") : "";
    let start = conversation.length;
    let budget = automaticProfile(request) === "deep" ? 7800 : 4000;
    while (start > 0 && conversation.length - start < 10) {
      const item = conversation[start - 1];
      const length = (start === conversation.length ? item.text.length : Math.min(item.text.length, item.role === "assistant" ? 3000 : 5000)) + 2;
      if (length > budget && start < conversation.length - 1) break;
      start--;
      budget -= length;
    }
    const background = data.enabled && (recallsMemory || start > 0 || state.preferences.rememberSaved && termsInRequest.length >= 2)
      ? relevantHistory(chat, request, conversation.slice(0, start)) : "";
    const system = [
      person.language !== "auto" ? "Язык: " + languages[person.language] : "",
      person.tone ? "Манера: " + person.tone : "",
      person.character ? "Характер: " + person.character : "",
      state.preferences.addressName ? "Обращение: " + JSON.stringify(string(state.preferences.addressName, 60)) : "",
      ...instructionFields.flatMap(field => {
        const custom = string(savedRules[field.id], 380).trim();
        return custom && custom !== field.value ? [field.label + ": " + custom] : [];
      }),
      facts ? "Память:\n" + facts : "",
      background ? "Из прежних бесед:\n" + background : "",
      policy
    ].filter(Boolean).join("\n");
    const messages = [];
    for (const item of conversation.slice(start)) {
      const limit = item.role === "assistant" ? 3000 : 5000;
      const content = item === conversation.at(-1) || item.text.length <= limit ? item.text
        : item.text.slice(0, limit / 2) + "\n…\n" + item.text.slice(-limit / 2);
      const previous = messages.at(-1);
      if (previous?.role === item.role) previous.content += "\n\n" + content;
      else if (content) messages.push({ role: item.role, content });
    }
    if (messages[0]?.role === "assistant") messages.shift();
    return [...(system ? [{ role: "system", content: system }] : []), ...messages];
  }

  if (old && Object.keys(old).length) save();
  return {
    state, defaults, motion, languages, styles, assistantOptions, automaticProfile, replyStyle, smallTalk, usage, instructionFields, profile, memory, chat, account,
    createChat, touch, turns, save, useAccount, clearLocalData, memoryCommand, learnFromUser, id: uid
  };
})();
