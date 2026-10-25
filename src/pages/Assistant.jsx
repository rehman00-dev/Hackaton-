import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { SendHorizontal, Sparkles } from 'lucide-react';
import { api, request } from '../lib/api.js';
import { Status } from '../components/ui.jsx';

export default function Assistant() {
  const reduceMotion = useReducedMotion();
  const [messages, setMessages] = useState([{ from: 'assistant', text: 'Ask about your HR data or company policies. I only use information permitted for your role.' }]);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const chatEndRef = useRef(null);
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'end' });
  }, [messages, busy, reduceMotion]);
  async function send(event) {
    event.preventDefault();
    if (busy) return;
    const message = prompt.trim();
    if (!message) return;
    setMessages((items) => [...items, { from: 'user', text: message }]);
    setPrompt('');
    setBusy(true);
    try {
      const response = await api('/ai/chat', request('POST', { message }));
      setMessages((items) => [...items, { from: 'assistant', text: response.response, label: response.generated ? 'AI-generated' : '' }]);
    } catch (error) {
      setMessages((items) => [...items, { from: 'assistant', text: error.message, error: true }]);
    } finally { setBusy(false); }
  }
  return (
    <div className="assistant-card card" data-reveal>
      <div className="assistant-header">
        <span className="assistant-mark"><Sparkles size={18} aria-hidden="true" /></span>
        <div><h2>HCM assistant</h2><p className="muted">Answers are scoped to your role and grounded in HCM data.</p></div>
        <Status value="Role scoped" />
      </div>
      <div className="chat-log" role="log" aria-live="polite" aria-relevant="additions">
        <AnimatePresence initial={false}>
          {messages.map((item, index) => (
            <motion.div initial={reduceMotion ? false : { opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={reduceMotion ? undefined : { opacity: 0 }} transition={{ duration: reduceMotion ? 0 : 0.2 }}
              className={`chat-message ${item.from} ${item.error ? 'chat-error' : ''}`} key={`${index}-${item.text}`}>
              <p>{item.text}</p>{item.label && <small>{item.label}</small>}
            </motion.div>
          ))}
        </AnimatePresence>
        {busy && <motion.div initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} className="chat-message assistant" role="status"><span className="typing" aria-label="Thinking"><i /><i /><i /></span></motion.div>}
        <div ref={chatEndRef} />
      </div>
      <form className="chat-form" onSubmit={send}>
        <input aria-label="Ask a question" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="e.g. Who is on leave today?" maxLength={2000} />
        <button className="button button-primary" disabled={busy || !prompt.trim()}><SendHorizontal size={15} aria-hidden="true" />{busy ? 'Thinking…' : 'Send'}</button>
      </form>
      <p className="hint">AI calls Groq from the server. If it is unavailable, check GROQ_API_KEY in the server .env and restart the backend after updating it.</p>
    </div>
  );
}
