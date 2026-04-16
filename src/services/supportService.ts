import { GoogleGenAI } from "@google/genai";
import { supabase } from "./supabase";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

export interface FAQ {
  id?: string;
  question: string;
  answer: string;
  category: 'general' | 'subscription' | 'referral' | 'technical';
}

export const INITIAL_FAQS: FAQ[] = [
  {
    question: "What is Flash AI?",
    answer: "Flash AI is a powerful Telegram Mini App that uses advanced artificial intelligence to analyze football matches and provide high-accuracy betting predictions and insights.",
    category: 'general'
  },
  {
    question: "How do I get more credits?",
    answer: "You can get more credits by upgrading to a Weekly or Monthly plan, or by completing tasks in the 'Referral and Earn' section. You also get a daily bonus if you claim it!",
    category: 'general'
  },
  {
    question: "What are the differences between the plans?",
    answer: "Free plan gives 5 daily credits and 1 analysis. Weekly ($3.99) gives 35 daily credits and 3 analyses. Monthly ($11.99) gives 120 daily credits, 10 analyses, and unlimited AI chat with deep data gathering.",
    category: 'subscription'
  },
  {
    question: "How does the Referral system work?",
    answer: "Share your unique referral link with friends. When they join Flash AI, you instantly receive 50 bonus credits. You can track your referrals in the 'Referral and Earn' section.",
    category: 'referral'
  },
  {
    question: "How accurate are the predictions?",
    answer: "Our AI analyzes thousands of data points including team form, player stats, historical data, and real-time news. While no prediction is 100% guaranteed, our users report a high win rate (avg. 84%).",
    category: 'technical'
  },
  {
    question: "I didn't receive my referral points, what should I do?",
    answer: "Referral points are usually credited instantly. If you haven't received them, please ensure your friend joined using your link. If the issue persists, use the 'Report a Problem' feature in Support.",
    category: 'referral'
  },
  {
    question: "How do I use the 'Analyze' feature?",
    answer: "Go to the 'Analyze' tab, select a match or upload a bet slip image. Our AI will process the data and provide a detailed breakdown, including win probability and key insights.",
    category: 'technical'
  }
];

export const supportService = {
  async getFAQs(): Promise<FAQ[]> {
    try {
      if (!supabase) {
        return INITIAL_FAQS;
      }
      const { data, error } = await supabase
        .from('faqs')
        .select('*');
      
      if (error) throw error;
      if (!data || data.length === 0) return INITIAL_FAQS;
      return data;
    } catch (error) {
      console.error("Error fetching FAQs:", error);
      return INITIAL_FAQS;
    }
  },

  async chatWithSupport(message: string, history: { role: 'user' | 'model', parts: string }[] = []) {
    const faqs = await this.getFAQs();
    const faqContext = faqs.map(f => `Q: ${f.question}\nA: ${f.answer}`).join('\n\n');

    const systemInstruction = `
      You are the Flash AI Support Agent. Your goal is to help users with their questions about the app.
      
      Here is the Knowledge Base (FAQs):
      ${faqContext}
      
      Guidelines:
      1. Be professional, friendly, and helpful.
      2. Use the Knowledge Base to answer questions. If the answer isn't there, try to provide a general helpful response related to the app's context.
      3. If a user wants to report a serious problem, tell them to use the "Report a Problem" button in the Support UI.
      4. Keep responses concise and suitable for a Telegram Mini App interface.
      5. The app is a Telegram Mini App for football predictions.
    `;

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          ...history.map(h => ({ role: h.role, parts: [{ text: h.parts }] })),
          { role: 'user', parts: [{ text: message }] }
        ],
        config: {
          systemInstruction,
          temperature: 0.7,
        }
      });

      return response.text;
    } catch (error) {
      console.error("Gemini Support Error:", error);
      return "I'm sorry, I'm having trouble connecting to my brain right now. Please try again in a moment or report a problem if it persists.";
    }
  }
};
