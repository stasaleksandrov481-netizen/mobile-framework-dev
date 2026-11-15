import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://cortexapp.ru"),
  title: "CORTEX — управление телефоном силой голоса",
  description: "CORTEX — интеллектуальный Android-ассистент, который понимает команды, помогает управлять телефоном и автоматизирует повседневные задачи. Бета — 20 ноября.",
  applicationName: "CORTEX",
  other: {
    "mailru-domain": "pLBDNiO0JIkaM12k",
  },
  openGraph: {
    title: "CORTEX — телефон, который понимает",
    description: "Новый способ взаимодействовать с Android. Голос, действия и сценарии в одном приложении.",
    url: "https://cortexapp.ru",
    siteName: "CORTEX",
    locale: "ru_RU",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#080808",
};

export default function RootLayout({ children }: Readonly<{children: React.ReactNode}>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
