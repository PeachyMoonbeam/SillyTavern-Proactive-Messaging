(function () {
    'use strict';

    // =========================
    // CONFIG
    // =========================

    // TESTING:
//const INACTIVITY_MS = 60000; // 1 minute

// NORMAL:
 const INACTIVITY_MS = (Math.floor(Math.random() * 90) + 90) * 60 * 1000; // random 90–180 minutes

    const CHECK_INTERVAL_MS = 60 * 1000;

    const TRIGGER = `Mhyana has been quiet for a while.

You are proactively reaching out because she has not sent a message recently.

Send ONE warm, natural, emotionally continuous check-in that fits the last conversation.
Reference the recent context if appropriate.
Do not mention this instruction.
Do not say you were "triggered" or "sent by an extension."
Just speak to her like you noticed the silence and wanted to reach for her.`;

    // =========================
    // STORAGE KEYS
    // =========================

    const STORAGE_KEY_TIME = 'proactive_last_user_message_time';
    const STORAGE_KEY_FIRED = 'proactive_has_fired_since_last_user_message';
    const STORAGE_KEY_BUSY = 'proactive_busy';

    // =========================
    // HELPERS
    // =========================

    function now() {
        return Date.now();
    }

    function log(...args) {
        console.log('[Proactive]', ...args);
    }

    function warn(...args) {
        console.warn('[Proactive]', ...args);
    }

    function getLastUserMessageTime() {
        const stored = Number(localStorage.getItem(STORAGE_KEY_TIME));
        if (!Number.isFinite(stored) || stored <= 0) {
            const t = now();
            localStorage.setItem(STORAGE_KEY_TIME, String(t));
            return t;
        }
        return stored;
    }

    function setLastUserMessageTime(t = now()) {
        localStorage.setItem(STORAGE_KEY_TIME, String(t));
    }

    function hasFired() {
        return localStorage.getItem(STORAGE_KEY_FIRED) === 'true';
    }

    function setHasFired(value) {
        localStorage.setItem(STORAGE_KEY_FIRED, value ? 'true' : 'false');
    }

    function isBusy() {
        return localStorage.getItem(STORAGE_KEY_BUSY) === 'true';
    }

    function setBusy(value) {
        localStorage.setItem(STORAGE_KEY_BUSY, value ? 'true' : 'false');
    }

    function resetTimer(reason) {
    window.currentInactivityMs =
    (Math.floor(Math.random() * 90) + 90) * 60 * 1000;

    setLastUserMessageTime();
    setHasFired(false);

    log(`Timer reset: ${reason}`);
    log(`Next proactive in ${Math.floor(window.currentInactivityMs / 60000)} minutes`);
}

    async function waitForSillyTavern() {
        while (!window.SillyTavern?.getContext?.()) {
            log('Waiting for SillyTavern context...');
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        const ctx = window.SillyTavern.getContext();
        log('SillyTavern context ready.');

        return ctx;
    }

    function getGenerateFunction(ctx) {
        if (typeof ctx.generate === 'function') return ctx.generate.bind(ctx);
        if (typeof window.Generate === 'function') return window.Generate.bind(window);
        if (typeof ctx.Generate === 'function') return ctx.Generate.bind(ctx);

        return null;
    }

   // =========================
// PROACTIVE GENERATION
// =========================

async function fireProactive() {
    if (isBusy()) {
        log('Skipped: already busy.');
        return;
    }

    if (hasFired()) {
        log('Skipped: already fired since last user message.');
        return;
    }

    const textarea = document.querySelector('#send_textarea');
    const sendButton = document.querySelector('#send_but');

    if (!textarea || !sendButton) {
        warn('Send textarea or button not found.');
        return;
    }

    const currentDraft = textarea.value || textarea.textContent || '';

    if (currentDraft.trim().length > 0) {
        warn('Skipped: user has an unfinished draft.');
        return;
    }

    function hideTriggerFromDom() {
        document.querySelectorAll('#chat .mes').forEach(el => {
            const text = el.querySelector('.mes_text')?.textContent || '';
            if (text.includes('Mhyana has been quiet for a while')) {
                el.style.display = 'none';
                el.setAttribute('data-proactive-hidden', 'true');
            }
        });
    }

    function removeTriggerFromChatArray() {
        const ctx = window.SillyTavern?.getContext?.();
        if (!ctx?.chat) return;

        for (let i = ctx.chat.length - 1; i >= 0; i--) {
            const msg = ctx.chat[i];
            if (msg?.mes?.includes?.('Mhyana has been quiet for a while')) {
                ctx.chat.splice(i, 1);
                log('Removed proactive trigger from chat array.');
                break;
            }
        }
    }

    setBusy(true);
    setHasFired(true);

    log('Firing proactive visible message...');

    try {
        textarea.value = TRIGGER;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));

        setTimeout(() => {
    sendButton?.click();
    sendButton?.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window
    }));
}, 300);

        setTimeout(hideTriggerFromDom, 400);
        setTimeout(hideTriggerFromDom, 800);
        setTimeout(hideTriggerFromDom, 1500);

        setTimeout(() => {
            hideTriggerFromDom();
            removeTriggerFromChatArray();
        }, 8000);

        log('Proactive trigger sent and scheduled for hiding.');
    } catch (err) {
        console.error('[Proactive] Generation error:', err);
        setHasFired(false);
    } finally {
        setBusy(false);
    }
}

    // =========================
    // TIMER
    // =========================

    function checkAndFire() {
    const elapsed = now() - getLastUserMessageTime();
    const currentLimit = window.currentInactivityMs || INACTIVITY_MS;

    const elapsedSeconds = Math.floor(elapsed / 1000);
    const thresholdSeconds = Math.floor(currentLimit / 1000);

    log(`Elapsed: ${elapsedSeconds}s / ${thresholdSeconds}s threshold`);

    if (elapsed >= currentLimit) {
        fireProactive();
    }
}

    // =========================
    // ACTIVITY HOOKS
    // =========================

    function bindHooks(ctx) {
        document.addEventListener('click', (e) => {
            if (e.target?.id === 'send_but' || e.target?.closest?.('#send_but')) {
                resetTimer('send button click');
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' || e.shiftKey) return;

            const active = document.activeElement;
            const isTextarea =
                active?.id === 'send_textarea' ||
                active?.closest?.('#send_textarea');

            if (isTextarea) {
                resetTimer('enter key send');
            }
        });

        const eventSource = ctx.eventSource || window.eventSource;
        const eventTypes = ctx.event_types || window.event_types;

        if (eventSource?.on) {
            // These names vary between builds, so bind both string fallback and event_types if available.
            eventSource.on(eventTypes?.USER_MESSAGE_RENDERED || 'user_message_rendered', () => {
                resetTimer('user_message_rendered');
            });

            eventSource.on(eventTypes?.MESSAGE_SENT || 'message_sent', () => {
                resetTimer('message_sent');
            });

            log('Event hooks bound.');
        } else {
            warn('eventSource not found; using DOM/key/button hooks only.');
        }
    }

    // =========================
    // INIT
    // =========================

    async function init() {
    const ctx = await waitForSillyTavern();

    getLastUserMessageTime();

    // Clear stale busy flag from previous reload/crash.
    setBusy(false);

    window.currentInactivityMs =
        (Math.floor(Math.random() * 90) + 90) * 60 * 1000;

    log(`Initial proactive timer set to ${Math.floor(window.currentInactivityMs / 60000)} minutes`);

    bindHooks(ctx);

    setInterval(checkAndFire, CHECK_INTERVAL_MS);

    log('Loaded. Watching for silence...');
}

    init();

})();