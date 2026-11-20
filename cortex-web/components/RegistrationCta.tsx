"use client";

import Link from "next/link";
import UiIcon from "@/components/UiIcon";
import { useCortexAccount } from "@/lib/use-cortex-account";

export default function RegistrationCta({ isOpen }: { isOpen: boolean }) {
  const { checking, email } = useCortexAccount();
  if (checking) {
    return <span className="glass glass--lg glass--light is-pending" role="status" aria-label="Проверяем вход">Проверяем аккаунт…</span>;
  }
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
