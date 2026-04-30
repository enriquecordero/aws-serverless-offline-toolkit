// @ts-nocheck
/* eslint-disable */
(function () {
    'use strict';

    let vscodeApi = null;
    let serverPort = null;
    let currentSchema = '';
    let panelState = { query: '', variables: '{}', history: [], resolverHistory: [] };
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
            resolverHistory: resolverHistory,
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
                var stepBadge = log.pipelineStep
                    ? '<span style="background:#1f2d3d;color:var(--warning);padding:1px 5px;border-radius:3px;font-size:9px;">' + escapeHtml(log.pipelineStep) + '</span>'
                    : '';
                item.innerHTML =
                    '<div style="display:flex;gap:6px;align-items:center;font-size:10px;margin-bottom:3px;">' +
                    '<span style="color:' + pColor + ';font-weight:700;">' + escapeHtml(log.phase) + '</span>' +
                    stepBadge +
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

    // ── Resolver run history ──────────────────────────────────────────────────

    var resolverHistory = [];
    var RESOLVER_HISTORY_MAX = 20;

    function saveResolverRun(run) {
        resolverHistory = [run].concat(resolverHistory.filter(function (r) {
            return !(r.typeName === run.typeName && r.fieldName === run.fieldName && r.identity === run.identity);
        })).slice(0, RESOLVER_HISTORY_MAX);
        persistPanelState();
        renderResolverHistory();
    }

    function renderResolverHistory() {
        var listEl = document.getElementById('resolverHistoryList');
        if (!listEl) return;
        if (!resolverHistory.length) {
            listEl.innerHTML = '<div style="padding:8px 12px;color:var(--muted);font-size:11px;">No runs yet.</div>';
            return;
        }
        const colors = { apiKey: '#e3b341', cognitoUser: '#79c0ff', iam: '#f0883e', admin: '#f85149', guest: '#8b949e' };
        listEl.innerHTML = resolverHistory.map(function (run, i) {
            const color = colors[run.identity] || '#8b949e';
            const icon = run.success ? '<span style="color:#56d364;">✓</span>' : '<span style="color:#f78166;">✗</span>';
            const ts = run.timestamp ? new Date(run.timestamp).toLocaleTimeString() : '';
            return '<div class="history-item" data-idx="' + i + '" style="display:flex;gap:6px;align-items:center;">' +
                icon +
                '<span style="color:var(--accent2);font-size:11px;">' + escapeHtml(run.typeName + '.' + run.fieldName) + '</span>' +
                '<span style="background:' + color + '20;color:' + color + ';border:1px solid ' + color + '40;padding:1px 5px;border-radius:3px;font-size:9px;">' + escapeHtml(run.identity) + '</span>' +
                '<span style="margin-left:auto;color:var(--muted);font-size:10px;">' + ts + '</span>' +
                '</div>';
        }).join('');
        listEl.querySelectorAll('.history-item').forEach(function (el) {
            el.addEventListener('click', function () {
                loadResolverHistoryEntry(parseInt(el.getAttribute('data-idx') || '0', 10));
            });
        });
    }

    function loadResolverHistoryEntry(idx) {
        var run = resolverHistory[idx];
        if (!run) return;
        var picker = document.getElementById('resolverPicker');
        var identityEl = document.getElementById('resolverIdentity');
        var argsEl = document.getElementById('resolverArgs');
        if (picker) picker.value = run.typeName + '.' + run.fieldName;
        if (identityEl) identityEl.value = run.identity;
        if (argsEl) argsEl.value = run.args ? JSON.stringify(run.args, null, 2) : '{}';
    }

    // ── Query history ─────────────────────────────────────────────────────────

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

    function diagnoseError(msg) {
        if (!msg) return '';
        if (/Cannot read propert/i.test(msg)) return 'Tip: the data source returned null or an unexpected shape. Check mock-data.json.';
        if (/is not defined/i.test(msg)) return 'Tip: the resolver references an undefined variable. Check the resolver code.';
        if (/SyntaxError/i.test(msg)) return 'Tip: the resolver code has a syntax error.';
        if (/No resolver found/i.test(msg)) return 'Tip: no resolver file was found for this Type.Field.';
        if (/\[VTL\]/i.test(msg)) return 'Tip: the VTL template raised an error. Check $util.error() calls and condition branches.';
        return '';
    }

    function renderResolverTrace(resolverName, identity, result) {
        var traceEl = document.getElementById('resolverTrace');
        if (!traceEl) return;
        var lines = [];
        var hasErrors = result.errors && result.errors.length > 0;
        lines.push('// Resolver: ' + resolverName + '   identity: ' + identity);
        lines.push('');
        if (result.logs && result.logs.length) {
            result.logs.forEach(function (log) {
                var stepLabel = log.pipelineStep ? log.pipelineStep + ' → ' : '';
                lines.push('// [' + stepLabel + (log.phase || '?').toUpperCase() + '] ' + (log.durationMs || 0) + 'ms');
                if (log.input !== undefined && log.input !== null) {
                    lines.push('//   in:  ' + JSON.stringify(log.input).slice(0, 300));
                }
                if (log.output !== undefined && log.output !== null) {
                    lines.push('//   out: ' + JSON.stringify(log.output).slice(0, 300));
                }
                lines.push('');
            });
        }
        if (hasErrors) {
            lines.push('// ERRORS:');
            result.errors.forEach(function (e) {
                lines.push('// ' + (e.type ? '[' + e.type + '] ' : '') + (e.message || String(e)));
                var tip = diagnoseError(e.message);
                if (tip) lines.push('// ' + tip);
            });
            lines.push('');
        }
        lines.push('// Response:');
        lines.push(JSON.stringify(result.data !== undefined ? result.data : null, null, 2));
        traceEl.textContent = lines.join('\n');
    }

    function debugLambda() {
        var picker = document.getElementById('resolverPicker');
        var argsEl = document.getElementById('resolverArgs');
        var identityEl = document.getElementById('resolverIdentity');
        var traceEl = document.getElementById('resolverTrace');

        if (!picker || !traceEl) return;
        if (!vscodeApi) { if (traceEl) traceEl.textContent = '// vscodeApi not available.'; return; }

        var resolverName = (picker.value || '').trim();
        if (!resolverName || !resolverName.includes('.')) {
            traceEl.textContent = '// Enter a resolver as Type.Field (e.g. Query.getItem)'; return;
        }

        var parts = resolverName.split('.');
        var typeName = parts[0];
        var fieldName = parts.slice(1).join('.');
        var identity = (identityEl && identityEl.value) || 'apiKey';

        var args = {};
        if (argsEl && argsEl.value.trim()) {
            try { args = JSON.parse(argsEl.value.trim()); } catch (_) {
                traceEl.textContent = '// Invalid JSON in Arguments field.'; return;
            }
        }

        traceEl.textContent = '// Starting debug session for ' + resolverName + '...\n// Waiting for VS Code debugger to attach...';
        vscodeApi.postMessage({ type: 'debugLambda', typeName: typeName, fieldName: fieldName, args: args, identity: identity });
    }

    function runResolver() {
        var picker = document.getElementById('resolverPicker');
        var argsEl = document.getElementById('resolverArgs');
        var identityEl = document.getElementById('resolverIdentity');
        var traceEl = document.getElementById('resolverTrace');

        if (!picker || !traceEl) return;
        if (!serverPort) { if (traceEl) traceEl.textContent = '// Server not running.'; return; }

        var resolverName = (picker.value || '').trim();
        if (!resolverName || !resolverName.includes('.')) {
            traceEl.textContent = '// Enter a resolver as Type.Field (e.g. Query.getItem)'; return;
        }

        var parts = resolverName.split('.');
        var typeName = parts[0];
        var fieldName = parts.slice(1).join('.');
        var identity = (identityEl && identityEl.value) || 'apiKey';

        var args = {};
        if (argsEl && argsEl.value.trim()) {
            try { args = JSON.parse(argsEl.value.trim()); } catch (_) {
                traceEl.textContent = '// Invalid JSON in Arguments field.'; return;
            }
        }

        traceEl.textContent = '// Running ' + resolverName + ' as ' + identity + '...';

        fetch('http://localhost:' + serverPort + '/direct-resolve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ typeName: typeName, fieldName: fieldName, args: args, identity: identity })
        })
            .then(function (res) { return res.json(); })
            .then(function (result) {
                var success = !result.errors || result.errors.length === 0;
                saveResolverRun({ typeName: typeName, fieldName: fieldName, identity: identity, args: args, success: success, timestamp: Date.now() });
                renderResolverTrace(resolverName, identity, result);
                return refreshLogs();
            })
            .catch(function (err) {
                var msg = (err && err.message) ? err.message : String(err);
                if (traceEl) traceEl.textContent = '// Network error: ' + msg;
                saveResolverRun({ typeName: typeName, fieldName: fieldName, identity: identity, args: args, success: false, timestamp: Date.now() });
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
            if (data.type === 'lambdaDebugStarted') {
                var traceEl = document.getElementById('resolverTrace');
                if (traceEl) traceEl.textContent = '// Debug session started on port ' + data.port + '\n// Set breakpoints and resume in the VS Code debugger panel...';
                setBanner('🐛 Lambda debug session active — use VS Code Debug panel to step through', '#1c2533', '#79c0ff');
            }
            if (data.type === 'lambdaDebugResult') {
                var r = data.result || {};
                var traceEl = document.getElementById('resolverTrace');
                if (traceEl) {
                    var lines = ['// Debug session complete'];
                    if (r.error) {
                        lines.push('// ERROR: ' + r.error);
                        if (r.stack) lines.push('// ' + String(r.stack).split('\n').slice(0, 4).join('\n// '));
                    } else {
                        lines.push('// Result:');
                        lines.push(JSON.stringify(r.result !== undefined ? r.result : null, null, 2));
                    }
                    if (r.logs && r.logs.length) {
                        lines.push('');
                        lines.push('// Lambda stderr:');
                        r.logs.forEach(function (l) { lines.push('//   ' + l); });
                    }
                    traceEl.textContent = lines.join('\n');
                }
                setBanner('✓ Lambda debug session complete', '#1c2a1c', '#56d364');
                refreshLogs();
            }
            if (data.type === 'lambdaDebugError') {
                var traceEl = document.getElementById('resolverTrace');
                if (traceEl) traceEl.textContent = '// Debug error: ' + escapeHtml(data.error || 'Unknown error');
                setBanner('✗ Lambda debug failed: ' + (data.error || '?'), '#2a1c1c', '#f78166');
            }
            if (data.type === 'hydrateState' && data.state) {
                var s = data.state;
                if (queryInput && typeof s.query === 'string') queryInput.value = s.query;
                if (varsInput && typeof s.variables === 'string') varsInput.value = s.variables;
                if (Array.isArray(s.history)) queryHistory = s.history;
                if (Array.isArray(s.resolverHistory)) resolverHistory = s.resolverHistory;
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
        wire('btnDebugLambda', debugLambda);
        wire('resolverHistoryToggle', function () {
            var listEl = document.getElementById('resolverHistoryList');
            var chevron = document.getElementById('resolverHistoryChevron');
            if (!listEl) return;
            var open = listEl.style.display === 'none' || listEl.style.display === '';
            listEl.style.display = open ? 'block' : 'none';
            if (chevron) chevron.textContent = open ? '▼' : '▶';
            if (open) renderResolverHistory();
        });

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
