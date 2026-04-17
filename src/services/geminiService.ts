import { GoogleGenAI } from "@google/genai";
import { ContextData, BetSlipAnalysis, MatchData, PredictionResult } from "../types/prediction";

import { multiAgentService } from "./multiAgentService";

function getPredictionKeys() {
  const predictionKeys = [
    process.env.GEMINI_PREDICTION_KEY_1 || process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_PREDICTION_KEY_2 || process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_PREDICTION_KEY_3 || process.env.GEMINI_API_KEY_3,
  ].filter(Boolean) as string[];

  if (predictionKeys.length === 0) {
    return [
      process.env.GEMINI_API_KEY_1,
      process.env.GEMINI_API_KEY_2,
      process.env.GEMINI_API_KEY_3,
      process.env.GEMINI_API_KEY,
    ].filter(Boolean) as string[];
  }

  return predictionKeys;
}

export async function analyzeMatchWithSearch(matchString: string): Promise<PredictionResult> {
  const keys = getPredictionKeys();
  const candidateKeys = keys.length > 0 ? keys : [process.env.GEMINI_API_KEY || ""];

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
        "home": {
          "name": "string",
          "form": "string (e.g., WWDWL)",
          "injuries": ["string"],
          "keyStats": ["string"]
        },
        "away": {
          "name": "string",
          "form": "string",
          "injuries": ["string"],
          "keyStats": ["string"]
        }
      }
    }
  `;

  const models = ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"];

  for (const model of models) {
    for (const key of candidateKeys) {
      try {
        const ai = new GoogleGenAI({ apiKey: key });
        const result = await ai.models.generateContent({
          model,
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          config: { 
            tools: [{ googleSearch: {} }] as any
          }
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
        const msg = String(error?.message || "");
        const isQuota = error?.status === 429 || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("quota");
        if (!isQuota) {
          console.error(`analyzeMatchWithSearch error (${model}):`, error);
          throw error;
        }
      }
    }
  }

  throw new Error("All Gemini prediction keys/models are temporarily rate-limited. Please retry shortly.");
}

export async function fetchContextData(matchName: string): Promise<ContextData> {
  return multiAgentService.fetchContextData(matchName);
}

export async function fetchMatchDataFallback(matchName: string): Promise<MatchData> {
  return multiAgentService.fetchMatchDataFallback(matchName);
}

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

export async function fetchMatchH2H(home: string, away: string): Promise<any> {
  const keys = getPredictionKeys();
  const ai = new GoogleGenAI({ apiKey: keys[Math.floor(Math.random() * keys.length)] || process.env.GEMINI_API_KEY || "" });

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

  try {
    const result = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });
    return parseJsonFromText(result.text);
  } catch (error) {
    console.error("H2H fetch error:", error);
    return null;
  }
}

export async function fetchLiveMatchesFallback(): Promise<any[]> {
  const keys = getPredictionKeys();
  const ai = new GoogleGenAI({ apiKey: keys[Math.floor(Math.random() * keys.length)] || process.env.GEMINI_API_KEY || "" });

  const prompt = `
    You are a real-time football score reporter. 
    Find the major live football matches happening right now (or recently finished today).
    Use Google Search to find real-time scores for top leagues (Premier League, La Liga, Champions League, etc.).
    
    Return ONLY a JSON array of objects with this structure:
    [
      {
        "fixture": {
          "id": "gemini_live_1",
          "date": "2026-04-14T...",
          "status": { "short": "LIVE", "elapsed": 75 }
        },
        "teams": {
          "home": { "name": "Team A", "id": 0 },
          "away": { "name": "Team B", "id": 0 }
        },
        "goals": { "home": 2, "away": 1 },
        "league": { "name": "Premier League" }
      }
    ]
  `;

  try {
    const result = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { 
        tools: [{ googleSearch: {} }] as any
      }
    });

    const text = result.text;
    if (!text) return [];
    return parseJsonFromText(text);
  } catch (error: any) {
    if (error?.status === 429 || error?.message?.includes('429') || error?.message?.includes('RESOURCE_EXHAUSTED')) {
      // Silently return empty array on rate limit
      return [];
    }
    console.error("Error fetching live matches fallback:", error);
    return [];
  }
}

export async function getTopFixturesFromSearch(): Promise<string[]> {
  return multiAgentService.getTopFixturesFromSearch();
}

export async function analyzeBetSlip(images: string[]): Promise<BetSlipAnalysis> {
  return multiAgentService.analyzeBetSlip(images);
}
