"use client";

import Link from "next/link";
import UiIcon from "@/components/UiIcon";
import { useCortexAccount } from "@/lib/use-cortex-account";

/** Header entry point: sign-in for guests, the account for verified members. */
export default function HeaderAccount() {
  const { checking, email } = useCortexAccount();
  if (email) {
    return <Link className="glass glass--pill header-account" href="/account" aria-label="Открыть личный кабинет">
      <UiIcon name="user" size={16} /><span>Кабинет</span>
    </Link>;
  }
  return <Link className="glass glass--pill header-account" href="/register?mode=signin" aria-busy={checking || undefined}>
    <span>Войти</span><UiIcon name="arrow-right" size={15} />
  </Link>;
}
