"use client";

/** A dependency-free recovery screen, including when app CSS failed to load. */
export default function SiteErrorView({ retry }: { retry: () => void }) {
  return (
    <main
      role="alert"
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 18,
        padding: 24,
        background: "#080808",
        color: "#f5f5f5",
        fontFamily: "Arial, sans-serif",
        textAlign: "center",
      }}
    >
      <img src="/cortex-mark.svg" alt="CORTEX" width="52" height="52" />
      <h1 style={{ margin: 0, fontSize: 24, fontWeight: 650 }}>Не удалось загрузить страницу</h1>
      <p style={{ margin: 0, maxWidth: 370, lineHeight: 1.65, color: "#aaa", fontSize: 14 }}>
        Возможно, соединение нестабильно. Проверьте интернет и попробуйте ещё раз.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 10 }}>
        <button
          type="button"
          onClick={retry}
          style={{ padding: "13px 20px", borderRadius: 30, border: 0, background: "#fff", color: "#080808", font: "600 14px Arial, sans-serif", cursor: "pointer" }}
        >
          Повторить
        </button>
        <a href="/" style={{ padding: "12px 19px", borderRadius: 30, border: "1px solid #414141", color: "#eee", fontSize: 14, textDecoration: "none" }}>
          На главную
        </a>
      </div>
      <a href="mailto:support@cortexapp.ru" style={{ color: "#999", fontSize: 12, textDecoration: "underline" }}>
        Связаться с поддержкой
      </a>
    </main>
  );
}
