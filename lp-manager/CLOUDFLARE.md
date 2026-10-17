## Cloudflare Pages 配置参考

在 Cloudflare Dashboard 选择 **Workers & Pages → Create → Pages → Connect to Git**，连接 GitHub 仓库并设置：

- Framework preset：Vite（或 None）
- Root directory：`/`（如果仓库直接放的是本应用文件）
- Build command：`npm run build`
- Build output directory：`dist`

如果整个项目仓库里应用仍在 `lp-manager/` 子目录，Root directory 填 `lp-manager`。部署成功后，Cloudflare 会提供 `*.pages.dev` 链接，之后推送更新会自动重新部署。

## RPC 可靠性（可选）

公共 RPC 可能限流。你可以向 RPC 服务商申请专用端点，然后在 Cloudflare Pages → Settings → Environment variables 设置 `VITE_BSC_RPC_URL` / `VITE_ROBINHOOD_RPC_URL` 并重新部署。这些值会打包进浏览器端代码，属于公开信息；只使用允许公开的密钥，并设置域名限制和额度限制。不要放私钥、钱包秘密或高权限凭据。

## 重要说明

部署后的网站是公开的，任何拿到链接的人都能查询地址。当前 MVP 只发起只读 RPC 请求，不签名或发送交易；会在访客浏览器本地保存上次输入的钱包地址。RPC 服务商可能看到查询请求和地址。请使用可信 RPC。

Robinhood 当前配置为测试网，使用前需核实网络/RPC 状态。Position Manager 地址由用户手动输入，必须从官方渠道核实。本工具尚未经过审计，不应作为财务决策的唯一依据。
