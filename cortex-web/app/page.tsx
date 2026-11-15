import PhoneModel from "@/components/PhoneModel";
import { DownloadCTA, Registration } from "@/components/Registration";
import UiIcon from "@/components/UiIcon";

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
          <span>Telegram</span><UiIcon name="arrow-up-right" size={17} />
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
            <Registration />
            <DownloadCTA url={downloadUrl} />
          </div>
          <p className="bonus-note"><strong>+5 000 ИИ-токенов</strong> за раннюю регистрацию. О запуске сообщим по почте, если согласишься получать уведомление.</p>
        </div>
        <div className="hero-visual">
          <PhoneModel />
        </div>
      </main>

      <footer className="site-footer">
        <span>© 2026 CORTEX</span>
        <div className="footer-links">
          <a href="/privacy"><UiIcon name="shield" size={15} />Конфиденциальность</a>
          <a href="https://t.me/cortexdevlog" target="_blank" rel="noopener noreferrer">Telegram<UiIcon name="arrow-up-right" size={15} /></a>
        </div>
      </footer>
    </div>
  );
}
