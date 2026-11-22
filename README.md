# 青灯黄卷

Astro 静态博客，部署到 GitHub Pages。当前默认地址由 `astro.config.mjs` 中的 `site` 指定，可通过 `SITE_URL` 覆盖。

## 本地运行

使用 `.nvmrc` 指定的 Node.js **24.19.0** 与 npm **11.x**（本次验证为 11.17.0）。`package.json` 的 engines 限定同一主版本，CI 直接读取 `.nvmrc`。

```sh
nvm use
npm ci
npm run dev
```

Windows 未安装 nvm 时，先安装对应 Node.js，再执行 npm 命令。

## 修改后的检查

```sh
npm run verify
npx playwright install chromium
npm run test:browser
npm audit --audit-level=low
```

- `npm run check`：Astro/TypeScript 诊断。
- `npm test`：完整用户脚本的 VM 回归，以及实际主题 CSS 的对比度和正文链接样式检查。
- `npm run build`：生成静态站点到 `dist/`。
- `npm run check:dist`：检查 HTML 内联脚本、JSON-LD、本地文件与锚点、文章正文和搜索索引、RSS、站点地图、robots 以及已发布文章地址。
- `npm run verify`：依次执行类型检查、单元回归、构建和生成文件检查。
- `npm run test:browser`：针对已构建产物启动本地 preview，运行 Chromium 桌面和移动模拟测试。仅修改源码后应先重新构建。Linux 安装浏览器可使用 `npx playwright install --with-deps chromium`。

Playwright 测试使用本地页面和本地搜索索引，阻止外部资源请求。用户脚本的网络请求和 GM 存储由测试桩控制，不依赖真实 Hitokoto 服务。测试不等同于 Tampermonkey/Violentmonkey 扩展兼容性或真实手机认证。

## 内容维护

内容集合在 `src/content.config.ts` 中声明，使用 `astro/loaders` 的 glob loader。路由使用 loader 的 `id`，正文使用 `render(entry)` 渲染。

### 唯一发布源与文件位置

**本仓库是当前博客的唯一发布源**，不要从旧项目或写作原稿区全量覆盖本目录。

| 内容或资源 | 唯一发布位置 | 发布后的地址 |
| --- | --- | --- |
| 随笔 Markdown | `src/content/essays/` | `/essays/文章文件名/` |
| 札记 Markdown | `src/content/notes/` | `/notes/文章文件名/` |
| 作品 Markdown | `src/content/works/` | `/works/文章文件名/` |
| 随笔图片 | `public/images/essays/文章标识/` | `/images/essays/文章标识/图片名` |
| 札记图片 | `public/images/notes/文章标识/` | `/images/notes/文章标识/图片名` |
| 作品图片 | `public/images/works/作品标识/` | `/images/works/作品标识/图片名` |
| 作品下载文件 | `public/downloads/` | `/downloads/文件名` |

`E:\Blog\随笔`、`E:\Blog\札记`、`E:\Blog\作品` 是电脑上的写作原稿区，不属于 Astro 构建输入；其中的文件不会自动上线。发布时选定具体文章，添加所需元信息并复制到上表目录；只复制正文实际引用的图片，保留原稿，不用旧原稿覆盖已发布的修订版。未选用的封面、截图、报告和临时脚本不要放入本仓库。

`E:\agentDATA\trae\BLOG\qd-astro` 是旧项目及历史副本，不是当前发布源。`dist/` 是构建产物，`test-results/`、`playwright-report/` 是本地检查产物，均已忽略，不要提交。`node_modules/` 是依赖目录，也不属于内容管理范围。

保留现有 frontmatter 的 `slug` 可保持文章地址。`tests/fixtures/published-routes.json` 记录本次升级前已有的文章入口；新增文章无需修改该清单，删除或改名已有入口时应先提供重定向方案再调整清单。搜索、RSS 和 sitemap 由内容自动生成。

`public/downloads/hitokoto-universal.user.js` 是实际发布的用户脚本。修改其行为时，应同步更新脚本 `@version`、作品介绍中的版本及相关操作说明。

现有演示内容和作者演示标识按原策略保留；发布真实个人经历或项目成果前，请自行核实对应内容。首页重点入口只从 `demo: false` 的条目中选择，优先 `featured: true`，没有正式内容时不显示推荐区。

作品缩略图统一使用楷体文字加渐变色块（由 frontmatter 的 `cls` 选择配色），不使用截图或封面图，以保持列表与首页的视觉一致。首页推荐区因此只显示文字，不显示作品配图。`src/content.config.ts` 仍保留可选的 `cover` 字段，但当前没有作品使用它。

## 发布校验

`.github/workflows/deploy.yml` 对 PR、main 分支推送和手动触发执行相同校验：锁文件安装、依赖审计、`verify`、桌面和移动浏览器测试。PR 只校验；只有 main 的非 PR 运行且全部检查成功后才上传并部署 Pages。发布写权限只赋予 deploy 作业。

本地执行检查不会推送代码或触发线上部署。首次使用或仓库设置变化后，仍需在 GitHub 设置中确认 Pages 使用 GitHub Actions。
