import Image from "next/image";
import Link from "next/link";
import CommandShowcase from "@/components/CommandShowcase";
import DownloadCTA from "@/components/DownloadCTA";
import LandingPhone from "@/components/LandingPhone";
import UiIcon from "@/components/UiIcon";

const questions = [
  {
    question: "Что доступно бесплатно?",
    answer: "Команды телефона, сценарии, напоминания и голосовой островок. Для облачного ИИ действует дневной лимит.",
  },
  {
    question: "Когда можно скачать приложение?",
    answer: "Дату открытия объявим в Telegram и пришлём письмом тем, кто подписался на уведомления.",
  },
  {
    question: "Нужен ли интернет для команд?",
    answer: "Поддерживаемые локальные команды выполняются на устройстве. Для запросов к облачному ИИ нужен интернет.",
  },
  {
    question: "Можно ли отключить доступ к экрану?",
    answer: "Да. Управление экраном включается отдельно, а разрешение можно отозвать в настройках Android.",
  },
];

export default function LandingDetails({ registrationOpen }: { registrationOpen: boolean }) {
  return (
    <div className="landing-details">
      <section className="landing-shell landing-features" id="features" aria-labelledby="features-title">
        <header className="landing-heading">
          <h2 id="features-title">От команды<br /> до действия.</h2>
          <p>Нажмите на островок CORTEX и скажите, что нужно сделать. Посмотрите, как это выглядит в приложении.</p>
        </header>
        <CommandShowcase />
      </section>

      <section className="landing-shell" aria-labelledby="device-title">
        <div className="device-section">
          <div className="device-copy">
            <h2 id="device-title">Вы выбираете, что разрешить</h2>
            <dl className="device-facts">
              <div>
                <dt>На телефоне</dt>
                <dd>Локальные команды выполняются на устройстве.</dd>
              </div>
              <div>
                <dt>С подтверждением</dt>
                <dd>Перед отправкой сообщения или звонком CORTEX спросит вас.</dd>
              </div>
              <div>
                <dt>С разрешением</dt>
                <dd>Текст с экрана передаётся в облако только с отдельного согласия.</dd>
              </div>
            </dl>
            <Link className="landing-cta landing-cta--ink" href="/permissions">
              Разрешения Android <UiIcon name="arrow-up-right" size={16} />
            </Link>
          </div>
          <div className="device-visual">
            <LandingPhone className="device-phone" screen="/landing/permissions.webp"
              alt="Экран доступов Android в приложении CORTEX" />
          </div>
        </div>
      </section>

      <section className="landing-shell landing-answers" aria-labelledby="faq-title">
        <header>
          <h2 id="faq-title">Частые вопросы</h2>
          <Link className="landing-text-link" href="/questions">Все вопросы <UiIcon name="arrow-up-right" size={17} /></Link>
        </header>
        <div className="landing-faq">
          {questions.map(({ question, answer }) => (
            <details key={question}>
              <summary>{question}<span className="landing-faq-toggle" aria-hidden="true" /></summary>
              <p>{answer}</p>
            </details>
          ))}
          <Link className="landing-pricing-link" href="/pricing">
            <span><strong>Тарифы CORTEX</strong><small>Дневные лимиты облачного ИИ и цены</small></span>
            <UiIcon name="arrow-up-right" size={19} />
          </Link>
        </div>
      </section>

      <section className="landing-shell" aria-labelledby="launch-title">
        <div className="landing-launch">
          <div className="landing-launch-copy">
            <h2 id="launch-title">Узнайте о запуске</h2>
            <p>Дату открытия опубликуем в Telegram. Ранним участникам после запуска начислим 5 000 ИИ‑токенов.</p>
            <div className="landing-launch-actions">
              <a className="landing-cta landing-cta--paper" href="https://t.me/cortexdevlog" target="_blank" rel="noopener noreferrer">
                <UiIcon name="telegram" size={19} /> Канал в Telegram
              </a>
              <Link className="landing-cta landing-cta--outline" href={registrationOpen ? "/register" : "/register?mode=signin"}>
                {registrationOpen ? "Создать аккаунт" : "Войти в аккаунт"} <UiIcon name="arrow-up-right" size={16} />
              </Link>
            </div>
            <div className="landing-download"><DownloadCTA /></div>
          </div>
          <div className="landing-launch-art" aria-hidden="true">
            <Image src="/cortex-mark.svg" alt="" width={100} height={100} unoptimized />
          </div>
        </div>
      </section>
    </div>
  );
}
