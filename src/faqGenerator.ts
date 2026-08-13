export interface ProductData {
  sku?: string;
  url: string;
  title: string;
  description?: string;
  category?: string;
  productType?: string;
  specs: Record<string, string>;
}

export interface FaqItem {
  question: string;
  answer: string;
}

export interface ProductFaqResult {
  sku?: string;
  url: string;
  title: string;
  category?: string;
  productType?: string;
  faqs: FaqItem[];
}

export function generateFaqsForProduct(product: ProductData): ProductFaqResult {
  const { url, title, description, category, productType, specs } = product;
  const faqs: FaqItem[] = [];

  const safeTitle = title || "this product";

  if (description && description.trim().length > 0) {
    faqs.push({
      question: `What is ${safeTitle} and how does it help?`,
      answer: description.trim(),
    });
  }

  const screenSize = findSpec(specs, ["screen size", "screen-size", "size"]);
  if (screenSize) {
    faqs.push({
      question: `What is the screen size of ${safeTitle}?`,
      answer: `${safeTitle} has a ${screenSize} screen.`,
    });
  }

  const capacity = findSpec(specs, ["capacity", "drum capacity", "net capacity"]);
  if (capacity) {
    faqs.push({
      question: `What is the capacity of ${safeTitle}?`,
      answer: `${safeTitle} has a capacity of ${capacity}.`,
    });
  }

  const energy = findSpec(specs, ["energy rating", "energy efficiency"]);
  if (energy) {
    faqs.push({
      question: `What is the energy rating of ${safeTitle}?`,
      answer: `${safeTitle} has an energy rating of ${energy}.`,
    });
  }

  const wifi = findSpec(specs, ["wi-fi", "wifi", "wireless connectivity"]);
  const smartPlatform = findSpec(specs, ["smart platform", "operating system", "os"]);
  if (wifi || smartPlatform) {
    faqs.push({
      question: `Is ${safeTitle} a smart/connected product?`,
      answer: [
        wifi ? `It supports ${wifi}.` : "",
        smartPlatform ? `It runs on ${smartPlatform}.` : "",
      ]
        .filter(Boolean)
        .join(" "),
    });
  }

  const warranty = findSpec(specs, ["warranty", "guarantee"]);
  if (warranty) {
    faqs.push({
      question: `What warranty comes with ${safeTitle}?`,
      answer: `${safeTitle} comes with a manufacturer's guarantee of ${warranty}. Proof of purchase may be required.`,
    });
  }

  const negativeImpressionRegex =
    /\b(cons|downside|downsides|drawback|drawbacks|disadvantage|disadvantages|problem|problems|issue|issues|complaint|complaints|negative|defect|defects|limitation|limitations|risk|risks|loud|noise)\b/i;
  const filteredFaqs = faqs.filter(
    (faq) =>
      !negativeImpressionRegex.test(faq.question) &&
      !negativeImpressionRegex.test(faq.answer)
  );

  const cleanedFaqs = filteredFaqs.map((faq) => ({
    question: fixMojibake(faq.question),
    answer: fixMojibake(faq.answer),
  }));

  return { url, title: safeTitle, category, productType, faqs: cleanedFaqs };
}

function findSpec(specs: Record<string, string>, candidates: string[]): string | undefined {
  const normalisedEntries = Object.entries(specs).map(([k, v]) => [
    normaliseKey(k),
    v,
  ]) as [string, string][];

  for (const candidate of candidates) {
    const normCandidate = normaliseKey(candidate);
    const match = normalisedEntries.find(([k]) => k.includes(normCandidate));
    if (match) return match[1];
  }

  return undefined;
}

function normaliseKey(key: string): string {
  return key.toLowerCase().replace(/\s+/g, " ").trim();
}

function fixMojibake(value: string): string {
  return value
    .replace(/Ã‚/g, "")
    .replace(/Ã¢â‚¬â„¢|â€™|’/g, "'")
    .replace(/Ã¢â‚¬Ëœ|â€˜|‘/g, "'")
    .replace(/Ã¢â‚¬Å“|â€œ|“/g, '"')
    .replace(/Ã¢â‚¬ï¿½|â€|”/g, '"')
    .replace(/Ã¢â‚¬â€œ|â€“|–/g, "-")
    .replace(/Ã¢â‚¬â€|â€”|—/g, "-")
    .replace(/Ã¢â‚¬Â¦|â€¦|…/g, "...")
    .replace(/Â/g, "")
    .replace(/\u00A0/g, " ");
}

