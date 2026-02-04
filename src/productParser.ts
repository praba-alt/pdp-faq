import { load, type CheerioAPI } from "cheerio";

export interface ParsedProduct {
  title: string;
  description?: string;
  metaDescription?: string;
  specs: Record<string, string>;
  sku?: string;
}

export function parseProductHtml(html: string): ParsedProduct {
  const $ = load(html);

  const title =
    $("h1").first().text().trim() ||
    $('[class*="product-title"], [class*="pdp-title"], [itemprop="name"]')
      .first()
      .text()
      .trim();

  const metaDescription =
    $('meta[name="description"]').attr("content")?.trim() || undefined;

  const description = extractBestDescription($, metaDescription);

  const specs: Record<string, string> = {};

  extractSpecsFromTables($, specs);
  extractSpecsFromDefinitionLists($, specs);
  extractSpecsFromLists($, specs);

  const sku = extractSkuFromJsonLd($);

  return {
    title,
    description,
    metaDescription,
    specs,
    sku,
  };
}

function extractBestDescription(
  $: CheerioAPI,
  metaDescription?: string
): string | undefined {
  const candidates: string[] = [];

  $(
    '[class*="description"], [id*="description"], [class*="overview"], .tab-details, .format-content--product-tabs, .b2c-tabs__content--details'
  ).each((_, el) => {
    const cloned = $(el).clone();
    cloned.find("button, a").remove();
    const text = cloned.text().replace(/\s+/g, " ").trim();
    if (text) {
      candidates.push(text);
    }
  });

  let best = candidates.sort((a, b) => b.length - a.length)[0] || "";

  best = best.trim();

  const features = extractFeatureBullets($);
  if (features) {
    if (best) {
      best = `${best}\n\nFeatures:\n${features}`;
    } else {
      best = `Features:\n${features}`;
    }
  }

  return best || undefined;
}

function extractFeatureBullets($: CheerioAPI): string | undefined {
  const lines: string[] = [];

  $("h2,h3,h4").each((_, heading) => {
    const text = $(heading).text().toLowerCase();
    if (!/feature|benefit|highlights?/.test(text)) return;

    const list = $(heading).nextAll("ul,ol").first();
    if (!list.length) return;

    list.find("li").each((__, li) => {
      const itemText = $(li).text().replace(/\s+/g, " ").trim();
      if (itemText) {
        lines.push(`- ${itemText}`);
      }
    });
  });

  return lines.length ? lines.join("\n") : undefined;
}

function extractSkuFromJsonLd($: CheerioAPI): string | undefined {
  const scripts = $('script[type="application/ld+json"]');
  const skus: string[] = [];

  scripts.each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      collectSkusFromNode(parsed, skus);
    } catch {
      // Ignore JSON-LD parse errors and continue
    }
  });

  return skus[0];
}

function collectSkusFromNode(node: unknown, out: string[]): void {
  if (!node || typeof node !== "object") return;

  if (Array.isArray(node)) {
    for (const item of node) {
      collectSkusFromNode(item, out);
      if (out.length) return;
    }
    return;
  }

  const obj = node as Record<string, unknown>;
  const type = typeof obj["@type"] === "string" ? String(obj["@type"]) : "";

  if (type.toLowerCase() === "product" && typeof obj["sku"] === "string") {
    const sku = String(obj["sku"]).trim();
    if (sku) {
      out.push(sku);
      return;
    }
  }

  for (const value of Object.values(obj)) {
    collectSkusFromNode(value, out);
    if (out.length) return;
  }
}

function extractSpecsFromTables(
  $: CheerioAPI,
  specs: Record<string, string>
): void {
  $("table").each((_: number, table: any) => {
    const $table = $(table);
    const isClassificationTable =
      $table.hasClass("classifications") ||
      $table.hasClass("flix-std-specs-table");

    if (!isClassificationTable) {
      const headingText = $table.prev("h1,h2,h3,h4,h5").text().toLowerCase();
      if (headingText && !/spec|tech|feature|detail/.test(headingText)) return;
    }

    $table.find("tr").each((__: number, tr: any) => {
      const cells = $(tr).find("th,td");
      if (cells.length < 2) return;
      const label = $(cells[0]).text().trim();
      const value = $(cells[1]).text().trim();
      if (!label || !value) return;
      const normalisedLabel = normaliseLabel(label);
      specs[normalisedLabel] = value;
    });
  });
}

function extractSpecsFromDefinitionLists(
  $: CheerioAPI,
  specs: Record<string, string>
): void {
  $("dl").each((_: number, dl: any) => {
    const $dl = $(dl);
    const headingText = $dl.prev("h1,h2,h3,h4,h5").text().toLowerCase();
    if (headingText && !/spec|tech|feature|detail/.test(headingText)) return;

    let currentLabel: string | null = null;
    $dl.children().each((__: number, el: any) => {
      const tag = el.tagName?.toLowerCase();
      if (tag === "dt") {
        currentLabel = $(el).text().trim();
      } else if (tag === "dd" && currentLabel) {
        const value = $(el).text().trim();
        if (value) {
          specs[normaliseLabel(currentLabel)] = value;
        }
        currentLabel = null;
      }
    });
  });
}

function extractSpecsFromLists(
  $: CheerioAPI,
  specs: Record<string, string>
): void {
  $("ul,ol").each((_: number, list: any) => {
    const $list = $(list);
    const headingText = $list.prev("h1,h2,h3,h4,h5").text().toLowerCase();
    if (!/spec|tech|feature|detail/.test(headingText)) return;

    $list.find("li").each((__: number, li: any) => {
      const text = $(li).text().trim();
      if (!text) return;
      const match = text.match(/^([^:–-]+)[ :–-]+(.+)$/);
      if (!match) return;
      const [, rawLabel, rawValue] = match;
      const label = normaliseLabel(rawLabel);
      const value = rawValue.trim();
      if (label && value) {
        specs[label] = value;
      }
    });
  });
}

function normaliseLabel(label: string): string {
  return label.replace(/\s+/g, " ").trim();
}
