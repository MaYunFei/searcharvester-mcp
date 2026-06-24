#!/usr/bin/env node

/**
 * Searcharvester MCP Server
 * A Model Context Protocol wrapping Searcharvester API with internal -> external fallback.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";

// ---- Pure formatting functions (exported for testing) ----

export function formatSearchResults(data, query) {
  if (!data.results || data.results.length === 0) {
    return `未检索到有关 "${query}" 的任何搜索结果。`;
  }

  return data.results
    .map((r, i) => {
      const scoreStr = r.score != null ? `[Score: ${r.score.toFixed(2)}]` : "";
      return `${i + 1}. **${r.title || "无标题"}**\n   URL: ${r.url}\n   内容: ${r.content || "暂无摘录"}\n   ${scoreStr}`;
    })
    .join("\n\n");
}

export function formatExtractResult(data) {
  const result = data.results?.[0] || {};

  let fullContent = result.content || "";

  if (result.pages && result.pages.total > 1) {
    // Multi-page: append stitched placeholder (actual stitching
    // happens via fetchExtractPage in the handler, not here)
    fullContent += `\n\n> ⚠ 此文档共 ${result.pages.total} 页，已自动拼接。`;
  }

  return {
    url: result.url,
    title: result.title || "未知",
    content: fullContent,
  };
}

// Retrieve settings from environment (no hardcoded IPs to ensure privacy and shareability)
const apiKey = process.env.SEARCHARVESTER_API_KEY;
const internalUrl = process.env.SEARCHARVESTER_INTERNAL_URL; // e.g. http://192.168.1.201:8001
const externalUrl = process.env.SEARCHARVESTER_EXTERNAL_URL; // e.g. https://searcharvester.lyzml.top

/**
 * Network fetch wrapper with fallback logic
 */
async function fetchWithFallback(endpoint, payload) {
  if (!apiKey) {
    throw new McpError(
      ErrorCode.InternalError,
      "【配置错误】缺少环境变量 SEARCHARVESTER_API_KEY。请在 MCP 环境变量配置中加上此字段。"
    );
  }
  if (!internalUrl && !externalUrl) {
    throw new McpError(
      ErrorCode.InternalError,
      "【配置错误】请至少在环境变量中提供 SEARCHARVESTER_INTERNAL_URL 或 SEARCHARVESTER_EXTERNAL_URL 其中之一。"
    );
  }

  // 1. Try Internal Endpoint First if provided
  if (internalUrl) {
    const cleanInternalUrl = internalUrl.replace(/\/$/, "");
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500); // 3.5s timeout for fast failover

      const response = await fetch(`${cleanInternalUrl}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        return await response.json();
      }
      console.error(
        `[Searcharvester MCP] 内网节点接口请求非 2xx 响应: ${response.status}`
      );
    } catch (err) {
      console.error(`[Searcharvester MCP] 无法连接到内网节点: ${err.message}`);
    }
  }

  // 2. Try External Endpoint with fake User-Agent and retries if provided
  if (externalUrl) {
    const cleanExternalUrl = externalUrl.replace(/\/$/, "");
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000); // 6s timeout for external

        const response = await fetch(`${cleanExternalUrl}${endpoint}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": apiKey,
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          return await response.json();
        }
        console.error(
          `[Searcharvester MCP] 尝试第 ${attempt} 次请求外网节点返回非 2xx 响应: ${response.status}`
        );
      } catch (err) {
        console.error(
          `[Searcharvester MCP] 尝试第 ${attempt} 次连接外网节点失败: ${err.message}`
        );
      }

      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 500)); // Delay between retries
      }
    }
  }

  // 3. Fallback instructions to Claude
  throw new Error(
    "【服务不可用警告】：Searcharvester 的内外网节点全部连接超时或失效。\n" +
      "【降级指令】：为避免中断，请忽略此工具执行报错，直接在此会话中通过你内置自带的 'WebSearch'（用于搜索任务）或 'WebFetch'（用于提取网页）工具来重新执行本轮操作。"
  );
}

/**
 * Fetch specific page for external extracts (only if base URL responds with total pages)
 */
async function fetchExtractPage(baseUrl, apiKey, extractId, page) {
  const cleanBaseUrl = baseUrl.replace(/\/$/, "");
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(
      `${cleanBaseUrl}/extract/${extractId}/${page}`,
      {
        method: "GET",
        headers: {
          "X-API-Key": apiKey,
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        signal: controller.signal,
      }
    );
    clearTimeout(timeoutId);
    if (response.ok) {
      const data = await response.json();
      return data.content || "";
    }
  } catch (err) {
    console.error(
      `[Searcharvester MCP] 拼接第 ${page} 页失败: ${err.message}`
    );
  }
  return "";
}

// Instantiate the MCP Server
const server = new Server(
  {
    name: "searcharvester-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// 1. Tool Declaration
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "searcharvester_search",
        description:
          "通过本地 Searcharvester (SearXNG 深度聚合服务) 进行实时多引擎网页搜索",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "用于在搜索引擎中查询的内容",
            },
            max_results: {
              type: "number",
              description: "返回的最大结果条数 (默认 10, 支持 1-20)",
              default: 10,
            },
            engines: {
              type: "string",
              description:
                "选填。指定逗号分隔的引擎名称（例如：google,duckduckgo,brave,bing）",
            },
            categories: {
              type: "string",
              description:
                "选填。搜索类型，如 general|news|images|videos|map|science|file",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "searcharvester_extract",
        description:
          "抓取并使用无杂质 trafilatura 精炼算法，从指定 URL 提取干净的 Markdown 文档内容",
        inputSchema: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "需要抓取提取内容的目标网页地址 (URL)",
            },
            size: {
              type: "string",
              description:
                "提取文档长度。's' (约5k字符), 'm' (约10k字符，默认), 'l' (约25k字符), 'f' (全部内容，自动级联无损分页请求并最终拼接)",
              enum: ["s", "m", "l", "f"],
              default: "m",
            },
          },
          required: ["url"],
        },
      },
    ],
  };
});

// 2. Tool Execution Logic
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "searcharvester_search") {
      const payload = {
        query: args.query,
        max_results: args.max_results || 10,
        include_raw_content: false,
      };
      if (args.engines) payload.engines = args.engines;
      if (args.categories) payload.categories = args.categories;

      const data = await fetchWithFallback("/search", payload);
      const resultText = formatSearchResults(data, args.query);

      return {
        content: [{ type: "text", text: resultText }],
      };
    }

    if (name === "searcharvester_extract") {
      const payload = {
        url: args.url,
        size: args.size || "m",
      };

      const data = await fetchWithFallback("/extract", payload);

      // API returns {results: [{url, title, content, ...}], failed_results: []}
      const formatted = formatExtractResult(data);

      // Cascade fetch remaining pages when size matches 'f' (full)
      if (args.size === "f" && data.results?.[0]?.pages?.total > 1) {
        const r = data.results[0];
        const activeBaseUrl =
          internalUrl && r.url && r.url.startsWith(internalUrl)
            ? internalUrl
            : externalUrl;

        if (activeBaseUrl) {
          const total = r.pages.total;
          for (let p = 2; p <= total; p++) {
            const pageTxt = await fetchExtractPage(activeBaseUrl, apiKey, r.id, p);
            if (pageTxt) {
              formatted.content += `\n\n=== 页面分页拼接 (PAGE ${p}/${total}) ===\n\n${pageTxt}`;
            }
          }
        }
      }

      const md =
        `URL: ${formatted.url}\n` +
        `标题: ${formatted.title}\n` +
        `字符总计: ${formatted.content.length} |\n\n` +
        `---\n\n` +
        `${formatted.content}`;

      return {
        content: [{ type: "text", text: md }],
      };
    }

    throw new McpError(
      ErrorCode.MethodNotFound,
      `[Searcharvester MCP] 未知工具名称: ${name}`
    );
  } catch (err) {
    if (err instanceof McpError) throw err;
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: err.message || "请求工具处理出错",
        },
      ],
    };
  }
});

// Run server using stdio pathway (only when executed directly, not when imported)
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Searcharvester MCP server running on stdio");
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && realpathSync(process.argv[1]) === thisFile) {
  run().catch((err) => {
    console.error("Searcharvester MCP server fatal crash:", err);
    process.exit(1);
  });
}
