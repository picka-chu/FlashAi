import { GoogleGenAI } from "@google/genai";
import { 
  apiKeyManager, 
  analysisCache, 
  globalCache,
  executeWithRetry,
  isRetryableGeminiError 
} from "./apiCacheService";

const AGENT_MODELS = ["gemini-2.5-flash", "gemini-1.5-flash", "gemini-1.5-flash-8b"];
const SEARCH_MODELS = ["gemini-2.5-flash", "gemini-1.5-flash"];
const VISION_MODELS = ["gemini-2.5-flash", "gemini-1.5-flash"];

export enum AgentType {
  ANALYST = "analyst",
  MARKETING = "marketing",
  RETENTION = "retention",
}

class MultiAgentService {
  private CACHE_TTL = 60 * 60 * 1000; // 1 hour

  /**
   * Generate content with automatic key rotation and retry
   */
  private async generateWithFallback(prompt: string, opts?: { allowSearch?: boolean; json?: boolean }) {
    return executeWithRetry(async (apiKey, keyIndex) => {
      for (const model of AGENT_MODELS) {
        try {
          const ai = new GoogleGenAI({ apiKey });
          const result = await ai.models.generateContent({
            model,
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            config: {
              ...(opts?.allowSearch ? { tools: [{ googleSearch: {} }] as any } : {}),
              ...(opts?.json ? { responseMimeType: "application/json" } : {}),
            },
          });
          return result;
        } catch (error: any) {
          if (!isRetryableGeminiError(error)) {
            throw error;
          }
          // Continue to next model
        }
      }
      throw new Error("All models failed");
    }, {
      maxRetries: 3
    });
  }

  async generateMarketingMessage(topPicks: any[]) {
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

    const result = await this.generateWithFallback(prompt);
    return result.text;
  }

  async generateRetentionMessage(userData: { name: string, lastActive: string, favoriteLeagues: string[] }) {
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

    const result = await this.generateWithFallback(prompt);
    return result.text;
  }

  async fetchContextData(matchName: string) {
    const cacheKey = analysisCache.generateKey('context', { matchName });
    
    return executeWithRetry(async (apiKey, keyIndex) => {
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

      const result = await this.generateWithFallback(prompt, { allowSearch: true });
      const text = result.text;
      
      if (!text) throw new Error("Empty response");
      
      let data;
      if (typeof text === 'object') {
        data = text;
      } else {
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start === -1 || end === -1 || end <= start) {
          throw new Error("Invalid JSON response from AI");
        }
        try {
          data = JSON.parse(text.substring(start, end + 1));
        } catch (parseError) {
          console.error("JSON parse error:", parseError);
          throw new Error("Failed to parse AI response");
        }
      }

      return data;
    }, {
      cache: analysisCache,
      cacheKey,
      metadata: { type: 'context' }
    }).catch(() => ({
      home_missing: 0,
      away_missing: 0,
      home_motivation: 'MEDIUM',
      away_motivation: 'MEDIUM',
      home_fatigue: false,
      away_fatigue: false,
      reasoning: "Limited real-time data available."
    }));
  }

  async analyzeMatch(matchData: any) {
    const cacheKey = analysisCache.generateKey('analysis', { matchData });

    return executeWithRetry(async (apiKey, keyIndex) => {
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

      const result = await this.generateWithFallback(prompt, { json: true });
      const text = result.text;
      
      if (!text) throw new Error("Empty response from Gemini");
      
      let data;
      if (typeof text === 'object') {
        data = text;
      } else {
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start === -1 || end === -1 || end <= start) {
          throw new Error("Invalid JSON response from AI");
        }
        try {
          data = JSON.parse(text.substring(start, end + 1));
        } catch (parseError) {
          console.error("JSON parse error:", parseError);
          throw new Error("Failed to parse AI response");
        }
      }

      return data;
    }, {
      cache: analysisCache,
      cacheKey,
      metadata: { type: 'match_analysis' }
    }).catch(() => ({ reasoning: "Analysis currently unavailable.", confidence: 50, best_value_market: "N/A" }));
  }

  async fetchMatchDataFallback(matchName: string) {
    const cacheKey = analysisCache.generateKey('fallback', { matchName });

    return executeWithRetry(async (apiKey, keyIndex) => {
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

      const result = await this.generateWithFallback(prompt, { allowSearch: true });
      const text = result.text;
      
      if (!text) throw new Error("Empty response");
      
      let data;
      if (typeof text === 'object') {
        data = text;
      } else {
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start === -1 || end === -1 || end <= start) {
          throw new Error("Invalid JSON response from AI");
        }
        try {
          data = JSON.parse(text.substring(start, end + 1));
        } catch (parseError) {
          console.error("JSON parse error:", parseError);
          throw new Error("Failed to parse AI response");
        }
      }

      return data;
    }, {
      cache: analysisCache,
      cacheKey,
      metadata: { type: 'match_data' }
    });
  }

  async getTopFixturesFromSearch(): Promise<string[]> {
    const today = new Date().toISOString().split('T')[0];
    const cacheKey = globalCache.generateKey('top_fixtures', { date: today });

    const prompt = `
      Find today's (${today}) most featured and top football matches/fixtures globally.
      Focus on major leagues like Champions League, Premier League, La Liga, etc.
      Return ONLY a JSON array of match names in "Home vs Away" format, ordered by importance/hype.
      Example: ["Real Madrid vs Manchester City", "Arsenal vs Bayern Munich"]
    `;

    return executeWithRetry(async (apiKey) => {
      let result: any = null;
      let lastError: any = null;

      for (const model of SEARCH_MODELS) {
        try {
          const ai = new GoogleGenAI({ apiKey });
          result = await ai.models.generateContent({
            model,
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            config: {
              tools: [{ googleSearch: {} }] as any
            }
          });
          break;
        } catch (error: any) {
          lastError = error;
          if (!isRetryableGeminiError(error)) {
            throw error;
          }
        }
      }

      if (!result) {
        throw lastError || new Error("All search fallback models failed");
      }

      const text = result.text;
      if (!text) return [];
      
      let data;
      if (typeof text === 'object') {
        data = text;
      } else {
        const start = text.indexOf('[');
        const end = text.lastIndexOf(']');
        if (start !== -1 && end !== -1 && end > start) {
          try {
            data = JSON.parse(text.substring(start, end + 1));
          } catch (parseError) {
            console.error("JSON parse error in top fixtures:", parseError);
            data = [];
          }
        } else {
          data = [];
        }
      }

      return data || [];
    }, {
      cache: globalCache,
      cacheKey,
      customTtl: 30 * 60 * 1000, // 30 minutes
      maxRetries: 2
    }).catch(() => []);
  }

  async analyzeBetSlip(images: string[]) {
    return executeWithRetry(async (apiKey) => {
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

      const imageParts = images.map((dataUri) => {
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

      let result: any = null;
      let lastError: any = null;
      for (const model of VISION_MODELS) {
        try {
          const ai = new GoogleGenAI({ apiKey });
          result = await ai.models.generateContent({
            model,
            contents: [{
              role: "user",
              parts: [
                { text: prompt },
                ...(imageParts as any)
              ]
            }],
            config: {
              responseMimeType: "application/json"
            }
          });
          break;
        } catch (error: any) {
          lastError = error;
          if (!isRetryableGeminiError(error)) {
            throw error;
          }
        }
      }

      if (!result) throw lastError || new Error("All betslip fallback models failed");

      const text = result.text;
      if (!text) throw new Error("Empty response");
      
      let data;
      if (typeof text === 'object') {
        data = text;
      } else {
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start === -1 || end === -1 || end <= start) {
          throw new Error("Invalid JSON response from AI");
        }
        try {
          data = JSON.parse(text.substring(start, end + 1));
        } catch (parseError) {
          console.error("JSON parse error in betslip analysis:", parseError);
          throw new Error("Failed to parse AI response");
        }
      }

      return data;
    }, {
      maxRetries: 2
    }).catch((error) => {
      console.error("Bet slip analysis failed:", error);
      throw error;
    });
  }

  async getMatchAnalysis(matchId: string) {
    return executeWithRetry(async (apiKey, keyIndex) => {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `Analyze match ${matchId} and provide prediction`;
      
      const result = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: prompt }] }]
      });

      return result.text;
    }, {
      maxRetries: 2
    }).catch((error) => {
      console.error("Match analysis failed:", error);
      throw error;
    });
  }
}

export const multiAgentService = new MultiAgentService();
