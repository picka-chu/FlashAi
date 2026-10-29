/**
 * Analyst chat — multi-turn conversation about a fixture or general football.
 * Uses the shared Gemini key pool. Free for paid plans; server gates access.
 */

import { GoogleGenAI } from '@google/genai';
import { analysisCache, executeWithRetry, isRetryableGeminiError } from './apiCacheService';

const MAX_MESSAGE = 2000;
const MAX_HISTORY = 12;
const CHAT_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

function systemPrompt(matchContext?: string) {
  return `You are Flash AI, a sharp football analyst inside a Telegram betting app.
Be direct, specific and honest. Prefer probabilities and ranges over absolutes. Never promise profit.
If asked about a match, ground answers in the provided model context when present. If data is thin, say so.
Keep replies under 180 words unless the user asks for depth. No markdown headers; plain text with short lines.
${matchContext ? `\nMATCH CONTEXT:\n${matchContext}` : ''}`;
}

export async function chatWithAnalyst(input: {
  message: string;
  history?: ChatTurn[];
  matchContext?: string;
}): Promise<string> {
  const message = String(input.message || '').trim().slice(0, MAX_MESSAGE);
  if (!message) return 'Ask me about any match, market or prediction.';

  const history = (Array.isArray(input.history) ? input.history : [])
    .slice(-MAX_HISTORY)
    .map((t) => ({
      role: t?.role === 'assistant' ? ('model' as const) : ('user' as const),
      text: String(t?.text || '').slice(0, MAX_MESSAGE).trim(),
    }))
    .filter((t) => t.text);

  const matchContext = String(input.matchContext || '').slice(0, 4000);

  return executeWithRetry(
    async (apiKey) => {
      const ai = new GoogleGenAI({ apiKey });
      const contents: any[] = [
        ...history.map((h) => ({ role: h.role, parts: [{ text: h.text }] })),
        { role: 'user', parts: [{ text: message }] },
      ];
      let lastText = '';
      for (const model of CHAT_MODELS) {
        try {
          const res = await ai.models.generateContent({
            model,
            contents,
            config: {
              systemInstruction: systemPrompt(matchContext || undefined),
              temperature: 0.55,
            },
          });
          if (res.text?.trim()) return res.text.trim();
          lastText = res.text || '';
        } catch (err: any) {
          if (!isRetryableGeminiError(err)) throw err;
        }
      }
      if (lastText.trim()) return lastText.trim();
      throw new Error('Chat model returned empty response');
    },
    { maxRetries: 3, metadata: { model: CHAT_MODELS[0], apiKeyIndex: 0, type: 'analysis_chat' } as any },
  );
}
