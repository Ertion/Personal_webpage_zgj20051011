# Cloudflare 登录配置

登录页面不会把所有者密码写入 HTML 或 GitHub。部署前请在 Cloudflare Dashboard 中配置两个加密 Secret。

1. 打开 **Workers & Pages**，进入当前 `personal-webpage-zgj20051011` 项目。
2. 打开 Worker 的 **Settings → Variables and Secrets**。不要添加到 **Settings → Build → Build Variables and Secrets**；构建变量不会在网页运行时提供给 Worker。
3. 在 Production 环境添加并加密以下变量：
   - `ADMIN_PASSWORD`：所有者登录密码。
   - `SESSION_SECRET`：至少 32 个随机字符，专门用于签名登录会话，不要与登录密码相同。
4. 保存变量后重新部署项目。当前项目通过 Worker 的 `/api/auth` 路由处理登录。

`wrangler.jsonc` 已声明这两个 Secret 为部署必需项。任何一个缺失时，Wrangler 会终止部署并明确列出缺失名称。

用户名已经固定在服务端代码中。不要创建或提交 `.dev.vars`、`.env` 文件；这些文件已经加入 `.gitignore`。

部署后验证：

- 未登录访问时显示“所有者登录 / 以游客身份进入”。
- 游客只能浏览页面。
- 所有者登录成功后，左侧显示“所有者模式”，行政页面显示权限提示。
- 点击“退出”后会清除服务器签名会话。
