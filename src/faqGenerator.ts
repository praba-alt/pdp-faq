export interface ProductData {
  sku?: string;
  url: string;
  title: string;
  description?: string;
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
  faqs: FaqItem[];
}

export function generateFaqsForProduct(product: ProductData): ProductFaqResult {
  const { url, title, description, specs } = product;
  const faqs: FaqItem[] = [];

  const safeTitle = title || "this product";

  if (description && description.trim().length > 0) {
    faqs.push({
      question: `What is ${safeTitle} and who is it for?`,
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

  const noise = findSpec(specs, ["noise level", "sound level"]);
  if (noise) {
    faqs.push({
      question: `How loud is ${safeTitle} in operation?`,
      answer: `${safeTitle} has a noise level of ${noise} during use.`,
    });
  }

  const warranty = findSpec(specs, ["warranty", "guarantee"]);
  if (warranty) {
    faqs.push({
      question: `What warranty comes with ${safeTitle}?`,
      answer: `${safeTitle} includes a warranty of ${warranty}.`,
    });
  }

  return { url, title: safeTitle, faqs };
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
