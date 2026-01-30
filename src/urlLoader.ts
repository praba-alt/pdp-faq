import fs from "fs";
import path from "path";

export type UrlList = string[];

export interface InputItem {
  sku?: string;
  url: string;
  title?: string;
}

function isProbablyJson(content: string): boolean {
  const trimmed = content.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
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

export function loadInputItems(filePath: string): InputItem[] {
  const fullPath = path.resolve(filePath);
  const content = fs.readFileSync(fullPath, "utf8");
  const ext = path.extname(fullPath).toLowerCase();

  if (ext === ".json") {
    return parseJsonToItems(content);
  }

  if (ext === ".csv") {
    return parseCsvToItems(content);
  }

  if (isProbablyJson(content)) {
    return parseJsonToItems(content);
  }

  if (content.includes(",")) {
    // Heuristic: treat as CSV if it looks like it
    return parseCsvToItems(content);
  }

  return parseTextToItems(content);
}

export function loadUrls(filePath: string): UrlList {
  return loadInputItems(filePath).map((item) => item.url);
}
