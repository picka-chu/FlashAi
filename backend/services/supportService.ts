import { GoogleGenAI } from '@google/genai';

export interface FAQ {
  id?: string;
  question: string;
  answer: string;
  category: 'general' | 'subscription' | 'referral' | 'technical';
}

const INITIAL_FAQS: FAQ[] = [
  {
    question: 'What is Flash AI?',
    answer: 'Flash AI is a Telegram Mini App that analyzes football matches with AI and returns betting insights.',
    category: 'general',
  },
  {
    question: 'How do I get more credits?',
    answer: 'You can upgrade your plan or complete tasks in the app to earn additional credits.',
    category: 'general',
  },
  {
    question: 'What are the plan differences?',
    answer: 'Free includes limited daily credits, while paid plans provide higher quotas and additional premium features.',
    category: 'subscription',
  },
  {
    question: 'How does referral work?',
    answer: 'Share your referral link. When a friend joins through it, you receive referral rewards.',
    category: 'referral',
  },
  {
    question: 'How accurate are predictions?',
    answer: 'Predictions are data-driven, but no outcome is guaranteed. Always bet responsibly.',
    category: 'technical',
  },
];

function getSupportKeys() {
  return [
    process.env.GEMINI_SUPPORT_KEY_1 || process.env.GEMINI_SUPPORT_KEY || process.env.GEMINI_AGENT_KEY_1 || process.env.GEMINI_API_KEY_4,
    process.env.GEMINI_SUPPORT_KEY_2 || process.env.GEMINI_AGENT_KEY_2 || process.env.GEMINI_API_KEY_5,
  ].filter(Boolean) as string[];
}

export async function generateSupportReply(
  message: string,
  history: { role: 'user' | 'model'; parts: string }[] = [],
  faqs: FAQ[] = INITIAL_FAQS,
) {
  const faqContext = faqs.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join('\n\n');
  const keys = getSupportKeys();
  if (keys.length === 0) throw new Error('Support AI is not configured');

  const systemInstruction = `
You are the Flash AI Support Agent for a Telegram mini app.
Use the FAQ knowledge base below first, then answer clearly and briefly.
If the issue is serious, ask the user to use the in-app "Report a Problem" feature.

FAQ:
${faqContext}
`;

  const models = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'];
  let lastError: any = null;

  for (const model of models) {
    for (const key of keys) {
      try {
        const ai = new GoogleGenAI({ apiKey: key });
        const response = await ai.models.generateContent({
          model,
          contents: [
            ...history.map((h) => ({ role: h.role, parts: [{ text: h.parts }] })),
            { role: 'user', parts: [{ text: message }] },
          ],
          config: {
            systemInstruction,
            temperature: 0.5,
          },
        });
        if (response.text) return response.text;
      } catch (error: any) {
        lastError = error;
      }
    }
  }

  console.error('Support AI fallback exhausted:', lastError?.message || lastError);
  return 'Sorry, I could not generate a response right now.';
}

export function getDefaultFaqs() {
  return INITIAL_FAQS;
}
