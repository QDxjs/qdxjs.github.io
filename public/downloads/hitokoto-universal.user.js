// ==UserScript==
// @name         一言 · 全站通用版
// @name:zh-CN   一言 · 全站通用版
// @name:en      Hitokoto · Universal
// @namespace    https://v1.hitokoto.cn
// @version      2.3
// @description  在任意网页顶部/底部显示一言（Hitokoto）随机句子。支持可视化设置面板、11种分类筛选、自动刷新、站点匹配（全站/白名单/黑名单）、外观自定义、SPA兼容。点击换句，右键打开设置。
// @description:zh-CN  在任意网页顶部/底部显示一言（Hitokoto）随机句子。支持可视化设置面板、11种分类筛选、自动刷新、站点匹配（全站/白名单/黑名单）、外观自定义、SPA兼容。点击换句，右键打开设置。
// @description:en  Display Hitokoto random quotes on any website. Features a visual settings panel, 11 categories, auto-refresh, site matching (all/whitelist/blacklist), appearance customization, and SPA compatibility. Click to refresh, right-click for settings.
// @author       Hitokoto Universal
// @license      MIT; https://opensource.org/licenses/MIT
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @connect      v1.hitokoto.cn
// @run-at       document-idle
// @noframes
// @homepageURL  https://v1.hitokoto.cn
// @supportURL   https://github.com/hitokoto-osc/API/issues
// ==/UserScript==

(function () {
    'use strict';

    /* ============================================================
     *  默认配置（首次使用生效，后续读取 GM 存储）
     * ============================================================ */
    const DEFAULT_CONFIG = {
        enabled:        true,       // 总开关
        category:       '',         // 分类筛选，留空=全部
        refreshInterval: 30,        // 自动刷新间隔（秒），0=不刷新
        position:       'top',     // top | bottom
        fontSize:       15,        // 正文字号 px
        opacity:        0.9,       // 0~1
        background:     'rgba(0,0,0,0.55)', // 背景色
        blur:           8,         // 毛玻璃模糊 px
        marginX:        16,        // 距上/下边距 px
        maxWidth:       90,        // 最大宽度 %
        showFrom:       true,      // 显示来源
        animation:      true,      // 开启切换动画
        zindex:         99999,     // 层级
        siteMode:       'all',     // all=全站 | whitelist=仅指定 | blacklist=排除指定
        siteList:       '',        // 域名列表，每行一个，支持通配符 *.example.com
    };

    // 一言分类表（网易云 j 已被官方停用，不再列出）
    const CATEGORIES = {
        '':  '全部分类',
        'a': '动画',
        'b': '漫画',
        'c': '游戏',
        'd': '文学',
        'e': '原创',
        'f': '来自网络',
        'g': '其他',
        'h': '影视',
        'i': '诗词',
        'k': '哲学',
        'l': '抖机灵',
    };

    /* ============================================================
     *  配置读写（含校验）
     * ============================================================ */
    function validateConfig(raw) {
        const cfg = Object.assign({}, DEFAULT_CONFIG);
        if (!raw || typeof raw !== 'object') return cfg;
        // 逐字段校验，类型不匹配则用默认值
        if (typeof raw.enabled === 'boolean')        cfg.enabled = raw.enabled;
        if (typeof raw.category === 'string')         cfg.category = raw.category;
        if (typeof raw.refreshInterval === 'number' && raw.refreshInterval >= 0 && raw.refreshInterval <= 3600)
                                                       cfg.refreshInterval = raw.refreshInterval;
        if (raw.position === 'top' || raw.position === 'bottom')
                                                       cfg.position = raw.position;
        if (typeof raw.fontSize === 'number' && raw.fontSize >= 8 && raw.fontSize <= 48)
                                                       cfg.fontSize = raw.fontSize;
        if (typeof raw.opacity === 'number' && raw.opacity >= 0 && raw.opacity <= 1)
                                                       cfg.opacity = raw.opacity;
        if (typeof raw.background === 'string' && raw.background.startsWith('rgba'))
                                                       cfg.background = raw.background;
        if (typeof raw.blur === 'number' && raw.blur >= 0 && raw.blur <= 40)
                                                       cfg.blur = raw.blur;
        if (typeof raw.marginX === 'number' && raw.marginX >= 0 && raw.marginX <= 500)
                                                       cfg.marginX = raw.marginX;
        if (typeof raw.maxWidth === 'number' && raw.maxWidth >= 20 && raw.maxWidth <= 100)
                                                       cfg.maxWidth = raw.maxWidth;
        if (typeof raw.showFrom === 'boolean')        cfg.showFrom = raw.showFrom;
        if (typeof raw.animation === 'boolean')       cfg.animation = raw.animation;
        if (typeof raw.zindex === 'number')           cfg.zindex = raw.zindex;
        if (['all','whitelist','blacklist'].indexOf(raw.siteMode) !== -1)
                                                       cfg.siteMode = raw.siteMode;
        if (typeof raw.siteList === 'string')         cfg.siteList = raw.siteList;
        return cfg;
    }

    function loadConfig() {
        const saved = GM_getValue('hitokoto_config', null);
        return validateConfig(saved);
    }
    function saveConfig(cfg) {
        GM_setValue('hitokoto_config', cfg);
    }
    let CONFIG = loadConfig();

    /* ============================================================
     *  样式注入
     * ============================================================ */
    GM_addStyle(`
        #hito-bar {
            position: fixed;
            left: 50%;
            transform: translateX(-50%);
            z-index: var(--hito-z, 99999);
            max-width: var(--hito-mw, 90%);
            padding: 10px 24px;
            background: var(--hito-bg, rgba(0,0,0,0.55));
            backdrop-filter: blur(var(--hito-blur, 8px));
            -webkit-backdrop-filter: blur(var(--hito-blur, 8px));
            border-radius: 20px;
            color: #fff;
            font-size: var(--hito-fs, 15px);
            line-height: 1.6;
            text-align: center;
            box-shadow: 0 2px 12px rgba(0,0,0,0.3);
            cursor: pointer;
            user-select: none;
            display: flex;
            align-items: center;
            gap: 6px;
            flex-direction: column;
            transition: opacity .3s, transform .3s;
        }
        #hito-bar.hito-top    { top: var(--hito-mx, 16px); }
        #hito-bar.hito-bottom { bottom: var(--hito-mx, 16px); }
        #hito-bar .hito-text  { font-weight: 400; }
        #hito-bar .hito-from  { font-size: .8em; opacity: .6; }
        #hito-bar .hito-loading { opacity: .5; font-size: .9em; }
        #hito-bar:hover       { opacity: 1 !important; }
        #hito-bar.hito-fade   { animation: hitoFade .4s ease; }
        @keyframes hitoFade {
            from { opacity: 0; transform: translateX(-50%) translateY(-6px); }
            to   { opacity: var(--hito-op, .9); transform: translateX(-50%) translateY(0); }
        }
        @media (max-width: 768px) {
            #hito-bar { font-size: 13px; padding: 8px 16px; max-width: 95%; }
        }

        /* ---- 设置面板 ---- */
        #hito-settings-overlay {
            position: fixed; inset: 0; z-index: 999999;
            background: rgba(0,0,0,.4);
            display: flex; align-items: center; justify-content: center;
            opacity: 0; pointer-events: none;
            transition: opacity .2s;
        }
        #hito-settings-overlay.hito-show { opacity: 1; pointer-events: auto; }
        #hito-settings-panel {
            width: 440px; max-width: 92vw; max-height: 85vh; overflow-y: auto;
            background: #fff; border-radius: 16px;
            box-shadow: 0 8px 40px rgba(0,0,0,.25);
            font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
            color: #333; transform: scale(.92); transition: transform .2s;
        }
        #hito-settings-overlay.hito-show #hito-settings-panel { transform: scale(1); }
        #hito-settings-panel .hito-sp-header {
            padding: 18px 24px; font-size: 18px; font-weight: 600;
            border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center;
        }
        #hito-settings-panel .hito-sp-close { cursor: pointer; font-size: 22px; color: #999; line-height: 1; }
        #hito-settings-panel .hito-sp-close:hover { color: #333; }
        #hito-settings-panel .hito-sp-body { padding: 16px 24px; }
        #hito-settings-panel .hito-sp-row {
            display: flex; align-items: center; justify-content: space-between;
            padding: 10px 0; border-bottom: 1px solid #f5f5f5; gap: 12px;
        }
        #hito-settings-panel .hito-sp-row:last-child { border-bottom: none; }
        #hito-settings-panel .hito-sp-label { font-size: 14px; flex-shrink: 0; }
        #hito-settings-panel .hito-sp-hint  { font-size: 12px; color: #999; margin-top: 2px; }
        #hito-settings-panel .hito-sp-control { flex: 1; display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
        #hito-settings-panel select,
        #hito-settings-panel input[type="number"],
        #hito-settings-panel input[type="text"] {
            padding: 5px 10px; border: 1px solid #ddd; border-radius: 6px;
            font-size: 13px; width: 140px; text-align: right;
        }
        #hito-settings-panel input[type="range"] { width: 140px; }
        #hito-settings-panel input[type="color"] { width: 44px; height: 28px; border: 1px solid #ddd; border-radius: 6px; cursor: pointer; }
        #hito-settings-panel input[type="checkbox"] { width: 18px; height: 18px; cursor: pointer; }
        #hito-settings-panel textarea {
            width: 100%; min-height: 80px; padding: 8px 10px;
            border: 1px solid #ddd; border-radius: 6px; font-size: 13px;
            font-family: "Consolas", "Monaco", monospace; resize: vertical;
            line-height: 1.5; box-sizing: border-box;
        }
        #hito-settings-panel textarea:focus { outline: none; border-color: #4f8cf0; }
        #hito-settings-panel .hito-sp-section {
            margin-top: 16px; padding-top: 12px;
            border-top: 2px solid #f0f0f0;
        }
        #hito-settings-panel .hito-sp-section-title {
            font-size: 14px; font-weight: 600; color: #4f8cf0;
            margin-bottom: 4px; display: flex; align-items: center; gap: 6px;
        }
        #hito-settings-panel .hito-sp-row-block {
            display: block; padding: 10px 0; border-bottom: 1px solid #f5f5f5;
        }
        #hito-settings-panel .hito-sp-row-block .hito-sp-label { margin-bottom: 6px; }
        #hito-settings-panel .hito-sp-row-block .hito-sp-control { justify-content: flex-start; margin-top: 8px; }
        #hito-settings-panel .hito-sp-status {
            display: inline-block; padding: 2px 10px; border-radius: 10px;
            font-size: 12px; font-weight: 500;
        }
        #hito-settings-panel .hito-sp-status-on  { background: #e8f5e9; color: #2e7d32; }
        #hito-settings-panel .hito-sp-status-off { background: #fbe9e7; color: #c62828; }
        #hito-settings-panel .hito-sp-footer {
            padding: 14px 24px; border-top: 1px solid #eee;
            display: flex; justify-content: flex-end; gap: 10px;
        }
        #hito-settings-panel .hito-btn {
            padding: 8px 20px; border-radius: 8px; font-size: 14px;
            cursor: pointer; border: none; transition: opacity .2s;
        }
        #hito-settings-panel .hito-btn:hover { opacity: .85; }
        #hito-settings-panel .hito-btn-primary { background: #4f8cf0; color: #fff; }
        #hito-settings-panel .hito-btn-reset   { background: #f0f0f0; color: #666; }
        #hito-settings-panel .hito-value-tag {
            font-size: 12px; color: #888; min-width: 38px; text-align: right;
        }
    `);

    /* ============================================================
     *  工具函数
     * ============================================================ */
    function escapeHtml(str) {
        const d = document.createElement('div');
        d.textContent = str == null ? '' : String(str);
        return d.innerHTML;
    }

    /* ============================================================
     *  站点匹配
     *  siteMode: 'all' | 'whitelist' | 'blacklist'
     *  siteList: 每行一个域名，支持通配符 *.example.com
     * ============================================================ */
    function getCurrentHost() {
        try { return location.hostname || ''; } catch (e) { return ''; }
    }

    function patternToRegex(pattern) {
        pattern = pattern.trim();
        if (!pattern) return null;
        let re = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
        return new RegExp('^' + re + '$', 'i');
    }

    function parseSiteList(text) {
        if (!text) return [];
        return text.split(/[\n,;]+/)
            .map(function (s) { return s.trim(); })
            .filter(function (s) { return s.length > 0; });
    }

    function isSiteAllowed() {
        const host = getCurrentHost();
        if (!host) return true;
        const rules = parseSiteList(CONFIG.siteList);
        if (rules.length === 0) {
            return CONFIG.siteMode !== 'whitelist';
        }
        const matched = rules.some(function (rule) {
            const re = patternToRegex(rule);
            return re && re.test(host);
        });
        if (CONFIG.siteMode === 'whitelist')  return matched;
        if (CONFIG.siteMode === 'blacklist') return !matched;
        return true;
    }

    function applyVars() {
        const bar = document.getElementById('hito-bar');
        if (!bar) return;
        bar.style.setProperty('--hito-bg', CONFIG.background);
        bar.style.setProperty('--hito-blur', CONFIG.blur + 'px');
        bar.style.setProperty('--hito-fs', CONFIG.fontSize + 'px');
        bar.style.setProperty('--hito-mw', CONFIG.maxWidth + '%');
        bar.style.setProperty('--hito-mx', CONFIG.marginX + 'px');
        bar.style.setProperty('--hito-op', CONFIG.opacity);
        bar.style.setProperty('--hito-z', CONFIG.zindex);
        bar.style.opacity = CONFIG.opacity;
        bar.className = 'hito-' + CONFIG.position;
        if (CONFIG.animation) bar.classList.add('hito-fade');
    }

    /* ============================================================
     *  一言获取
     * ============================================================ */
    let refreshTimer = null;
    let isLoading = false; // 防止并发请求

    function fetchHitokoto() {
        // [Bug 修复] 同时检查 enabled 和 isSiteAllowed
        if (!CONFIG.enabled || !isSiteAllowed()) return;
        // [Bug 修复] 防抖：如果正在请求中则跳过
        if (isLoading) return;
        isLoading = true;

        const bar = ensureBar();
        const loadingEl = bar.querySelector('.hito-loading');
        if (loadingEl) loadingEl.textContent = '加载中...';
        else {
            bar.innerHTML = '<span class="hito-loading">加载中...</span>';
        }

        const cat = CONFIG.category ? '?c=' + CONFIG.category.split(',')[0].trim() : '';
        const url = 'https://v1.hitokoto.cn/' + cat + (cat ? '&' : '?') + 'encode=json';

        GM_xmlhttpRequest({
            method: 'GET',
            url: url,
            timeout: 8000,
            onload: function (res) {
                isLoading = false;
                try {
                    const d = JSON.parse(res.responseText);
                    let html = '<span class="hito-text">' + escapeHtml(d.hitokoto || '未获取到句子') + '</span>';
                    if (CONFIG.showFrom && d.from) {
                        html += '<span class="hito-from">—— ' + escapeHtml(d.from) + '</span>';
                    }
                    bar.innerHTML = html;
                    if (CONFIG.animation) {
                        bar.classList.remove('hito-fade');
                        void bar.offsetWidth;
                        bar.classList.add('hito-fade');
                    }
                } catch (e) {
                    bar.innerHTML = '<span class="hito-text">解析失败，点击重试</span>';
                }
            },
            onerror: function () {
                isLoading = false;
                bar.innerHTML = '<span class="hito-text">网络错误，点击重试</span>';
            },
            ontimeout: function () {
                isLoading = false;
                bar.innerHTML = '<span class="hito-text">请求超时，点击重试</span>';
            }
        });
    }

    function setupTimer() {
        if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
        // [Bug 修复] 定时器也要检查 isSiteAllowed
        if (CONFIG.enabled && isSiteAllowed() && CONFIG.refreshInterval > 0) {
            refreshTimer = setInterval(fetchHitokoto, CONFIG.refreshInterval * 1000);
        }
    }

    /* ============================================================
     *  创建浮动条
     * ============================================================ */
    function ensureBar() {
        let bar = document.getElementById('hito-bar');
        if (bar) return bar;

        // document.body 可能被 SPA 替换，确保 body 存在
        if (!document.body) return document.createElement('div'); // 临时空元素

        bar = document.createElement('div');
        bar.id = 'hito-bar';
        bar.innerHTML = '<span class="hito-loading">一言加载中...</span>';
        document.body.appendChild(bar);

        bar.addEventListener('click', function () {
            fetchHitokoto();
        });
        bar.addEventListener('contextmenu', function (e) {
            e.preventDefault();
            openSettings();
        });

        applyVars();
        return bar;
    }

    function removeBar() {
        const bar = document.getElementById('hito-bar');
        if (bar) bar.remove();
    }

    /* ============================================================
     *  [Bug 修复] SPA 支持：监控 body 变化，一言条被移除时自动恢复
     * ============================================================ */
    let spaObserver = null;
    function setupSPAWatcher() {
        if (spaObserver) return;
        if (typeof MutationObserver === 'undefined') return;

        spaObserver = new MutationObserver(function (mutations) {
            // 检查一言条是否还存在
            if (CONFIG.enabled && isSiteAllowed()) {
                if (!document.getElementById('hito-bar') && document.body) {
                    ensureBar();
                    fetchHitokoto();
                }
            }
        });
        // 监控 body 子节点变化（SPA 导航时可能替换整个内容）
        if (document.body) {
            spaObserver.observe(document.body, { childList: true });
        }
    }

    /* ============================================================
     *  设置面板
     * ============================================================ */
    function openSettings() {
        let overlay = document.getElementById('hito-settings-overlay');
        if (overlay) { overlay.remove(); return; }

        overlay = document.createElement('div');
        overlay.id = 'hito-settings-overlay';

        let catOptions = '';
        for (const k in CATEGORIES) {
            catOptions += '<option value="' + k + '"' + (CONFIG.category === k ? ' selected' : '') + '>' + CATEGORIES[k] + '</option>';
        }

        let bgColor = '#000000';
        let bgAlpha = 0.55;
        const rgbaMatch = CONFIG.background.match(/rgba?\(([^,]+),([^,]+),([^,]+),?([^)]*)\)/);
        if (rgbaMatch) {
            const r = parseInt(rgbaMatch[1].trim(), 10);
            const g = parseInt(rgbaMatch[2].trim(), 10);
            const b = parseInt(rgbaMatch[3].trim(), 10);
            bgColor = '#' + [r, g, b].map(function (x) {
                return x.toString(16).padStart(2, '0');
            }).join('');
            bgAlpha = rgbaMatch[4] ? parseFloat(rgbaMatch[4].trim()) : 1;
        }

        overlay.innerHTML = `
            <div id="hito-settings-panel">
                <div class="hito-sp-header">
                    <span>一言 · 设置</span>
                    <span class="hito-sp-close" id="hito-sp-close">&times;</span>
                </div>
                <div class="hito-sp-body">
                    <div class="hito-sp-row">
                        <div>
                            <div class="hito-sp-label">启用一言</div>
                            <div class="hito-sp-hint">关闭后不再显示</div>
                        </div>
                        <div class="hito-sp-control">
                            <input type="checkbox" id="hito-cfg-enabled" ${CONFIG.enabled ? 'checked' : ''}>
                        </div>
                    </div>

                    <div class="hito-sp-row">
                        <div>
                            <div class="hito-sp-label">句子分类</div>
                            <div class="hito-sp-hint">选择感兴趣的类型</div>
                        </div>
                        <div class="hito-sp-control">
                            <select id="hito-cfg-category">${catOptions}</select>
                        </div>
                    </div>

                    <div class="hito-sp-row">
                        <div>
                            <div class="hito-sp-label">自动刷新</div>
                            <div class="hito-sp-hint">0 = 不自动刷新</div>
                        </div>
                        <div class="hito-sp-control">
                            <input type="number" id="hito-cfg-refresh" min="0" max="3600" value="${CONFIG.refreshInterval}" style="width:70px"> 秒
                        </div>
                    </div>

                    <div class="hito-sp-row">
                        <div>
                            <div class="hito-sp-label">显示位置</div>
                        </div>
                        <div class="hito-sp-control">
                            <select id="hito-cfg-position">
                                <option value="top" ${CONFIG.position==='top'?'selected':''}>顶部</option>
                                <option value="bottom" ${CONFIG.position==='bottom'?'selected':''}>底部</option>
                            </select>
                        </div>
                    </div>

                    <div class="hito-sp-row">
                        <div>
                            <div class="hito-sp-label">字号</div>
                        </div>
                        <div class="hito-sp-control">
                            <input type="range" id="hito-cfg-fontSize" min="12" max="24" value="${CONFIG.fontSize}">
                            <span class="hito-value-tag" id="hito-val-fontSize">${CONFIG.fontSize}px</span>
                        </div>
                    </div>

                    <div class="hito-sp-row">
                        <div>
                            <div class="hito-sp-label">透明度</div>
                        </div>
                        <div class="hito-sp-control">
                            <input type="range" id="hito-cfg-opacity" min="0.2" max="1" step="0.05" value="${CONFIG.opacity}">
                            <span class="hito-value-tag" id="hito-val-opacity">${CONFIG.opacity}</span>
                        </div>
                    </div>

                    <div class="hito-sp-row">
                        <div>
                            <div class="hito-sp-label">背景色</div>
                        </div>
                        <div class="hito-sp-control">
                            <input type="color" id="hito-cfg-bgColor" value="${bgColor}">
                            <input type="range" id="hito-cfg-bgAlpha" min="0" max="1" step="0.05" value="${bgAlpha}" style="width:80px">
                            <span class="hito-value-tag" id="hito-val-bgAlpha">${bgAlpha}</span>
                        </div>
                    </div>

                    <div class="hito-sp-row">
                        <div>
                            <div class="hito-sp-label">毛玻璃模糊</div>
                        </div>
                        <div class="hito-sp-control">
                            <input type="range" id="hito-cfg-blur" min="0" max="20" value="${CONFIG.blur}">
                            <span class="hito-value-tag" id="hito-val-blur">${CONFIG.blur}px</span>
                        </div>
                    </div>

                    <div class="hito-sp-row">
                        <div>
                            <div class="hito-sp-label">边距</div>
                            <div class="hito-sp-hint">距上/下边缘</div>
                        </div>
                        <div class="hito-sp-control">
                            <input type="number" id="hito-cfg-marginX" min="0" max="200" value="${CONFIG.marginX}" style="width:70px"> px
                        </div>
                    </div>

                    <div class="hito-sp-row">
                        <div>
                            <div class="hito-sp-label">最大宽度</div>
                        </div>
                        <div class="hito-sp-control">
                            <input type="range" id="hito-cfg-maxWidth" min="40" max="100" value="${CONFIG.maxWidth}">
                            <span class="hito-value-tag" id="hito-val-maxWidth">${CONFIG.maxWidth}%</span>
                        </div>
                    </div>

                    <div class="hito-sp-row">
                        <div>
                            <div class="hito-sp-label">显示来源</div>
                            <div class="hito-sp-hint">「—— 某作品」</div>
                        </div>
                        <div class="hito-sp-control">
                            <input type="checkbox" id="hito-cfg-showFrom" ${CONFIG.showFrom ? 'checked' : ''}>
                        </div>
                    </div>

                    <div class="hito-sp-row">
                        <div>
                            <div class="hito-sp-label">切换动画</div>
                        </div>
                        <div class="hito-sp-control">
                            <input type="checkbox" id="hito-cfg-animation" ${CONFIG.animation ? 'checked' : ''}>
                        </div>
                    </div>

                    <!-- ========== 站点匹配 ========== -->
                    <div class="hito-sp-section">
                        <div class="hito-sp-section-title">🌐 站点匹配</div>
                        <div class="hito-sp-row" style="border-bottom:none">
                            <div>
                                <div class="hito-sp-label">当前站点状态</div>
                                <div class="hito-sp-hint">${escapeHtml(getCurrentHost()) || '未知'}</div>
                            </div>
                            <div class="hito-sp-control">
                                <span class="hito-sp-status ${isSiteAllowed() ? 'hito-sp-status-on' : 'hito-sp-status-off'}" id="hito-site-status">
                                    ${isSiteAllowed() ? '● 已启用' : '● 已禁用'}
                                </span>
                            </div>
                        </div>

                        <div class="hito-sp-row-block">
                            <div class="hito-sp-label">匹配模式</div>
                            <div class="hito-sp-hint" style="margin-bottom:8px">
                                全站通用=所有网站显示<br>
                                仅指定站点=只列表中网站显示<br>
                                排除指定站点=列表中网站不显示
                            </div>
                            <div class="hito-sp-control">
                                <select id="hito-cfg-siteMode" style="width:100%">
                                    <option value="all" ${CONFIG.siteMode==='all'?'selected':''}>全站通用</option>
                                    <option value="whitelist" ${CONFIG.siteMode==='whitelist'?'selected':''}>仅指定站点</option>
                                    <option value="blacklist" ${CONFIG.siteMode==='blacklist'?'selected':''}>排除指定站点</option>
                                </select>
                            </div>
                        </div>

                        <div class="hito-sp-row-block">
                            <div class="hito-sp-label">域名列表</div>
                            <div class="hito-sp-hint" style="margin-bottom:8px">
                                每行一个域名，支持通配符 *<br>
                                示例：google.com / *.google.com / github.com
                            </div>
                            <textarea id="hito-cfg-siteList" placeholder="google.com&#10;*.google.com&#10;github.com">${escapeHtml(CONFIG.siteList)}</textarea>
                            <div style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap">
                                <button class="hito-btn hito-btn-reset" id="hito-btn-addCurrent" style="padding:4px 12px;font-size:12px">
                                    + 添加当前站点
                                </button>
                                <button class="hito-btn hito-btn-reset" id="hito-btn-clearSites" style="padding:4px 12px;font-size:12px">
                                    清空列表
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="hito-sp-footer">
                    <button class="hito-btn hito-btn-reset" id="hito-btn-reset">恢复默认</button>
                    <button class="hito-btn hito-btn-primary" id="hito-btn-save">保存</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        requestAnimationFrame(function () { overlay.classList.add('hito-show'); });

        // ---- 实时预览：range 拖动时更新数值标签 ----
        const liveMap = {
            fontSize:  { suffix: 'px' },
            opacity:   { suffix: ''   },
            blur:      { suffix: 'px' },
            maxWidth:  { suffix: '%'  },
            bgAlpha:   { suffix: ''   },
        };
        for (const key in liveMap) {
            const input = document.getElementById('hito-cfg-' + key);
            const tag = document.getElementById('hito-val-' + key);
            if (input && tag) {
                input.addEventListener('input', function () {
                    tag.textContent = input.value + liveMap[key].suffix;
                });
            }
        }

        // ---- 关闭按钮 ----
        document.getElementById('hito-sp-close').addEventListener('click', function () {
            overlay.remove();
        });
        // 用 mousedown 代替 click：只有鼠标直接按下在遮罩背景上才关闭，
        // 避免在面板内拖选文字时松开到遮罩上导致误关
        overlay.addEventListener('mousedown', function (e) {
            if (e.target === overlay) overlay.remove();
        });

        // [Bug 修复] Escape 键关闭设置面板
        function onEsc(e) {
            if (e.key === 'Escape') {
                overlay.remove();
                document.removeEventListener('keydown', onEsc);
            }
        }
        document.addEventListener('keydown', onEsc);

        // ---- 站点：添加当前站点 ----
        document.getElementById('hito-btn-addCurrent').addEventListener('click', function () {
            const ta = document.getElementById('hito-cfg-siteList');
            const host = getCurrentHost();
            if (!host) return;
            const lines = ta.value.split(/[\n,;]+/).map(function (s) { return s.trim(); }).filter(Boolean);
            if (lines.indexOf(host) === -1) {
                lines.push(host);
                ta.value = lines.join('\n');
            }
        });

        // ---- 站点：清空列表 ----
        document.getElementById('hito-btn-clearSites').addEventListener('click', function () {
            document.getElementById('hito-cfg-siteList').value = '';
        });

        // ---- 站点：模式切换时实时更新状态预览 ----
        function updateSiteStatusPreview() {
            const mode = document.getElementById('hito-cfg-siteMode').value;
            const list = document.getElementById('hito-cfg-siteList').value;
            const host = getCurrentHost();
            const rules = parseSiteList(list);
            let allowed;
            if (rules.length === 0) {
                allowed = mode !== 'whitelist';
            } else {
                const matched = rules.some(function (rule) {
                    const re = patternToRegex(rule);
                    return re && re.test(host);
                });
                allowed = mode === 'whitelist' ? matched : (mode === 'blacklist' ? !matched : true);
            }
            const el = document.getElementById('hito-site-status');
            el.textContent = allowed ? '● 已启用' : '● 已禁用';
            el.className = 'hito-sp-status ' + (allowed ? 'hito-sp-status-on' : 'hito-sp-status-off');
        }
        document.getElementById('hito-cfg-siteMode').addEventListener('change', updateSiteStatusPreview);
        document.getElementById('hito-cfg-siteList').addEventListener('input', updateSiteStatusPreview);

        // ---- 恢复默认 ----
        document.getElementById('hito-btn-reset').addEventListener('click', function () {
            CONFIG = Object.assign({}, DEFAULT_CONFIG);
            saveConfig(CONFIG);
            overlay.remove();
            applyConfigChange();
        });

        // ---- 保存 ----
        document.getElementById('hito-btn-save').addEventListener('click', function () {
            const newVal = function (id) { return document.getElementById(id).value; };
            const checked = function (id) { return document.getElementById(id).checked; };

            const bgC = newVal('hito-cfg-bgColor');
            const bgA = parseFloat(newVal('hito-cfg-bgAlpha'));
            const r = parseInt(bgC.slice(1, 3), 16);
            const g = parseInt(bgC.slice(3, 5), 16);
            const b = parseInt(bgC.slice(5, 7), 16);

            CONFIG.enabled        = checked('hito-cfg-enabled');
            CONFIG.category       = newVal('hito-cfg-category');
            CONFIG.refreshInterval= parseInt(newVal('hito-cfg-refresh'), 10) || 0;
            CONFIG.position       = newVal('hito-cfg-position');
            CONFIG.fontSize       = parseInt(newVal('hito-cfg-fontSize'), 10);
            CONFIG.opacity        = parseFloat(newVal('hito-cfg-opacity'));
            CONFIG.background     = 'rgba(' + r + ',' + g + ',' + b + ',' + bgA + ')';
            CONFIG.blur           = parseInt(newVal('hito-cfg-blur'), 10);
            CONFIG.marginX        = parseInt(newVal('hito-cfg-marginX'), 10) || 0;
            CONFIG.maxWidth       = parseInt(newVal('hito-cfg-maxWidth'), 10);
            CONFIG.showFrom       = checked('hito-cfg-showFrom');
            CONFIG.animation      = checked('hito-cfg-animation');
            CONFIG.siteMode       = newVal('hito-cfg-siteMode');
            CONFIG.siteList       = newVal('hito-cfg-siteList');

            saveConfig(CONFIG);
            overlay.remove();
            applyConfigChange();
        });
    }

    function applyConfigChange() {
        if (CONFIG.enabled && isSiteAllowed()) {
            ensureBar();
            applyVars();
            fetchHitokoto();
        } else {
            removeBar();
        }
        setupTimer();
    }

    /* ============================================================
     *  油猴菜单
     * ============================================================ */
    GM_registerMenuCommand('⚙ 一言设置', openSettings);
    GM_registerMenuCommand('🔄 换一句', fetchHitokoto);
    GM_registerMenuCommand('🔌 开关一言', function () {
        CONFIG.enabled = !CONFIG.enabled;
        saveConfig(CONFIG);
        applyConfigChange();
    });
    GM_registerMenuCommand('🌐 在当前站点' + (isSiteAllowed() ? '禁用' : '启用'), function () {
        const host = getCurrentHost();
        if (!host) return;
        const rules = parseSiteList(CONFIG.siteList);
        const idx = rules.indexOf(host);
        if (isSiteAllowed()) {
            if (idx === -1) rules.push(host);
            CONFIG.siteMode = 'blacklist';
            CONFIG.siteList = rules.join('\n');
        } else {
            if (idx === -1) rules.push(host);
            CONFIG.siteMode = 'whitelist';
            CONFIG.siteList = rules.join('\n');
        }
        saveConfig(CONFIG);
        applyConfigChange();
    });

    /* ============================================================
     *  启动
     * ============================================================ */
    function waitForBody(cb, tries) {
        tries = tries || 0;
        if (document.body && document.body.children.length > 0) {
            // 自适应延迟：SPA 页面需要等待框架渲染
            // 用 requestAnimationFrame 替代固定 setTimeout，减少静态页面的不必要等待
            requestAnimationFrame(function () {
                setTimeout(cb, 300);
            });
        } else if (tries < 50) {
            setTimeout(function () { waitForBody(cb, tries + 1); }, 200);
        }
    }

    waitForBody(function () {
        if (!CONFIG.enabled || !isSiteAllowed()) return;
        ensureBar();
        fetchHitokoto();
        setupTimer();
        setupSPAWatcher();
    });

})();
