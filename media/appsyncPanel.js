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

    // ── Utilities ────────────────────────────────────────────────────────────

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

    // ── Tab management ───────────────────────────────────────────────────────

    function showEditorTab(kind) {
        ['query', 'vars', 'resolver'].forEach(function (k) {
            const tab = document.getElementById('tabEditor' + k.charAt(0).toUpperCase() + k.slice(1));
            const panel = document.getElementById('editorPanel' + k.charAt(0).toUpperCase() + k.slice(1));
            const active = k === kind;
            if (tab) tab.classList.toggle('active', active);
            if (panel) panel.classList.toggle('active', active);
        });
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

    // ── Response pane ────────────────────────────────────────────────────────

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

    // ── Logs ─────────────────────────────────────────────────────────────────

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
        if (!log || typeof log !== 'object') { return String(Date.now()); }
        return [log.timestamp || '', log.typeName || '', log.fieldName || '', log.phase || '', log.durationMs || ''].join('|');
    }

    function addLogUnique(log) {
        const key = buildLogKey(log);
        if (seenLogKeys.has(key)) { return; }
        seenLogKeys.add(key);
        allLogs.unshift(log);
        if (allLogs.length > 300) { allLogs.length = 300; }
        renderLogs();
    }

    function matchesLogFilter(log) {
        const phase = String((log && log.phase) || '').toLowerCase();
        const resolverName = (String((log && log.typeName) || '') + '.' + String((log && log.fieldName) || '')).toLowerCase();
        return (activeLogPhase === 'all' || phase === activeLogPhase) &&
            (!activeLogSearch || resolverName.indexOf(activeLogSearch) !== -1);
    }

    function phaseColor(phase) {
        if (phase === 'request') return '#79c0ff';
        if (phase === 'response') return '#56d364';
        return '#f78166';
    }

    function identityBadge(identityType) {
        if (!identityType) return '';
        const colors = { apiKey: '#e3b341', cognitoUser: '#79c0ff', iam: '#f0883e', admin: '#f85149', guest: '#8b949e' };
        const color = colors[identityType] || '#8b949e';
        return '<span style="background:' + color + '20;color:' + color + ';border:1px solid ' + color + '40;padding:1px 6px;border-radius:4px;font-size:9px;margin-left:4px;">' + escapeHtml(identityType) + '</span>';
    }

    function renderLogs() {
        if (!logList) return;
        const filtered = allLogs.filter(matchesLogFilter);
        if (!filtered.length) {
            logList.innerHTML = '<div style="padding:16px;color:var(--muted);font-size:12px;">No logs for current filter.</div>';
            return;
        }

        // Group by traceId
        const traces = [];
        const traceMap = new Map();
        for (const log of filtered) {
            const tid = log.traceId || 'no-trace';
            if (!traceMap.has(tid)) {
                const group = { traceId: tid, logs: [], identity: log.identityType };
                traceMap.set(tid, group);
                traces.push(group);
            }
            traceMap.get(tid).logs.push(log);
        }

        logList.innerHTML = '';
        traces.forEach(function (trace, idx) {
            const wrapper = document.createElement('div');
            wrapper.style.cssText = 'border-bottom:1px solid var(--border);';

            const hasError = trace.logs.some(function (l) { return l.phase === 'error'; });
            const totalMs = trace.logs.reduce(function (s, l) { return s + (l.durationMs || 0); }, 0);
            const headerColor = hasError ? '#f78166' : '#56d364';
            const resolvers = [...new Set(trace.logs.map(function (l) { return l.typeName + '.' + l.fieldName; }))];

            const header = document.createElement('div');
            header.style.cssText = 'padding:7px 12px;display:flex;align-items:center;gap:6px;cursor:pointer;background:var(--surface);font-size:11px;';
            header.innerHTML =
                '<span style="color:' + headerColor + ';font-weight:700;">' + (hasError ? '✗' : '✓') + '</span>' +
                '<span style="color:var(--text);">' + escapeHtml(resolvers.join(', ')) + '</span>' +
                identityBadge(trace.identity) +
                '<span style="margin-left:auto;color:var(--muted);">' + totalMs + 'ms</span>';

            const body = document.createElement('div');
            body.style.cssText = idx === 0 ? 'display:block;' : 'display:none;';

            trace.logs.forEach(function (log) {
                const item = document.createElement('div');
                item.style.cssText = 'padding:6px 12px 6px 20px;border-top:1px solid var(--border)30;';
                const out = escapeHtml(JSON.stringify(log.output || {}).slice(0, 160));
                const pColor = phaseColor(log.phase);
                item.innerHTML =
                    '<div style="display:flex;gap:6px;align-items:center;font-size:10px;margin-bottom:3px;">' +
                    '<span style="color:' + pColor + ';font-weight:700;">' + escapeHtml(log.phase) + '</span>' +
                    '<span style="color:var(--accent2);">' + escapeHtml(log.typeName + '.' + log.fieldName) + '</span>' +
                    '<span style="color:var(--muted);margin-left:auto;">' + (log.durationMs || 0) + 'ms</span>' +
                    '</div>' +
                    '<div style="font-family:monospace;font-size:10px;color:var(--muted);">' + out + '</div>';
                body.appendChild(item);
            });

            header.addEventListener('click', function () {
                body.style.display = body.style.display === 'none' ? 'block' : 'none';
            });

            wrapper.appendChild(header);
            wrapper.appendChild(body);
            logList.appendChild(wrapper);
        });
    }

    function refreshLogs() {
        if (!serverPort) { return Promise.resolve(); }
        return fetch('http://localhost:' + serverPort + '/logs')
            .then(function (res) { return res.json(); })
            .then(function (logs) {
                if (!Array.isArray(logs)) { return; }
                logs.forEach(addLogUnique);
            })
            .catch(function () { /* Ignore polling failures */ });
    }

    // ── Schema ───────────────────────────────────────────────────────────────

    function highlightSdl(source) {
        return source.split('\n').map(function (line) {
            var esc = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            if (/^\s*#/.test(line)) { return '<span class="sdl-comment">' + esc + '</span>'; }
            esc = esc.replace(/\b(type|interface|input|enum|union|scalar|schema|extend|directive|query|mutation|subscription|fragment|on|implements)\b/g, '<span class="sdl-keyword">$1</span>');
            esc = esc.replace(/@(\w+)/g, '<span class="sdl-directive">@$1</span>');
            esc = esc.replace(/\b([A-Z][A-Za-z0-9_]*)\b/g, '<span class="sdl-type">$1</span>');
            return esc;
        }).join('\n');
    }

    function renderSchema(sdl) {
        currentSchema = sdl || '';
        filterSchema((document.getElementById('schemaSearch') || {}).value || '', currentSchema);
    }

    function filterSchema(query, sdl) {
        var source = sdl !== undefined ? sdl : currentSchema;
        if (!schemaOutput || !schemaCount) return;
        if (!source) { schemaOutput.textContent = '// Schema not loaded yet'; schemaCount.textContent = ''; return; }
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

    // ── History ──────────────────────────────────────────────────────────────

    var queryHistory = [];
    var HISTORY_MAX = 30;

    function saveToHistory(query) {
        var trimmed = (query || '').trim();
        if (!trimmed) return;
        queryHistory = queryHistory.filter(function (q) { return q !== trimmed; });
        queryHistory.unshift(trimmed);
        if (queryHistory.length > HISTORY_MAX) queryHistory.length = HISTORY_MAX;
        persistPanelState();
    }

    function renderHistoryDropdown() {
        var dd = document.getElementById('historyDropdown');
        if (!dd) return;
        if (!queryHistory.length) { dd.innerHTML = '<div class="history-empty">No history yet.</div>'; return; }
        dd.innerHTML = queryHistory.map(function (q, i) {
            return '<div class="history-item" data-idx="' + i + '">' + escapeHtml(q.replace(/\s+/g, ' ').slice(0, 60)) + '</div>';
        }).join('');
        dd.querySelectorAll('.history-item').forEach(function (el) {
            el.addEventListener('click', function () { loadHistory(parseInt(el.getAttribute('data-idx') || '0', 10)); });
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

    // ── Query runner ─────────────────────────────────────────────────────────

    function getSelectedIdentity() {
        var sel = document.getElementById('identitySelect');
        return (sel && sel.value) || null;
    }

    function buildHeaders(identity) {
        var headers = { 'Content-Type': 'application/json' };
        if (identity) { headers['x-appsync-identity'] = identity; }
        return headers;
    }

    function handleEditorKeydown(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runQuery(); }
    }

    function runQuery() {
        if (!responseOutput) return;
        if (!serverPort) { responseOutput.textContent = '// Server not running. Start the server first.'; return; }
        const query = (queryInput && queryInput.value || '').trim();
        if (!query) { responseOutput.textContent = '// Query is empty.'; return; }

        let variables;
        const raw = (varsInput && varsInput.value || '').trim();
        if (raw && raw !== '{}') {
            try { variables = JSON.parse(raw); } catch (_) {
                responseOutput.textContent = '// Invalid JSON in Variables tab.'; return;
            }
        }

        const identity = getSelectedIdentity();
        responseOutput.textContent = '// Running' + (identity ? ' as ' + identity : '') + '...';
        const queryToRun = query;

        fetch('http://localhost:' + serverPort + '/graphql', {
            method: 'POST',
            headers: buildHeaders(identity),
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

    // ── Multi-identity runner ─────────────────────────────────────────────────

    const ALL_IDENTITIES = ['apiKey', 'cognitoUser', 'iam', 'admin', 'guest'];

    function runAllIdentities() {
        if (!responseOutput) return;
        if (!serverPort) { responseOutput.textContent = '// Server not running.'; return; }
        const query = (queryInput && queryInput.value || '').trim();
        if (!query) { responseOutput.textContent = '// Query is empty.'; return; }

        let variables;
        const raw = (varsInput && varsInput.value || '').trim();
        if (raw && raw !== '{}') {
            try { variables = JSON.parse(raw); } catch (_) {
                responseOutput.textContent = '// Invalid JSON in Variables tab.'; return;
            }
        }

        responseOutput.textContent = '// Running with all identities...';
        responseOutput.className = '';

        const requests = ALL_IDENTITIES.map(function (identity) {
            return fetch('http://localhost:' + serverPort + '/graphql', {
                method: 'POST',
                headers: buildHeaders(identity),
                body: JSON.stringify({ query: query, variables: variables })
            })
                .then(function (res) { return res.json(); })
                .then(function (data) { return { identity: identity, data: data }; })
                .catch(function (err) { return { identity: identity, error: err.message || String(err) }; });
        });

        Promise.all(requests).then(function (results) {
            const combined = {};
            var hasError = false;
            results.forEach(function (r) {
                combined[r.identity] = r.error ? { networkError: r.error } : r.data;
                if (r.data && r.data.errors && r.data.errors.length) { hasError = true; }
            });
            responseOutput.textContent = JSON.stringify(combined, null, 2);
            responseOutput.className = hasError ? 'response-error' : '';
            return refreshLogs();
        });
    }

    // ── Reload mock data ──────────────────────────────────────────────────────

    function reloadMockData() {
        if (!vscodeApi) return;
        vscodeApi.postMessage({ type: 'reloadMockData' });
        setBanner('↺ Reloading mock data...', '#1c2533', '#79c0ff');
    }

    // ── Resolver Runner ───────────────────────────────────────────────────────

    function runResolver() {
        const picker = document.getElementById('resolverPicker');
        const argsEl = document.getElementById('resolverArgs');
        const identityEl = document.getElementById('resolverIdentity');
        const traceEl = document.getElementById('resolverTrace');

        if (!picker || !traceEl) return;
        if (!serverPort) { if (traceEl) traceEl.textContent = '// Server not running.'; return; }

        const resolverName = (picker.value || '').trim();
        if (!resolverName || !resolverName.includes('.')) {
            traceEl.textContent = '// Enter a resolver as Type.Field (e.g. Query.getItem)'; return;
        }

        const parts = resolverName.split('.');
        const typeName = parts[0];
        const fieldName = parts.slice(1).join('.');
        const identity = (identityEl && identityEl.value) || 'apiKey';

        let args = {};
        if (argsEl && argsEl.value.trim()) {
            try { args = JSON.parse(argsEl.value.trim()); } catch (_) {
                traceEl.textContent = '// Invalid JSON in Arguments field.'; return;
            }
        }

        // Build a minimal query for the resolver
        const query = 'query ResolverRun { ' + fieldName + ' }';
        const variables = Object.keys(args).length ? args : undefined;

        traceEl.textContent = '// Running ' + resolverName + ' as ' + identity + '...';

        fetch('http://localhost:' + serverPort + '/graphql', {
            method: 'POST',
            headers: buildHeaders(identity),
            body: JSON.stringify({ query: query, variables: variables })
        })
            .then(function (res) { return res.json(); })
            .then(function (data) {
                // Pull trace logs for this execution
                return refreshLogs().then(function () {
                    const traceLogs = allLogs.filter(function (l) {
                        return l.typeName === typeName && l.fieldName === fieldName;
                    }).slice(0, 6);

                    var lines = ['// Resolver: ' + resolverName + ' — identity: ' + identity, ''];
                    traceLogs.forEach(function (log) {
                        lines.push('// [' + log.phase.toUpperCase() + '] ' + log.durationMs + 'ms');
                        lines.push('// input:  ' + JSON.stringify(log.input).slice(0, 200));
                        lines.push('// output: ' + JSON.stringify(log.output).slice(0, 200));
                        lines.push('');
                    });
                    lines.push('// Response:');
                    lines.push(JSON.stringify(data, null, 2));
                    traceEl.textContent = lines.join('\n');
                });
            })
            .catch(function (err) {
                traceEl.textContent = '// Error: ' + ((err && err.message) ? err.message : String(err));
            });
    }

    // ── Init ─────────────────────────────────────────────────────────────────

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
                if (badge) { badge.className = 'reload-badge show'; setTimeout(function () { badge.className = 'reload-badge'; }, 3000); }
            }
            if (data.type === 'log' && data.log) {
                addLogUnique(data.log);
            }
            if (data.type === 'mockDataReloaded') {
                setBanner('✓ Mock data reloaded', '#1c2a1c', '#56d364');
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
            queryInput.addEventListener('input', function () { syncEditor(); persistPanelState(); });
            queryInput.addEventListener('scroll', syncScroll);
            queryInput.addEventListener('keydown', handleEditorKeydown);
        }
        if (varsInput) { varsInput.addEventListener('input', persistPanelState); }

        // Button wiring
        var wire = function (id, fn) { var el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
        wire('btnRun', runQuery);
        wire('btnRunAll', runAllIdentities);
        wire('btnReloadData', reloadMockData);
        wire('btnClear', clearResponse);
        wire('btnHistory', toggleHistory);
        wire('btnCopy', copyResponse);
        wire('btnResizeUp', function () { resizeResponse(-80); });
        wire('btnResizeDown', function () { resizeResponse(80); });
        wire('btnResetSize', resetResponseSize);
        wire('tabEditorQuery', function () { showEditorTab('query'); });
        wire('tabEditorVars', function () { showEditorTab('vars'); });
        wire('tabEditorResolver', function () { showEditorTab('resolver'); });
        wire('tabLogs', function () { showSidePanel('logs'); });
        wire('tabSchema', function () { showSidePanel('schema'); });
        wire('btnClearLogs', clearLogs);
        wire('btnRunResolver', runResolver);

        var schemaSearchEl = document.getElementById('schemaSearch');
        if (schemaSearchEl) schemaSearchEl.addEventListener('input', function () { filterSchema(this.value); });

        var logPhaseFilterEl = document.getElementById('logPhaseFilter');
        if (logPhaseFilterEl) logPhaseFilterEl.addEventListener('change', function () {
            activeLogPhase = String(logPhaseFilterEl.value || 'all').toLowerCase();
            renderLogs();
        });

        var logSearchEl = document.getElementById('logSearch');
        if (logSearchEl) logSearchEl.addEventListener('input', function () {
            activeLogSearch = String(logSearchEl.value || '').trim().toLowerCase();
            renderLogs();
        });

        document.body.classList.add('overlay-ready');
        syncEditor();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
