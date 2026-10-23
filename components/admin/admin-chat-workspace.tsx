'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ArrowLeft, MessageCircle, LoaderCircle, Send } from 'lucide-react';
import { playChatNotificationSound, unlockChatNotificationSound } from '@/components/chat/chat-notification-sound';

interface ChatMessage {
  id: string;
  senderType: 'investor' | 'staff';
  senderName: string;
  message: string;
  createdAt: string;
}

interface ChatListItem {
  id: string;
  userName: string;
  userEmail: string;
  department: string;
  status: string;
  assignedTo: string | null;
  assignedName: string | null;
  updatedAt: string;
  lastMessageId: string;
  lastMessage: string;
  lastSenderType: string;
}

interface DirectoryPerson {
  id: string;
  fullName: string;
  email: string;
  role: string;
  department: string;
}

interface ChatInbox {
  chats: ChatListItem[];
  messages: ChatMessage[];
  typing: string | null;
  directory: DirectoryPerson[];
  canManage: boolean;
}

type AdminRequester = (request: () => Promise<Response>) => Promise<Record<string, unknown>>;

export function AdminChatWorkspace({ adminRequest, onError, onNotice }: {
  adminRequest: AdminRequester;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  const [inbox, setInbox] = useState<ChatInbox>({ chats: [], messages: [], typing: null, directory: [], canManage: false });
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState('');
  const [department, setDepartment] = useState('support');
  const [assignedTo, setAssignedTo] = useState('');
  const [mobileShowChat, setMobileShowChat] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [localError, setLocalError] = useState('');
  const lastMessageIds = useRef(new Map<string, string>());
  const inboxInitialized = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const requestInFlight = useRef(false);
  const typingTimer = useRef<number | null>(null);
  const selected = inbox.chats.find((chat) => chat.id === selectedId);

  const refresh = useCallback(async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    try {
      const result = await adminRequest(() => fetch(`/api/admin/chats${selectedId ? `?chatId=${encodeURIComponent(selectedId)}` : ''}`, { cache: 'no-store' })) as unknown as ChatInbox;
      const hasNewInvestorMessage = result.chats.some((chat) =>
        chat.lastSenderType === 'investor' && chat.lastMessageId &&
        lastMessageIds.current.get(chat.id) !== chat.lastMessageId);
      if (inboxInitialized.current && hasNewInvestorMessage) {
        void playChatNotificationSound().catch((reason: unknown) => {
          console.warn('Chat notification sound could not play:', reason instanceof Error ? reason.message : 'Unsupported browser audio');
        });
      }
      for (const chat of result.chats) lastMessageIds.current.set(chat.id, chat.lastMessageId);
      inboxInitialized.current = true;
      setInbox(result);
      if (!selectedId && result.chats[0]) setSelectedId(result.chats[0].id);
      setLocalError('');
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Could not load the chat inbox.';
      setLocalError(message);
      onError(message);
    } finally {
      requestInFlight.current = false;
      setLoading(false);
    }
  }, [adminRequest, onError, selectedId]);

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
    if (!selected) return;
    setDepartment(selected.department);
    setAssignedTo(selected.assignedTo ?? '');
  }, [selected?.id, selected?.department, selected?.assignedTo]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [inbox.messages.length]);

  async function postAction(action: Record<string, unknown>) {
    await adminRequest(() => fetch('/api/admin/chats', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: selectedId, ...action }),
    }));
  }

  async function setTyping(isTyping: boolean) {
    if (!selectedId) return;
    try {
      await postAction({ action: 'typing', isTyping });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Could not update typing status.';
      setLocalError(message);
      onError(message);
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
    if (!message || !selectedId || sending) return;
    if (typingTimer.current !== null) window.clearTimeout(typingTimer.current);
    setSending(true);
    try {
      await postAction({ action: 'message', message });
      setDraft('');
      await setTyping(false);
      await refresh();
    } catch (reason) {
      const messageText = reason instanceof Error ? reason.message : 'Could not send the reply.';
      setLocalError(messageText);
      onError(messageText);
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

  async function transferChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId) return;
    try {
      await postAction({ action: 'transfer', department, assignedTo: assignedTo || null });
      onNotice(assignedTo ? 'Chat transferred to the selected staff member.' : 'Chat transferred to the department queue.');
      setSelectedId('');
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Could not transfer this chat.';
      setLocalError(message);
      onError(message);
    }
  }

  async function updateStatus(status: 'open' | 'resolved' | 'closed') {
    if (!selectedId) return;
    try {
      await adminRequest(() => fetch('/api/admin/chats', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: selectedId, status }),
      }));
      onNotice(`Chat marked ${status}.`);
      await refresh();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Could not update chat status.';
      setLocalError(message);
      onError(message);
    }
  }

  const departmentPeople = inbox.directory.filter((person) =>
    person.role === 'owner' || person.department === department);

  return (
    <section className={`gq-admin-chat-workspace ${mobileShowChat ? 'has-mobile-selection' : ''}`}>
      <aside className="gq-admin-chat-list">
        <div className="gq-admin-chat-list-heading"><div><h2>Chat list</h2><p>{inbox.chats.length} conversations</p></div></div>
        {loading && !inbox.chats.length ? <div className="gq-chat-loading"><LoaderCircle className="gq-spin" size={18} />Loading inbox…</div> :
          inbox.chats.length ? inbox.chats.map((chat) => (
            <button type="button" key={chat.id} className={`gq-admin-chat-list-item ${selectedId === chat.id ? 'is-selected' : ''}`} onClick={() => { setSelectedId(chat.id); setMobileShowChat(true); }}>
              <span className="gq-admin-chat-avatar">{chat.userName.trim().charAt(0).toUpperCase()}</span>
              <span className="gq-admin-chat-list-copy"><strong>{chat.userName}</strong><small>{chat.lastMessage || 'No messages yet'}</small><small>{chat.assignedName ? `With ${chat.assignedName}` : `${chat.department.replace('_', ' ')} queue`}</small></span>
              <span className={`gq-admin-chat-status is-${chat.status}`}>{chat.status}</span>
            </button>
          )) : <p className="gq-admin-empty">No support conversations yet.</p>}
      </aside>
      <div className="gq-admin-chat-conversation">
        {selected ? <>
          <header className="gq-admin-chat-header">
            <button className="gq-admin-chat-back" type="button" onClick={() => setMobileShowChat(false)} aria-label="Back to chat list"><ArrowLeft size={17} /><span>Chats</span></button>
            <div className="gq-admin-chat-identity"><span className="gq-admin-chat-avatar">{selected.userName.trim().charAt(0).toUpperCase()}</span><div><h2>{selected.userName}</h2><p>{selected.userEmail} · {selected.department.replace('_', ' ')}</p></div></div>
            <div className="gq-admin-chat-owner"><span>Assigned to</span><strong>{selected.assignedName ?? `${selected.department.replace('_', ' ')} queue`}</strong>{inbox.typing && <small>{inbox.typing} is typing…</small>}</div>
          </header>
          <div className="gq-admin-chat-transcript" role="log" aria-live="polite" aria-label="Selected conversation messages">
            {inbox.messages.length ? inbox.messages.map((message) => (
              <article key={message.id} className={`gq-chat-message ${message.senderType === 'staff' ? 'is-mine' : 'is-team'}`}>
                <span className="gq-chat-message-author">{message.senderType === 'staff' ? `${message.senderName} · Staff` : message.senderName}</span>
                <p>{message.message}</p>
                <time>{new Date(message.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</time>
              </article>
            )) : <div className="gq-chat-welcome"><span className="gq-chat-welcome-icon"><MessageCircle size={19} /></span><h2>New conversation</h2><p>Send a message to help this investor.</p></div>}
            <div ref={bottomRef} />
          </div>
          {(localError || selected.status !== 'open') && <p className={`gq-chat-error ${localError ? '' : 'is-neutral'}`} role={localError ? 'alert' : 'status'}>{localError || `This conversation is ${selected.status}. A reply will reopen it.`}</p>}
          {inbox.canManage && <form className="gq-admin-chat-transfer" onSubmit={(event) => void transferChat(event)}>
            <label>Transfer to department<select value={department} onChange={(event) => { setDepartment(event.target.value); setAssignedTo(''); }}><option value="support">Support</option><option value="account_manager">Account management</option></select></label>
            <label>Staff member<select value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)}><option value="">Department queue</option>{departmentPeople.map((person) => <option key={person.id} value={person.id}>{person.fullName} · {person.role.replace('_', ' ')}</option>)}</select></label>
            <button type="submit">Transfer chat</button>
          </form>}
          <div className="gq-admin-chat-bottom">
            {inbox.canManage ? <form className="gq-chat-composer" onSubmit={(event) => void sendMessage(event)}>
              <textarea value={draft} onChange={(event) => changeDraft(event.target.value)} onKeyDown={onComposerKeyDown} placeholder="Reply to investor…" rows={1} maxLength={2000} aria-label="Reply to investor" />
              <button type="submit" disabled={!draft.trim() || sending} aria-label="Send reply">{sending ? <LoaderCircle className="gq-spin" size={18} /> : <Send size={18} />}</button>
              <span>Enter to send · Shift + Enter for a new line</span>
            </form> : <span className="gq-admin-chat-readonly">Read-only conversation</span>}
            {inbox.canManage && <div className="gq-admin-chat-status-actions"><button type="button" onClick={() => void updateStatus('open')}>Reopen</button><button type="button" onClick={() => void updateStatus('resolved')}>Resolve</button><button type="button" onClick={() => void updateStatus('closed')}>Close</button></div>}
          </div>
        </> : <div className="gq-admin-chat-empty"><MessageCircle size={26} /><h2>Choose a conversation</h2><p>Select a chat to view messages, respond, or transfer it to another department.</p></div>}
      </div>
    </section>
  );
}
