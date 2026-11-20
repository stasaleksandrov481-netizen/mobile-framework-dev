"use client";

import Link from "next/link";
import { useCortexAccount } from "@/lib/use-cortex-account";

export default function RegistrationCta({ isOpen }: { isOpen: boolean }) {
  const { checking, email } = useCortexAccount();
  const className = "landing-button landing-button--primary";

  if (checking) {
    return <span className={className} role="status">Проверяем вход…</span>;
  }
  if (email) {
    return <Link className={className} href="/account">Личный кабинет</Link>;
  }
  if (!isOpen) {
    return <Link className={className} href="/register?mode=signin">Войти в аккаунт</Link>;
  }
  return <Link id="register" className={className} href="/register">Создать аккаунт</Link>;
}
