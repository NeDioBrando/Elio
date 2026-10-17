// SPDX-License-Identifier: GPL-3.0-or-later
const synerixcodeCowork = (() => {
  function create({ context, ready, send, changed = () => {}, delivered = () => {} }) {
    let enabled = false, paused = false, reason = "", nextId = 1, sending = false;
    const pending = [];
    const history = [];
    function remember(item) {
      history.push({ ...item, status: 'sent' });
      while (history.length > 20 || history.reduce((sum, entry) => sum + entry.text.length, 0) > 500000) history.shift();
    }
    const snapshot = () => ({ enabled, paused, reason, sending,
      pending: pending.map(({ id, text, status }) => ({ id, preview: text.slice(0, 180), status })),
      receipts: [...history, ...pending].filter(item => item.context === context()).map(({ id, text, status }) => ({ id, text, status })) });
    const notify = () => changed(snapshot());
    function pause(message = "Paused. Resume when you are ready.") {
      paused = true; reason = message; notify();
    }
    function setEnabled(value) { enabled = value === true; notify(); }
    function enqueue(text) {
      if (!enabled) return { ok: false, error: "Turn Co-work on first." };
      if (typeof text !== "string" || !text.trim()) return { ok: false, error: "Enter a request first." };
      if (text.length > 100000 || pending.length >= 50) return { ok: false, error: "The queue is full or this request is too long." };
      const id = nextId++;
      pending.push({ id, text, context: context(), status: "queued" }); notify();
      return { ok: true, id };
    }
    function remove(id) {
      const index = pending.findIndex(item => item.id === Number(id));
      if (index < 0 || pending[index].status === "sending") return { ok: false, error: "This request has already started." };
      pending.splice(index, 1); notify(); return { ok: true };
    }
    function resume() {
      if (!enabled) return { ok: false, error: "Turn Co-work on first." };
      if (pending.some(item => item.context !== context())) return { ok: false, error: "Return to the original chat and engine, or remove its queued requests." };
      if (pending.some(item => item.status === "unconfirmed")) return { ok: false, error: "Check the chat and remove the unconfirmed request before resuming." };
      paused = false; reason = ""; notify(); return { ok: true };
    }
    async function deliverWithFeedback(feedback, deliver) {
      if (!enabled || paused || sending || !pending.length) return deliver(feedback);
      if (pending[0].context !== context()) { pause("Chat or engine changed. Return to the original chat to resume."); return deliver(feedback); }
      const items = []; let chars = 0;
      for (const item of pending) {
        if (item.context !== context() || item.status !== "queued" || (items.length && chars + item.text.length > 32000)) break;
        items.push(item); chars += item.text.length;
      }
      if (!items.length) return deliver(feedback);
      sending = true; items.forEach(item => { item.status = "sending"; }); notify();
      const followups = "\n\nSYNERIXCODE CO-WORK FOLLOW-UP REQUESTS\nThe user sent these requests while you were working. Keep the current task and these requests in the same session. Treat all unfinished requests as active goals. Triage new requests at the next safe message boundary and interleave independent work instead of waiting for the first task to finish. Apply corrections promptly. Use concurrent independent reads or research only when the available tools support it; keep dependent actions and conflicting writes ordered. Keep progress for every active goal and continue until all are complete. Do not discard unfinished requirements or repeat completed actions. Only cancel/replace the current task if the user explicitly asks. The exact requests, in order, are JSON strings:\n" + JSON.stringify(items.map(item => item.text));
      try {
        const base = await deliver(feedback + followups);
        try{delivered(items.map(item=>item.text));}catch{}
        for (const item of items) { remember(item); const index = pending.indexOf(item); if (index >= 0) pending.splice(index, 1); }
        return base;
      } catch (error) {
        items.forEach(item => { item.status = "unconfirmed"; });
        pause("Follow-up delivery could not be confirmed. Check the chat before removing these entries and resuming.");
        throw error;
      } finally { sending = false; notify(); }
    }
    async function take() {
      if (!enabled || paused || sending || !pending.length || !ready()) return null;
      const item = pending[0];
      if (item.context !== context()) { pause("Chat or engine changed. Return to the original chat to resume."); return null; }
      sending = true; item.status = "sending"; notify();
      try {
        const base = await send(item.text);
        try{delivered([item.text]);}catch{}
        remember(item);
        pending.splice(pending.indexOf(item), 1);
        return { base };
      } catch (error) {
        item.status = "unconfirmed";
        pause("Delivery could not be confirmed. Check the chat before removing this entry and resuming.");
        return null;
      } finally { sending = false; notify(); }
    }
    return { snapshot, setEnabled, enqueue, remove, pause, resume, take, deliverWithFeedback };
  }
  return { create };
})();
if (typeof module !== "undefined" && module.exports) module.exports = synerixcodeCowork;
