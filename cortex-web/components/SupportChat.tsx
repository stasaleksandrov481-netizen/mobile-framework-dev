"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import { cortexAuth } from "@/lib/cortex-auth";
import { compressSupportMedia, SUPPORT_MEDIA_LIMIT, supportMediaExtension } from "@/lib/support-media";
import UiIcon from "@/components/UiIcon";

type Thread = { id: string; category: "contact" | "bug" | "idea"; message: string; status: "open" | "in_progress" | "answered" | "closed"; created_at: string };
type Reply = {
  id: string; author_id: string; ticket_id: string; message: string; created_at: string;
  attachment_path: string | null; attachment_name: string | null;
  attachment_mime: string | null; attachment_bytes: number | null;
};
type VisibleReply = Reply & { attachment_url?: string };
type Viewer = { id: string; email: string | undefined };
type Receipt = { ticket_id: string; staff_seen_at: string | null; user_seen_at: string | null; unread_count: number };

const categories = { contact: "Общий вопрос", bug: "Ошибка", idea: "Предложение" } as const;
const statuses = { open: "Открыт", in_progress: "В работе", answered: "Есть ответ", closed: "Закрыт" } as const;
const date = (value: string) => new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));

function messageError(failure: unknown): string {
  const original = failure && typeof failure === "object" && "message" in failure && typeof failure.message === "string"
    ? failure.message : String(failure);
  if (/rate|too many|wait|limit|429/i.test(original)) return "Слишком много сообщений. Подождите немного и повторите.";
  return "Не удалось выполнить действие. Проверьте соединение и попробуйте ещё раз.";
}

export default function SupportChat() {
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [accountLoading, setAccountLoading] = useState(true);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [replies, setReplies] = useState<VisibleReply[]>([]);
  const [receipts, setReceipts] = useState<Record<string, Receipt>>({});
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState("");
  const [category, setCategory] = useState<Thread["category"]>("contact");
  const [attached, setAttached] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [mobileList, setMobileList] = useState(false);
  const filesRef = useRef<HTMLInputElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const sendLock = useRef(false);
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  useLayoutEffect(() => {
    const field = messageRef.current;
    if (!field) return;
    field.style.height = "auto";
    const height = Math.min(field.scrollHeight, 150);
    field.style.height = `${Math.max(height, 42)}px`;
    field.style.overflowY = field.scrollHeight > 150 ? "auto" : "hidden";
  }, [text, activeId]);

  useEffect(() => {
    let alive = true;
    void cortexAuth.auth.getUser().then(({ data, error: authError }) => {
      if (!alive) return;
      setViewer(authError || !data.user?.email_confirmed_at ? null : { id: data.user.id, email: data.user.email });
      setAccountLoading(false);
    }).catch(() => { if (alive) setAccountLoading(false); });
    const { data: listener } = cortexAuth.auth.onAuthStateChange((_event, session) => {
      if (!alive) return;
      if (!session?.user?.email_confirmed_at) {
        setViewer(null); setThreads([]); setActiveId(null); setReceipts({});
      } else setViewer({ id: session.user.id, email: session.user.email });
    });
    return () => { alive = false; listener.subscription.unsubscribe(); };
  }, []);

  const loadThreads = useCallback(async () => {
    if (!viewer) return;
    const { data, error: loadError } = await cortexAuth.from("cortex_support")
      .select("id,category,message,status,created_at")
      .eq("user_id", viewer.id).order("created_at", { ascending: false }).limit(50);
    if (loadError) throw loadError;
    setThreads((data || []) as Thread[]);
  }, [viewer]);

  const loadReceipts = useCallback(async () => {
    if (!viewer) return;
    const { data, error: loadError } = await cortexAuth.rpc("cortex_support_receipt_overview", { p_side: "user" });
    if (loadError) throw loadError;
    setReceipts(Object.fromEntries(((data || []) as Receipt[]).map(item => [item.ticket_id, item])));
  }, [viewer]);

  const loadReplies = useCallback(async () => {
    if (!viewer || !activeId) { setReplies([]); return; }
    const { data, error: loadError } = await cortexAuth.from("cortex_support_replies")
      .select("id,author_id,ticket_id,message,created_at,attachment_path,attachment_name,attachment_mime,attachment_bytes")
      .eq("ticket_id", activeId).order("created_at", { ascending: true }).limit(100);
    if (loadError) throw loadError;
    const resolved = await Promise.all(((data || []) as Reply[]).map(async reply => {
      if (!reply.attachment_path) return reply;
      const { data: signed } = await cortexAuth.storage.from("cortex-support")
        .createSignedUrl(reply.attachment_path, 300);
      return { ...reply, attachment_url: signed?.signedUrl };
    }));
    if (activeIdRef.current !== activeId) return;
    setReplies(resolved);
    if (!document.hidden && document.hasFocus()) {
      const { error: receiptError } = await cortexAuth.rpc("cortex_support_mark_read", {
        p_ticket_id: activeId, p_last_reply_id: resolved.at(-1)?.id || null, p_side: "user",
      });
      if (!receiptError && activeIdRef.current === activeId) await loadReceipts().catch(() => {});
    }
  }, [activeId, viewer, loadReceipts]);

  useEffect(() => {
    if (!viewer) return;
    let alive = true;
    setLoading(true);
    void Promise.all([loadThreads(), loadReceipts()]).catch(() => { if (alive) setError("Не удалось загрузить обращения. Попробуйте обновить страницу."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [loadThreads, loadReceipts, viewer]);

  useEffect(() => {
    if (!viewer) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) void Promise.all([loadThreads(), loadReceipts()]).catch(() => {});
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [loadThreads, loadReceipts, viewer]);

  useEffect(() => {
    if (!activeId || !viewer) { setReplies([]); return; }
    void loadReplies().catch(() => setError("Не удалось загрузить переписку."));
    const timer = window.setInterval(() => {
      if (!document.hidden) void loadReplies().catch(() => {});
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [activeId, viewer, loadReplies]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [replies.length, activeId]);

  useEffect(() => {
    if (!activeId || !viewer) return;
    const refresh = () => {
      if (!document.hidden && document.hasFocus()) void loadReplies().catch(() => {});
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [activeId, viewer, loadReplies]);

  const current = threads.find(thread => thread.id === activeId) || null;

  function newThread() {
    if (sending) return;
    activeIdRef.current = null;
    setActiveId(null); setReplies([]); setText(""); setAttached(null);
    setCategory("contact"); setError(""); setMobileList(false);
  }

  function pickFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    event.target.value = "";
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      setError("Файл слишком большой. Изображения сжимаются, остальные файлы до 8 МБ.");
      return;
    }
    setAttached(file); setError("");
  }

  async function send() {
    if (!viewer || sending || sendLock.current) return;
    const message = text.trim();
    if (!message && !attached) return;
    if (message.length > 4000) { setError("Максимум 4000 символов."); return; }
    if (!current && !message) { setError("Для нового обращения сначала напишите сообщение."); return; }
    if (current?.status === "closed") { setError("Обращение закрыто. Создайте новый чат."); return; }
    sendLock.current = true; setSending(true); setError("");
    let uploadedPath: string | null = null;
    let written = false;
    try {
      let ticketId = activeId;
      if (!ticketId) {
        const { data, error: writeError } = await cortexAuth.from("cortex_support").insert({
          user_id: viewer.id, category, message, status: "open",
        }).select("id,category,message,status,created_at").single();
        if (writeError || !data) throw writeError || new Error("Ticket creation failed");
        ticketId = data.id;
        setThreads(items => [data as Thread, ...items]);
        activeIdRef.current = ticketId;
        setActiveId(ticketId);
        written = true;
      }
      let payload: Pick<Reply, "attachment_path" | "attachment_name" | "attachment_mime" | "attachment_bytes"> | null = null;
      if (attached) {
        const processed = await compressSupportMedia(attached);
        const ext = supportMediaExtension(processed.type);
        if (!ext || processed.size > SUPPORT_MEDIA_LIMIT) throw new Error("Неверный формат вложения.");
        uploadedPath = `${viewer.id}/${ticketId}/${crypto.randomUUID()}.${ext}`;
        const { error: uploadError } = await cortexAuth.storage.from("cortex-support")
          .upload(uploadedPath, processed, { contentType: processed.type, upsert: false });
        if (uploadError) throw uploadError;
        payload = { attachment_path: uploadedPath, attachment_name: attached.name.slice(0, 120),
          attachment_mime: processed.type, attachment_bytes: processed.size };
      }
      if (!written || payload) {
        const { error: replyError } = await cortexAuth.from("cortex_support_replies").insert({
          ticket_id: ticketId, author_id: viewer.id,
          message: written ? "Вложение" : message || "Вложение", ...payload,
        });
        if (replyError) throw replyError;
      }
      setText(""); setAttached(null);
      void Promise.all([loadThreads(), loadReceipts()]).catch(() => {});
      if (!written) void loadReplies().catch(() => {});
    } catch (failure) {
      if (uploadedPath) await cortexAuth.storage.from("cortex-support").remove([uploadedPath]).catch(() => {});
      if (failure instanceof Error && /Слишком большой|не поддерживается|Не удалось сжать|не соответствует|не должен превышать|Неверный формат/.test(failure.message)) {
        setError(failure.message);
      } else setError(messageError(failure));
    } finally { sendLock.current = false; setSending(false); }
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault(); void send();
    }
  }

  async function copyMessage(message: string) {
    try { await navigator.clipboard.writeText(message); }
    catch { setError("Не удалось скопировать текст сообщения."); }
  }

  const readByStaff = current ? receipts[current.id]?.staff_seen_at : null;
  const wasReadByStaff = (when: string) => Boolean(readByStaff && new Date(readByStaff).getTime() >= new Date(when).getTime());

  return (
    <section className="support-app" aria-label="Чаты поддержки CORTEX">
      {mobileList && <button type="button" className="support-mobile-scrim" aria-label="Закрыть список обращений" onClick={() => setMobileList(false)} />}
      <aside className={`support-sidebar${mobileList ? " support-sidebar--shown" : ""}`}>
        <header className="support-sidebar-head">
          <Link href="/" className="support-brand"><Image src="/cortex-mark.svg" alt="" width={27} height={27} />CORTEX<span> / Поддержка</span></Link>
          <button type="button" className="support-new" onClick={newThread} aria-label="Новое обращение" title="Новое обращение">+</button>
        </header>
        <div className="support-sidebar-label">Ваши диалоги</div>
        <div className="support-thread-list">
          {loading && <p className="support-muted">Загружаем обращения…</p>}
          {!loading && !threads.length && <p className="support-muted">Здесь появятся ваши обращения.</p>}
          {threads.map(thread => (
            <button type="button" key={thread.id} className={`support-thread${activeId === thread.id ? " support-thread--active" : ""}`}
              onClick={() => { setActiveId(thread.id); setError(""); setMobileList(false); }} aria-current={activeId === thread.id ? "true" : undefined}>
              <span className="support-thread-symbol"><Image src="/cortex-mark.svg" alt="" width={23} height={23} /></span>
              <span className="support-thread-copy"><strong>{categories[thread.category] || "Обращение"}</strong><small>{thread.message}</small></span>
              {Boolean(receipts[thread.id]?.unread_count) && <span className="support-unread-count" aria-label={`Непрочитанных: ${receipts[thread.id].unread_count}`}>{receipts[thread.id].unread_count > 9 ? "9+" : receipts[thread.id].unread_count}</span>}
              <time className="support-thread-date" dateTime={thread.created_at}>{date(thread.created_at).split(",")[0]}</time>
            </button>
          ))}
        </div>
        <div className="support-sidebar-foot">Ответы сотрудников появятся в этом диалоге. <a href="mailto:support@cortexapp.ru">Написать на почту</a></div>
      </aside>

      <div className="support-conversation">
        <header className="support-conversation-head">
          <button type="button" className="support-mobile-menu" onClick={() => setMobileList(true)} aria-label="Открыть список обращений">☰</button>
          <div className="support-agent-avatar"><Image src="/cortex-mark.svg" alt="CORTEX" width={27} height={27} /></div>
          <div className="support-conversation-title"><strong>{current ? categories[current.category] : "Поддержка CORTEX"}</strong>
            <span>{current ? statuses[current.status] : "Новое обращение"}</span></div>
          <Link href="/" className="support-home" aria-label="На главную"><UiIcon name="close" size={18} /></Link>
        </header>
        <div className="support-messages">
          {accountLoading ? <div className="support-empty"><p>Проверяем аккаунт…</p></div>
          : !viewer ? <div className="support-empty">
            <span className="support-empty-mark"><Image src="/cortex-mark.svg" alt="" width={55} height={55} /></span>
            <h1>Войдите в CORTEX</h1>
            <p>Чаты поддержки доступны после подтверждения почты. Так переписка останется только в вашем аккаунте.</p>
            <Link href="/register?mode=signin&next=%2Fsupport" className="support-empty-action">Войти в аккаунт</Link>
            <a href="mailto:support@cortexapp.ru">Или напишите на почту</a>
          </div> : !current ? <div className="support-empty">
            <span className="support-empty-mark"><Image src="/cortex-mark.svg" alt="" width={55} height={55} /></span>
            <h1>Чем можем помочь?</h1>
            <p>Опишите вопрос. Мы ответим здесь, в вашем личном диалоге.</p>
            <div className="support-category-picker" role="group" aria-label="Тема обращения">
              {(Object.keys(categories) as Thread["category"][]).map(key => <button type="button" key={key}
                aria-pressed={category === key} onClick={() => setCategory(key)}>{categories[key]}</button>)}
            </div>
          </div> : <div className="support-message-stack">
            <article className="support-bubble support-bubble--me"><p>{current.message}</p><div className="support-message-meta">
              <button type="button" className="support-copy" onClick={() => void copyMessage(current.message)} title="Копировать сообщение" aria-label="Копировать сообщение"><UiIcon name="copy" size={14} /></button>
              <time dateTime={current.created_at}>{date(current.created_at)}</time>
              <span className={`support-read-state${wasReadByStaff(current.created_at) ? " support-read-state--seen" : ""}`} title={wasReadByStaff(current.created_at) ? "Прочитано сотрудником" : "Отправлено"}>{wasReadByStaff(current.created_at) ? "✓✓" : "✓"}</span>
            </div></article>
            {replies.map(reply => <article key={reply.id} className={`support-bubble${reply.author_id === viewer.id ? " support-bubble--me" : " support-bubble--staff"}`}>
              {reply.author_id !== viewer.id && <span className="support-bubble-from">Команда CORTEX</span>}
              <p>{reply.message}</p>
              {reply.attachment_url && <div className="support-attachment-view">
                {reply.attachment_mime?.startsWith("image/") && <a href={reply.attachment_url} target="_blank" rel="noopener noreferrer"><img src={reply.attachment_url} alt={reply.attachment_name || "Изображение"} loading="lazy" /></a>}
                <a href={reply.attachment_url} target="_blank" rel="noopener noreferrer">{reply.attachment_name || "Скачать вложение"}</a>
              </div>}
              <div className="support-message-meta"><button type="button" className="support-copy" onClick={() => void copyMessage(reply.message)} title="Копировать сообщение" aria-label="Копировать сообщение"><UiIcon name="copy" size={14} /></button>
                <time dateTime={reply.created_at}>{date(reply.created_at)}</time>
                {reply.author_id === viewer.id && <span className={`support-read-state${wasReadByStaff(reply.created_at) ? " support-read-state--seen" : ""}`} title={wasReadByStaff(reply.created_at) ? "Прочитано сотрудником" : "Отправлено"}>{wasReadByStaff(reply.created_at) ? "✓✓" : "✓"}</span>}
              </div>
            </article>)}
            <div ref={bottomRef} />
          </div>}
        </div>
        <div className="support-bottom">
          {error && <p className="support-error" role="alert">{error}</p>}
          {viewer && <>
            <div className="support-composer">
              {attached && <div className="support-attachment-chip"><UiIcon name="paperclip" size={15} /><span title={attached.name}>{attached.name} · {(attached.size / 1024 / 1024).toFixed(1)} МБ</span>
                <button type="button" onClick={() => setAttached(null)} aria-label="Убрать вложение"><UiIcon name="close" size={15} /></button></div>}
              <div className="support-composer-row">
              <input ref={filesRef} type="file" className="support-file-input" onChange={pickFile}
                accept="image/jpeg,image/png,image/webp,application/pdf,video/mp4,video/webm,audio/mpeg,audio/ogg,audio/webm" aria-label="Прикрепить файл" />
              <button type="button" className="support-attach" onClick={() => filesRef.current?.click()}
                disabled={sending || current?.status === "closed"} title="Прикрепить файл" aria-label="Прикрепить файл"><UiIcon name="paperclip" size={21} /></button>
              <textarea ref={messageRef} value={text} onChange={event => { setText(event.target.value); if (error) setError(""); }} onKeyDown={keyDown}
                aria-label="Сообщение в поддержку" maxLength={4000} rows={1}
                placeholder={current?.status === "closed" ? "Обращение закрыто" : "Сообщение…"}
                disabled={sending || current?.status === "closed"} spellCheck />
              <button type="button" className="support-send" onClick={() => void send()}
                aria-label="Отправить сообщение" title="Отправить" disabled={sending || current?.status === "closed" || (!text.trim() && !attached)}>
                {sending ? <span className="support-spinner" /> : <UiIcon name="send" size={19} />}
              </button>
              </div>
            </div>
            <p className="support-hint">Enter — отправить, Shift+Enter — новая строка. Не присылайте пароли и коды.</p>
          </>}
        </div>
      </div>
    </section>
  );
}
