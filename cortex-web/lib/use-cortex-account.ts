"use client";

import { useEffect, useState } from "react";
import { cortexAuth } from "@/lib/cortex-auth";

type AccountState = { checking: boolean; email: string | null };

/** Authenticated account state is obtained from Supabase, not localStorage flags. */
export function useCortexAccount(): AccountState {
  const [state, setState] = useState<AccountState>({ checking: true, email: null });

  useEffect(() => {
    let active = true;
    let generation = 0;

    const refresh = async () => {
      const requestId = ++generation;
      try {
        const { data: { user }, error } = await cortexAuth.auth.getUser();
        if (!active || generation !== requestId) return;
        setState({
          checking: false,
          email: !error && user?.email_confirmed_at && user.email ? user.email.toLowerCase() : null,
        });
      } catch {
        if (active && generation === requestId) setState({ checking: false, email: null });
      }
    };

    void refresh();
    const { data: { subscription } } = cortexAuth.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        ++generation;
        if (active) setState({ checking: false, email: null });
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
