import "./env.js";
import express from "express";
import multer from "multer";
import cors from "cors";
import { loadInputItems } from "./urlLoader.js";
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
app.use(express.static(path.join(process.cwd(), "public")));

app.post("/api/upload-urls", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const filePath = req.file.path;
    const useAI =
      String(req.query.ai ?? "").toLowerCase() === "1" ||
      String(req.query.ai ?? "").toLowerCase() === "true";
    const items = loadInputItems(filePath);
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
      `Received upload (${req.file.originalname}) with ${urls.length} URL(s), AI=${useAI}`
    );

    const results = [];
    for (const item of items) {
      const url = item.url;
      try {
        // eslint-disable-next-line no-console
        console.log(`Fetching: ${url}`);
        const html = await fetchHtml(url);
        const parsed = parseProductHtml(html);
        const baseProduct = {
          sku: item.sku ?? parsed.sku,
          url,
          title: parsed.title || item.title || "",
          description: parsed.description,
          metaDescription: parsed.metaDescription,
          specs: parsed.specs,
        };

        if (useAI && process.env.OPENAI_API_KEY) {
          try {
            const faqs = await generateFaqsWithAI(baseProduct);
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

    fs.unlink(filePath, () => {});
    return res.json(results);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? String(err) });
  }
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Server running on http://localhost:${port}`);
});
