import { GoogleGenAI } from "@google/genai";
import { ContextData, BetSlipAnalysis, MatchData, PredictionResult } from "../../src/types/prediction";
import { multiAgentService } from "./multiAgentService";
import { logger } from "../utils/logger";
import { 
  apiKeyManager, 
  analysisCache, 
  predictionCache, 
  executeWithRetry,
  isRetryableGeminiError,
  createGeminiClient 
} from "./apiCacheService";

const PREDICTION_MODELS = [
  "gemini-2.5-flash-lite",
];

function parseJsonFromText(text: string) {
  const extractBalancedJson = (input: string): string | null => {
    const startCandidates = [input.indexOf('{'), input.indexOf('[')].filter((v) => v >= 0);
    if (!startCandidates.length) return null;
    const start = Math.min(...startCandidates);
    const opener = input[start];
    const closer = opener === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < input.length; i++) {
      const ch = input[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
      } else if (ch === opener) {
        depth += 1;
      } else if (ch === closer) {
        depth -= 1;
        if (depth === 0) return input.slice(start, i + 1);
      }
    }
    return null;
  };

  try {
    if (typeof text === 'object' && text !== null) return text;
    const normalized = String(text || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\uFEFF/g, '')
      .trim();
    if (!normalized) return null;

    // 1) Direct parse
    try {
      return JSON.parse(normalized);
    } catch {}

    // 2) Parse fenced markdown JSON
    const fenced = normalized.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1]?.trim();
    if (fenced) {
      try {
        return JSON.parse(fenced);
      } catch {}
    }

    // 3) Parse first balanced JSON fragment in the text
    const balanced = extractBalancedJson(normalized);
    if (balanced) {
      return JSON.parse(balanced);
    }

    return null;
  } catch (e) {
    console.error("Parse error: Could not parse JSON from text. Raw text:", text);
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
          config: {
            tools: [{ googleSearch: {} }] as any
          }
        });

        const rawText = result.text || "";
        logger.debug("Gemini response received", { preview: rawText.substring(0, 180) });
        
        const parsed = parseJsonFromText(rawText);
        logger.debug("Gemini parsed keys", parsed ? Object.keys(parsed) : ["null"]);
        
        if (!parsed) {
          throw new Error(`Failed to parse JSON from Gemini response. Raw text: ${rawText.substring(0, 200)}`);
        }
        
        if (!parsed.predictions || !Array.isArray(parsed.predictions)) {
          throw new Error(`Invalid prediction data structure. Missing 'predictions' array. Parsed keys: ${parsed ? Object.keys(parsed).join(', ') : 'none'}. Raw text: ${rawText.substring(0, 200)}`);
        }

        const topPredictions = parsed.predictions
          .sort((a: any, b: any) => b.confidence - a.confidence)
          .slice(0, 2);

        return {
          matchId: matchString,
          predictions: topPredictions,
          overallReasoning: parsed.overallReasoning || "No reasoning provided.",
          teamData: parsed.teamData || {
            home: { name: 'Home', form: 'N/A', injuries: [], keyStats: [] },
            away: { name: 'Away', form: 'N/A', injuries: [], keyStats: [] }
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
      model: "gemini-2.5-flash-lite",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json"
      }
    });
    return parseJsonFromText(result.text);
  }, {
    cache: predictionCache,
    cacheKey,
    maxRetries: 2
  });
}

/**
 * BACKEND ONLY: Fetches live matches using ESPN API (reliable real-time data).
 * Gemini is used only for analysis/reasoning, not for fetching live scores.
 */
export async function fetchLiveMatchesFallback(): Promise<any[]> {
  const cacheKey = predictionCache.generateKey('live_matches', { date: new Date().toDateString() });
  
  // Try ESPN API first for reliable real-time data
  const fetchFromESPN = async (): Promise<any[]> => {
    try {
      const axios = await import('axios');
      const today = new Date();
      const dateStr = today.toISOString().split('T')[0].replace(/-/g, '');
      const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard?dates=${dateStr}`;
      
      const response = await axios.default.get(url);
      const events = Array.isArray(response.data?.events) ? response.data.events : [];
      
      return events
        .filter((event: any) => {
          const state = event?.competitions?.[0]?.status?.type?.state;
          return state === 'in' || state === 'pre'; // Only live or upcoming
        })
        .map((event: any) => {
          const comp = event.competitions[0];
          const competitors = comp.competitors || [];
          const home = competitors.find((c: any) => c.homeAway === 'home');
          const away = competitors.find((c: any) => c.homeAway === 'away');
          const status = comp.status || {};
          
          return {
            fixture: {
              id: `espn_${event.id}_${event.league?.slug || 'soccer'}`,
              date: event.date,
              status: {
                short: status.type?.state === 'in' ? 'LIVE' : 'NS',
                elapsed: status.displayClock || 0
              }
            },
            teams: {
              home: { name: home?.team?.displayName || 'Home', id: home?.team?.id || 0 },
              away: { name: away?.team?.displayName || 'Away', id: away?.team?.id || 0 }
            },
            goals: {
              home: Number(home?.score ?? 0),
              away: Number(away?.score ?? 0)
            },
            league: { name: event.league?.name || event.league?.abbreviation || 'Unknown League' }
          };
        });
    } catch (error) {
      console.error('ESPN live matches fetch error:', error);
      return [];
    }
  };

  return executeWithRetry(async (apiKey, keyIndex) => {
    // First try ESPN for reliable data
    const espnData = await fetchFromESPN();
    if (espnData && espnData.length > 0) {
      return espnData;
    }

    // Fallback to Gemini only if ESPN returns nothing (rare case)
    const ai = new GoogleGenAI({ apiKey });
    const prompt = `
      You are a real-time football score reporter. 
      Find the major live football matches happening right now (or recently finished today).
      Use Google Search to find real-time scores for top leagues (Premier League, La Liga, Champions League, etc.).
      
      Return ONLY a JSON array of objects with this structure. Do NOT include any other text or explanation outside the JSON array.
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
      model: "gemini-2.5-flash-lite",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { tools: [{ googleSearch: {} }] as any }
    });

    const parsed = parseJsonFromText(result.text || "");
    return parsed || [];
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
