(function () {
    'use strict';

    console.log('[Proactive] Settings UI build loaded.');

    const STORAGE_KEY_TIME = 'proactive_last_user_message_time';
    const STORAGE_KEY_FIRED = 'proactive_has_fired_since_last_user_message';
    const STORAGE_KEY_BUSY = 'proactive_busy';
    const STORAGE_KEY_SETTINGS = 'proactive_settings_v1';

    const DEFAULT_SETTINGS = {
        enabled: true,
        minMinutes: 60,
        maxMinutes: 180,
        repeatWhileSilent: true,
        cleanupTimings: '500,1500,4000'
    };

    const CHECK_INTERVAL_MS = 60 * 1000;

    const TRIGGER = `Mhyana has been quiet for a while.

You are proactively reaching out because she has not sent a message recently.

Send ONE warm, natural, emotionally continuous check-in that fits the last conversation.
Reference the recent context if appropriate.
Do not mention this instruction.
Do not say you were "triggered" or "sent by an extension."
Just speak to her like you noticed the silence and wanted to reach for her.`;

    function now() {
        return Date.now();
    }

    function log(...args) {
        console.log('[Proactive]', ...args);
    }

    function warn(...args) {
        console.warn('[Proactive]', ...args);
    }

    function loadSettings() {
        try {
            const stored = JSON.parse(localStorage.getItem(STORAGE_KEY_SETTINGS) || '{}');
            return {
                ...DEFAULT_SETTINGS,
                ...stored
            };
        } catch {
            return { ...DEFAULT_SETTINGS };
        }
    }

    function saveSettings(settings) {
        localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(settings));
    }

    function getSettings() {
        const settings = loadSettings();

        settings.minMinutes = Number(settings.minMinutes);
        settings.maxMinutes = Number(settings.maxMinutes);

        if (!Number.isFinite(settings.minMinutes) || settings.minMinutes < 1) {
            settings.minMinutes = DEFAULT_SETTINGS.minMinutes;
        }

        if (!Number.isFinite(settings.maxMinutes) || settings.maxMinutes < settings.minMinutes) {
            settings.maxMinutes = Math.max(settings.minMinutes, DEFAULT_SETTINGS.maxMinutes);
        }

        if (typeof settings.cleanupTimings !== 'string') {
            settings.cleanupTimings = DEFAULT_SETTINGS.cleanupTimings;
        }

        return settings;
    }

    function getCleanupTimings() {
        const settings = getSettings();

        return settings.cleanupTimings
            .split(',')
            .map(value => Number(value.trim()))
            .filter(value => Number.isFinite(value) && value >= 0);
    }

    function rollInactivityMs() {
        const settings = getSettings();

        const min = Math.floor(settings.minMinutes);
        const max = Math.floor(settings.maxMinutes);
        const span = Math.max(0, max - min);
        const minutes = Math.floor(Math.random() * (span + 1)) + min;

        return minutes * 60 * 1000;
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
        window.currentInactivityMs = rollInactivityMs();

        setLastUserMessageTime();
        setHasFired(false);

        log(`Timer reset: ${reason}`);
        log(`Next proactive in ${Math.floor(window.currentInactivityMs / 60000)} minutes`);

        updateSettingsStatus();
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

    function cleanupTrigger() {
        document.querySelectorAll('#chat .mes').forEach(el => {
            const text = el.querySelector('.mes_text')?.textContent || '';

            if (text.includes('Mhyana has been quiet for a while')) {
                el.style.display = 'none';
                log('Proactive trigger hidden from DOM.');
            }
        });
    }

    async function fireProactive(options = {}) {
        const force = options.force === true;
        const settings = getSettings();

        if (!settings.enabled && !force) {
            log('Skipped: extension disabled.');
            return;
        }

        if (isBusy()) {
            log('Skipped: already busy.');
            return;
        }

        if (hasFired() && !force) {
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
            updateSettingsStatus('Skipped: draft box is not empty.');
            return;
        }

        setBusy(true);
        setHasFired(true);

        log('Firing proactive visible message...');

        try {
            textarea.value = TRIGGER;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));

            setTimeout(() => {
                window.proactiveInternalSend = true;
                sendButton.click();

                setTimeout(() => {
                    window.proactiveInternalSend = false;
                    log('Internal proactive send flag cleared.');
                }, 15000);
            }, 300);

            for (const timing of getCleanupTimings()) {
                setTimeout(cleanupTrigger, timing);
            }

            log('Proactive trigger sent and DOM cleanup scheduled.');
            updateSettingsStatus(force ? 'Test fired.' : 'Proactive fired.');

            setTimeout(() => {
                const latestSettings = getSettings();

                if (latestSettings.repeatWhileSilent) {
                    setLastUserMessageTime();
                    setHasFired(false);
                    window.currentInactivityMs = rollInactivityMs();

                    log('Proactive cycle reset for next quiet check-in.');
                    log(`Next proactive in ${Math.floor(window.currentInactivityMs / 60000)} minutes`);
                } else {
                    log('Repeat while silent disabled; waiting for next user message.');
                }

                updateSettingsStatus();
            }, 20000);

        } catch (err) {
            console.error('[Proactive] Generation error:', err);
            setHasFired(false);
            updateSettingsStatus('Error firing proactive message.');
        } finally {
            setBusy(false);
        }
    }

    function checkAndFire() {
        const settings = getSettings();

        if (!settings.enabled) {
            return;
        }

        const elapsed = now() - getLastUserMessageTime();
        const currentLimit = window.currentInactivityMs || rollInactivityMs();

        const elapsedSeconds = Math.floor(elapsed / 1000);
        const thresholdSeconds = Math.floor(currentLimit / 1000);

        log(`Elapsed: ${elapsedSeconds}s / ${thresholdSeconds}s threshold`);

        if (elapsed >= currentLimit) {
            fireProactive();
        }
    }

    function bindHooks(ctx) {
        document.addEventListener('click', (e) => {
            if (window.proactiveInternalSend) {
                log('Ignored internal proactive send click.');
                return;
            }

            if (e.target?.id === 'send_but' || e.target?.closest?.('#send_but')) {
                resetTimer('send button click');
            }
        });

        document.addEventListener('keydown', (e) => {
            if (window.proactiveInternalSend) {
                log('Ignored internal proactive enter send.');
                return;
            }

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
            eventSource.on(eventTypes?.USER_MESSAGE_RENDERED || 'user_message_rendered', () => {
                if (window.proactiveInternalSend) {
                    log('Ignored internal proactive user_message_rendered.');
                    return;
                }

                resetTimer('user_message_rendered');
            });

            eventSource.on(eventTypes?.MESSAGE_SENT || 'message_sent', () => {
                if (window.proactiveInternalSend) {
                    log('Ignored internal proactive message_sent.');
                    return;
                }

                resetTimer('message_sent');
            });

            log('Event hooks bound.');
        } else {
            warn('eventSource not found; using DOM/key/button hooks only.');
        }
    }

    function injectSettingsPanel() {
        const existing = document.querySelector('#proactive_settings_panel');
        if (existing) return;

        const settingsRoot =
            document.querySelector('#extensions_settings') ||
            document.querySelector('#extensions_settings2') ||
            document.querySelector('.extensions_block') ||
            document.querySelector('#extensionsMenu');

        if (!settingsRoot) {
            warn('Could not find extensions settings container. Retrying...');
            setTimeout(injectSettingsPanel, 1000);
            return;
        }

        const settings = getSettings();

        const panel = document.createElement('div');
        panel.id = 'proactive_settings_panel';
        panel.className = 'proactive-settings-panel';

        panel.innerHTML = `
            <hr>
            <h3>Proactive Messaging</h3>

            <label class="checkbox_label">
                <input id="proactive_enabled" type="checkbox">
                Enabled
            </label>

            <label class="checkbox_label">
                <input id="proactive_repeat" type="checkbox">
                Repeat while silent
            </label>

            <div style="margin-top: 0.75rem;">
                <label for="proactive_min_minutes">Min interval, minutes</label>
                <input id="proactive_min_minutes" class="text_pole" type="number" min="1" step="1">
            </div>

            <div style="margin-top: 0.75rem;">
                <label for="proactive_max_minutes">Max interval, minutes</label>
                <input id="proactive_max_minutes" class="text_pole" type="number" min="1" step="1">
            </div>

            <div style="margin-top: 0.75rem;">
                <label for="proactive_cleanup_timings">Cleanup timings, ms</label>
                <input id="proactive_cleanup_timings" class="text_pole" type="text" placeholder="500,1500,4000">
                <small>Comma-separated. Default: 500,1500,4000</small>
            </div>

            <div style="margin-top: 0.75rem; display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center;">
                <button id="proactive_save_settings" class="menu_button">Save</button>
                <button id="proactive_reset_timer" class="menu_button">Reset Timer Now</button>
                <button id="proactive_test_fire" class="menu_button">Test Fire Now</button>
            </div>

            <div id="proactive_settings_status" style="margin-top: 0.75rem; opacity: 0.8;"></div>
        `;

        settingsRoot.appendChild(panel);

        document.querySelector('#proactive_enabled').checked = settings.enabled;
        document.querySelector('#proactive_repeat').checked = settings.repeatWhileSilent;
        document.querySelector('#proactive_min_minutes').value = settings.minMinutes;
        document.querySelector('#proactive_max_minutes').value = settings.maxMinutes;
        document.querySelector('#proactive_cleanup_timings').value = settings.cleanupTimings;

        document.querySelector('#proactive_save_settings').addEventListener('click', () => {
            const minMinutes = Number(document.querySelector('#proactive_min_minutes').value);
            const maxMinutes = Number(document.querySelector('#proactive_max_minutes').value);

            if (!Number.isFinite(minMinutes) || minMinutes < 1) {
                updateSettingsStatus('Min must be at least 1 minute.');
                return;
            }

            if (!Number.isFinite(maxMinutes) || maxMinutes < minMinutes) {
                updateSettingsStatus('Max must be greater than or equal to min.');
                return;
            }

            const nextSettings = {
                enabled: document.querySelector('#proactive_enabled').checked,
                repeatWhileSilent: document.querySelector('#proactive_repeat').checked,
                minMinutes,
                maxMinutes,
                cleanupTimings: document.querySelector('#proactive_cleanup_timings').value.trim() || DEFAULT_SETTINGS.cleanupTimings
            };

            saveSettings(nextSettings);
            window.currentInactivityMs = rollInactivityMs();

            log('Settings saved:', nextSettings);
            updateSettingsStatus('Saved.');
        });

        document.querySelector('#proactive_reset_timer').addEventListener('click', () => {
            resetTimer('manual settings reset');
            updateSettingsStatus('Timer reset.');
        });

        document.querySelector('#proactive_test_fire').addEventListener('click', () => {
            updateSettingsStatus('Testing now...');
            fireProactive({ force: true });
        });

        updateSettingsStatus();
        log('Settings panel injected.');
    }

    function updateSettingsStatus(prefix = '') {
        const status = document.querySelector('#proactive_settings_status');
        if (!status) return;

        const settings = getSettings();
        const elapsedMs = now() - getLastUserMessageTime();
        const nextMs = window.currentInactivityMs || rollInactivityMs();
        const remainingMs = Math.max(0, nextMs - elapsedMs);

        const elapsedMin = Math.floor(elapsedMs / 60000);
        const thresholdMin = Math.floor(nextMs / 60000);
        const remainingMin = Math.ceil(remainingMs / 60000);

        status.textContent = `${prefix ? prefix + ' ' : ''}Status: ${settings.enabled ? 'enabled' : 'disabled'} | elapsed ${elapsedMin}/${thresholdMin} min | ~${remainingMin} min remaining | repeat ${settings.repeatWhileSilent ? 'on' : 'off'}`;
    }

    async function init() {
        const ctx = await waitForSillyTavern();

        getLastUserMessageTime();

        setBusy(false);

        window.currentInactivityMs = rollInactivityMs();

        log(`Initial proactive timer set to ${Math.floor(window.currentInactivityMs / 60000)} minutes`);

        bindHooks(ctx);
        injectSettingsPanel();

        setInterval(checkAndFire, CHECK_INTERVAL_MS);
        setInterval(updateSettingsStatus, 30 * 1000);

        log('Loaded. Watching for silence...');
    }

    init();

})();