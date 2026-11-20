import UiIcon from "@/components/UiIcon";

/**
 * Public APK downloads are closed by the owner's decision.
 * No environment variable, date or client timer can reopen this control;
 * reopening requires a reviewed code change and an approved release.
 */
export default function DownloadCTA() {
  return (
    <span className="glass glass--lg glass--closed" role="note" aria-label="Скачивание приложения временно закрыто">
      <UiIcon name="lock" size={17} />
      <span>Скачивание закрыто</span>
    </span>
  );
}
