import { GoogleGenAI } from "@google/genai";
import { ContextData, BetSlipAnalysis, MatchData, PredictionResult } from "../types/prediction";
import { multiAgentService } from "./multiAgentService";
import { 
  apiKeyManager, 
  analysisCache, 
  predictionCache, 
  executeWithRetry,
  isRetryableGeminiError,
  createGeminiClient 
} from "./apiCacheService";

const PREDICTION_MODELS = [
  "gemini-2.0-flash",
];

function parseJsonFromText(text: string) {
  try {
    if (typeof text === 'object') return text;
    const start = text.indexOf('{');
    const startBracket = text.indexOf('[');
    let s = -1;
    let e = -1;
    if (start !== -1 && (startBracket === -1 || start < startBracket)) {
      s = start;
      e = text.lastIndexOf('}');
    } else if (startBracket !== -1) {
      s = startBracket;
      e = text.lastIndexOf(']');
    }
    if (s !== -1 && e !== -1) {
      return JSON.parse(text.substring(s, e + 1));
    }
    return JSON.parse(text.replace(/```json\n?|```/g, "").trim());
  } catch (e) {
    console.error("Parse error:", text);
    return null;
  }
}

/**
 * BACKEND ONLY: Performs deep match analysis using Gemini with Search.
 */
export async function analyzeMatchWithSearch(matchString: string): Promise<PredictionResult> {
  const cacheKey = predictionCache.generateKey('match_analysis', { matchString });
  
  return executeWithRetry(async (apiKey, keyIndex) => {
    for (const model of PREDICTION_MODELS) {
      try {
        const ai = new GoogleGenAI({ apiKey });
        const prompt = `
          You are an expert sports betting analyst.
          Use Google Search to find the latest news, form, injuries, and betting odds for the upcoming match: ${matchString}.
          Based on your search, generate exactly 10 different betting predictions (e.g., Match Winner, Over/Under Goals, BTTS, Player to Score, Corners, etc.).
          Evaluate the confidence of each prediction from 0 to 100.
          
          Return the response ONLY as a valid JSON object with the following structure:
          {
            "predictions": [
              { "market": "string", "confidence": number, "reasoning": "string" }
            ],
            "overallReasoning": "string (detailed overall match analysis)",
            "teamData": {
              "home": { "name": "string", "form": "string", "injuries": ["string"], "keyStats": ["string"] },
              "away": { "name": "string", "form": "string", "injuries": ["string"], "keyStats": ["string"] }
            }
          }
        `;

        const result = await ai.models.generateContent({
          model,
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          config: { tools: [{ googleSearch: {} }] as any }
        });

        const parsed = parseJsonFromText(result.text || "");
        if (!parsed || !parsed.predictions) throw new Error("Failed to parse prediction data");

        const topPredictions = parsed.predictions
          .sort((a: any, b: any) => b.confidence - a.confidence)
          .slice(0, 2);

        return {
          matchId: matchString,
          predictions: topPredictions,
          overallReasoning: parsed.overallReasoning || "No reasoning provided.",
          teamData: parsed.teamData || {
            home: { name: matchString.split('vs')[0]?.trim() || 'Home', form: 'N/A', injuries: [], keyStats: [] },
            away: { name: matchString.split('vs')[1]?.trim() || 'Away', form: 'N/A', injuries: [], keyStats: [] }
          }
        };
      } catch (error: any) {
        if (!isRetryableGeminiError(error)) throw error;
      }
    }
    throw new Error("All models failed");
  }, {
    cache: predictionCache,
    cacheKey,
    metadata: { model: PREDICTION_MODELS[0] }
  });
}

export async function fetchContextData(matchName: string): Promise<ContextData> {
  return multiAgentService.fetchContextData(matchName);
}

export async function fetchMatchDataFallback(matchName: string): Promise<MatchData> {
  return multiAgentService.fetchMatchDataFallback(matchName);
}

/**
 * FRONTEND SECURE: Fetches H2H data via backend proxy to avoid exposing API keys.
 */
export async function fetchMatchH2H(home: string, away: string): Promise<any> {
  // If running in browser, use backend proxy
  if (typeof window !== 'undefined') {
    try {
      const response = await fetch(`/api/football/h2h?home=${encodeURIComponent(home)}&away=${encodeURIComponent(away)}`);
      if (!response.ok) throw new Error('Backend H2H fetch failed');
      return await response.json();
    } catch (e) {
      console.error("Frontend H2H fetch error:", e);
      return null;
    }
  }

  // BACKEND ONLY: Direct Gemini call
  const cacheKey = predictionCache.generateKey('h2h', { home, away });
  return executeWithRetry(async (apiKey, keyIndex) => {
    const ai = new GoogleGenAI({ apiKey });
    const prompt = `
      Provide head-to-head statistics for the football match: ${home} vs ${away}.
      Include the last 5 results (W/D/L for ${home}), average goals, and a hype score (1-100).
      Return ONLY a JSON object:
      {
        "last5": ["W", "D", "L", "W", "W"],
        "summary": "3W - 1D - 1L",
        "avgGoals": 2.4,
        "hypeScore": 85,
        "hypeLevel": "EXTREME",
        "watchingCount": 8400
      }
    `;
    const result = await ai.models.generateContent({
      model: "gemini-1.5-pro",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });
    return parseJsonFromText(result.text);
  }, {
    cache: predictionCache,
    cacheKey,
    maxRetries: 2
  });
}

/**
 * BACKEND ONLY: Fetches live matches using Gemini Search.
 */
export async function fetchLiveMatchesFallback(): Promise<any[]> {
  const cacheKey = predictionCache.generateKey('live_matches', { date: new Date().toDateString() });
  
  return executeWithRetry(async (apiKey, keyIndex) => {
    const ai = new GoogleGenAI({ apiKey });
    const prompt = `
      You are a real-time football score reporter. 
      Find the major live football matches happening right now (or recently finished today).
      Use Google Search to find real-time scores for top leagues (Premier League, La Liga, Champions League, etc.).
      
      Return ONLY a JSON array of objects with this structure:
      [
        {
          "fixture": { "id": "gemini_live_1", "date": "2026-04-14T...", "status": { "short": "LIVE", "elapsed": 75 } },
          "teams": { "home": { "name": "Team A", "id": 0 }, "away": { "name": "Team B", "id": 0 } },
          "goals": { "home": 2, "away": 1 },
          "league": { "name": "Premier League" }
        }
      ]
    `;

    const result = await ai.models.generateContent({
      model: "gemini-1.5-pro",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { tools: [{ googleSearch: {} }] as any }
    });

    return parseJsonFromText(result.text || "") || [];
  }, {
    cache: predictionCache,
    cacheKey,
    customTtl: 5 * 60 * 1000,
    maxRetries: 2
  }).catch(() => []);
}

export async function getTopFixturesFromSearch(): Promise<string[]> {
  return multiAgentService.getTopFixturesFromSearch();
}

export async function analyzeBetSlip(images: string[]): Promise<BetSlipAnalysis> {
  return multiAgentService.analyzeBetSlip(images);
}
