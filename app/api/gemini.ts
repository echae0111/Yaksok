export const GEMINI_MODEL = "gemini-3.1-pro-preview";

export type GeminiPayload = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  error?: { code?: number; message?: string; status?: string };
};

export function geminiText(payload: GeminiPayload) {
  return payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
}

export function callGemini(apiKey: string, systemInstruction: string, parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }>, schema: object) {
  return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: "user", parts }],
      generationConfig: { responseMimeType: "application/json", responseJsonSchema: schema },
    }),
  });
}
