"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useCortexAccount } from "@/lib/use-cortex-account";

/** The public landing is for guests; verified members see their account. */
export default function LandingAccountGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { checking, email } = useCortexAccount();

  useEffect(() => {
    if (!checking && email) router.replace("/account");
  }, [checking, email, router]);

  // Keep the public landing in the server-rendered HTML for crawlers and guests.
  // Once Auth verifies a member, replace it with the transition screen.
  if (!checking && email) return (
    <div className="account-gate" role="status" aria-label="Открываем CORTEX">
      <img src="/cortex-mark.svg" width="53" height="53" alt="CORTEX" />
    </div>
  );
  return <>{children}</>;
}
