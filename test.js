import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { formatSearchResults, formatExtractResult } from "./index.js";

describe("formatSearchResults", () => {
  it("formats results with title, url, content, score", () => {
    const data = {
      results: [
        {
          title: "Title A",
          url: "https://a.com",
          content: "Content A",
          score: 0.85,
        },
        {
          title: "Title B",
          url: "https://b.com",
          content: "Content B",
          score: 0.72,
        },
      ],
    };
    const out = formatSearchResults(data, "test query");

    assert.ok(out.includes("1. **Title A**"));
    assert.ok(out.includes("URL: https://a.com"));
    assert.ok(out.includes("内容: Content A"));
    assert.ok(out.includes("[Score: 0.85]"));

    assert.ok(out.includes("2. **Title B**"));
    assert.ok(out.includes("URL: https://b.com"));
    assert.ok(out.includes("内容: Content B"));
    assert.ok(out.includes("[Score: 0.72]"));
  });

  it("omits Score line when score is null/undefined", () => {
    const data = {
      results: [{ title: "T", url: "https://x.com", content: "C" }],
    };
    const out = formatSearchResults(data, "q");
    assert.ok(!out.includes("[Score:"));
  });

  it("shows zero score when score is 0", () => {
    const data = {
      results: [{ title: "T", url: "https://x.com", content: "C", score: 0 }],
    };
    const out = formatSearchResults(data, "q");
    assert.ok(out.includes("[Score: 0.00]"));
  });

  it("falls back to 无标题 for missing title", () => {
    const data = {
      results: [{ url: "https://x.com", content: "C" }],
    };
    const out = formatSearchResults(data, "q");
    assert.ok(out.includes("无标题"));
  });

  it("falls back to 暂无摘录 for missing content", () => {
    const data = {
      results: [{ title: "T", url: "https://x.com" }],
    };
    const out = formatSearchResults(data, "q");
    assert.ok(out.includes("暂无摘录"));
  });

  it("returns no-results message when results array is empty", () => {
    const out = formatSearchResults({ results: [] }, "xxx");
    assert.ok(out.includes("未检索到有关"));
    assert.ok(out.includes("xxx"));
  });

  it("returns no-results message when results is missing", () => {
    const out = formatSearchResults({}, "yyy");
    assert.ok(out.includes("未检索到有关"));
    assert.ok(out.includes("yyy"));
  });
});

describe("formatExtractResult", () => {
  it("unwraps results[0] and returns url, title, content", () => {
    const data = {
      results: [
        {
          id: "abc123",
          url: "https://example.com",
          title: "Example Domain",
          content: "Hello world",
          pages: { current: 1, total: 1, page_size: 5000 },
        },
      ],
      failed_results: [],
    };
    const out = formatExtractResult(data);
    assert.equal(out.url, "https://example.com");
    assert.equal(out.title, "Example Domain");
    assert.equal(out.content, "Hello world");
  });

  it("falls back to 未知 title when missing", () => {
    const out = formatExtractResult({
      results: [{ url: "https://x.com", content: "x" }],
    });
    assert.equal(out.title, "未知");
    assert.equal(out.content, "x");
  });

  it("returns empty content and 未知 title for empty results", () => {
    const out = formatExtractResult({ results: [], failed_results: [] });
    assert.equal(out.title, "未知");
    assert.equal(out.content, "");
    assert.equal(out.url, undefined);
  });

  it("returns empty content and 未知 title when results is missing", () => {
    const out = formatExtractResult({ failed_results: [] });
    assert.equal(out.title, "未知");
    assert.equal(out.content, "");
    assert.equal(out.url, undefined);
  });

  it("shows multi-page placeholder when pages.total > 1", () => {
    const data = {
      results: [
        {
          id: "mp",
          url: "https://long.com",
          title: "Long Doc",
          content: "Part 1 content",
          pages: { current: 1, total: 3, page_size: 5000 },
        },
      ],
    };
    const out = formatExtractResult(data);
    assert.ok(out.content.includes("Part 1 content"));
    assert.ok(out.content.includes("此文档共 3 页"));
    assert.ok(out.content.includes("已自动拼接"));
  });

  it("does NOT show multi-page notice when pages.total is 1", () => {
    const data = {
      results: [
        {
          id: "sp",
          url: "https://short.com",
          title: "Short",
          content: "One page only",
          pages: { current: 1, total: 1, page_size: 5000 },
        },
      ],
    };
    const out = formatExtractResult(data);
    assert.ok(!out.content.includes("已自动拼接"));
  });
});
