import { Failure } from "./provider.ts";

const actions = ["home", "back", "quick_settings", "open", "tap", "set", "type", "submit", "scroll", "swipe", "read", "expect", "lock"];
const directions = ["up", "down", "left", "right"];
const step = {
  type: "object",
  additionalProperties: false,
  properties: {
    action: { type: "string", enum: actions },
    target: { type: "string" }, value: { type: "string" }, expect: { type: "string" }, confirm: { type: "boolean" },
  },
  required: ["action", "target", "value", "expect", "confirm"],
};
export const visualFormat = {
  type: "json_schema",
  json_schema: {
    name: "cortex_android_plan",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        steps: { type: "array", items: step },
        question: { type: "string" }, answer: { type: "string" }, done: { type: "boolean" },
      },
      required: ["steps", "question", "answer", "done"],
    },
  },
};

export const visualToolName = "plan_android_screen";
export const visualTool = {
  type: "function",
  function: {
    name: visualToolName,
    description: "Return the next verified steps CORTEX should take in Android, or a concrete question.",
    parameters: visualFormat.json_schema.schema,
  },
};

export const visualGuide = 'Return exactly one JSON object with keys steps, question, answer, done. ' +
  'Each step has keys action, target, value, expect, confirm. Allowed actions: ' +
  actions.join(", ") + '. Use empty strings or false for unused values. Return the plan through plan_android_screen if available.';

function field(value: unknown, maximum: number): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" || value.length > maximum || value.includes("\0")) throw new Failure("invalid_plan", 502);
  return value;
}

export function checkedVisualPlan(text: string) {
  try {
    if (text.length > 18_000) throw new Failure("invalid_plan", 502);
    const data = JSON.parse(text.trim().replace(/^`{3}(?:json)?\s*([\s\S]*?)\s*`{3}$/i, "$1"));
    if (!data || !Array.isArray(data.steps) || data.steps.length > 10 ||
      Object.keys(data).some(key => !["steps", "question", "answer", "done"].includes(key))) throw new Failure("invalid_plan", 502);
    const question = field(data.question, 1200).trim(), answer = field(data.answer, 6000).trim();
    if (data.done !== undefined && typeof data.done !== "boolean") throw new Failure("invalid_plan", 502);
    const done = data.done === true;
    const steps = data.steps.map((item: Record<string, unknown>) => {
      if (!item || Object.keys(item).some(key => !step.required.includes(key)) ||
        typeof item.action !== "string" || item.confirm !== undefined && typeof item.confirm !== "boolean") {
        throw new Failure("invalid_plan", 502);
      }
      const action = item.action.trim().toLowerCase();
      const target = field(item.target, 180).trim(), value = field(item.value, 2400);
      const expect = field(item.expect, 180).trim();
      if (!actions.includes(action)) throw new Failure("invalid_plan", 502);
      const valid = action === "type" ? Boolean(value.trim())
        : ["open", "tap", "expect"].includes(action) ? Boolean(target && !value)
        : action === "set" ? Boolean(target && ["on", "off"].includes(value))
        : ["scroll", "swipe"].includes(action) ? directions.includes(value)
        : !target && !value;
      if (!valid) throw new Failure("invalid_plan", 502);
      return { action, target, value, expect, confirm: item.confirm === true };
    });
    if (!steps.length && !question && !answer && !done ||
      done && (question || steps.some((item: {action: string}) => item.action === "read"))) throw new Failure("invalid_plan", 502);
    return { steps, question, answer, done };
  } catch {
    throw new Failure("invalid_plan", 502);
  }
}
