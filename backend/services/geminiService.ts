import { GoogleGenAI } from "@google/genai";
import {
  ContextData,
  BetSlipAnalysis,
  MatchData,
  PredictionResult,
  PredictionOutcome,
  MarketPick,
  MarketDataQuality,
} from "../../src/types/prediction";
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
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-1.5-pro",
  "gemini-1.5-flash",
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

function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function clampPercent(value: unknown, fallback: number | null = null): number | null {
  if (value === null || value === undefined || value === "") return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const scaled = numeric > 0 && numeric <= 1 ? numeric * 100 : numeric;
  return Math.round(Math.min(99, Math.max(1, scaled)));
}

function normalizeOdds(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 1.01 && numeric < 1000
    ? Number(numeric.toFixed(2))
    : null;
}

function normalizeEdge(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const scaled = Math.abs(numeric) <= 1 ? numeric * 100 : numeric;
  return Number(Math.max(-100, Math.min(100, scaled)).toFixed(1));
}

function normalizeDataQuality(value: unknown): MarketDataQuality {
  const normalized = String(value ?? "").toUpperCase();
  if (normalized === "STRONG" || normalized === "HIGH") return "STRONG";
  if (normalized === "LIMITED" || normalized === "LOW" || normalized === "WEAK") return "LIMITED";
  return "MODERATE";
}

function normalizeMarketPick(raw: any): MarketPick | null {
  if (!raw || typeof raw !== "object") return null;
  const market = cleanText(raw.market || raw.selection || raw.pick, 120);
  if (!market) return null;

  return {
    market,
    confidence: clampPercent(raw.confidence, 50) ?? 50,
    probability: clampPercent(raw.probability ?? raw.modelProbability, null),
    odds: normalizeOdds(raw.odds),
    edge: normalizeEdge(raw.edge ?? raw.value),
    dataQuality: normalizeDataQuality(raw.dataQuality),
    reasoning:
      cleanText(raw.reasoning || raw.reason, 700) ||
      "Model lean based on the available match data.",
  };
}

function toPredictionOutcome(
  pick: MarketPick,
  type: PredictionOutcome["type"],
): PredictionOutcome {
  return {
    market: pick.market,
    confidence: pick.confidence,
    reasoning: pick.reasoning,
    type,
    probability: pick.probability,
    odds: pick.odds,
    edge: pick.edge,
    dataQuality: pick.dataQuality,
  };
}

/**
 * BACKEND ONLY: Performs deep match analysis using Gemini with Search.
 */
export async function analyzeMatchWithSearch(matchString: string, structuredContext?: string): Promise<PredictionResult> {
  const cacheKey = predictionCache.generateKey('match_analysis_v3', { matchString, structuredContext: structuredContext || null });
  
  return executeWithRetry(async (apiKey, keyIndex) => {
    for (const model of PREDICTION_MODELS) {
      try {
        const ai = new GoogleGenAI({ apiKey });
        const today = new Date().toISOString().split('T')[0];
        const structuredDataPrompt = structuredContext
          ? `\n\nPRIMARY DATA SOURCE (use this first — it contains live BSD API + statistical model data):\n${structuredContext}\n\nOnly use Google Search to SUPPLEMENT missing fields, verify news, or find current odds.`
          : '';
        const prompt = `
You are a senior quantitative analyst at a professional football betting syndicate.
Today: ${today}. Target match: **${matchString}**
${structuredDataPrompt}

PHASE 1 — INTELLIGENCE GATHERING (use Google Search)
Search for ALL of the following:
1. "${matchString} injuries suspensions team news ${today}"
2. "${matchString} form standings league table"
3. "${matchString} odds betting tips referee corners cards prediction"
4. "${matchString} head to head h2h history player props lineups"

PHASE 2 — ANALYSE EVERY MARKET, OUTPUT ONLY THE BEST 4 PICKS
Review the FULL market list internally, but return ONLY the 4 strongest verified selections:
- Match Result: 1X2 and Double Chance
- Total Goals: Over/Under 1.5, 2.5, 3.5 and correct score
- Both Teams to Score: Yes/No
- Half-Time: 1st-half and 2nd-half markets
- Cards: total cards line and which team receives more cards
- Corners: total corners line and which team wins more corners
- Player Props: anytime scorer, shots on target, assists, player cards (ONLY with verified lineups/player data)
- Combos: 2-3 leg builds from the strongest non-correlated picks

SELECTION RULES:
- safePicks: exactly 2 highest-probability, lowest-variance picks from any market (1X2 favourite, Double Chance, DNB, Over 1.5). Prefer probability >= 65.
- valuePicks: exactly 2 picks where estimated probability clearly exceeds the market-implied probability. Include the edge in percentage points.
- The 2 safe picks and 2 value picks must cover different markets or clear angles; never repeat the same selection twice.

ACCURACY RULES:
- Use the PRIMARY DATA SOURCE first. If live data is present, respect the score/minute and never recommend markets that are already settled.
- Never invent odds. If no real price is found, set "odds": null and "edge": null.
- Never invent players, lineups, referees, or statistics. If a player prop cannot be verified, use a team-level alternative and set dataQuality "LIMITED".
- dataQuality: STRONG = official stats + confirmed news/odds; MODERATE = good stats but one input missing; LIMITED = thin or unverified data.

CONFIDENCE:
85-95 = statistical + qualitative + price alignment; 70-84 = strong signal; 55-69 = mixed/thin; below 55 = speculative.

Return ONLY valid JSON (no markdown, no text outside the JSON):
{
  "safePicks": [marketPick, marketPick],
  "valuePicks": [marketPick, marketPick],
  "overallReasoning":"<5-8 sentence professional preview: form, absences, H2H, tactics, and the sharpest insight>",
  "teamData":{"home":{"name":"<team>","form":"<last 5 e.g. WWDLW>","injuries":["<player and position>"],"keyStats":["<specific stat>"]},"away":{"name":"<team>","form":"<last 5>","injuries":["<player and position>"],"keyStats":["<specific stat>"]}}
}

marketPick = {"market":"<exact bet label>","confidence":<50-95>,"probability":<0-100>,"odds":<decimal|null>,"edge":<percent|null>,"dataQuality":"STRONG|MODERATE|LIMITED","reasoning":"<1-2 specific sentences>"}
Return exactly 2 objects in safePicks and exactly 2 in valuePicks. Keep reasoning concise.
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
        
        const toOutcomes = (rawList: any, type: PredictionOutcome["type"]): PredictionOutcome[] =>
          (Array.isArray(rawList) ? rawList : [])
            .map((raw: any) => normalizeMarketPick(raw))
            .filter((pick): pick is MarketPick => Boolean(pick))
            .map((pick) => toPredictionOutcome(pick, type));

        let predictions: PredictionResult["predictions"] = [
          ...toOutcomes(parsed.safePicks, "safe"),
          ...toOutcomes(parsed.valuePicks, "value"),
        ];

        // Backwards-compatible fallback if a model returns the legacy shape.
        if (!predictions.length && Array.isArray(parsed.predictions)) {
          predictions = toOutcomes(parsed.predictions, undefined);
        }

        const seenMarkets = new Set<string>();
        predictions = predictions
          .sort((a, b) => b.confidence - a.confidence)
          .filter((prediction) => {
            const key = prediction.market.toLowerCase();
            if (seenMarkets.has(key)) return false;
            seenMarkets.add(key);
            return true;
          })
          .slice(0, 4);

        if (!predictions.length) {
          throw new Error(`Invalid prediction data structure. Missing 'safePicks' and 'valuePicks'. Parsed keys: ${Object.keys(parsed).join(', ')}.`);
        }

        return {
          matchId: matchString,
          predictions,
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
    metadata: { model: PREDICTION_MODELS[0], apiKeyIndex: 0 }
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
