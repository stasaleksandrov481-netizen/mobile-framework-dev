"use client";

import { useEffect, useState } from "react";
import { cortexAuth } from "@/lib/cortex-auth";
import { settleWithTimeout } from "@/lib/settle-with-timeout";

type AccountState = { checking: boolean; email: string | null; accountId: string | null; name: string | null; tone: unknown };

/** Authenticated account state is obtained from Supabase, not localStorage flags. */
export function useCortexAccount(): AccountState {
  const [state, setState] = useState<AccountState>({ checking: true, email: null, accountId:null, name:null, tone:null });

  useEffect(() => {
    let active = true;
    let generation = 0;

    const refresh = async () => {
      const requestId = ++generation;
      try {
        const { data: { user }, error } = await settleWithTimeout(cortexAuth.auth.getUser(), 9_000);
        if (!active || generation !== requestId) return;
        const verified=!error&&!!user?.email_confirmed_at&&!!user.email;
        const rawName=user?.user_metadata?.cortex_display_name||user?.user_metadata?.name;
        setState({
          checking:false,email:verified&&user?.email?user.email.toLowerCase():null,
          accountId:verified?user?.id??null:null,
          name:verified?(typeof rawName==="string"&&rawName.trim()?rawName.trim().slice(0,40):user?.email?.split("@")[0]??null):null,
          tone:verified?user?.user_metadata?.cortex_avatar_tone:null,
        });
      } catch {
        if (active && generation === requestId) setState({ checking: false, email: null, accountId:null, name:null,tone:null });
      }
    };

    void refresh();
    const { data: { subscription } } = cortexAuth.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        ++generation;
        if (active) setState({ checking: false, email: null, accountId:null, name:null,tone:null });
      } else {
        // Supabase advises against awaiting auth calls in this callback.
        window.setTimeout(() => { if (active) void refresh(); }, 0);
      }
    });
    const onFocus = () => { void refresh(); };
    const onVisibility = () => { if (!document.hidden) void refresh(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      ++generation;
      subscription.unsubscribe();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return state;
}
