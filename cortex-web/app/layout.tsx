import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./landing.css";
import "./pages.css";
import "./silk.css";
import GlassPointer from "@/components/GlassPointer";

export const metadata: Metadata = {
  metadataBase: new URL("https://cortexapp.ru"),
  title: "CORTEX — управление телефоном силой голоса",
  description: "CORTEX — интеллектуальный Android-ассистент, который понимает команды, помогает управлять телефоном и автоматизирует повседневные задачи. Дата открытого запуска будет объявлена отдельно.",
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
  themeColor: "#000000",
  viewportFit: "cover",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{children: React.ReactNode}>) {
  return (
    <html lang="ru">
      <body>{children}<GlassPointer /></body>
    </html>
  );
}
