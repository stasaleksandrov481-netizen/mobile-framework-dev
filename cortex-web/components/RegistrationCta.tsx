"use client";

import Link from "next/link";
import UiIcon from "@/components/UiIcon";
import { useCortexAccount } from "@/lib/use-cortex-account";

export default function RegistrationCta({ isOpen }: { isOpen: boolean }) {
  const { checking, email } = useCortexAccount();
  if (checking) {
    return <span className="button button--secondary registration-checking" role="status" aria-label="Проверяем вход">Проверяем аккаунт…</span>;
  }
  if (email) {
    return <Link className="button button--secondary registration-registered" href="/account" aria-label="Открыть личный кабинет CORTEX">
      <UiIcon name="check" size={18} /> Личный кабинет <span className="button-icon"><UiIcon name="arrow-up-right" size={18} /></span>
    </Link>;
  }
  if (!isOpen) return <span className="button button--primary button--disabled">Регистрация скоро</span>;
  return <Link id="register" className="button button--primary" href="/register">
    Зарегистрироваться <span className="button-icon"><UiIcon name="arrow-up-right" size={18} /></span>
  </Link>;
}
