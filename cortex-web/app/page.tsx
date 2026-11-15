import InteractivePhone from "@/components/InteractivePhone";

const icons = {
  voice: <svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><rect x="12" y="4" width="8" height="16" rx="4" stroke="currentColor" strokeWidth="1.6"/><path d="M8 16a8 8 0 0016 0M16 24v4m-5 0h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>,
  layers: <svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><rect x="4" y="5" width="24" height="22" rx="5" stroke="currentColor" strokeWidth="1.6"/><path d="m10 14 4 4 8-8M10 23h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  clock: <svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><circle cx="16" cy="16" r="12" stroke="currentColor" strokeWidth="1.6"/><path d="M16 9v8l5 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  eye: <svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M3 16s4-8 13-8 13 8 13 8-4 8-13 8S3 16 3 16Z" stroke="currentColor" strokeWidth="1.6"/><circle cx="16" cy="16" r="4" stroke="currentColor" strokeWidth="1.6"/></svg>,
};

const features = [
  {num: "01", title: "Управление голосом", detail: "Открывает приложения, ищет элементы интерфейса и выполняет доступные действия Android по команде.", icon: icons.voice, label:"ГОЛОСОВЫЕ КОМАНДЫ"},
  {num: "02", title: "Сценарии из шагов", detail: "Собирай цепочки действий, назначай голосовые фразы и проверяй результат каждого шага.", icon: icons.layers, label:"СЦЕНАРИИ"},
  {num: "03", title: "Задачи по расписанию", detail: "Создавай напоминания и отложенные поручения. Список задач и история выполнения доступны в приложении.", icon: icons.clock, label:"ПЛАНИРОВЩИК"},
  {num: "04", title: "Контекст экрана", detail: "CORTEX читает доступные элементы Android и при необходимости распознаёт текст на снимке экрана.", icon: icons.eye, label:"АНАЛИЗ ИНТЕРФЕЙСА"},
];

export default function Home() {
  return (
    <>
      <div className="shell">
        <header className="site-header" id="top">
          <a href="#top" className="brand" aria-label="CORTEX — на главную">
            <span className="brand-mark"><img src="/cortex-mark.svg" alt="" /></span>
            <span className="brand-name">CORTEX</span>
          </a>
          <nav className="site-nav" aria-label="Навигация">
            <a href="#capabilities">Возможности</a>
            <a href="#approach">Как работает</a>
            <a href="#questions">Вопросы</a>
          </nav>
          <a className="header-action" href="https://t.me/cortexdevlog" target="_blank" rel="noopener noreferrer">Следить за запуском <span aria-hidden="true">↗</span></a>
        </header>
        <main>
          <section className="hero" aria-labelledby="hero-title">
            <div className="hero-copy">
              <div className="eyebrow"><span className="live-dot" /> БЕТА · 20 НОЯБРЯ 2026</div>
              <h1 id="hero-title">Твой телефон.<br /><em>Твои правила.</em></h1>
              <p className="hero-description">Скажи, что нужно сделать. CORTEX поможет открыть приложение, найти нужный экран и выполнить действие, если Android это позволяет.</p>
              <div className="hero-actions">
                <a className="button button--light" href="https://t.me/cortexdevlog" target="_blank" rel="noopener noreferrer">Узнать о запуске <span aria-hidden="true">↗</span></a>
                <a className="button button--outline" href="#capabilities">Исследовать возможности <span aria-hidden="true">↓</span></a>
              </div>
              <div className="hero-footnote"><span className="mini-stack" aria-hidden="true"><span /><span /><span /></span> Android · Голос · Действия · Сценарии</div>
            </div>
            <div className="hero-visual">
              <div className="backdrop-halo" aria-hidden="true" />
              <InteractivePhone />
              <div className="visual-index"><span>01 / 04</span><span>ИНТЕРАКТИВНАЯ 3D-МОДЕЛЬ</span></div>
            </div>
            <div className="hero-rail" aria-hidden="true"><span>УПРАВЛЕНИЕ БЕЗ ЛИШНИХ ДВИЖЕНИЙ</span><span>SCROLL TO EXPLORE ↓</span></div>
          </section>
          <div className="ticker" aria-label="Функции CORTEX"><div className="ticker-inner"><span>ГОЛОСОВОЙ ИНТЕРФЕЙС</span><span className="diamond">✦</span><span>ДЕЙСТВИЯ В ANDROID</span><span className="diamond">✦</span><span>УМНЫЕ СЦЕНАРИИ</span><span className="diamond">✦</span><span>ЛОКАЛЬНЫЕ КОМАНДЫ</span><span className="diamond">✦</span><span>ГОЛОСОВОЙ ИНТЕРФЕЙС</span></div></div>
          <section className="features-section" id="capabilities">
            <div className="section-intro">
              <span className="section-kicker">[01 — ВОЗМОЖНОСТИ]</span>
              <h2>Меньше нажатий.<br /><span>Больше возможностей.</span></h2>
              <p>Ты говоришь, что хочешь сделать. CORTEX помогает пройти путь от команды до результата.</p>
            </div>
            <div className="feature-grid">
              {features.map((item) => <article className="feature-card" key={item.num}>
                <div className="card-top"><span>{item.num} / 04</span><span className="feature-icon">{item.icon}</span></div>
                <div className="card-bottom"><span className="card-label">{item.label}</span><h3>{item.title}</h3><p>{item.detail}</p></div>
              </article>)}
            </div>
          </section>
          <section className="approach-section" id="approach">
            <div className="approach-inner">
              <div className="approach-lead"><span className="section-kicker">[02 — ПРИНЦИП РАБОТЫ]</span><h2>Умный.<br />Но под <i>твоим</i><br />контролем.</h2><p>Мощные возможности требуют прозрачности. Поэтому CORTEX разделяет локальные действия и задачи с участием ИИ.</p></div>
              <div className="approach-list">
                <div className="approach-item"><span>01</span><div><h3>Локально, когда возможно</h3><p>Простые команды и распознавание текста на снимках экрана выполняются на самом устройстве.</p></div><b>↗</b></div>
                <div className="approach-item"><span>02</span><div><h3>Понятные разрешения</h3><p>Для взаимодействия с Android нужны системные разрешения. Ты включаешь их в настройках устройства.</p></div><b>↗</b></div>
                <div className="approach-item"><span>03</span><div><h3>Подтверждение важных шагов</h3><p>Перед отправкой сообщений и другими необратимыми действиями приложение запрашивает подтверждение.</p></div><b>↗</b></div>
                <div className="approach-item"><span>04</span><div><h3>Данные экрана — с согласия</h3><p>Передача текста экрана серверному ИИ требует отдельного согласия. Его можно отозвать в приложении.</p></div><b>↗</b></div>
              </div>
            </div>
          </section>
          <section className="statement-section" aria-label="Манифест CORTEX">
            <div className="statement-border"><span>CORTEX / 2026</span><span>FUTURE IS PERSONAL</span></div>
            <p>Технологии должны<br /><span>подстраиваться под тебя.</span><br />Не наоборот.</p>
            <div className="statement-orb" aria-hidden="true" />
          </section>
          <section className="faq-section" id="questions">
            <div className="section-intro"><span className="section-kicker">[03 — FAQ]</span><h2>Коротко о <span>главном.</span></h2><p>Всё, что стоит знать перед первым запуском.</p></div>
            <div className="faq-list">
              <details><summary>Когда выйдет CORTEX?<span>+</span></summary><p>Открытая бета запланирована на 20 ноября 2026 года. Следи за новостями в Telegram, там появится информация о доступе.</p></details>
              <details><summary>Можно будет пользоваться бесплатно?<span>+</span></summary><p>Да. Основные локальные возможности планируются бесплатными. Лимиты и условия использования ИИ будут опубликованы отдельно перед запуском.</p></details>
              <details><summary>Какие устройства поддерживаются?<span>+</span></summary><p>CORTEX разрабатывается для Android. Некоторые действия зависят от версии системы, доступных разрешений и интерфейса конкретного приложения.</p></details>
              <details><summary>Зачем приложению доступ к специальным возможностям?<span>+</span></summary><p>Чтобы находить элементы интерфейса и выполнять разрешённые пользователем действия. Разрешение включается вручную в настройках Android и может быть отключено.</p></details>
              <details><summary>Можно ли доверить ему отправку сообщений?<span>+</span></summary><p>Перед отправкой CORTEX сверяет получателя и текст и просит подтверждение. Некоторые приложения могут ограничивать автоматизацию.</p></details>
            </div>
          </section>
          <section className="launch-section" id="launch">
            <div className="launch-content"><span className="section-kicker">[04 — СКОРО]</span><h2>Готов к новому<br />уровню свободы?</h2><p>Первая публичная бета CORTEX уже близко.</p><a className="button button--dark" href="https://t.me/cortexdevlog" target="_blank" rel="noopener noreferrer">Следить за релизом <span>↗</span></a></div>
            <div className="launch-art" aria-hidden="true"><div className="launch-ring launch-ring-a" /><div className="launch-ring launch-ring-b" /><img src="/cortex-mark.svg" alt="" /></div>
          </section>
        </main>
        <footer className="site-footer"><div className="footer-top"><div className="footer-brand"><img src="/cortex-mark.svg" alt="" /> CORTEX</div><div className="footer-links"><a href="#capabilities">Возможности</a><a href="#questions">FAQ</a><a href="https://t.me/cortexdevlog" target="_blank" rel="noopener noreferrer">Telegram ↗</a></div></div><div className="footer-bottom"><span>© 2026 CORTEX. Независимый Android-проект.</span><span>СДЕЛАНО ДЛЯ ЛЮДЕЙ, А НЕ НАОБОРОТ.</span></div></footer>
      </div>
    </>
  );
}
