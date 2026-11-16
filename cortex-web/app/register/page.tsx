import type { Metadata } from "next";
import Link from "next/link";
import InteractiveGrid from "@/components/InteractiveGrid";
import { RegistrationForm } from "@/components/Registration";
import UiIcon from "@/components/UiIcon";

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
        <RegistrationForm />
      </main>

      <footer className="auth-footer">
        <span>© 2026 CORTEX</span>
        <div className="auth-footer-links">
          <Link href="/privacy">Конфиденциальность</Link>
          <Link href="/terms">Условия</Link>
          <Link href="/pricing">Тарифы</Link>
          <Link href="/support">Поддержка</Link>
        </div>
      </footer>

      <aside className="auth-art" aria-hidden="true">
        <InteractiveGrid />
        <div className="grid-topline"><span>VOICE FIRST INTERFACE</span><span>2026 / BETA</span></div>
        <div className="grid-statement">
          <span className="grid-statement-number">01 / INTELLIGENT INTERFACE</span>
          <strong>CORTEX<span className="grid-statement-caret">_</span></strong>
          <span className="grid-statement-rule" />
          <span className="grid-statement-description">ГОЛОС → ДЕЙСТВИЕ</span>
        </div>
        <div className="grid-bottomline">
          <p>Слова становятся действиями.</p>
          <span>CORTEX / ANDROID</span>
        </div>
      </aside>
    </div>
  );
}
