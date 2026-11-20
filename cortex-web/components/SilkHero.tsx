import RegistrationCta from "@/components/RegistrationCta";
import SilkBackground from "@/components/SilkBackground";

const lines = [["Телефон,", "который"], ["вас", "слышит"]];

/** First screen: silk backdrop, one message, one primary and one secondary action. */
export default function SilkHero({ registrationOpen }: { registrationOpen: boolean }) {
  let word = 0;
  return (
    <section className="silk-hero" aria-labelledby="hero-title">
      <SilkBackground intensity={1} shade={.66} className="silk--hero" />
      <div className="silk-hero-inner">
        <p className="silk-badge rise" style={{ "--d": "80ms" } as React.CSSProperties}>
          <span className="silk-badge-dot" aria-hidden="true" />Бета для Android · скачивание пока закрыто
        </p>
        <h1 id="hero-title" className="silk-title">
          {lines.map((line, index) => (
            <span className="silk-title-line" key={index}>
              {line.map(text => (
                <span className="silk-word" key={text} style={{ "--d": `${220 + word++ * 90}ms` } as React.CSSProperties}>{text}</span>
              ))}
            </span>
          ))}
        </h1>
        <p className="silk-lead rise" style={{ "--d": "640ms" } as React.CSSProperties}>
          Скажите, что нужно сделать. CORTEX откроет приложение, поставит будильник и напомнит о важном.
        </p>
        <div className="silk-actions rise" style={{ "--d": "760ms" } as React.CSSProperties}>
          <RegistrationCta isOpen={registrationOpen} />
          <a className="glass glass--lg" href="#features"><span>Возможности</span></a>
        </div>
      </div>
      <a className="silk-scroll rise" href="#features" style={{ "--d": "1000ms" } as React.CSSProperties} aria-label="К возможностям CORTEX">
        <span className="silk-scroll-text">Листайте вниз</span>
        <span className="silk-scroll-line" aria-hidden="true" />
        <span className="silk-mouse" aria-hidden="true"><i /></span>
        <span className="silk-scroll-line" aria-hidden="true" />
        <span className="silk-scroll-text">чтобы узнать больше</span>
      </a>
    </section>
  );
}
