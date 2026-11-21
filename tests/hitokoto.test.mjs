import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/downloads/hitokoto-universal.user.js', import.meta.url), 'utf8');

// Run the entire distributed script, including startup and real settings/menu handlers.
// This small DOM models attachment, inputs and observer delivery; it does not replace
// any userscript function or depend on test-only exports in the distributed script.
function harness(config = {}, { throwRequest = false } = {}) {
    const requests = [], observers = [], menus = new Map(), timers = new Map(), tasks = [], saves = [];
    let timerId = 0;
    class Element {
        constructor(tag) {
            this.tagName = tag.toLowerCase();
            this.children = [];
            this.parentNode = null;
            this.listeners = new Map();
            this.id = '';
            this.className = '';
            this.value = '';
            this.checked = false;
            this.validityMessage = '';
            this.validityReports = 0;
            this.style = { setProperty() {} };
            this.classList = {
                add: (name) => { this.className += ' ' + name; },
                remove: (name) => { this.className = this.className.split(' ').filter((s) => s !== name).join(' '); },
            };
            this._html = '';
            this._text = '';
        }
        appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
        remove() {
            if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
            this.parentNode = null;
        }
        addEventListener(type, fn) {
            if (!this.listeners.has(type)) this.listeners.set(type, []);
            this.listeners.get(type).push(fn);
        }
        dispatch(type) {
            for (const fn of this.listeners.get(type) || []) fn({ target: this, preventDefault() {} });
        }
        setCustomValidity(message) { this.validityMessage = message; }
        reportValidity() {
            this.validityReports++;
            return !this.validityMessage;
        }
        set textContent(value) {
            this._text = String(value);
            this._html = this._text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
        }
        get textContent() { return this._text; }
        set innerHTML(html) {
            this._html = html;
            this.children = [];
            for (const match of html.matchAll(/<(input|select|textarea|button|span|div)\b([^>]*)>/g)) {
                const child = new Element(match[1]);
                for (const attr of match[2].matchAll(/([\w-]+)="([^"]*)"/g)) child[attr[1]] = attr[2];
                child.checked = /\bchecked\b/.test(match[2]);
                if (child.tagName === 'select') {
                    const content = html.slice(match.index + match[0].length).split('</select>')[0];
                    const options = [...content.matchAll(/<option\b([^>]*)>/g)];
                    const selected = options.find((option) => /\bselected\b/.test(option[1])) || options[0];
                    child.value = selected?.[1].match(/value="([^"]*)"/)?.[1] || '';
                }
                if (child.tagName === 'textarea') child.value = html.slice(match.index + match[0].length).split('</textarea>')[0];
                this.appendChild(child);
            }
        }
        get innerHTML() { return this._html; }
    }
    const root = new Element('html');
    let body = root.appendChild(new Element('body'));
    body.appendChild(new Element('main'));
    function find(node, id) {
        if (node.id === id) return node;
        for (const child of node.children) { const found = find(child, id); if (found) return found; }
        return null;
    }
    const document = {
        documentElement: root,
        get body() { return body; },
        createElement: (tag) => new Element(tag),
        getElementById: (id) => find(root, id),
        addEventListener() {}, removeEventListener() {},
    };
    class Observer {
        constructor(callback) { this.callback = callback; this.target = null; observers.push(this); }
        observe(target, options) { this.target = target; this.options = options; }
        disconnect() { this.target = null; }
    }
    vm.runInNewContext(source, {
        document, location: { hostname: 'example.com' }, MutationObserver: Observer,
        GM_getValue: () => ({ refreshInterval: 0, ...config }),
        GM_setValue: (_key, value) => saves.push(structuredClone(value)),
        GM_addStyle() {}, GM_registerMenuCommand: (label, fn) => menus.set(label, fn),
        GM_xmlhttpRequest(options) {
            if (throwRequest) throw new Error('manager unavailable');
            const request = { options, aborted: false, abort() { this.aborted = true; options.onabort?.(); } };
            requests.push(request);
            return request;
        },
        requestAnimationFrame: (fn) => tasks.push(fn),
        setTimeout: (fn) => { tasks.push(fn); return ++timerId; },
        setInterval: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
        clearInterval: (id) => timers.delete(id),
    }, { filename: 'hitokoto-universal.user.js' });
    while (tasks.length) tasks.shift()();
    return {
        requests, observers, menus, timers, saves, document,
        bar: () => document.getElementById('hito-bar'),
        get: (id) => document.getElementById(id),
        menu(prefix) { const entry = [...menus].find(([label]) => label.startsWith(prefix)); assert.ok(entry); entry[1](); },
        mutations() {
            for (const observer of observers) if (observer.target) observer.callback([{ type: 'childList' }]);
        },
        replaceBody() {
            body.remove(); body = root.appendChild(new Element('body')); body.appendChild(new Element('main'));
            this.mutations();
        },
        activeObservers: () => observers.filter((observer) => observer.target),
        open() { this.menu('⚙'); },
        save() { this.get('hito-btn-save').dispatch('click'); },
    };
}

const outcomes = [
    ['onload', { responseText: JSON.stringify({ hitokoto: '<新句子>', from: '测试' }) }, '&lt;新句子&gt;'],
    ['onerror', undefined, '网络错误'],
    ['ontimeout', undefined, '请求超时'],
    ['onload', { responseText: '{invalid' }, '解析失败'],
];
for (const [callback, response, expected] of outcomes) {
    test(`${callback}/${expected}: removed bar is replaced and current node receives completion`, () => {
        const h = harness();
        const oldBar = h.bar();
        oldBar.remove(); h.mutations();
        const liveBar = h.bar();
        assert.notEqual(liveBar, oldBar);
        assert.equal(h.requests.length, 1, 'pending request is reused');
        h.requests[0].options[callback](response);
        assert.match(liveBar.innerHTML, new RegExp(expected));
        assert.match(oldBar.innerHTML, /加载中/);
        h.menu('🔄');
        assert.equal(h.requests.length, 2, 'completion releases request lock');
    });
    test(`${callback}/${expected}: completion repairs removal before observer delivery`, () => {
        const h = harness();
        const oldBar = h.bar(); oldBar.remove();
        h.requests[0].options[callback](response);
        assert.notEqual(h.bar(), oldBar);
        assert.ok(h.bar().innerHTML.includes(expected));
    });
    test(`${callback}/${expected}: whole-body replacement receives pending completion`, () => {
        const h = harness();
        const oldBar = h.bar();
        h.replaceBody();
        assert.notEqual(h.bar(), oldBar);
        assert.equal(h.requests.length, 1);
        h.requests[0].options[callback](response);
        assert.ok(h.bar().innerHTML.includes(expected));
        assert.match(oldBar.innerHTML, /加载中/);
        h.mutations();
        assert.equal(h.requests.length, 1);
    });
    test(`${callback}/${expected}: late completion after disabling cannot recreate or overwrite`, () => {
        const h = harness({ refreshInterval: 30 });
        const old = h.requests[0];
        h.menu('🔌');
        assert.ok(old.aborted);
        assert.equal(h.bar(), null);
        assert.equal(h.timers.size, 0);
        assert.equal(h.activeObservers().length, 0);
        old.options[callback](response);
        assert.equal(h.bar(), null);
        h.menu('🔌');
        const current = h.bar();
        old.options[callback](response);
        assert.match(current.innerHTML, /加载中/);
        h.menu('🔄');
        assert.equal(h.requests.length, 2, 'stale callback must not unlock the new request');
        h.requests[1].options.onload({ responseText: '{"hitokoto":"当前请求"}' });
        assert.match(current.innerHTML, /当前请求/);
    });
}

test('disabled startup → enable → body swap → disable/re-enable keeps one observer and timer', () => {
    const h = harness({ enabled: false, refreshInterval: 30 });
    assert.equal(h.requests.length, 0);
    assert.equal(h.activeObservers().length, 0);
    h.menu('🔌');
    assert.equal(h.activeObservers().length, 1);
    assert.equal(h.timers.size, 1);
    assert.equal(h.activeObservers()[0].target, h.document.documentElement);
    assert.equal(h.activeObservers()[0].options.subtree, true);
    const oldBar = h.bar();
    h.replaceBody();
    assert.notEqual(h.bar(), oldBar);
    assert.equal(h.requests.length, 1);
    h.requests[0].options.ontimeout();
    assert.match(h.bar().innerHTML, /请求超时/);
    h.mutations(); h.mutations();
    assert.equal(h.requests.length, 1);
    h.open(); h.save(); // enabled configuration reapplied, no duplicate watcher/timer
    assert.equal(h.activeObservers().length, 1);
    assert.equal(h.timers.size, 1);
    assert.equal([...h.timers.values()][0].delay, 30000);
    h.menu('🔌'); h.replaceBody();
    assert.equal(h.bar(), null);
    assert.equal(h.activeObservers().length, 0);
    h.menu('🔌');
    assert.equal(h.activeObservers().length, 1);
    assert.equal(h.timers.size, 1);
    h.bar().remove(); h.mutations();
    assert.ok(h.bar());
});

test('initial site exclusion can be enabled and disabling the site cancels pending work', () => {
    const h = harness({ siteMode: 'whitelist', siteList: '', refreshInterval: 30 });
    assert.equal(h.bar(), null);
    h.menu('🌐');
    assert.ok(h.bar());
    assert.equal(h.activeObservers().length, 1);
    h.menu('🌐');
    assert.equal(h.bar(), null);
    assert.ok(h.requests[0].aborted);
    assert.equal(h.timers.size, 0);
    h.requests[0].options.onload({ responseText: '{"hitokoto":"旧请求"}' });
    assert.equal(h.bar(), null);
});

test('synchronous manager failure releases the request lifecycle and displays retry state', () => {
    const h = harness({}, { throwRequest: true });
    assert.match(h.bar().innerHTML, /网络错误/);
    h.menu('🔄');
    assert.match(h.bar().innerHTML, /网络错误/);
});

for (const value of [-1, 3601, 1.5, NaN, Infinity, -Infinity, '', '30']) {
    test(`stored refresh ${String(value)} falls back to the default`, () => {
        const h = harness({ refreshInterval: value }); h.open();
        assert.equal(h.get('hito-cfg-refresh').value, '30');
    });
}
for (const value of ['-1', '3601', '1.5', '', '   ', 'Infinity', 'NaN', '12abc']) {
    test(`save rejects refresh ${JSON.stringify(value)} without mutating or persisting config`, () => {
        const h = harness({ refreshInterval: 30 }); h.open();
        h.get('hito-cfg-enabled').checked = false;
        const input = h.get('hito-cfg-refresh'); input.value = value;
        h.save();
        assert.equal(h.saves.length, 0);
        assert.ok(h.get('hito-settings-overlay'));
        assert.ok(input.validityMessage);
        assert.equal(input.validityReports, 1);
        assert.ok(h.bar());
        assert.equal(h.requests[0].aborted, false);
        input.value = '0'; input.dispatch('input');
        assert.equal(input.validityMessage, '');
        h.save();
        assert.equal(h.saves.length, 1);
        assert.equal(h.saves[0].refreshInterval, 0);
        assert.equal(h.bar(), null);
    });
}
for (const value of [0, 3600]) {
    test(`refresh boundary ${value} saves and reloads unchanged`, () => {
        const h = harness(); h.open();
        h.get('hito-cfg-refresh').value = String(value); h.save();
        assert.equal(h.saves[0].refreshInterval, value);
        assert.equal(h.get('hito-settings-overlay'), null);
        assert.equal(h.timers.size, value === 0 ? 0 : 1);
        if (value) assert.equal([...h.timers.values()][0].delay, 3600000);
        const reloaded = harness(h.saves[0]); reloaded.open();
        assert.equal(reloaded.get('hito-cfg-refresh').value, String(value));
    });
}

test('other numeric controls use the same persisted boundaries and reject invalid input', () => {
    const fields = { fontSize: [8, 48], opacity: [0, 1], blur: [0, 40], marginX: [0, 500], maxWidth: [20, 100] };
    for (const [field, bounds] of Object.entries(fields)) {
        for (const value of bounds) {
            const h = harness({ [field]: value }); h.open();
            const input = h.get('hito-cfg-' + field);
            assert.equal(Number(input.min), bounds[0]);
            assert.equal(Number(input.max), bounds[1]);
            assert.equal(Number(input.value), value);
            h.save();
            assert.equal(h.saves[0][field], value);
        }
        for (const invalid of ['', 'Infinity', String(bounds[1] + 1), ...(field === 'opacity' ? [] : ['1.5'])]) {
            const h = harness(); h.open();
            const input = h.get('hito-cfg-' + field); input.value = invalid;
            h.save();
            assert.equal(h.saves.length, 0, `${field} ${invalid}`);
            assert.ok(input.validityMessage);
        }
    }
    const h = harness(); h.open();
    h.get('hito-cfg-bgAlpha').value = 'Infinity'; h.save();
    assert.equal(h.saves.length, 0);
    assert.ok(h.get('hito-cfg-bgAlpha').validityMessage);
});
