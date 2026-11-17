import { Failure } from "./provider.ts";

const booleans = ["reduceMotion", "haptics", "voiceContinue", "rememberSaved", "notifyReplies",
  "phoneActions", "visualLaunch", "hideLandscape", "hotwordEnabled", "memory"];
const values: Record<string, string[]> = {
  quality: ["full", "balanced", "simple"], model: ["auto", "fast", "deep"],
  language: ["auto", "ru-RU", "en-US"], overlayMode: ["always", "wake", "off"],
  energy: ["economy", "balanced", "maximum"], replyStyle: ["brief", "balanced", "deep"],
};
const strings: Record<string, number> = { addressName: 60, tone: 90, description: 180 };
const keys = [...booleans, ...Object.keys(values), ...Object.keys(strings), "aiModel"];

export const settingsToolName = "propose_cortex_settings";
const schema = {
  type: "object", additionalProperties: false,
  properties: { actions: { type: "array", maxItems: 5, items: {
    type: "object", additionalProperties: false,
    properties: { key: { type: "string", enum: keys }, value: { type: "string", maxLength: 180 } },
    required: ["key", "value"],
  } } },
  required: ["actions"],
};
export const settingsFormat = { type: "json_schema", json_schema: { name: "cortex_settings", strict: true, schema } };
export const settingsTool = { type: "function", function: {
  name: settingsToolName, description: "Propose strictly bounded Android app settings requested by the user. Do not execute them.",
  parameters: schema,
} };
export const settingsGuide = "\n\nYou can call propose_cortex_settings when the user explicitly requests " +
  "changing CORTEX settings. Return only the tool arguments or JSON matching the schema. " +
  "Each value MUST be a STRING. Boolean settings use 'true'/'false'. Maximum 5 changes. " +
  "Do not change Android permissions, subscription, account, payment, data deletion or security settings. " +
  "Return {\"actions\":[]} for ambiguous requests. " +
  "Valid keys: " + keys.join(", ") + ". Enum values: " +
  Object.entries(values).map(([key, entries]) => key + "=" + entries.join("|")).join("; ") + ". " +
  "aiModel must be an exact OpenRouter catalog model ID. Do not write secrets or tokens. " +
  "These proposals are untrusted until the Android client validates them and user confirms sensitive changes.";

export function checkedSettingsPlan(text: string, models: ReadonlySet<string>) {
  try {
    if (text.length > 5_500) throw new Error("oversized");
    const obj = JSON.parse(text.trim().replace(/^`{3}(?:json)?\s*([\s\S]*?)\s*`{3}$/iu, "$1"));
    if (!obj || typeof obj !== "object" || Array.isArray(obj) || Object.keys(obj).join() !== "actions" ||
      !Array.isArray(obj.actions) || obj.actions.length > 5) throw new Error("shape");
    const seen = new Set<string>();
    const actions = obj.actions.map((item: unknown) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("item");
      const data = item as Record<string, unknown>;
      if (Object.keys(data).sort().join() !== "key,value" ||
        typeof data.key !== "string" || typeof data.value !== "string" || seen.has(data.key)) throw new Error("fields");
      const { key } = data;
      const raw = data.value.trim();
      seen.add(key);
      let value: string | boolean = raw;
      if (booleans.includes(key)) {
        if (raw !== "true" && raw !== "false") throw new Error("boolean");
        value = raw === "true";
      } else if (Object.hasOwn(values, key)) {
        if (!values[key].includes(raw)) throw new Error("enum");
      } else if (key === "aiModel") {
        if (raw !== "auto" && !models.has(raw)) throw new Error("model");
      } else if (Object.hasOwn(strings, key)) {
        if (!raw || raw.length > strings[key] || /[<>\r\n\x00-\x1f]/u.test(raw)) throw new Error("string");
      } else throw new Error("unknown");
      return { key, value };
    });
    return { actions };
  } catch { throw new Failure("invalid_plan", 502); }
}
