import { supabase } from './supabase';

export interface FAQ {
  id?: string;
  question: string;
  answer: string;
  category: 'general' | 'subscription' | 'referral' | 'technical';
}

export const INITIAL_FAQS: FAQ[] = [
  {
    question: 'What is Flash AI?',
    answer: 'Flash AI is a powerful Telegram Mini App that uses advanced artificial intelligence to analyze football matches and provide high-accuracy betting predictions and insights.',
    category: 'general',
  },
  {
    question: 'How do I get more credits?',
    answer: "You can get more credits by upgrading to a paid pass (Day Pass, 7-Day Pass, 30-Day Basic, or 30-Day Pro), or by completing tasks in the 'Referral and Earn' section. Passes are not auto-renewing subscriptions - nothing is charged automatically.",
    category: 'general',
  },
  {
    question: 'What are the differences between the plans?',
    answer: 'Free gives 1 analysis per day forever. Day Pass gives 2 analyses for one match day. 7-Day Pass gives 2 analyses per day for 7 days. 30-Day Basic gives 2 analyses per day for 30 days with Flash AI Lite. 30-Day Pro gives 4 analyses per day for 30 days with Flash AI Pro, bundles, and top-pick accumulators. All paid passes are fixed-price in your local currency and expire at the end of the period.',
    category: 'subscription',
  },
  {
    question: 'How does the Referral system work?',
    answer: "Share your unique referral link with friends. When they join Flash AI, you receive referral bonus credits. You can track your referrals in the 'Referral and Earn' section.",
    category: 'referral',
  },
];

export const supportService = {
  async getFAQs(): Promise<FAQ[]> {
    try {
      if (!supabase) return INITIAL_FAQS;

      const { data, error } = await supabase.from('faqs').select('*');
      if (error) throw error;
      if (!data || data.length === 0) return INITIAL_FAQS;
      return data;
    } catch (error) {
      console.error('Error fetching FAQs:', error);
      return INITIAL_FAQS;
    }
  },

  async chatWithSupport(message: string, history: { role: 'user' | 'model'; parts: string }[] = []) {
    const faqs = await this.getFAQs();
    const initData = (window as any)?.Telegram?.WebApp?.initData || '';

    const response = await fetch('/api/support/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(initData ? { 'X-TG-Init-Data': initData } : {}),
      },
      body: JSON.stringify({ message, history, faqs }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload?.error || 'Failed to get support response');
    }

    const data = await response.json();
    return data.reply as string;
  },
};
