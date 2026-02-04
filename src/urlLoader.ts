import fs from "fs";
import path from "path";
import { load as loadXml } from "cheerio";

export type UrlList = string[];

export interface InputItem {
  sku?: string;
  url: string;
  title?: string;
  description?: string;
  metaDescription?: string;
  specs?: Record<string, string>;
}

function isProbablyJson(content: string): boolean {
  const trimmed = content.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function isProbablyXml(content: string): boolean {
  const trimmed = content.trim();
  return trimmed.startsWith("<") && !isProbablyJson(content);
}

function parseTextToItems(content: string): InputItem[] {
  return content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(
      (l) =>
        l.length > 0 &&
        !l.startsWith("#") &&
        /^https?:\/\//i.test(l.replace(/^\uFEFF/, ""))
    )
    .map((url) => ({ url }));
}

function parseCsvToItems(content: string): InputItem[] {
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  const header = lines[0].split(",");
  const normalisedHeader = header.map((h) => h.trim().toLowerCase());

  const urlIndex = normalisedHeader.findIndex(
    (h) => h === "url" || h === "link"
  );
  const skuIndex = normalisedHeader.findIndex((h) => h === "sku");
  const titleIndex = normalisedHeader.findIndex(
    (h) => h === "title" || h === "name"
  );

  const items: InputItem[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const get = (idx: number): string | undefined =>
      idx >= 0 && idx < cols.length ? cols[idx].trim() : undefined;

    const rawUrl =
      get(urlIndex) ??
      get(0); // fallback to first column if no explicit url column
    if (!rawUrl) continue;

    const url = rawUrl.replace(/^\uFEFF/, "").trim();
    if (!/^https?:\/\//i.test(url)) continue;

    const sku = get(skuIndex)?.replace(/^\uFEFF/, "").trim();
    const title = get(titleIndex)?.trim();

    items.push({
      url,
      ...(sku ? { sku } : null),
      ...(title ? { title } : null),
    });
  }

  return items;
}

function parseJsonToItems(content: string): InputItem[] {
  const data = JSON.parse(content);
  if (Array.isArray(data)) {
    if (data.every((v) => typeof v === "string")) {
      return (data as string[])
        .filter((u) => /^https?:\/\//i.test(u))
        .map((url) => ({ url }));
    }
    if (data.every((v) => typeof v === "object" && v !== null)) {
      return (data as any[])
        .filter((item) => item && typeof item.url === "string")
        .map((item) => ({
          url: String(item.url),
          ...(item.sku ? { sku: String(item.sku) } : null),
          ...(item.title || item.name
            ? { title: String(item.title ?? item.name) }
            : null),
        }));
    }
  }
  if (data && typeof data === "object") {
    if (Array.isArray((data as any).urls)) {
      return ((data as any).urls as any[])
        .map((u) => String(u))
        .filter((u) => /^https?:\/\//i.test(u))
        .map((url) => ({ url }));
    }
    if (Array.isArray((data as any).items)) {
      return ((data as any).items as any[])
        .filter((item) => item && typeof item.url === "string")
        .map((item) => ({
          url: String(item.url),
          ...(item.sku ? { sku: String(item.sku) } : null),
          ...(item.title || item.name
            ? { title: String(item.title ?? item.name) }
            : null),
        }));
    }
  }
  throw new Error("Unsupported JSON shape for URLs");
}

function parseXmlToItems(content: string): InputItem[] {
  const $ = loadXml(content, { xmlMode: true });
  const items: InputItem[] = [];

  const pushItem = (input: {
    url?: string;
    sku?: string;
    title?: string;
    description?: string;
    specs?: Record<string, string>;
  }) => {
    if (!input.url) return;
    const url = input.url.replace(/^\uFEFF/, "").trim();
    if (!/^https?:\/\//i.test(url)) return;
    const sku = input.sku?.replace(/^\uFEFF/, "").trim();
    const title = input.title?.trim();
    const description = input.description?.trim();
    const specs = input.specs ?? {};

    items.push({
      url,
      ...(sku ? { sku } : null),
      ...(title ? { title } : null),
      ...(description ? { description } : null),
      ...(Object.keys(specs).length ? { specs } : null),
    });
  };

  const containers = $("product, item, entry");
  if (containers.length > 0) {
    containers.each((_: number, el: any) => {
      const node = $(el);
      let urlText: string | undefined =
        node.find("url, link, g\\:link").first().text().trim() ||
        node.attr("url")?.trim() ||
        node.attr("link")?.trim();

      let skuText: string | undefined =
        node.find("sku, id, g\\:sku, g\\:id").first().text().trim() ||
        node.attr("sku")?.trim() ||
        node.attr("id")?.trim();

      let titleText: string | undefined =
        node.find("title, name, g\\:title, g\\:name").first().text().trim() ||
        node.attr("title")?.trim() ||
        node.attr("name")?.trim();

      let descriptionText: string | undefined =
        node.find("description, g\\:description").first().text().trim() ||
        undefined;

      const specs: Record<string, string> = {};

      if (!urlText) {
        node.find("*").each((__: number, child: any) => {
          if (urlText) return;
          const text = $(child).text().trim();
          if (/^https?:\/\//i.test(text)) {
            urlText = text;
          }
        });
      }

      if (!skuText) {
        node.find("*").each((__: number, child: any) => {
          if (skuText) return;
          const text = $(child).text().trim();
          if (text && text.length > 0 && text.length <= 64 && !/\s/.test(text)) {
            skuText = text;
          }
        });
      }

      if (!titleText) {
        node.find("*").each((__: number, child: any) => {
          if (titleText) return;
          const text = $(child).text().trim();
          if (text && /\s/.test(text) && text.length >= 4) {
            titleText = text;
          }
        });
      }

      const ignoredTags = new Set([
        "url",
        "link",
        "g:link",
        "id",
        "g:id",
        "sku",
        "g:sku",
        "title",
        "g:title",
        "name",
        "g:name",
        "description",
        "g:description",
      ]);

      node.find("*").each((__: number, child: any) => {
        const tag = child.tagName ? String(child.tagName).toLowerCase() : "";
        if (!tag || ignoredTags.has(tag)) return;
        const text = $(child).text().trim();
        if (!text) return;
        const key = tag.replace(/^g:/, "");
        if (!specs[key]) {
          specs[key] = text;
        }
      });

      pushItem({
        url: urlText,
        sku: skuText,
        title: titleText,
        description: descriptionText,
        specs,
      });
    });

    return items;
  }

  $("url, link, g\\:link").each((_: number, el: any) => {
    const node = $(el);
    const urlText =
      node.text().trim() ||
      node.attr("href")?.trim() ||
      node.attr("url")?.trim();
    pushItem({ url: urlText });
  });

  return items;
}

export function loadInputItemsFromContent(
  content: string,
  filenameHint?: string
): InputItem[] {
  const ext = filenameHint
    ? path.extname(filenameHint).toLowerCase()
    : "";

  if (ext === ".json") {
    return parseJsonToItems(content);
  }

  if (ext === ".csv") {
    return parseCsvToItems(content);
  }

  if (ext === ".xml") {
    return parseXmlToItems(content);
  }

  if (isProbablyJson(content)) {
    return parseJsonToItems(content);
  }

  if (isProbablyXml(content)) {
    return parseXmlToItems(content);
  }

  if (content.includes(",")) {
    // Heuristic: treat as CSV if it looks like it
    return parseCsvToItems(content);
  }

  return parseTextToItems(content);
}

export function loadInputItems(filePath: string): InputItem[] {
  const fullPath = path.resolve(filePath);
  const content = fs.readFileSync(fullPath, "utf8");
  return loadInputItemsFromContent(content, fullPath);
}

export function loadUrls(filePath: string): UrlList {
  return loadInputItems(filePath).map((item) => item.url);
}
