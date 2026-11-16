import Link from "next/link";
import DownloadCTA from "@/components/DownloadCTA";
import UiIcon from "@/components/UiIcon";
import { safeHttpsDownloadUrl } from "@/lib/safe-url";

const downloadUrl = safeHttpsDownloadUrl(process.env.NEXT_PUBLIC_CORTEX_ANDROID_DOWNLOAD_URL);

export default function Home() {
  return (
    <div className="shell">
      <header className="site-header">
        <a className="brand" href="/" aria-label="CORTEX — на главную">
          <img src="/cortex-mark.svg" alt="" />
          <span>CORTEX</span>
        </a>
        <a className="header-action" href="https://t.me/cortexdevlog" target="_blank" rel="noopener noreferrer">
          <UiIcon name="telegram" size={18} /><span>Telegram</span>
        </a>
      </header>

      <main className="hero">
        <div className="hero-copy">
          <p className="release-status"><span className="live-dot" /> ОТКРЫТАЯ БЕТА · 20 НОЯБРЯ</p>
          <h1>Телефон,<br />который <span>слышит.</span></h1>
          <p className="hero-description">
            CORTEX управляет Android по твоей команде. Меньше нажатий. Больше свободы.
          </p>
          <div className="hero-actions">
            <Link id="register" className="button button--primary" href="/register">
              Зарегистрироваться <span className="button-icon"><UiIcon name="arrow-up-right" size={18} /></span>
            </Link>
            <DownloadCTA url={downloadUrl} />
          </div>
          <p className="bonus-note"><strong>+5 000 ИИ-токенов</strong> за раннюю регистрацию. О запуске сообщим по почте, если согласишься получать уведомление.</p>
        </div>
      </main>

      <footer className="site-footer">
        <span>© 2026 CORTEX</span>
        <div className="footer-links">
          <a href="/privacy"><UiIcon name="shield" size={15} />Конфиденциальность</a>
          <a href="/terms">Условия</a>
          <a href="/offer">Оферта</a>
          <a href="/pricing">Тарифы</a>
          <a href="/questions">Вопросы</a>
          <a href="/support">Поддержка</a>
          <a href="mailto:support@cortexapp.ru">support@cortexapp.ru</a>
          <a href="https://t.me/cortexdevlog" target="_blank" rel="noopener noreferrer"><UiIcon name="telegram" size={15} />Telegram</a>
        </div>
      </footer>
    </div>
  );
}
