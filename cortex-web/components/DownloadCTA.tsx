import UiIcon from "@/components/UiIcon";

/** Public downloads are enabled only by an explicit server-side release decision. */
export default function DownloadCTA({ url, released = false }: { url?: string; released?: boolean }) {
  return released && url ? (
    <a className="button button--secondary" href={url} rel="noopener noreferrer">
      Установить <span className="button-icon"><UiIcon name="download" size={18} /></span>
    </a>
  ) : (
    <span className="button button--secondary button--disabled" aria-label="Дата выхода приложения ещё не объявлена">
      <UiIcon name="clock" size={17} /> Установка <span className="button-soon">Скоро</span>
    </span>
  );
}
