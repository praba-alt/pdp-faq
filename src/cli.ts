#!/usr/bin/env node
import "./env.js";
import { hideBin } from "yargs/helpers";
import yargs from "yargs";
import { loadInputItems } from "./urlLoader.js";
import { fetchHtml } from "./fetcher.js";
import { parseProductHtml } from "./productParser.js";
import { generateFaqsForProduct } from "./faqGenerator.js";
import { generateFaqsWithAI } from "./aiFaqGenerator.js";

async function main() {
  const argv = await yargs(hideBin(process.argv))
    .scriptName("pdp-faq")
    .usage("$0 -i <file> [-o <file>]")
    .option("input", {
      alias: "i",
      type: "string",
      describe: "Path to CSV/JSON/TXT file containing product URLs",
      demandOption: true,
    })
    .option("output", {
      alias: "o",
      type: "string",
      describe: "Optional path to write FAQs JSON (defaults to stdout)",
    })
    .option("ai", {
      type: "boolean",
      default: false,
      describe:
        "Use OpenAI to generate FAQ content (requires OPENAI_API_KEY). Falls back to rule-based generator on error.",
    })
    .option("style", {
      type: "string",
      describe: "FAQ tone: formal, casual, or genz (AI mode only)",
    })
    .option("language", {
      type: "string",
      describe:
        "FAQ language variant: en-GB (UK English) or en-US (US English) (AI mode only)",
    })
    .option("no-delivery-faqs", {
      type: "boolean",
      default: false,
      describe: "Exclude delivery/shipping/returns FAQs (AI mode only)",
    })
    .help()
    .parse();

  const items = loadInputItems(argv.input);
  const urls = items
    .map((item) => item.url.trim())
    .filter(
      (u) =>
        u.length > 0 &&
        !/^(url|link|urls)$/i.test(u.replace(/^\uFEFF/, "")) &&
        /^https?:\/\//i.test(u)
    );
  const useAI = Boolean(argv.ai);
  const style =
    typeof argv.style === "string" && argv.style.trim().length > 0
      ? argv.style.trim()
      : undefined;
  const noDeliveryFaqs = Boolean((argv as any)["no-delivery-faqs"]);
  const language =
    typeof (argv as any).language === "string" &&
    (argv as any).language.trim().length > 0
      ? (argv as any).language.trim()
      : undefined;

  // eslint-disable-next-line no-console
  console.log(`Loaded ${urls.length} URL(s) from ${argv.input}`);

  const results = [];
  const inferredNoDeliveryFaqs =
    noDeliveryFaqs || inferNoDeliveryFaqsFromItems(items);
  for (const item of items) {
    const url = item.url;
    try {
      // Always fetch the PDP HTML to get up-to-date specs.
      // Feed-provided fields are only used as fallbacks/overrides.
      // eslint-disable-next-line no-console
      console.log(`Fetching: ${url}`);
      const html = await fetchHtml(url);
      const parsed = parseProductHtml(html);
      const feedSpecs =
        ((item as any).specs as Record<string, string> | undefined) ?? {};
      const baseProduct = {
        url,
        title: parsed.title || parsed.jsonTitle || (item as any).title || "",
        description:
          parsed.description ||
          parsed.jsonDescription ||
          parsed.jsonContent ||
          (item as any).description,
        metaDescription: parsed.metaDescription ?? (item as any).metaDescription,
        specs: {
          ...(parsed.specs ?? {}),
          ...feedSpecs,
        },
        sku: item.sku ?? (parsed as any).sku ?? (item as any).sku,
        jsonId: parsed.jsonId,
        jsonTitle: parsed.jsonTitle,
        jsonDescription: parsed.jsonDescription,
        jsonContent: parsed.jsonContent,
      };

      if (useAI && process.env.OPENAI_API_KEY) {
        try {
          const faqs = await generateFaqsWithAI(baseProduct, {
            style,
            language,
            allowDeliveryFaqs: !inferredNoDeliveryFaqs,
          });
          // eslint-disable-next-line no-console
          console.log(
            `Success (AI): ${url} — ${faqs.length} FAQ(s) generated`
          );
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
        `Success (rule-based): ${url} — ${faq.faqs.length} FAQ(s) generated`
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
        url,
        title: "",
        faqs: [],
        error: err?.message ?? String(err),
      });
    }
  }

  const json = JSON.stringify(results, null, 2);
  if (argv.output) {
    const fs = await import("fs");
    await fs.promises.writeFile(argv.output, json, "utf8");
  } else {
    // eslint-disable-next-line no-console
    console.log(json);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

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
