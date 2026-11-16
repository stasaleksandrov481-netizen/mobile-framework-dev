import type { Metadata } from "next";
import Link from "next/link";
import InteractiveGrid from "@/components/InteractiveGrid";
import { RegistrationForm } from "@/components/Registration";
import UiIcon from "@/components/UiIcon";
import { registrationIsOpen } from "@/lib/registration-gate";

export const metadata: Metadata = {
  title: "Регистрация — CORTEX",
  description: "Регистрация в CORTEX до запуска открытой беты 20 ноября. Бонус 5 000 ИИ-токенов для ранних пользователей.",
};

export default function RegisterPage() {
  return (
    <div className="auth-page">
      <header className="auth-header">
        <Link className="brand" href="/" aria-label="CORTEX — на главную">
          <img src="/cortex-mark.svg" alt="" /><span>CORTEX</span>
        </Link>
        <Link href="/" className="auth-back"><UiIcon name="arrow-right" size={16} /> На главную</Link>
      </header>

      <main className="auth-main">
        {registrationIsOpen() ? <RegistrationForm /> : (
          <section className="auth-form-area" aria-labelledby="auth-title">
            <p className="auth-kicker">CORTEX · РАННИЙ ДОСТУП</p>
            <h1 id="auth-title">Регистрация пока закрыта.</h1>
            <p className="auth-description">О начале регистрации сообщим в официальном канале CORTEX.</p>
            <a className="button button--primary auth-submit" href="https://t.me/cortexdevlog" target="_blank" rel="noopener noreferrer">Новости CORTEX</a>
          </section>
        )}
      </main>

      <footer className="auth-footer">
        <span>© 2026 CORTEX</span>
        <div className="auth-footer-links">
          <Link href="/privacy">Конфиденциальность</Link>
          <Link href="/terms">Условия</Link>
          <Link href="/consent">Согласие</Link>
          <Link href="/pricing">Тарифы</Link>
          <a href="mailto:support@cortexapp.ru">support@cortexapp.ru</a>
        </div>
      </footer>

      <aside className="auth-art" aria-hidden="true">
        <InteractiveGrid />
        <div className="grid-logo"><img src="/cortex-mark.svg" alt="" /></div>
      </aside>
    </div>
  );
}
