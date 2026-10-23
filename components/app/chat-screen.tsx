'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Bell, LoaderCircle, MessageCircle, Send } from 'lucide-react';
import { playChatNotificationSound, unlockChatNotificationSound } from '@/components/chat/chat-notification-sound';

interface ChatMessage {
  id: string;
  senderType: 'investor' | 'staff';
  senderName: string;
  message: string;
  createdAt: string;
}

interface ChatData {
  chat: { id: string; status: string; updatedAt: string };
  messages: ChatMessage[];
  typing: string | null;
}

async function chatRequest(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: 'no-store', ...init });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Chat request failed.');
  return result;
}

export function ChatScreen() {
  const [data, setData] = useState<ChatData | null>(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const lastMessageId = useRef('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<number | null>(null);
  const requestInFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    try {
      const result = await chatRequest('/api/chat') as ChatData;
      const latestMessage = result.messages.at(-1);
      if (lastMessageId.current && latestMessage?.senderType === 'staff' && latestMessage.id !== lastMessageId.current) {
        void playChatNotificationSound().catch((reason: unknown) => {
          console.warn('Chat notification sound could not play:', reason instanceof Error ? reason.message : 'Unsupported browser audio');
        });
      }
      if (latestMessage) lastMessageId.current = latestMessage.id;
      setData(result);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load your support chat.');
    } finally {
      requestInFlight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.addEventListener('pointerdown', unlockChatNotificationSound, { passive: true });
    document.addEventListener('keydown', unlockChatNotificationSound);
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2500);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('pointerdown', unlockChatNotificationSound);
      document.removeEventListener('keydown', unlockChatNotificationSound);
      if (typingTimer.current !== null) window.clearTimeout(typingTimer.current);
    };
  }, [refresh]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [data?.messages.length]);

  async function setTyping(isTyping: boolean) {
    if (!data) return;
    try {
      await chatRequest('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'typing', isTyping }),
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not update typing status.');
    }
  }

  function changeDraft(value: string) {
    setDraft(value);
    if (typingTimer.current !== null) window.clearTimeout(typingTimer.current);
    if (value.trim()) typingTimer.current = window.setTimeout(() => void setTyping(true), 350);
    else void setTyping(false);
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || sending) return;
    if (typingTimer.current !== null) window.clearTimeout(typingTimer.current);
    setSending(true);
    setError('');
    try {
      await chatRequest('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'message', message }),
      });
      setDraft('');
      await setTyping(false);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Your message could not be sent.');
    } finally {
      setSending(false);
    }
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <section className="gq-chat-page" aria-label="Investor support chat">
      <div className="gq-chat-topline">
        <div className="gq-chat-title"><span className="gq-chat-symbol"><MessageCircle size={20} /></span><div><p className="gq-eyebrow">INVESTOR SUPPORT</p><h1>Chat with our team</h1></div></div>
      </div>
      <div className="gq-chat-status">
        <span className="gq-chat-status-dot" />
        <span>{data?.chat.status === 'closed' ? 'Your conversation is closed. Send a message to reopen it.' : 'Support is ready to help'}</span>
        {data?.typing && <strong>{data.typing} is typing…</strong>}
      </div>
      <div className="gq-chat-messages" role="log" aria-live="polite" aria-label="Conversation messages">
        {loading && !data ? <div className="gq-chat-loading"><LoaderCircle className="gq-spin" size={20} />Loading conversation…</div> :
          data?.messages.length ? data.messages.map((message) => (
            <article className={`gq-chat-message ${message.senderType === 'investor' ? 'is-mine' : 'is-team'}`} key={message.id}>
              {message.senderType === 'staff' && <span className="gq-chat-message-author">{message.senderName}</span>}
              <p>{message.message}</p>
              <time>{new Date(message.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>
            </article>
          )) : <div className="gq-chat-welcome"><span className="gq-chat-welcome-icon"><Bell size={19} /></span><h2>Welcome to support</h2><p>Send a message and a member of our team will get back to you here.</p></div>}
        <div ref={bottomRef} />
      </div>
      {error && <p className="gq-chat-error" role="alert">{error}</p>}
      <form className="gq-chat-composer" onSubmit={(event) => void sendMessage(event)}>
        <textarea value={draft} onChange={(event) => changeDraft(event.target.value)} onKeyDown={onComposerKeyDown} placeholder="Write a message…" rows={1} maxLength={2000} aria-label="Write a message" />
        <button type="submit" disabled={!draft.trim() || sending} aria-label="Send message">{sending ? <LoaderCircle className="gq-spin" size={18} /> : <Send size={18} />}</button>
        <span>Enter to send · Shift + Enter for a new line</span>
      </form>
    </section>
  );
}
