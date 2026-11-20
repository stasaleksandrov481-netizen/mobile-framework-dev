"use client";

import Link from "next/link";
import UiIcon from "@/components/UiIcon";
import { useCortexAccount } from "@/lib/use-cortex-account";

export default function RegistrationCta({ isOpen }: { isOpen: boolean }) {
  const { email } = useCortexAccount();
  if (email) {
    return <Link className="glass glass--lg glass--light" href="/account" aria-label="Открыть личный кабинет CORTEX">
      <UiIcon name="user" size={17} /><span>Личный кабинет</span><UiIcon name="arrow-up-right" size={17} />
    </Link>;
  }
  if (!isOpen) {
    return <Link className="glass glass--lg glass--light" href="/register?mode=signin">
      <span>Войти в аккаунт</span><UiIcon name="arrow-right" size={17} />
    </Link>;
  }
  return <Link id="register" className="glass glass--lg glass--light" href="/register">
    <span>Создать аккаунт</span><UiIcon name="arrow-up-right" size={17} />
  </Link>;
}
