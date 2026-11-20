import { Failure, type ModelProfile, type Turn } from "./provider.ts";

type ChatRequest = {
  messages: Turn[];
  limit: number;
  device: boolean;
  repair: boolean;
  plan: boolean;
  visual: boolean;
  webSearch: boolean;
  profile?: ModelProfile;
  modelId?: string;
};

// Only an unpersonalised, one-turn educational question can be reused across
// accounts. A mobile client is untrusted: the server checks the entire payload.
function publicQuestion(input: ChatRequest): boolean {
  if (input.messages.length !== 1 || input.messages[0].role !== "user" || input.limit > 1450) return false;
  const query = input.messages[0].content.trim();
  return query.length >= 12 && query.length <= 180 && !/[\n@]|https?:\/\/|\d{5,}/iu.test(query) &&
    /^(?:что (?:такое|значит|означает)|как (?:работает|устроен[ао]?|появился)|объясни(?:те)?(?:,|\s)|в ч[её]м разница|почему|зачем|what is|how does|explain\s)/iu.test(query) &&
    !/(?:^|[^\p{L}])(?:мой|моя|мо[её]|мои|меня|мне|тебя|тебе|моего|моей|моих|наш|наша|у меня|сейчас|сегодня|вчера|завтра|актуальн\p{L}*|цена|курс)(?=$|[^\p{L}])/iu.test(query);
}

/** An exact input fingerprint, not an approximate semantic cache. */
export function chatFlightKey(input: ChatRequest, subject: string, plan: string): { key: string; public: boolean } | null {
  if (input.device || input.repair || input.plan || input.visual || input.webSearch || input.limit > 1450) return null;
  if (!subject || !input.messages.length) return null;
  const isPublic = !["start", "pro", "ultra"].includes(plan) && publicQuestion(input);
  // Different accounts never share a reply containing device facts, custom
  // instructions, history, user memory or their individual paid entitlement.
  const owner = isPublic ? "public" : "private:" + subject;
  return { key: owner + ":" + JSON.stringify({ turns: input.messages, limit: input.limit,
    profile: input.profile || "auto", model: input.modelId || "auto", plan }), public: isPublic };
}

const MAX_FLIGHTS = 32;
const MAX_FOLLOWERS = 8;
const MAX_REPLAY_BYTES = 256_000;
const MAX_AGE_MS = 60_000;
const PUBLIC_TTL_MS = 15_000;

class Flight {
  readonly created = Date.now();
  followers = 0;
  frames: Uint8Array[] = [];
  totalBytes = 0;
  finished = false;
  finishedAt = 0;
  success = false;
  ready: Promise<boolean>;
  private resolveReady!: (available: boolean) => void;
  private waiters = new Set<() => void>();
  private encoder = new TextEncoder();

  constructor(readonly isPublic: boolean) {
    this.ready = new Promise(resolve => { this.resolveReady = resolve; });
  }

  announce(available: boolean) { this.resolveReady(available); }

  private wake() {
    for (const resolve of this.waiters) resolve();
    this.waiters.clear();
  }

  private append(value: string) {
    const bytes = this.encoder.encode("data: " + value + "\n\n");
    if (this.totalBytes + bytes.byteLength > MAX_REPLAY_BYTES) throw new Error("replay_too_large");
    this.totalBytes += bytes.byteLength;
    this.frames.push(bytes);
    this.wake();
  }

  private finish(success: boolean) {
    this.finished = true;
    this.finishedAt = Date.now();
    this.success = success;
    this.wake();
  }

  async mirror(response: Response): Promise<boolean> {
    const reader = response.body?.getReader();
    if (!reader) { this.finish(false); return false; }
    const decoder = new TextDecoder();
    let pending = "";
    let hasText = false;
    try {
      while (true) {
        const { done, value } = await reader.read();
        pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
        let end: number;
        while ((end = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0, end).trim();
          pending = pending.slice(end + 1);
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") {
            if (!hasText) throw new Error("empty_stream");
            this.append("[DONE]");
            this.finish(true);
            return true;
          }
          let event: Record<string, unknown>;
          try { event = JSON.parse(payload); } catch { continue; }
          if (!event || typeof event !== "object" || Array.isArray(event)) continue;
          if (typeof event.delta === "string") {
            hasText ||= Boolean(event.delta);
            this.append(JSON.stringify({ delta: event.delta }));
          } else if (event.status === "text_ready" && hasText) {
            this.append(JSON.stringify({ status: "text_ready" }));
          } else if (typeof event.error === "string") {
            // Never replay quota objects or any subject-specific metadata.
            this.append(JSON.stringify({ error: "provider" }));
            this.finish(false);
            return false;
          }
        }
        if (pending.length > 40_000) throw new Error("sse_line_too_large");
        if (done) break;
      }
    } catch {
      // An oversized or malformed stream still reaches its original requester.
      // Followers fail closed, never receiving partial data from another user.
    } finally {
      reader.releaseLock();
    }
    try { this.append(JSON.stringify({ error: "provider" })); } catch { /* bounded */ }
    this.finish(false);
    return false;
  }

  follower(): Response {
    let cursor = 0;
    let active = true;
    const stream = new ReadableStream<Uint8Array>({
      pull: async controller => {
        while (active && cursor === this.frames.length && !this.finished) {
          await new Promise<void>(resolve => this.waiters.add(resolve));
        }
        if (!active) return;
        if (cursor < this.frames.length) controller.enqueue(this.frames[cursor++]);
        else controller.close();
      },
      cancel: () => { active = false; this.wake(); },
    });
    return new Response(stream, { headers: {
      "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform",
      "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Accel-Buffering": "no",
    } });
  }
}

/** Shared only within one warm function isolate. Failures never become cache hits. */
export class ChatFlights {
  private flights = new Map<string, Flight>();

  async run(fingerprint: { key: string; public: boolean } | null, produce: () => Promise<Response>): Promise<Response> {
    if (!fingerprint) return produce();
    for (const [key, entry] of this.flights) {
      if (Date.now() - entry.created >= MAX_AGE_MS || entry.finished &&
        (!entry.success || !entry.isPublic || Date.now() - entry.finishedAt >= PUBLIC_TTL_MS)) this.flights.delete(key);
    }
    const cached = this.flights.get(fingerprint.key);
    if (cached && Date.now() - cached.created < MAX_AGE_MS && cached.followers < MAX_FOLLOWERS) {
      cached.followers++;
      if (!await cached.ready) throw new Failure("provider", 502);
      return cached.follower();
    }
    if (cached || this.flights.size >= MAX_FLIGHTS) return produce();
    const flight = new Flight(fingerprint.public);
    this.flights.set(fingerprint.key, flight);
    const remove = () => { if (this.flights.get(fingerprint.key) === flight) this.flights.delete(fingerprint.key); };
    try {
      const response = await produce();
      if (response.status !== 200 || !response.headers.get("content-type")?.includes("text/event-stream")) {
        flight.announce(false);
        remove();
        return response;
      }
      const mirror = response.clone();
      flight.announce(true);
      void flight.mirror(mirror).then(ok => {
        if (!ok || !fingerprint.public) remove();
      }).catch(remove);
      return response;
    } catch (error) {
      flight.announce(false);
      remove();
      throw error;
    }
  }
}
