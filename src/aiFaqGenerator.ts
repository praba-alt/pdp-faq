import OpenAI from "openai";
import type { FaqItem } from "./faqGenerator.js";

export interface AiFaqInput {
  sku?: string;
  url: string;
  title: string;
  description?: string;
  metaDescription?: string;
  specs: Record<string, string>;
  jsonId?: string;
  jsonTitle?: string;
  jsonDescription?: string;
  jsonContent?: string;
}

const MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

let openai: OpenAI | null = null;

function getClient(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set");
  }
  if (!openai) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

export async function generateFaqsWithAI(
  input: AiFaqInput,
  options?: { style?: string }
): Promise<FaqItem[]> {
  const client = getClient();

  const specsText = JSON.stringify(input.specs ?? {}, null, 2);
  const style = normaliseStyle(options?.style);
  const styleInstruction = buildStyleInstruction(style);
  const jsonTitle = truncate(input.jsonTitle, 600);
  const jsonDescription = truncate(input.jsonDescription, 1500);
  const jsonContent = truncate(input.jsonContent, 2200);

  const messages = [
    {
      role: "system" as const,
      content:
        "You write concise, shopper-focused FAQs for ecommerce product pages. " +
        "Only use the provided description and specifications. Do not invent technical details. " +
        "Never mention or infer price, cost, discounts, promotions, special offers, or stock/availability status. " +
        "Always respond with pure JSON in the requested format, no extra text. " +
        styleInstruction,
    },
    {
      role: "user" as const,
      content:
        `Write between 5 and 10 FAQs from a shopper's perspective for this product.\n\n` +
        `Title: ${input.title}\n` +
        (input.sku ? `SKU: ${input.sku}\n` : "") +
        `URL: ${input.url}\n\n` +
        (input.jsonId
          ? `JSON source ID: ${input.jsonId}\n`
          : "") +
        (jsonTitle ? `JSON title:\n${jsonTitle}\n\n` : "") +
        (jsonDescription
          ? `JSON description:\n${jsonDescription}\n\n`
          : "") +
        (jsonContent ? `JSON content:\n${jsonContent}\n\n` : "") +
        (input.metaDescription
          ? `Meta description:\n${input.metaDescription}\n\n`
          : "") +
        `Description:\n${input.description ?? ""}\n\n` +
        `Specifications (JSON):\n${specsText}\n\n` +
        `Respond as a JSON array of objects like:\n` +
        `[{"question": "...", "answer": "..."}]\n` +
        `- Questions should be specific and helpful.\n` +
        `- Focus primarily on product features and specifications (size, dimensions, materials, capacity, performance, connectivity, compatibility, care instructions, usage scenarios, etc.) based on the product type.\n` +
        `- You may include at most 2 FAQs in total about delivery, shipping, returns, refunds, or exchanges; all other FAQs should be about the product itself.\n` +
        `- Do not include FAQs about price, cost, discounts, promotions, or whether the product is in stock or available.\n` +
        `- Answers must be grounded only in the description/specs.\n` +
        `- If something (especially a feature, specification or technical detail) is not clearly stated, do not claim it as fact and avoid creating a FAQ whose main point is that the information is missing.\n` +
        `- Aim for up to 10 FAQs; if there is not enough product information, it's fine to return fewer.`,
    },
  ];

  // Log payload sent to OpenAI for debugging, message by message
  // eslint-disable-next-line no-console
  console.log(`[AI FAQ] Model: ${MODEL}`);
  messages.forEach((msg, index) => {
    // eslint-disable-next-line no-console
    console.log(
      `[AI FAQ] Message ${index} (${msg.role}):\n${typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)}\n---`
    );
  });

  const completion = await client.chat.completions.create({
    model: MODEL,
    messages,
    temperature: 0.3,
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error("Empty AI response");
  }

  let raw: unknown;

  try {
    raw = JSON.parse(content);
  } catch {
    const match = content.match(/\[[\s\S]*\]/);
    if (!match) {
      throw new Error("AI response was not valid JSON");
    }
    raw = JSON.parse(match[0]);
  }

  if (!Array.isArray(raw)) {
    throw new Error("AI response JSON is not an array");
  }

  let faqs: FaqItem[] = (raw as any[])
    .map((item) => ({
      question: String(item.question ?? "").trim(),
      answer: String(item.answer ?? "").trim(),
    }))
    .filter((qa) => qa.question && qa.answer);

  // Filter out FAQs whose sole purpose is to state that information is missing
  const missingInfoRegex =
    /(not specified|not provided|not mentioned|does not (provide|specify|state)|no information (is|was) provided|isn['’]t listed)/i;
  faqs = faqs.filter(
    (faq) =>
      !missingInfoRegex.test(faq.question) &&
      !missingInfoRegex.test(faq.answer)
  );

  // Filter out FAQs about dynamic commerce info such as price or availability
  const dynamicInfoRegex =
    /(price|cost|discount|deal|offer|promotion|special offer|save [0-9]|in stock|out of stock|availability|available to order|back[- ]?order|backorder|pre[- ]?order)/i;
  faqs = faqs.filter(
    (faq) =>
      !dynamicInfoRegex.test(faq.question) &&
      !dynamicInfoRegex.test(faq.answer)
  );

  // Separate delivery/returns questions and cap them to 2
  const deliveryRegex =
    /(delivery|shipping|returns?|refunds?|exchanges?|return policy|shipping policy|tariffs?|dut(y|ies)|tax(es)?|customs)/i;
  const deliveryFaqs: FaqItem[] = [];
  const otherFaqs: FaqItem[] = [];

  for (const faq of faqs) {
    if (deliveryRegex.test(faq.question) || deliveryRegex.test(faq.answer)) {
      deliveryFaqs.push(faq);
    } else {
      otherFaqs.push(faq);
    }
  }

  const limitedDeliveryFaqs = deliveryFaqs.slice(0, 2);
  faqs = [...otherFaqs, ...limitedDeliveryFaqs];

  // Enforce a maximum of 10 FAQs
  if (faqs.length > 10) {
    faqs = faqs.slice(0, 10);
  }

  if (!faqs.length) {
    throw new Error("AI returned no FAQs");
  }

  return faqs;
}

function normaliseStyle(style?: string): string {
  if (!style) return "formal";
  const key = style.toLowerCase().replace(/[^a-z]/g, "");
  if (key === "casual") return "casual";
  if (key === "genz" || key === "genzstyle" || key === "genzvibe") return "genz";
  return "formal";
}

function buildStyleInstruction(style: string): string {
  if (style === "casual") {
    return (
      "Write in a friendly, casual tone with simple, conversational phrasing. " +
      "Avoid slang overload and keep answers concise."
    );
  }
  if (style === "genz") {
    return (
      "Write in a light Gen Z tone: short, energetic sentences with minimal, tasteful slang. " +
      "Avoid emojis and avoid sounding forced."
    );
  }
  return (
    "Write in a professional, formal tone with clear, polished phrasing."
  );
}

function truncate(value: string | undefined, max: number): string | undefined {
  if (!value) return undefined;
  if (value.length <= max) return value;
  return value.slice(0, max).trim() + "...";
}
