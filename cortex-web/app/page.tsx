import Image from "next/image";
import Link from "next/link";
import DownloadCTA from "@/components/DownloadCTA";
import LandingAccountGate from "@/components/LandingAccountGate";
import RegistrationCta from "@/components/RegistrationCta";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import UiIcon from "@/components/UiIcon";
import { registrationIsOpen } from "@/lib/registration-gate";

export const revalidate = 60;

const features = [
  {
    icon: "phone",
    title: "Открывайте приложения",
    example: "«Открой калькулятор»",
  },
  {
    icon: "layers",
    title: "Меняйте настройки",
    example: "«Уменьши яркость экрана»",
  },
  {
    icon: "bell",
    title: "Ставьте будильники",
    example: "«Разбуди меня в 7:30»",
  },
  {
    icon: "mic",
    title: "Создавайте напоминания",
    example: "«Напомни позвонить маме вечером»",
  },
] as const;

const questions = [
  {
    q: "Что доступно бесплатно?",
    a: "Управление телефоном, сценарии и напоминания. Облачный ИИ тоже доступен бесплатно с дневным лимитом.",
  },
  {
    q: "Когда можно скачать приложение?",
    a: "Скачивание пока закрыто. Об открытии сообщим в Telegram и по почте тем, кто подписался на уведомления.",
  },
  {
    q: "Куда уходят мои данные?",
    a: "Локальные команды выполняются на телефоне. Запросы к облачному ИИ проходят через сервер CORTEX. Текст с экрана передаётся только с вашего отдельного согласия.",
  },
];

export default function Home() {
  return (
    <LandingAccountGate>
      <div className="page landing">
        <SiteHeader />

        <main>
          <section className="landing-hero" aria-labelledby="hero-title">
            <div className="landing-hero-visual" aria-hidden="true">
              <Image
                src="/cortex-hero-monochrome.webp"
                alt=""
                width={1536}
                height={1024}
                unoptimized
                preload
              />
            </div>
            <div className="landing-hero-copy">
              <h1 id="hero-title">Управляйте Android голосом</h1>
              <p className="landing-hero-lead">Откройте приложение, поставьте будильник или создайте напоминание одной фразой.</p>
              <div className="landing-hero-actions">
                <RegistrationCta isOpen={registrationIsOpen()} />
                <a className="landing-button" href="#features">Что умеет CORTEX</a>
              </div>
              <DownloadCTA />
            </div>
          </section>

          <section className="landing-section landing-features" id="features" aria-labelledby="features-title">
            <div className="landing-section-intro">
              <h2 id="features-title">Просто скажите, что нужно</h2>
              <p>Говорите своими словами. Если команда неясна, CORTEX уточнит, что вы имели в виду.</p>
            </div>
            <ul className="landing-command-list">
              {features.map(item => (
                <li key={item.title}>
                  <span className="landing-feature-icon" aria-hidden="true"><UiIcon name={item.icon} size={19} /></span>
                  <div>
                    <h3>{item.title}</h3>
                    <p>{item.example}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="landing-section landing-panels" aria-label="Тарифы и приватность">
            <article className="landing-panel">
              <h2>Основное бесплатно</h2>
              <p>Управление телефоном и напоминания бесплатны. Подписка увеличивает дневной лимит облачного ИИ.</p>
              <Link className="landing-button" href="/pricing">Смотреть тарифы</Link>
            </article>
            <article className="landing-panel">
              <h2>Вы решаете, что разрешить</h2>
              <p>Простые команды выполняются на телефоне. Перед звонком или отправкой CORTEX попросит подтверждение.</p>
              <Link className="landing-button" href="/permissions">О разрешениях</Link>
            </article>
          </section>

          <section className="landing-section landing-faq" aria-labelledby="faq-title">
            <div className="landing-section-intro">
              <h2 id="faq-title">Частые вопросы</h2>
              <Link className="landing-text-link" href="/questions">Все вопросы</Link>
            </div>
            <div className="landing-faq-list">
              {questions.map(item => (
                <details key={item.q}>
                  <summary>{item.q}<span className="landing-faq-toggle" aria-hidden="true" /></summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
          </section>

          <section className="landing-section landing-release" aria-labelledby="release-title">
            <div className="landing-section-intro">
              <h2 id="release-title">Узнайте о запуске</h2>
              <p>Дату открытия скачивания объявим в Telegram. Ранние участники получат 5 000 ИИ-токенов после запуска.</p>
            </div>
            <a className="landing-button" href="https://t.me/cortexdevlog" target="_blank" rel="noopener noreferrer">Канал в Telegram</a>
          </section>
        </main>

        <SiteFooter />
      </div>
    </LandingAccountGate>
  );
}
