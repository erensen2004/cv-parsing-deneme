import { Router, Request, Response } from "express";
import OpenAI from "openai";
import { createRequire } from "module";
import { requireAuth } from "../lib/auth.js";
import { requireRole } from "../lib/authz.js";
import { CvParseBodySchema, CvParseResponseSchema } from "../lib/schemas.js";
import { Errors } from "../lib/errors.js";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse") as (buf: Buffer) => Promise<{ text: string }>;

const router = Router();

async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const data = await pdfParse(buffer);
  return data.text;
}

async function parseWithAI(cvText: string): Promise<Record<string, unknown>> {
  const apiKey = process.env.REPLIT_AI_TOKEN || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("AI service not configured");
  }

  const client = new OpenAI({
    apiKey,
    baseURL: process.env.REPLIT_AI_TOKEN ? "https://ai.replit.com" : undefined,
  });

  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `You are a CV parser. Extract structured data from CVs and return ONLY valid JSON with these fields:
{
  "firstName": string,
  "lastName": string,
  "email": string,
  "phone": string or null,
  "skills": string (comma-separated skill list),
  "expectedSalary": number or null
}
Return only the JSON object, no markdown or extra text.`,
      },
      {
        role: "user",
        content: `Parse this CV:\n\n${cvText.slice(0, 4000)}`,
      },
    ],
    temperature: 0.1,
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  return JSON.parse(raw);
}

/**
 * POST /cv-parse
 *
 * Parses a CV from either:
 * 1. JSON body: { cvText: string }  — manual text input
 * 2. Binary body with Content-Type: application/pdf — auto PDF extraction
 *
 * Returns validated structured candidate data.
 */
router.post("/", requireAuth, requireRole("vendor"), async (req: Request, res: Response) => {
  try {
    const apiKey = process.env.REPLIT_AI_TOKEN || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      Errors.serviceUnavailable(res, "AI service not configured");
      return;
    }

    let cvText: string;

    if (req.headers["content-type"]?.includes("application/pdf")) {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      await new Promise<void>((resolve, reject) => {
        req.on("end", resolve);
        req.on("error", reject);
      });

      const pdfBuffer = Buffer.concat(chunks);
      if (!pdfBuffer.length) {
        Errors.badRequest(res, "PDF body is empty");
        return;
      }

      try {
        cvText = await extractTextFromPdf(pdfBuffer);
      } catch {
        Errors.badRequest(res, "Failed to extract text from PDF");
        return;
      }
    } else {
      const bodyValidation = CvParseBodySchema.safeParse(req.body);
      if (!bodyValidation.success) {
        Errors.validation(res, bodyValidation.error.flatten());
        return;
      }
      cvText = bodyValidation.data.cvText;
    }

    let parsedJson: Record<string, unknown>;
    try {
      parsedJson = await parseWithAI(cvText);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      if (message === "AI service not configured") {
        Errors.serviceUnavailable(res, "AI service not configured");
      } else if (message.includes("JSON")) {
        Errors.badRequest(res, "AI returned invalid JSON");
      } else {
        throw err;
      }
      return;
    }

    const validated = CvParseResponseSchema.safeParse(parsedJson);
    if (!validated.success) {
      Errors.validation(res, validated.error.flatten());
      return;
    }

    res.json(validated.data);
  } catch (err) {
    console.error("CV parse error:", err);
    Errors.internal(res, "CV parsing failed");
  }
});

export default router;
