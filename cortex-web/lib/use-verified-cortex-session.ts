"use client";

import { useEffect, useRef, useState } from "react";
import { AuthApiError } from "@supabase/supabase-js";
import type { Session, User } from "@supabase/supabase-js";
import { cortexAuth, cortexClientWithToken, verifyCortexUser } from "./cortex-auth";

type VerifiedSession = {
  user: User;
  key: number;
  getToken: () => Promise<string>;
  isCurrent: () => boolean;
  client: ReturnType<typeof cortexClientWithToken>;
};

export function useVerifiedCortexSession() {
  const [state, setState] = useState({
    session: null as VerifiedSession | null, checking: true, failed: false,
  });
  const [attempt, setAttempt] = useState(0);
  const nextKey = useRef(0);

  useEffect(() => {
    let active = true;
    let generation = 0;
    let timer: number | undefined;
    let expectedOwner: string | null = null;
    let key = ++nextKey.current;
    let verifiedToken: string | null = null;
    let binding: Omit<VerifiedSession, "user"> | null = null;
    setState({ session: null, checking: true, failed: false });
    const initializationTimeout = window.setTimeout(() => {
      if (active && generation === 0) setState({ session: null, checking: false, failed: true });
    }, 9_000);

    function receive(session: Session | null) {
      const revision = ++generation;
      window.clearTimeout(initializationTimeout);
      window.clearTimeout(timer);
      const owner = session?.user?.id ?? null;
      if (owner !== expectedOwner) {
        expectedOwner = owner;
        key = ++nextKey.current;
        verifiedToken = null;
        binding = null;
        setState({ session: null, checking: Boolean(owner), failed: false });
      }
      if (!session || !owner) {
        verifiedToken = null;
        setState({ session: null, checking: false, failed: false });
        return;
      }
      const sessionKey = key;
      const accessToken = session.access_token;
      if (verifiedToken === accessToken) return;
      // GoTrue holds its session lock during events. Verify in a separate task.
      timer = window.setTimeout(() => void (async () => {
        try {
          const user = await verifyCortexUser(accessToken);
          if (!active || revision !== generation) return;
          if (user.id !== owner || !user.email || !user.email_confirmed_at) {
            verifiedToken = null;
            setState({ session: null, checking: false, failed: false });
            return;
          }
          verifiedToken = accessToken;
          if (!binding) {
            const isCurrent = () => active && key === sessionKey && expectedOwner === owner && Boolean(verifiedToken);
            const getToken = async () => {
              if (!isCurrent() || !verifiedToken) throw new Error("session_changed");
              return verifiedToken;
            };
            binding = { key: sessionKey, getToken, isCurrent, client: cortexClientWithToken(getToken) };
          }
          setState({ session: { user, ...binding }, checking: false, failed: false });
        } catch (error) {
          if (!active || revision !== generation) return;
          verifiedToken = null;
          const rejected = error instanceof AuthApiError && (error.status === 401 || error.status === 403 || error.code === "session_not_found");
          setState({ session: null, checking: false, failed: !rejected });
        }
      })(), 0);
    }

    const { data: { subscription } } = cortexAuth.auth.onAuthStateChange((_event, session) => receive(session));
    return () => {
      active = false;
      window.clearTimeout(initializationTimeout);
      window.clearTimeout(timer);
      subscription.unsubscribe();
    };
  }, [attempt]);

  return { ...state, retry: () => setAttempt(value => value + 1) };
}
