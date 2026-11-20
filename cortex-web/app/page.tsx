import Link from "next/link";
import DownloadCTA from "@/components/DownloadCTA";
import LandingAccountGate from "@/components/LandingAccountGate";
import LandingMotion from "@/components/LandingMotion";
import RegistrationCta from "@/components/RegistrationCta";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import UiIcon from "@/components/UiIcon";
import { registrationIsOpen } from "@/lib/registration-gate";

export const revalidate = 60;

const commands = [
  { icon: "phone", title: "Приложения", example: "«Открой калькулятор»" },
  { icon: "bell", title: "Будильники", example: "«Разбуди меня в 7:30»" },
  { icon: "mic", title: "Напоминания", example: "«Напомни позвонить вечером»" },
] as const;

export default function Home() {
  return (
    <LandingAccountGate>
      <div className="page landing">
        <SiteHeader />

        <main>
          <section className="landing-hero" aria-labelledby="hero-title">
            <LandingMotion />
            <div className="landing-shell landing-hero-inner">
              <div className="landing-hero-copy">
                <h1 id="hero-title">Управляйте Android голосом</h1>
                <p className="landing-hero-lead">Открывайте приложения, меняйте настройки и ставьте будильник одной фразой.</p>
                <div className="landing-hero-actions">
                  <RegistrationCta isOpen={registrationIsOpen()} />
                  <a className="landing-button" href="#features">Возможности</a>
                </div>
                <DownloadCTA />
              </div>
            </div>
          </section>

          <section className="landing-shell landing-section" id="features" aria-labelledby="features-title">
            <header className="landing-section-intro" data-landing-reveal>
              <h2 id="features-title">Достаточно сказать</h2>
              <p>Говорите своими словами. Если команда неясна, CORTEX уточнит детали.</p>
            </header>

            <ul className="landing-command-grid">
              {commands.map(command => (
                <li className="landing-command-card" key={command.title} data-landing-reveal>
                  <div className="landing-command-light" aria-hidden="true" />
                  <div className="landing-command-content">
                    <UiIcon name={command.icon} size={24} />
                    <h3>{command.title}</h3>
                    <p>{command.example}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="landing-shell landing-section landing-access" aria-labelledby="access-title">
            <div data-landing-reveal>
              <h2 id="access-title">Когда можно скачать?</h2>
              <p>Дату запуска объявим в Telegram и по почте тем, кто подписался на уведомления.</p>
            </div>
            <div className="landing-access-actions" data-landing-reveal>
              <a className="landing-button" href="https://t.me/cortexdevlog" target="_blank" rel="noopener noreferrer">Канал в Telegram</a>
              <Link className="landing-text-link" href="/questions">Частые вопросы</Link>
            </div>
          </section>
        </main>

        <SiteFooter />
      </div>
    </LandingAccountGate>
  );
}
