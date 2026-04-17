import { GoogleGenAI } from "@google/genai";

// Initialize multiple Gemini API keys
const keys = [
  process.env.GEMINI_API_KEY_1,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
  process.env.GEMINI_API_KEY_4,
  process.env.GEMINI_API_KEY_5,
].filter(Boolean) as string[];

// Fallback to default if no numbered keys are provided
if (keys.length === 0 && process.env.GEMINI_API_KEY) {
  keys.push(process.env.GEMINI_API_KEY);
}

/**
 * Agent Types:
 * 1 & 2: Analysts (Gemini 1.5 Pro)
 * 3: Marketing Agent
 * 4: Retention Agent
 * 5: General Utility
 */

export enum AgentType {
  ANALYST = "analyst",
  MARKETING = "marketing",
  RETENTION = "retention",
}

class MultiAgentService {
  private instances: GoogleGenAI[] = [];
  private currentIndex = 0;
  private CACHE_TTL = 60 * 60 * 1000; // 1 hour

  constructor() {
    this.instances = keys.map(key => new GoogleGenAI({ apiKey: key }));
  }

  /**
   * Rotates through all available keys to spread the load
   */
  private getNextInstance() {
    if (this.instances.length < 1) throw new Error("No Gemini API keys configured");
    const instance = this.instances[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.instances.length;
    return instance;
  }

  private getCache(key: string) {
    try {
      const cached = localStorage.getItem(`flash_ai_${key}`);
      if (cached) {
        const { data, timestamp } = JSON.parse(cached);
        if (Date.now() - timestamp < this.CACHE_TTL) {
          return data;
        }
      }
    } catch (e) {
      console.warn("Cache read error:", e);
    }
    return null;
  }

  private setCache(key: string, data: any) {
    try {
      localStorage.setItem(`flash_ai_${key}`, JSON.stringify({
        data,
        timestamp: Date.now()
      }));
    } catch (e) {
      console.warn("Cache write error:", e);
    }
  }

  async generateMarketingMessage(topPicks: any[]) {
    const ai = this.getNextInstance();
    const prompt = `
      You are a high-end Football Marketing Agent for "Flash AI".
      Your goal is to create an engaging Telegram message for our users about today's top picks.
      
      Top Picks Data: ${JSON.stringify(topPicks)}
      
      Tone: Professional, Elite, Urgent, High-stakes.
      Style: Use emojis, bold text, and clear calls to action.
      
      Requirements:
      - Mention the total odds.
      - Highlight the "Lock of the Day".
      - Create FOMO (Fear Of Missing Out).
      - Keep it under 1000 characters.
      
      Return ONLY the message text.
    `;

    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    return result.text;
  }

  async generateRetentionMessage(userData: { name: string, lastActive: string, favoriteLeagues: string[] }) {
    const ai = this.getNextInstance();
    const prompt = `
      You are a Retention Specialist for a Football Prediction App.
      Your job is to get an inactive user back to the app.
      
      User Data:
      - Name: ${userData.name}
      - Last Active: ${userData.lastActive}
      - Interests: ${userData.favoriteLeagues.join(", ")}
      
      Requirements:
      - Personalized feeling.
      - Curiosity-driven (e.g., "The algorithm found something in ${userData.favoriteLeagues[0] || 'the Champions League'}...").
      - Short and punchy.
      - No corporate jargon.
      
      Return ONLY the message text.
    `;

    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    return result.text;
  }

  async fetchContextData(matchName: string) {
    const cacheKey = `context_${matchName.toLowerCase().replace(/\s+/g, '_')}`;
    const cached = this.getCache(cacheKey);
    if (cached) return cached;

    const ai = this.getNextInstance();
    const prompt = `
      You are a world-class football data analyst and betting expert. 
      Extract the following information for the match: ${matchName}.
      Use Google Search to find real-time data about:
      1. Injuries and Suspensions (key players missing).
      2. Team Motivation (relegation battle, title race, cup final, etc.).
      3. Recent Fatigue (travel, fixture congestion).
      4. Current Weather conditions if relevant.
      
      Return ONLY a JSON object with this structure:
      {
        "home_missing": number,
        "away_missing": number,
        "home_motivation": "HIGH" | "MEDIUM" | "LOW",
        "away_motivation": "HIGH" | "MEDIUM" | "LOW",
        "home_fatigue": boolean,
        "away_fatigue": boolean,
        "reasoning": "A professional, data-driven summary of how these factors influence the match."
      }
    `;

    try {
      const result = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: { 
          tools: [{ googleSearch: {} }] as any
        }
      });

      const text = result.text;
      if (!text) throw new Error("Empty response");
      
      let data;
      if (typeof text === 'object') {
        data = text;
      } else {
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        data = JSON.parse(text.substring(start, end + 1));
      }

      this.setCache(cacheKey, data);
      return data;
    } catch (error) {
      console.error("Context fetch error:", error);
      return {
        home_missing: 0,
        away_missing: 0,
        home_motivation: 'MEDIUM',
        away_motivation: 'MEDIUM',
        home_fatigue: false,
        away_fatigue: false,
        reasoning: "Limited real-time data available."
      };
    }
  }

  async analyzeMatch(matchData: any) {
    const cacheKey = `analysis_${matchData.match.toLowerCase().replace(/\s+/g, '_')}`;
    const cached = this.getCache(cacheKey);
    if (cached) return cached;

    const ai = this.getNextInstance();
    // Use 2.0 Pro for deep analysis if available, otherwise fallback to 2.0 Flash
    const model = keys.length >= 2 ? "gemini-2.0-pro-exp-02-05" : "gemini-2.0-flash";
    
    const prompt = `
      You are a professional betting syndicate analyst. 
      Analyze this match data and provide a high-accuracy prediction:
      ${JSON.stringify(matchData)}
      
      Consider:
      - xG (Expected Goals) trends.
      - Tactical matchups.
      - Market value vs. actual probability.
      - Deep context (injuries, standings, recent news) if provided in the data.
      
      Provide deep reasoning, a confidence score (0-100), and the best value market (e.g., "Home Win", "Over 2.5 Goals", "BTTS - Yes").
      
      Return ONLY a JSON object:
      {
        "reasoning": "Detailed technical analysis...",
        "confidence": number,
        "best_value_market": "string"
      }
    `;

    try {
      const result = await ai.models.generateContent({
        model: model,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: { responseMimeType: "application/json" }
      });

      const text = result.text;
      if (!text) throw new Error("Empty response from Gemini");
      
      let data;
      if (typeof text === 'object') {
        data = text;
      } else {
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        data = JSON.parse(text.substring(start, end + 1));
      }

      this.setCache(cacheKey, data);
      return data;
    } catch (error) {
      console.error("MultiAgent analysis error:", error);
      return { reasoning: "Analysis currently unavailable.", confidence: 50, best_value_market: "N/A" };
    }
  }

  async fetchMatchDataFallback(matchName: string) {
    const cacheKey = `fallback_${matchName.toLowerCase().replace(/\s+/g, '_')}`;
    const cached = this.getCache(cacheKey);
    if (cached) return cached;

    const ai = this.getNextInstance();
    const prompt = `
      You are a professional football data scout. 
      Fetch the latest data and odds for the match: ${matchName}.
      Use Google Search to find:
      1. Recent 5 match results for both teams.
      2. Season stats (played, goals scored/conceded).
      3. Current real-world bookmaker odds (Home, Draw, Away, Over/Under 2.5, BTTS).
      
      Return ONLY a JSON object with this structure:
      {
        "id": "fallback",
        "home": {
          "id": 0,
          "name": "Home Team Name",
          "last5": {
            "goalsScored": number,
            "goalsConceded": number,
            "results": ["W", "D", "L", "W", "W"]
          },
          "season": {
            "played": number,
            "goalsScored": number,
            "goalsConceded": number
          }
        },
        "away": {
          "id": 0,
          "name": "Away Team Name",
          "last5": {
            "goalsScored": number,
            "goalsConceded": number,
            "results": ["W", "D", "L", "W", "W"]
          },
          "season": {
            "played": number,
            "goalsScored": number,
            "goalsConceded": number
          }
        },
        "leagueAvgGoals": number,
        "odds": {
          "home": number,
          "draw": number,
          "away": number,
          "over25": number,
          "under25": number,
          "bttsYes": number,
          "dc1X": number,
          "dcX2": number
        }
      }
    `;

    try {
      const result = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: { 
          tools: [{ googleSearch: {} }] as any
        }
      });

      const text = result.text;
      if (!text) throw new Error("Empty response");
      
      let data;
      if (typeof text === 'object') {
        data = text;
      } else {
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        data = JSON.parse(text.substring(start, end + 1));
      }

      this.setCache(cacheKey, data);
      return data;
    } catch (error) {
      console.error("Match data fallback error:", error);
      throw error;
    }
  }

  async getTopFixturesFromSearch(): Promise<string[]> {
    const today = new Date().toISOString().split('T')[0];
    const cacheKey = `top_fixtures_${today}`;
    const cached = this.getCache(cacheKey);
    if (cached) return cached;

    const ai = this.getNextInstance();
    const prompt = `
      Find today's (${today}) most featured and top football matches/fixtures globally.
      Focus on major leagues like Champions League, Premier League, La Liga, etc.
      Return ONLY a JSON array of match names in "Home vs Away" format, ordered by importance/hype.
      Example: ["Real Madrid vs Manchester City", "Arsenal vs Bayern Munich"]
    `;

    try {
      const result = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: { 
          tools: [{ googleSearch: {} }] as any
        }
      });

      const text = result.text;
      if (!text) return [];
      
      let data;
      if (typeof text === 'object') {
        data = text;
      } else {
        const start = text.indexOf('[');
        const end = text.lastIndexOf(']');
        if (start !== -1 && end !== -1) {
          data = JSON.parse(text.substring(start, end + 1));
        } else {
          data = [];
        }
      }

      if (Array.isArray(data) && data.length > 0) {
        this.setCache(cacheKey, data);
      }
      return data || [];
    } catch (error: any) {
      if (error?.status === 429 || error?.message?.includes('429') || error?.message?.includes('RESOURCE_EXHAUSTED')) {
        console.warn("Gemini Search Rate Limit Hit - using empty fallback");
        return [];
      }
      console.error("Error getting top fixtures from search:", error);
      return [];
    }
  }

  async analyzeBetSlip(images: string[]) {
    const ai = this.getNextInstance();
    const prompt = `
      You are an expert sports betting analyst. 
      Analyze the provided bet slip image(s). 
      Extract the matches, predictions, and odds.
      For each match, provide a confidence score (0-100), risk level, and a brief professional reasoning based on current football knowledge.
      Calculate the total odds if not present.
      Provide an overall verdict and a suggested stake level (e.g., 1/10, 5/10).
      
      CRITICAL: Suggest 1-2 "Safe Picks" which MUST be high-probability alternative markets (e.g., Double Chance, Over 1.5, etc.) for the EXACT SAME matches found in the uploaded bet slip. Do NOT suggest matches that are not in the slip.

      Return ONLY a JSON object with this structure:
      {
        "items": [
          {
            "match": "Team A vs Team B",
            "prediction": "Home Win",
            "odds": 1.85,
            "confidence": 85,
            "riskLevel": "LOW" | "MEDIUM" | "HIGH",
            "reasoning": "..."
          }
        ],
        "totalOdds": 5.42,
        "overallRisk": "LOW" | "MEDIUM" | "HIGH",
        "verdict": "...",
        "suggestedStake": "3/10",
        "safePicks": [
          {
            "match": "Team A vs Team B",
            "pick": "Home or Draw",
            "odds": 1.25,
            "reason": "Safer alternative to the Home Win prediction on the slip."
          }
        ]
      }
    `;

    try {
      // Convert base64 data URIs to inlineData objects
      const imageParts = images.map((dataUri) => {
        // data:image/jpeg;base64,...
        const matches = dataUri.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
        if (!matches || matches.length !== 3) {
           throw new Error("Invalid image format provided.");
        }
        return {
          inlineData: {
            mimeType: matches[1],
            data: matches[2]
          }
        };
      });

      const result = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ 
          role: "user", 
          parts: [
            { text: prompt },
            ...imageParts as any
          ] 
        }],
        config: { 
          responseMimeType: "application/json"
        }
      });

      const text = result.text;
      if (!text) throw new Error("Empty response");
      
      let data;
      if (typeof text === 'object') {
        data = text;
      } else {
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        data = JSON.parse(text.substring(start, end + 1));
      }

      return data;
    } catch (error) {
      console.error("Bet slip analysis error:", error);
      throw error;
    }
  }
}

export const multiAgentService = new MultiAgentService();
