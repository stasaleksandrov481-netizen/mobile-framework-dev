import { Failure } from "./provider.ts";

export type Database = <T>(path: string, method?: string, payload?: unknown, preference?: string) => Promise<T>;

type Gate = { mode: "open" | "maintenance" | "update" | "beta"; message?: string; update_url?: string };
type ControlConfig = {
  maintenance_enabled: boolean;
  maintenance_message: string;
  block_old_versions: boolean;
  min_version_code: number;
  update_url: string;
  beta_enabled: boolean;
  beta_message: string;
};

const OPEN: Gate = { mode: "open" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_VERSION = /^[1-9][0-9]{0,9}$/;

export function createControl(database: Database) {
  let config: { value: Promise<ControlConfig | undefined>; until: number } | undefined;
  const versions = new Map<number, { value: Promise<boolean>; until: number }>();

  function blocked(code: number): Promise<boolean> {
    if (code <= 0 || code > 2_100_000_000) return Promise.resolve(false);
    const old = versions.get(code);
    if (old && old.until > Date.now()) return old.value;
    const value = database<Array<{ access: string }>>("cortex_release_versions?select=access&version_code=eq." + code + "&limit=1")
      .then(rows => rows[0]?.access === "blocked");
    if (versions.size >= 24) versions.clear();
    versions.set(code, { value, until: Date.now() + 8000 });
    void value.catch(() => { if (versions.get(code)?.value === value) versions.delete(code); });
    return value;
  }

  function configuration() {
    if (config && config.until > Date.now()) return config.value;
    const value = database<ControlConfig[]>(
      "cortex_control_config?select=maintenance_enabled,maintenance_message,block_old_versions,min_version_code,update_url,beta_enabled,beta_message&singleton=eq.true&limit=1",
    ).then(rows => rows[0]);
    config = { value, until: Date.now() + 5000 };
    void value.catch(() => { if (config?.value === value) config = undefined; });
    return value;
  }

  async function gate(request: Request, account?: { id: string; email: string } | null): Promise<Gate> {
    const settings = await configuration();
    // Missing settings must never bypass maintenance or closed-beta admission.
    if (!settings) throw new Failure("storage_config", 503);
    const clientVersion = request.headers.get("x-cortex-version-code") || "";
    const versionCode = VALID_VERSION.test(clientVersion) ? Number(clientVersion) : 0;
    const needsUpdate = (settings.block_old_versions && versionCode < settings.min_version_code) ||
      await blocked(versionCode);
    if (!settings.maintenance_enabled && !needsUpdate && !settings.beta_enabled) return OPEN;

    if (account?.id && UUID.test(account.id)) {
      const roles = await database<Array<{ role: string }>>(
        "cortex_admin_roles?select=role&user_id=eq." + account.id + "&limit=1",
      );
      if (["owner", "admin", "support"].includes(roles[0]?.role ?? "")) return OPEN;
    }
    const accountId = account?.id;
    const grants = settings.maintenance_enabled && accountId &&
        (UUID.test(accountId) || /^yandex_[A-Za-z0-9_-]{43}$/.test(accountId))
      ? await database<Array<{ maintenance_until: string }>>(
        "cortex_public_accounts?select=maintenance_until&subject=eq." + accountId + "&limit=1",
      ) : [];
    if (settings.maintenance_enabled && !(Date.parse(grants[0]?.maintenance_until || "") > Date.now())) {
      return { mode: "maintenance", message: settings.maintenance_message || "CORTEX временно недоступен." };
    }
    if (needsUpdate) return { mode: "update", message: "Установите актуальную версию CORTEX.", update_url: httpsUrl(settings.update_url) };
    if (settings.beta_enabled) {
      // With beta switched on, no guest or unauthenticated installation may use the API.
      const install = request.headers.get("x-cortex-install") || "";
      if (account && /^[a-zA-Z0-9_-]{43}$/.test(install)) {
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(install));
        const fingerprint = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
        const admitted = await database<boolean>("rpc/cortex_beta_admit", "POST", {
          p_email: account.email, p_account: account.id, p_install: fingerprint,
        });
        if (admitted === true) return OPEN;
      }
      return { mode: "beta", message: settings.beta_message || "Доступен только участникам закрытого тестирования." };
    }
    return OPEN;
  }

  async function presence(install: string, input: Record<string, unknown>, version: string, stable: string | null, account?: string) {
    const session = input.session_id;
    const screen = input.screen;
    if (typeof session !== "string" || !UUID.test(session) || typeof screen !== "string" ||
        !/^[a-z][a-z-]{0,39}$/.test(screen)) throw new Failure("invalid", 400);
    if (stable) {
      await database("rpc/cortex_record_launch", "POST", {
        p_device: stable, p_session: session, p_subject: account ?? null, p_version: version, p_old_install: install,
      });
    }
    const time = new Date().toISOString();
    await database("cortex_installs?on_conflict=install_hash", "POST", {
      install_hash: install, last_seen_at: time, app_version: version, platform: "android", last_screen: screen,
    }, "resolution=merge-duplicates");
    await database("cortex_app_sessions?on_conflict=id", "POST", {
      id: session, install_hash: install, last_seen_at: time,
    }, "resolution=ignore-duplicates");
    await database("cortex_app_sessions?id=eq." + session + "&install_hash=eq." + install, "PATCH", { last_seen_at: time });
  }

  async function inbox(owners: string[]) {
    if (!owners.length) throw new Failure("client_version", 400);
    const tickets = await database<Array<{ id: string }>>(
      "cortex_support?select=id,created_at,category,message,status&order=created_at.desc,id.desc&limit=50&device_hash=in.(" +
      owners.map(encodeURIComponent).join(",") + ")",
    );
    const ids = tickets.map(ticket => ticket.id).filter(id => UUID.test(id));
    const replies = ids.length ? await database(
      "cortex_support_replies?select=id,ticket_id,created_at,message&order=created_at.desc,id.desc&limit=500&ticket_id=in.(" + ids.join(",") + ")",
    ) : [];
    return { tickets, replies };
  }

  return { gate, presence, inbox };
}

function httpsUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password) return url.toString();
  } catch { /* Invalid update URL. */ }
}
