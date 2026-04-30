// @ts-nocheck
/* eslint-disable */
(function () {
    'use strict';

    let vscodeApi = null;
    let serverPort = null;
    let currentSchema = '';
    let panelState = { query: '', variables: '{}', history: [] };
    const RESPONSE_DEFAULT_HEIGHT = 200;
    const RESPONSE_MIN_HEIGHT = 100;
    const RESPONSE_MAX_HEIGHT = 560;

    const bannerEl = document.getElementById('banner');
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    const queryInput = document.getElementById('queryInput');
    const varsInput = document.getElementById('variablesInput');
    const responseOutput = document.getElementById('responseOutput');
    const schemaOutput = document.getElementById('schemaOutput');
    const schemaCount = document.getElementById('schemaCount');
    const logList = document.getElementById('logList');
    const seenLogKeys = new Set();
    const allLogs = [];
    let activeLogPhase = 'all';
    let activeLogSearch = '';

    function safeText(el, text) {
        if (el) { el.textContent = text; }
    }

    function setBanner(text, bg, color) {
        if (!bannerEl) return;
        bannerEl.classList.add('visible');
        bannerEl.style.display = 'block';
        bannerEl.style.background = bg || '#1c2a1c';
        bannerEl.style.color = color || '#56d364';
        bannerEl.textContent = text;
    }

    function escapeHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function syncEditor() {
        if (!queryInput) return;
        const highlight = document.getElementById('queryHighlight');
        if (highlight) {
            highlight.innerHTML = queryInput.value
                ? escapeHtml(queryInput.value)
                : '<span style="color:#3d444d">' + escapeHtml(queryInput.placeholder || '') + '</span>';
        }
    }

    function persistPanelState() {
        if (!vscodeApi) return;
        panelState = {
            query: (queryInput && queryInput.value) || '',
            variables: (varsInput && varsInput.value) || '{}',
            history: queryHistory,
        };
        vscodeApi.postMessage({ type: 'persistState', state: panelState });
    }

    function syncScroll() {
        const highlight = document.getElementById('queryHighlight');
        if (queryInput && highlight) {
            highlight.scrollTop = queryInput.scrollTop;
            highlight.scrollLeft = queryInput.scrollLeft;
        }
    }

    function showEditorTab(kind) {
        const isQuery = kind === 'query';
        const qTab = document.getElementById('tabEditorQuery');
        const vTab = document.getElementById('tabEditorVars');
        const qPanel = document.getElementById('editorPanelQuery');
        const vPanel = document.getElementById('editorPanelVars');
        if (qTab) qTab.classList.toggle('active', isQuery);
        if (vTab) vTab.classList.toggle('active', !isQuery);
        if (qPanel) qPanel.classList.toggle('active', isQuery);
        if (vPanel) vPanel.classList.toggle('active', !isQuery);
    }

    function showSidePanel(kind) {
        const showLogs = kind === 'logs';
        const tabLogs = document.getElementById('tabLogs');
        const tabSchema = document.getElementById('tabSchema');
        const panelLogs = document.getElementById('panelLogs');
        const panelSchema = document.getElementById('panelSchema');
        if (tabLogs) tabLogs.classList.toggle('active', showLogs);
        if (tabSchema) tabSchema.classList.toggle('active', !showLogs);
        if (panelLogs) panelLogs.classList.toggle('active', showLogs);
        if (panelSchema) panelSchema.classList.toggle('active', !showLogs);
    }

    function clearResponse() {
        if (responseOutput) {
            responseOutput.textContent = '';
            responseOutput.className = '';
        }
    }

    function copyResponse() {
        if (!responseOutput) return;
        const text = responseOutput.textContent || '';
        if (!text) return;
        try {
            navigator.clipboard.writeText(text);
        } catch (_) {
            const r = document.createRange();
            r.selectNode(responseOutput);
            const sel = window.getSelection();
            if (sel) {
                sel.removeAllRanges();
                sel.addRange(r);
            }
        }
    }

    function resizeResponse(delta) {
        const pane = document.getElementById('responsePane');
        if (!pane) return;
        const current = pane.getBoundingClientRect().height;
        const next = Math.max(RESPONSE_MIN_HEIGHT, Math.min(RESPONSE_MAX_HEIGHT, current + delta));
        pane.style.height = next + 'px';
    }

    function resetResponseSize() {
        const pane = document.getElementById('responsePane');
        if (pane) pane.style.height = RESPONSE_DEFAULT_HEIGHT + 'px';
    }

    function clearLogs() {
        seenLogKeys.clear();
        allLogs.length = 0;
        if (logList) {
            logList.innerHTML = '<div style="padding:16px;color:var(--muted);font-size:12px;">Logs cleared.</div>';
        }
        if (vscodeApi) {
            vscodeApi.postMessage({ type: 'clearLogs' });
        }
    }

    function buildLogKey(log) {
        if (!log || typeof log !== 'object') {
            return String(Date.now());
        }
        const ts = log.timestamp || '';
        const tn = log.typeName || '';
        const fn = log.fieldName || '';
        const ph = log.phase || '';
        const dm = log.durationMs || '';
        return [ts, tn, fn, ph, dm].join('|');
    }

    function addLogUnique(log) {
        const key = buildLogKey(log);
        if (seenLogKeys.has(key)) {
            return;
        }
        seenLogKeys.add(key);
        allLogs.unshift(log);
        if (allLogs.length > 300) {
            allLogs.length = 300;
        }
        renderLogs();
    }

    function addLog(log) {
        if (!logList) return;
        const item = document.createElement('div');
        item.className = 'log-item';
        const tn = escapeHtml((log && log.typeName) || 'Resolver');
        const fn = escapeHtml((log && log.fieldName) || 'field');
        const ph = escapeHtml((log && log.phase) || 'response');
        const dm = escapeHtml((log && log.durationMs) || '0');
        const out = escapeHtml(JSON.stringify((log && log.output) || {}).slice(0, 120));
        item.innerHTML =
            '<div class="log-header">' +
            '<span class="field">' + tn + '.' + fn + '</span>' +
            '<span class="phase ' + ph + '">' + ph + '</span>' +
            '<span class="duration">' + dm + 'ms</span>' +
            '</div>' +
            '<div class="log-body">' + out + '</div>';
        logList.appendChild(item);
    }

    function matchesLogFilter(log) {
        const phase = String((log && log.phase) || '').toLowerCase();
        const resolverName = (String((log && log.typeName) || '') + '.' + String((log && log.fieldName) || '')).toLowerCase();
        const phaseMatch = activeLogPhase === 'all' || phase === activeLogPhase;
        const searchMatch = !activeLogSearch || resolverName.indexOf(activeLogSearch) !== -1;
        return phaseMatch && searchMatch;
    }

    function renderLogs() {
        if (!logList) return;
        logList.innerHTML = '';

        const filtered = allLogs.filter(matchesLogFilter);
        if (!filtered.length) {
            logList.innerHTML = '<div style="padding:16px;color:var(--muted);font-size:12px;">No logs for current filter.</div>';
            return;
        }

        filtered.forEach(addLog);
    }

    function refreshLogs() {
        if (!serverPort) {
            return Promise.resolve();
        }
        return fetch('http://localhost:' + serverPort + '/logs')
            .then(function (res) { return res.json(); })
            .then(function (logs) {
                if (!Array.isArray(logs)) {
                    return;
                }
                logs.forEach(addLogUnique);
            })
            .catch(function () {
                // Ignore polling failures; live push logs may still arrive via postMessage.
            });
    }

    // ── Schema ──────────────────────────────────────────────────────────────

    function highlightSdl(source) {
        return source
            .split('\n')
            .map(function (line) {
                var esc = line
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;');
                // comments
                if (/^\s*#/.test(line)) {
                    return '<span class="sdl-comment">' + esc + '</span>';
                }
                // keywords at start of line
                esc = esc.replace(
                    /\b(type|interface|input|enum|union|scalar|schema|extend|directive|query|mutation|subscription|fragment|on|implements)\b/g,
                    '<span class="sdl-keyword">$1</span>'
                );
                // directives
                esc = esc.replace(/@(\w+)/g, '<span class="sdl-directive">@$1</span>');
                // type references (UpperCase words)
                esc = esc.replace(/\b([A-Z][A-Za-z0-9_]*)\b/g, '<span class="sdl-type">$1</span>');
                return esc;
            })
            .join('\n');
    }

    function renderSchema(sdl) {
        currentSchema = sdl || '';
        filterSchema((document.getElementById('schemaSearch') || {}).value || '', currentSchema);
    }

    function filterSchema(query, sdl) {
        var source = sdl !== undefined ? sdl : currentSchema;
        if (!schemaOutput || !schemaCount) return;
        if (!source) {
            schemaOutput.textContent = '// Schema not loaded yet';
            schemaCount.textContent = '';
            return;
        }
        var lines = source.split('\n');
        if (query) {
            var low = String(query).toLowerCase();
            lines = lines.filter(function (l) { return l.toLowerCase().includes(low); });
            schemaCount.textContent = lines.length + ' matches';
        } else {
            schemaCount.textContent = lines.length + ' lines';
        }
        schemaOutput.innerHTML = highlightSdl(lines.join('\n'));
    }

    // ── History ─────────────────────────────────────────────────────────────

    var queryHistory = [];
    var HISTORY_MAX = 30;

    function saveToHistory(query) {
        var trimmed = (query || '').trim();
        if (!trimmed) return;
        // remove duplicate if already in list
        queryHistory = queryHistory.filter(function (q) { return q !== trimmed; });
        queryHistory.unshift(trimmed);
        if (queryHistory.length > HISTORY_MAX) queryHistory.length = HISTORY_MAX;
        persistPanelState();
    }

    function renderHistoryDropdown() {
        var dd = document.getElementById('historyDropdown');
        if (!dd) return;
        if (!queryHistory.length) {
            dd.innerHTML = '<div class="history-empty">No history yet.</div>';
            return;
        }
        dd.innerHTML = queryHistory.map(function (q, i) {
            var preview = escapeHtml(q.replace(/\s+/g, ' ').slice(0, 60));
            return '<div class="history-item" data-idx="' + i + '">' + preview + '</div>';
        }).join('');
        dd.querySelectorAll('.history-item').forEach(function (el) {
            el.addEventListener('click', function () {
                loadHistory(parseInt(el.getAttribute('data-idx') || '0', 10));
            });
        });
    }

    function toggleHistory() {
        var dd = document.getElementById('historyDropdown');
        if (!dd) return;
        var isOpen = dd.classList.toggle('open');
        if (isOpen) renderHistoryDropdown();
    }

    function loadHistory(idx) {
        var q = queryHistory[idx];
        if (!q || !queryInput) return;
        queryInput.value = q;
        syncEditor();
        persistPanelState();
        var dd = document.getElementById('historyDropdown');
        if (dd) dd.classList.remove('open');
    }

    function handleEditorKeydown(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            runQuery();
        }
    }

    function runQuery() {
        if (!responseOutput) return;
        if (!serverPort) {
            responseOutput.textContent = '// Server not running. Start the server first.';
            return;
        }
        const query = (queryInput && queryInput.value || '').trim();
        if (!query) {
            responseOutput.textContent = '// Query is empty.';
            return;
        }

        let variables;
        const raw = (varsInput && varsInput.value || '').trim();
        if (raw && raw !== '{}') {
            try {
                variables = JSON.parse(raw);
            } catch (_) {
                responseOutput.textContent = '// Invalid JSON in Variables tab.';
                return;
            }
        }

        responseOutput.textContent = '// Running...';
        var queryToRun = query;
        fetch('http://localhost:' + serverPort + '/graphql', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: query, variables: variables })
        })
            .then(function (res) { return res.json(); })
            .then(function (data) {
                saveToHistory(queryToRun);
                responseOutput.textContent = JSON.stringify(data, null, 2);
                responseOutput.className = (data && data.errors && data.errors.length) ? 'response-error' : '';
                return refreshLogs();
            })
            .catch(function (err) {
                responseOutput.textContent = '// Network error: ' + ((err && err.message) ? err.message : String(err));
            });
    }

    function init() {
        try {
            vscodeApi = acquireVsCodeApi();
            vscodeApi.postMessage({ type: 'ready' });
            vscodeApi.postMessage({ type: 'requestState' });
        } catch (err) {
            setBanner('ERROR: ' + ((err && err.message) ? err.message : String(err)), '#5a0000', '#ffd7d7');
            return;
        }

        window.addEventListener('message', function (event) {
            const data = (event && event.data) || {};
            if (data.type === 'serverStarted') {
                serverPort = data.port;
                if (statusDot) statusDot.classList.add('running');
                safeText(statusText, 'http://localhost:' + serverPort);
                setBanner('✓ AppSync Offline running at http://localhost:' + serverPort + '/graphql', '#1c2a1c', '#56d364');
                renderSchema(data.schemaSDL || '');
                refreshLogs();
            }
            if (data.type === 'schemaReloaded') {
                renderSchema(data.schemaSDL || '');
                const badge = document.getElementById('reloadBadge');
                if (badge) {
                    badge.className = 'reload-badge show';
                    setTimeout(function () { badge.className = 'reload-badge'; }, 3000);
                }
            }
            if (data.type === 'log' && data.log) {
                addLogUnique(data.log);
            }
            if (data.type === 'hydrateState' && data.state) {
                var s = data.state;
                if (queryInput && typeof s.query === 'string') queryInput.value = s.query;
                if (varsInput && typeof s.variables === 'string') varsInput.value = s.variables;
                if (Array.isArray(s.history)) queryHistory = s.history;
                syncEditor();
            }
        });

        if (queryInput) {
            queryInput.addEventListener('input', function () {
                syncEditor();
                persistPanelState();
            });
            queryInput.addEventListener('scroll', syncScroll);
            queryInput.addEventListener('keydown', handleEditorKeydown);
        }

        if (varsInput) {
            varsInput.addEventListener('input', function () {
                persistPanelState();
            });
        }

        const btnRun = document.getElementById('btnRun');
        const btnClear = document.getElementById('btnClear');
        const btnHistory = document.getElementById('btnHistory');
        const btnCopy = document.getElementById('btnCopy');
        const btnResizeUp = document.getElementById('btnResizeUp');
        const btnResizeDown = document.getElementById('btnResizeDown');
        const btnResetSize = document.getElementById('btnResetSize');
        const tabEditorQuery = document.getElementById('tabEditorQuery');
        const tabEditorVars = document.getElementById('tabEditorVars');
        const tabLogsBtn = document.getElementById('tabLogs');
        const tabSchemaBtn = document.getElementById('tabSchema');
        const btnClearLogs = document.getElementById('btnClearLogs');
        const schemaSearchEl = document.getElementById('schemaSearch');
        const logPhaseFilterEl = document.getElementById('logPhaseFilter');
        const logSearchEl = document.getElementById('logSearch');

        if (btnRun) btnRun.addEventListener('click', runQuery);
        if (btnClear) btnClear.addEventListener('click', clearResponse);
        if (btnHistory) btnHistory.addEventListener('click', toggleHistory);
        if (btnCopy) btnCopy.addEventListener('click', copyResponse);
        if (btnResizeUp) btnResizeUp.addEventListener('click', function () { resizeResponse(-80); });
        if (btnResizeDown) btnResizeDown.addEventListener('click', function () { resizeResponse(80); });
        if (btnResetSize) btnResetSize.addEventListener('click', resetResponseSize);
        if (tabEditorQuery) tabEditorQuery.addEventListener('click', function () { showEditorTab('query'); });
        if (tabEditorVars) tabEditorVars.addEventListener('click', function () { showEditorTab('vars'); });
        if (tabLogsBtn) tabLogsBtn.addEventListener('click', function () { showSidePanel('logs'); });
        if (tabSchemaBtn) tabSchemaBtn.addEventListener('click', function () { showSidePanel('schema'); });
        if (btnClearLogs) btnClearLogs.addEventListener('click', clearLogs);
        if (schemaSearchEl) schemaSearchEl.addEventListener('input', function () { filterSchema(this.value); });
        if (logPhaseFilterEl) {
            logPhaseFilterEl.addEventListener('change', function () {
                activeLogPhase = String(logPhaseFilterEl.value || 'all').toLowerCase();
                renderLogs();
            });
        }
        if (logSearchEl) {
            logSearchEl.addEventListener('input', function () {
                activeLogSearch = String(logSearchEl.value || '').trim().toLowerCase();
                renderLogs();
            });
        }

        document.body.classList.add('overlay-ready');
        syncEditor();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
