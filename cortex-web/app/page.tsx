import PhoneModel from "@/components/PhoneModel";
import { DownloadCTA, Registration } from "@/components/Registration";

const downloadUrl = process.env.NEXT_PUBLIC_CORTEX_ANDROID_DOWNLOAD_URL;

export default function Home() {
  return (
    <div className="shell">
      <header className="site-header">
        <a className="brand" href="/" aria-label="CORTEX — на главную">
          <img src="/cortex-mark.svg" alt="" />
          <span>CORTEX</span>
        </a>
        <a className="header-action" href="https://t.me/cortexdevlog" target="_blank" rel="noopener noreferrer">
          Наш Telegram <span aria-hidden="true">↗</span>
        </a>
      </header>

      <main className="hero">
        <div className="hero-copy">
          <p className="release-status"><span className="live-dot" /> ОТКРЫТАЯ БЕТА · 20.11.2026</p>
          <h1>Телефон,<br />который <span>слышит.</span></h1>
          <p className="hero-description">
            CORTEX управляет Android по твоей команде. Меньше нажатий. Больше свободы.
          </p>
          <div className="hero-actions">
            <Registration />
            <DownloadCTA url={downloadUrl} />
          </div>
          <p className="bonus-note">Регистрируйся сейчас. <strong>+5 000 ИИ-токенов</strong> к старту беты. Об открытии сообщим по почте с твоего согласия.</p>
        </div>
        <div className="hero-visual">
          <PhoneModel />
        </div>
      </main>

      <footer className="site-footer">
        <span>© 2026 CORTEX</span>
        <div className="footer-links">
          <a href="/privacy">Конфиденциальность</a>
          <a href="https://t.me/cortexdevlog" target="_blank" rel="noopener noreferrer">Telegram ↗</a>
        </div>
      </footer>
    </div>
  );
}
