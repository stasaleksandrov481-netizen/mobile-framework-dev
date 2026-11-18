import type { Metadata } from "next";
import Link from "next/link";
import InteractiveGrid from "@/components/InteractiveGrid";
import { RegistrationForm } from "@/components/Registration";
import UiIcon from "@/components/UiIcon";
import { registrationIsOpen } from "@/lib/registration-gate";

// Re-evaluate the operator-controlled registration gate on every request.
// A prerendered static page could keep exposing a stale signup form after closure.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Вход и регистрация — CORTEX",
  description: "Вход в CORTEX и регистрация новых аккаунтов, когда ранний доступ открыт.",
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

      <main className="auth-main"><RegistrationForm signupEnabled={registrationIsOpen()} /></main>

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
