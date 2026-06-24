# Searcharvester MCP Server

这是一个自托管网页搜索与页面提取服务适配器，基于 [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) 运行。
你可以将自建的 [Searcharvester](https://github.com/MaYunFei/searcharvester) 桥接到 Claude Code、Claude Desktop 等大模型客户端，作为它们的原生网络搜索及提取工具。

## ✨ 特性

- **多端同步配置**：无需在多台电脑上配置复杂的绝对路径，支持通过 `npx` 远程拉起，免安装且配置天然同步。
- **内网优先与网络容灾**：支持“内网优先 -> 外网备份”的双重备灾降级。若配置了内网并畅通，搜索秒级返回；若内网离线，无缝切换到外网代理并自动伪装 User-Agent 进行最多 3 次重试。
- **协同回退原生工具**：当内外网服务全部挂掉时，工具会自动输出友好引导警示，引导 Claude 临时降级调用自带的 `WebSearch` 和 `WebFetch` 兜底。
- **自动级联分页拼接**：提取超长网页时（`size: "f"`），MCP 服务会在后台自动请求所有切片页并拼接整合成完整的 Markdown 输出给模型，免除大模型多次调用工具拉取分页的消耗。

---

## 🛠️ 环境变量配置

MCP Server 在拉起时将读取以下环境变量进行寻址和鉴权：

| 环境变量 | 必须 | 说明 | 示例 |
| :--- | :---: | :--- | :--- |
| `SEARCHARVESTER_API_KEY` | **是** | 你的 Searcharvester 服务校验 Key | `你的APIKEY` |
| `SEARCHARVESTER_INTERNAL_URL` | 否 | 自建局域网内部部署的地址 | `http://192.168.1.xxx:8001` |
| `SEARCHARVESTER_EXTERNAL_URL` | 否 | 自建外部公网的代理或反代节点 | `https://你的外部公网地址` |

> 💡 **提示**：`SEARCHARVESTER_INTERNAL_URL` 与 `SEARCHARVESTER_EXTERNAL_URL` 至少配置一项。

---

## 🚀 多端一键配置使用 (Claude Code / Claude Desktop)

由于你的代码已打包为独立仓库，在所有的设备中，你的全局配置文件（例如 `~/.claude/settings.json`）只需配入以下参数。`npx` 会在两台电脑的后台**全自动获取最新代码并跑起来**，保证随时同步：

```json
{
  "mcpServers": {
    "searcharvester": {
      "command": "npx",
      "args": ["-y", "github:MaYunFei/searcharvester-mcp"],
      "env": {
        "SEARCHARVESTER_API_KEY": "你的验证KEY",
        "SEARCHARVESTER_INTERNAL_URL": "http://内网地址:8001",
        "SEARCHARVESTER_EXTERNAL_URL": "https://你的外部公网地址"
      }
    }
  }
}
```

---

## 🧰 提供的 Tool List

一经连接，客户端将可以使用以下两个工具：

### 1. `searcharvester_search`
利用自托管的聚合搜索平台查询网络。
*   **参数**:
    *   `query` (string, 必须): 查询词。
    *   `max_results` (number): 返回条数（支持 1 - 20，默认 10）。
    *   `engines` (string): 选填，覆盖默认的聚合引擎（如 `google,duckduckgo`）。
    *   `categories` (string): 选填，分类类型（如 `news|images|science`）。

### 2. `searcharvester_extract`
对提取的目标链接进行 trafilatura 无噪精研提取。
*   **参数**:
    *   `url` (string, 必须): 需要抓取的页面地址。
    *   `size` (string): 限制大小。's' (约5k字符), 'm' (10k), 'l' (25k), 'f' (全部内容，自动后台拼接多页文件)。
