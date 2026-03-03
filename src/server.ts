import "./env.js";
import express from "express";
import multer from "multer";
import cors from "cors";
import { loadInputItems, loadInputItemsFromContent, type InputItem } from "./urlLoader.js";
import { fetchHtml } from "./fetcher.js";
import { parseProductHtml } from "./productParser.js";
import { generateFaqsForProduct } from "./faqGenerator.js";
import { generateFaqsWithAI } from "./aiFaqGenerator.js";
import fs from "fs";
import path from "path";

const upload = multer({ dest: "uploads/" });
const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(process.cwd(), "public")));

function parseUseAI(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const s = String(value ?? "").toLowerCase();
  return s === "1" || s === "true";
}

function parseStyle(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim();
  return undefined;
}

function parseNoDeliveryFaqs(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const s = String(value ?? "").toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

function inferNoDeliveryFaqsFromItems(
  items: Array<{ url?: string; title?: string }>
): boolean {
  return items.some((item) => {
    const url = String(item.url ?? "").toLowerCase();
    const title = String(item.title ?? "").toLowerCase();
    return (
      url.includes("childsplayclothing.com") || title.includes("childsplay")
    );
  });
}

function applyRange(
  items: InputItem[],
  startRaw: unknown,
  endRaw: unknown
): { items: InputItem[]; startIndex: number; endIndex: number } {
  const total = items.length;
  let startIndex = 0;
  let endIndex = total;

  const startNum = Number(startRaw);
  if (!Number.isNaN(startNum) && startNum > 0) {
    startIndex = Math.min(total, Math.max(0, Math.floor(startNum) - 1));
  }

  const endNum = Number(endRaw);
  if (!Number.isNaN(endNum) && endNum > 0) {
    endIndex = Math.min(total, Math.max(startIndex, Math.floor(endNum)));
  }

  return {
    items: items.slice(startIndex, endIndex),
    startIndex,
    endIndex,
  };
}

async function processItems(
  items: InputItem[],
  useAI: boolean,
  style?: string,
  noDeliveryFaqs?: boolean
): Promise<
  {
    sku: string;
    url: string;
    title: string;
    faqs: any[];
    error?: string;
  }[]
> {
  const results: {
    sku: string;
    url: string;
    title: string;
    faqs: any[];
    error?: string;
  }[] = [];

  for (const item of items) {
    const url = item.url;
    try {
      // Always fetch the PDP HTML to get up-to-date specs.
      // Feed-provided fields are only used as fallbacks/overrides.
      // eslint-disable-next-line no-console
      console.log(`Fetching: ${url}`);
      const html = await fetchHtml(url);
      const parsed = parseProductHtml(html);
      const baseProduct = {
        sku: item.sku ?? parsed.sku,
        url,
        title: parsed.title || parsed.jsonTitle || item.title || "",
        description:
          parsed.description ||
          parsed.jsonDescription ||
          parsed.jsonContent ||
          item.description,
        metaDescription: parsed.metaDescription ?? item.metaDescription,
        specs: {
          ...(parsed.specs ?? {}),
          ...(item.specs ?? {}),
        },
        jsonId: parsed.jsonId,
        jsonTitle: parsed.jsonTitle,
        jsonDescription: parsed.jsonDescription,
        jsonContent: parsed.jsonContent,
      };

      if (useAI && process.env.OPENAI_API_KEY) {
        try {
          const faqs = await generateFaqsWithAI(baseProduct, {
            style,
            allowDeliveryFaqs: !noDeliveryFaqs,
          });
          results.push({
            sku: baseProduct.sku ?? "",
            url,
            title: baseProduct.title,
            faqs,
          });
          continue;
        } catch (aiErr: any) {
          const fallback = generateFaqsForProduct(baseProduct);
          (fallback as any).error = `AI generation failed: ${
            aiErr?.message ?? String(aiErr)
          }`;
          // eslint-disable-next-line no-console
          console.warn(
            `Warning: AI generation failed for ${url}, using rule-based fallback: ${
              aiErr?.message ?? String(aiErr)
            }`
          );
          results.push({
            sku: baseProduct.sku ?? "",
            url,
            title: fallback.title,
            faqs: fallback.faqs,
            error: (fallback as any).error,
          });
          continue;
        }
      }

      const faq = generateFaqsForProduct(baseProduct);
      // eslint-disable-next-line no-console
      console.log(
        `Success (${useAI && process.env.OPENAI_API_KEY ? "rule-based fallback" : "rule-based"}): ${url} — ${faq.faqs.length} FAQ(s) generated`
      );
      results.push({
        sku: baseProduct.sku ?? "",
        url,
        title: faq.title,
        faqs: faq.faqs,
      });
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error(`Error while processing ${url}:`, err?.message ?? err);
      results.push({
        sku: "",
        url,
        title: "",
        faqs: [],
        error: err?.message ?? String(err),
      });
    }
  }

  return results;
}

app.post("/api/upload-urls", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const filePath = req.file.path;
    const useAI = parseUseAI(req.query.ai);
    const style = parseStyle(req.query.style);
    const noDeliveryFaqs = parseNoDeliveryFaqs(req.query.noDeliveryFaqs);
    const allItems = loadInputItems(filePath);
    const inferredNoDeliveryFaqs =
      noDeliveryFaqs || inferNoDeliveryFaqsFromItems(allItems);
    const { items, startIndex, endIndex } = applyRange(
      allItems,
      req.query.start,
      req.query.end
    );

    const urls = items
      .map((item) => item.url.trim())
      .filter(
        (u) =>
          u.length > 0 &&
          !/^(url|link|urls)$/i.test(u.replace(/^\uFEFF/, "")) &&
          /^https?:\/\//i.test(u)
      );
    // eslint-disable-next-line no-console
    console.log(
      `Received upload (${req.file.originalname}) with ${urls.length} URL(s), AI=${useAI}` +
        (allItems.length !== items.length
          ? `, range=${startIndex + 1}-${endIndex}`
          : "")
    );

    const results = await processItems(
      items,
      useAI,
      style,
      inferredNoDeliveryFaqs
    );

    fs.unlink(filePath, () => {});
    return res.json(results);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? String(err) });
  }
});

app.post("/api/process-urls", async (req, res) => {
  try {
    const body = req.body ?? {};
    const useAI =
      "ai" in body ? parseUseAI(body.ai) : parseUseAI(req.query.ai);
    const style = parseStyle(body.style ?? req.query.style);
    const noDeliveryFaqs = parseNoDeliveryFaqs(
      body.noDeliveryFaqs ?? req.query.noDeliveryFaqs
    );

    const directUrlsRaw = Array.isArray(body.urls) ? body.urls : [];
    const apiUrl =
      typeof body.apiUrl === "string" ? body.apiUrl.trim() : "";

    let items: InputItem[] = [];

    if (directUrlsRaw.length > 0) {
      const urls = directUrlsRaw
        .map((u: unknown) => String(u || "").trim())
        .filter(
          (u: string) =>
            u.length > 0 &&
            !/^(url|link|urls)$/i.test(u.replace(/^\uFEFF/, "")) &&
            /^https?:\/\//i.test(u)
        );
      items = urls.map((url: string) => ({ url }));
      // eslint-disable-next-line no-console
      console.log(
        `Received direct URL list with ${items.length} URL(s), AI=${useAI}`
      );
    } else if (apiUrl) {
      // eslint-disable-next-line no-console
      console.log(`Fetching URL list from API URL: ${apiUrl}`);
      const text = await fetchHtml(apiUrl);
      const parsedItems = loadInputItemsFromContent(text, apiUrl);
      items = parsedItems;
      // eslint-disable-next-line no-console
      console.log(
        `Loaded ${items.length} item(s) from API URL, AI=${useAI}`
      );
    } else {
      return res.status(400).json({
        error:
          "Provide either a non-empty 'urls' array or an 'apiUrl' field in the request body.",
      });
    }

    const { items: rangedItems, startIndex, endIndex } = applyRange(
      items,
      body.rangeStart ?? body.start,
      body.rangeEnd ?? body.end
    );
    const inferredNoDeliveryFaqs =
      noDeliveryFaqs || inferNoDeliveryFaqsFromItems(items);

    if (!rangedItems.length) {
      return res.json([]);
    }

    // eslint-disable-next-line no-console
    console.log(
      `Processing ${rangedItems.length} URL(s)` +
        (items.length !== rangedItems.length
          ? ` (range ${startIndex + 1}-${endIndex} of ${items.length})`
          : "")
    );

    const results = await processItems(
      rangedItems,
      useAI,
      style,
      inferredNoDeliveryFaqs
    );
    return res.json(results);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? String(err) });
  }
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Server running on http://localhost:${port}`);
});
