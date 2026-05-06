/**
 * MultiAgentService — Elite Football Intelligence Layer
 *
 * Key fixes in this rewrite:
 *  1. analyzeMatch now uses `allowSearch: true` — NOT `json: true`.
 *     Gemini CANNOT use googleSearch and responseMimeType simultaneously.
 *     Forcing `json: true` was silently disabling grounding, causing the model
 *     to hallucinate "recent" form data from its training set.
 *  2. fetchMatchDataFallback TTL reduced to TTL.FALLBACK (10 min) — these are
 *     AI-estimated stats, not real API data. They should expire fast.
 *  3. fetchContextData TTL aligned to TTL.CONTEXT (15 min) — was 2 hours,
 *     causing stale lineups and injury reports to poison predictions.
 *  4. All prompts upgraded: explicit chain-of-search, named search queries,
 *     hallucination guards, and required data validation before inference.
 *  5. Robust JSON extraction via parseBalancedJson — handles all response shapes.
 */

import { GoogleGenAI } from "@google/genai";
import {
  apiKeyManager,
  analysisCache,
  globalCache,
  TTL,
  executeWithRetry,
  isRetryableGeminiError,
} from "./apiCacheService";

// ─── Model tiers ──────────────────────────────────────────────────────────────
/** High-capability models used for deep reasoning + search grounding */
const AGENT_MODELS  = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-1.5-pro", "gemini-1.5-flash"];
/** Models that reliably support googleSearch grounding */
const SEARCH_MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-1.5-flash"];
/** Vision-capable models for bet slip image analysis */
const VISION_MODELS = ["gemini-2.5-flash-lite", "gemini-1.5-flash"];

// ─── JSON extraction (handles all Gemini response shapes) ────────────────────
function parseBalancedJson(text: string): any | null {
  if (!text) return null;
  if (typeof text === "object" && text !== null) return text;

  const s = String(text)
    .replace(/\u00a0/g, " ")
    .replace(/\uFEFF/g, "")
    .trim();

  // 1) Direct parse
  try { return JSON.parse(s); } catch {}

  // 2) Fenced markdown block
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1]?.trim();
  if (fenced) { try { return JSON.parse(fenced); } catch {} }

  // 3) Extract first balanced { } or [ ] block
  for (const opener of ["{", "["]) {
    const closer = opener === "{" ? "}" : "]";
    const start = s.indexOf(opener);
    if (start === -1) continue;
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (inStr) {
        if (esc) { esc = false; continue; }
        if (c === "\\") { esc = true; continue; }
        if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') { inStr = true; continue; }
      if (c === opener) depth++;
      else if (c === closer) {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(s.slice(start, i + 1)); } catch {}
        }
      }
    }
  }
  return null;
}

export enum AgentType {
  ANALYST   = "analyst",
  MARKETING = "marketing",
  RETENTION = "retention",
}

class MultiAgentService {

  // ─── Core generator ─────────────────────────────────────────────────────────
  /**
   * Generate content with key rotation and model fallback.
   *
   * CRITICAL: `allowSearch` and `json` are MUTUALLY EXCLUSIVE in Gemini.
   * Passing `json: true` disables googleSearch grounding. Never combine them.
   * When search grounding is required, parse JSON from plain text output instead.
   */
  private async generateWithFallback(
    prompt: string,
    opts?: { allowSearch?: boolean; json?: boolean; forceModel?: string }
  ) {
    const models = opts?.forceModel ? [opts.forceModel] : AGENT_MODELS;

    return executeWithRetry(async (apiKey) => {
      for (const model of models) {
        try {
          const ai = new GoogleGenAI({ apiKey });

          // Build config — never mix search + json mime type
          const config: Record<string, any> = {};
          if (opts?.allowSearch) {
            config.tools = [{ googleSearch: {} }];
            // Do NOT set responseMimeType here — incompatible with grounding
          } else if (opts?.json) {
            config.responseMimeType = "application/json";
          }

          const result = await ai.models.generateContent({
            model,
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            config,
          });
          return result;
        } catch (err: any) {
          if (!isRetryableGeminiError(err)) throw err;
        }
      }
      throw new Error("generateWithFallback: all models exhausted");
    }, { maxRetries: 3 });
  }

  // ─── Marketing ───────────────────────────────────────────────────────────────
  async generateMarketingMessage(topPicks: any[]) {
    const prompt = `
You are a high-end Football Marketing Agent for "Flash AI".
Create an engaging Telegram message for today's top picks.

Top Picks Data: ${JSON.stringify(topPicks)}

Tone: Professional, Elite, Urgent, High-stakes.
Style: Emojis, bold text, clear calls to action.
Requirements:
- Mention total odds.
- Highlight the "Lock of the Day".
- Create FOMO.
- Under 1000 characters.

Return ONLY the message text.
    `;
    const result = await this.generateWithFallback(prompt);
    return result.text;
  }

  // ─── Retention ───────────────────────────────────────────────────────────────
  async generateRetentionMessage(userData: {
    name: string;
    lastActive: string;
    favoriteLeagues: string[];
  }) {
    const prompt = `
You are a Retention Specialist for a Football Prediction App.
Get this inactive user back to the app.

User Data:
- Name: ${userData.name}
- Last Active: ${userData.lastActive}
- Interests: ${userData.favoriteLeagues.join(", ")}

Requirements:
- Personalized feeling.
- Curiosity-driven (e.g., "The algorithm found something in ${userData.favoriteLeagues[0] || "the Champions League"}...").
- Short and punchy.
- No corporate jargon.

Return ONLY the message text.
    `;
    const result = await this.generateWithFallback(prompt);
    return result.text;
  }

  // ─── Context data (injuries, motivation, fatigue) ────────────────────────────
  /**
   * Fetches real-time pre-match intelligence via Google Search grounding.
   * TTL: 15 minutes — lineups drop 90 min before kickoff, injuries break at any time.
   */
  async fetchContextData(matchName: string) {
    const cacheKey = analysisCache.generateKey("context_v3", { matchName });

    return executeWithRetry(async (apiKey) => {
      const today = new Date().toISOString().split("T")[0];

      const prompt = `
You are an elite football intelligence analyst working for a professional betting syndicate.
Today: ${today}. Target match: **${matchName}**

MANDATORY SEARCH SEQUENCE — execute all 4 searches before writing ANY analysis:

SEARCH 1: "${matchName} injuries suspensions confirmed lineup ${today}"
  → Count confirmed absentees per team. Identify positions affected. Note "doubt" vs "out".

SEARCH 2: "${matchName} league table standings form ${today}"
  → Find both teams' league positions. Identify relegation battle, title race, European spots.
  → Extract last-5 results WITH actual scores (e.g. "W 3-1, D 1-1, L 0-2").

SEARCH 3: "${matchName} fixture congestion schedule midweek travel"
  → Did either team play within 72 hours? Multiple competitions? Long-haul travel?

SEARCH 4: "${matchName} press conference team news manager ${today}"
  → Any rotation hints, tactical changes, squad depth warnings from manager quotes?

HALLUCINATION GUARD: If search returns no data for a field, use the default value — DO NOT invent
players, scores, or facts. Use the default JSON values shown below.

After completing all 4 searches, synthesize the findings and return ONLY a valid JSON object
(absolutely no markdown, no preamble, no text outside the JSON):
{
  "home_missing": <integer 0-11: CONFIRMED absentees only, not doubts>,
  "away_missing": <integer 0-11>,
  "home_key_absentee": "<name + position of most critical missing player, or empty string>",
  "away_key_absentee": "<name + position, or empty string>",
  "home_motivation": "HIGH" | "MEDIUM" | "LOW",
  "away_motivation": "HIGH" | "MEDIUM" | "LOW",
  "home_fatigue": <boolean: true only if confirmed fixture within 72h>,
  "away_fatigue": <boolean>,
  "is_derby": <boolean: local/historic rival fixture>,
  "home_form_context": "<1 sentence citing actual recent results with scores, not vague>",
  "away_form_context": "<1 sentence citing actual recent results with scores, not vague>",
  "home_league_position": <integer or 0 if not found>,
  "away_league_position": <integer or 0 if not found>,
  "reasoning": "<3-5 sentences of elite intelligence. Reference SPECIFIC: player names, league positions, actual recent scores, and the SINGLE MOST IMPORTANT factor that will shift this match's outcome. No vague language.>"
}
      `;

      const result = await this.generateWithFallback(prompt, { allowSearch: true });
      const data = parseBalancedJson(result.text ?? "");
      if (!data || typeof data.home_missing === "undefined") {
        throw new Error("fetchContextData: invalid JSON structure from AI");
      }
      return data;
    }, {
      cache: analysisCache,
      cacheKey,
      customTtl: TTL.CONTEXT,
      metadata: { model: AGENT_MODELS[0], apiKeyIndex: 0 },
    }).catch((err) => {
      console.warn("[MultiAgent] fetchContextData fallback:", err?.message);
      return {
        home_missing: 0,
        away_missing: 0,
        home_key_absentee: "",
        away_key_absentee: "",
        home_motivation: "MEDIUM",
        away_motivation: "MEDIUM",
        home_fatigue: false,
        away_fatigue: false,
        is_derby: false,
        home_form_context: "",
        away_form_context: "",
        home_league_position: 0,
        away_league_position: 0,
        reasoning:
          "Limited real-time data available. Statistical model applied without qualitative adjustments.",
      };
    });
  }

  // ─── AI match analysis (the deep reasoning layer) ────────────────────────────
  /**
   * KEY FIX: This now uses allowSearch: true (was incorrectly using json: true).
   * json mode + googleSearch are incompatible in Gemini — using json was silently
   * disabling grounding, causing the AI to reason from stale training data.
   * We now request plain text with embedded JSON and parse it explicitly.
   *
   * TTL: 20 minutes.
   */
  async analyzeMatch(matchData: any) {
    const cacheKey = analysisCache.generateKey("analysis_v3", { matchData });

    return executeWithRetry(async (apiKey) => {
      const today = new Date().toISOString().split("T")[0];
      const matchStr   = matchData.match ?? "Unknown Match";
      const homeStats  = matchData.stats?.home;
      const awayStats  = matchData.stats?.away;
      const lambdas    = matchData.poissonLambdas;
      const probs      = matchData.probabilities;
      const valueBets  = matchData.valueBets || [];
      const context    = matchData.context || {};
      const bsdData    = matchData.bsdData || null;
      const odds       = matchData.odds || {};
      const [homeTeam, awayTeam] = matchStr.split(" vs ");

      const prompt = `
You are a senior quantitative analyst at a professional football betting syndicate.
Today: ${today}. Match: **${matchStr}**

════════════════════════════════════
STATISTICAL MODEL OUTPUT (Dixon-Coles Poisson)
════════════════════════════════════
Home xG lambda: ${lambdas?.home?.toFixed(3) ?? "N/A"}
Away xG lambda: ${lambdas?.away?.toFixed(3) ?? "N/A"}

Computed Probabilities:
  Home Win:    ${probs?.homeWin ?? "N/A"}
  Draw:        ${probs?.draw ?? "N/A"}
  Away Win:    ${probs?.awayWin ?? "N/A"}
  Over 2.5:    ${probs?.over25 ?? "N/A"}
  BTTS Yes:    ${probs?.bttsYes ?? "N/A"}

Season Stats:
  Home: ${homeStats?.played ?? "?"} played, ${homeStats?.goalsScored ?? 0} scored, ${homeStats?.goalsConceded ?? 0} conceded
  Away: ${awayStats?.played ?? "?"} played, ${awayStats?.goalsScored ?? 0} scored, ${awayStats?.goalsConceded ?? 0} conceded

Form (last 5):
  Home: ${(matchData.form?.home ?? []).join("") || "N/A"}
  Away: ${(matchData.form?.away ?? []).join("") || "N/A"}

Intelligence Layer (from context agents):
  Home missing: ${context.home_missing ?? 0}${context.home_key_absentee ? ` (key: ${context.home_key_absentee})` : ""}
  Away missing: ${context.away_missing ?? 0}${context.away_key_absentee ? ` (key: ${context.away_key_absentee})` : ""}
  Home motivation: ${context.home_motivation ?? "MEDIUM"} | Away motivation: ${context.away_motivation ?? "MEDIUM"}
  Home fatigue: ${context.home_fatigue ?? false} | Away fatigue: ${context.away_fatigue ?? false}
  Derby: ${context.is_derby ?? false}
  Context: ${context.reasoning ?? "Not available"}
  Home form context: ${context.home_form_context ?? ""}
  Away form context: ${context.away_form_context ?? ""}

Value Bets Detected by Quantitative Model:
${valueBets.length > 0
  ? valueBets.map((v: any) => `  - ${v.market}: edge ${v.edge}, odds ${v.odds}`).join("\n")
  : "  None (no live odds feed)"}

${bsdData?.liveStats ? `
Live Match State (BSD API):
  Score: ${bsdData.score ?? "N/A"} | Minute: ${bsdData.elapsed ?? "?"}
  Possession: ${bsdData.liveStats?.possession?.home ?? "?"}% vs ${bsdData.liveStats?.possession?.away ?? "?"}%
  Shots on Target: ${bsdData.liveStats?.shotsOnTarget?.home ?? 0} vs ${bsdData.liveStats?.shotsOnTarget?.away ?? 0}
` : ""}
Current Odds:
${Object.entries(odds).filter(([, v]) => (v as number) > 1).map(([k, v]) => `  ${k}: ${v}`).join("\n") || "  No odds provided"}

════════════════════════════════════
MANDATORY SEARCH TASK
════════════════════════════════════
Execute these searches NOW before writing your analysis:

1. Search: "${matchStr} latest team news injuries lineups ${today}"
   → Verify or update the injury/suspension data above. Flag any contradictions.

2. Search: "${homeTeam} vs ${awayTeam} betting odds prediction tips ${today}"
   → Check if current market odds align with or diverge from the model probabilities above.
   → A divergence of >5% is a VALUE SIGNAL. Document it.

3. Search: "${homeTeam} recent results ${today}" AND "${awayTeam} recent results ${today}"
   → Verify the form data above with actual recent scorelines.

ANALYSIS REQUIREMENTS:
- If model and qualitative data AGREE → escalate confidence
- If they DISAGREE → identify which takes precedence and WHY
- Flag any value bet with edge >8% as high priority
- Be SPECIFIC: name real players, cite actual recent scores, reference actual league positions
- NEVER use phrases like "both teams are capable" or "it could go either way"

CONFIDENCE CALIBRATION:
  85-95: Statistical model + live search data + value edge all strongly aligned
  70-84: Good model signal, confirmed by search, moderate edge
  55-69: Mixed signals, thin data, or high-variance fixture
  50-54: Low conviction — include but flag speculative
  Hard cap at 95 (claiming certainty is professional malpractice)

Return a valid JSON object embedded anywhere in your response
(we will extract it — you may add brief notes before/after if needed):
{
  "reasoning": "<4-7 sentences. Reference SPECIFIC statistics, player names, actual recent results. Explain the single most important factor driving this prediction. Note any model override.>",
  "confidence": <integer 50-95>,
  "best_value_market": "<exact market name e.g. 'Over 2.5 Goals', 'Home Win', '1X', 'BTTS - Yes', 'Under 2.5 Goals'>",
  "key_insight": "<1 sentence: the single sharpest insight a casual bettor would miss>",
  "risk_flag": "LOW" | "MEDIUM" | "HIGH",
  "search_data_used": <boolean: true if Google Search returned real data for this match>
}
      `;

      // CRITICAL: allowSearch — NOT json. These are mutually exclusive in Gemini.
      const result = await this.generateWithFallback(prompt, { allowSearch: true });
      const data = parseBalancedJson(result.text ?? "");

      if (!data || typeof data.confidence === "undefined") {
        throw new Error(`analyzeMatch: invalid JSON. Raw snippet: ${(result.text ?? "").slice(0, 200)}`);
      }

      // Sanity clamp
      data.confidence = Math.min(Math.max(Number(data.confidence) || 60, 50), 95);
      return data;
    }, {
      cache: analysisCache,
      cacheKey,
      customTtl: TTL.ANALYSIS,
      metadata: { model: AGENT_MODELS[0], apiKeyIndex: 0 },
    }).catch((err) => {
      console.warn("[MultiAgent] analyzeMatch fallback:", err?.message);
      return {
        reasoning: "AI deep analysis unavailable — prediction based on statistical model only.",
        confidence: 55,
        best_value_market: "N/A",
        key_insight: "",
        risk_flag: "MEDIUM",
        search_data_used: false,
      };
    });
  }

  // ─── Fallback team data (when BSD API returns nothing) ───────────────────────
  /**
   * KEY FIX: TTL reduced to TTL.FALLBACK (10 min).
   * This data is AI-estimated (not from a real sports API). It must expire quickly
   * to avoid poisoning the Poisson model with stale AI-guessed statistics.
   *
   * Also: now uses allowSearch: true so Gemini actively looks up real numbers
   * rather than generating plausible-sounding but fabricated stats.
   */
  async fetchMatchDataFallback(matchName: string) {
    const cacheKey = analysisCache.generateKey("fallback_v3", { matchName });

    return executeWithRetry(async (apiKey) => {
      const today = new Date().toISOString().split("T")[0];

      const prompt = `
You are a professional football data scout. Today: ${today}.
Target match: **${matchName}**

CRITICAL INSTRUCTION: You MUST use Google Search to find real numbers.
Do NOT generate statistical estimates. If a figure cannot be found via search, use null.
Fabricated statistics directly harm prediction accuracy — this is unacceptable.

EXECUTE ALL 4 SEARCHES BEFORE FILLING THE JSON:

SEARCH 1: "${matchName} recent results form last 5 games ${today}"
  → Find last 5 results per team WITH actual scores

SEARCH 2: "${matchName} season stats goals scored goals conceded table ${today}"
  → Games played, total goals for and against this season

SEARCH 3: "${matchName} betting odds today Bet365 Betway William Hill ${today}"
  → Home/Draw/Away odds, Over/Under 2.5, BTTS Yes/No

SEARCH 4: "average goals per game ${matchName.split(" vs ")[0]} league ${today}"
  → League average goals per match (typically 2.4-3.2 for top European leagues)

HALLUCINATION GUARD: If any search returns no data, use null for that field.
Using null tells the model "data missing" — using a made-up number silently corrupts predictions.

Return ONLY a valid JSON object (no markdown, no preamble):
{
  "id": "fallback",
  "dataSource": "gemini_search",
  "dataQualityWarning": <boolean: true if any key fields are null or estimated>,
  "home": {
    "id": 0,
    "name": "<exact home team name>",
    "last5": {
      "goalsScored": <integer or null>,
      "goalsConceded": <integer or null>,
      "results": ["W"|"D"|"L", "W"|"D"|"L", "W"|"D"|"L", "W"|"D"|"L", "W"|"D"|"L"] or null
    },
    "season": {
      "played": <integer or null>,
      "goalsScored": <integer or null>,
      "goalsConceded": <integer or null>
    }
  },
  "away": {
    "id": 0,
    "name": "<exact away team name>",
    "last5": {
      "goalsScored": <integer or null>,
      "goalsConceded": <integer or null>,
      "results": ["W"|"D"|"L", "W"|"D"|"L", "W"|"D"|"L", "W"|"D"|"L", "W"|"D"|"L"] or null
    },
    "season": {
      "played": <integer or null>,
      "goalsScored": <integer or null>,
      "goalsConceded": <integer or null>
    }
  },
  "leagueAvgGoals": <float or null>,
  "odds": {
    "home":    <float or null>,
    "draw":    <float or null>,
    "away":    <float or null>,
    "over25":  <float or null>,
    "under25": <float or null>,
    "bttsYes": <float or null>,
    "bttsNo":  <float or null>,
    "dc1X":    <float or null>,
    "dcX2":    <float or null>,
    "over15":  <float or null>,
    "over35":  <float or null>
  }
}
      `;

      const result = await this.generateWithFallback(prompt, { allowSearch: true });
      const data = parseBalancedJson(result.text ?? "");

      if (!data || !data.home || !data.away) {
        throw new Error("fetchMatchDataFallback: missing home/away in response");
      }

      // Replace null stats with conservative defaults so Poisson has something to work with
      // but flag the quality issue so confidence is penalized downstream
      const fillDefaults = (team: any) => {
        if (!team.last5.results) team.last5.results = ["D", "D", "D", "D", "D"];
        if (team.last5.goalsScored == null) team.last5.goalsScored = 5; // conservative 1.0/game
        if (team.last5.goalsConceded == null) team.last5.goalsConceded = 5;
        if (!team.season.played) team.season.played = 10;
        if (team.season.goalsScored == null) team.season.goalsScored = 12;
        if (team.season.goalsConceded == null) team.season.goalsConceded = 12;
        return team;
      };

      data.home = fillDefaults(data.home);
      data.away = fillDefaults(data.away);
      data.leagueAvgGoals = data.leagueAvgGoals ?? 2.6;

      return data;
    }, {
      cache: analysisCache,
      cacheKey,
      customTtl: TTL.FALLBACK,  // 10 min — AI estimates must expire fast
      metadata: { model: AGENT_MODELS[0], apiKeyIndex: 0 },
    });
  }

  // ─── Top fixtures ─────────────────────────────────────────────────────────────
  async getTopFixturesFromSearch(): Promise<string[]> {
    const today = new Date().toISOString().split("T")[0];
    const cacheKey = globalCache.generateKey("top_fixtures_v2", { date: today });

    const prompt = `
Find today's (${today}) most important football matches globally.
Focus on: UEFA Champions League, Premier League, La Liga, Serie A, Bundesliga, Ligue 1, and major cup finals.
Sort by match importance/hype descending.
Return ONLY a JSON array of match names in "Home vs Away" format.
Example: ["Real Madrid vs Manchester City", "Arsenal vs Bayern Munich"]
Return at least 8 matches if available.
    `;

    return executeWithRetry(async (apiKey) => {
      let lastError: any;
      for (const model of SEARCH_MODELS) {
        try {
          const ai = new GoogleGenAI({ apiKey });
          const result = await ai.models.generateContent({
            model,
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            config: { tools: [{ googleSearch: {} }] as any },
          });
          const data = parseBalancedJson(result.text ?? "");
          return Array.isArray(data) ? data : [];
        } catch (err: any) {
          lastError = err;
          if (!isRetryableGeminiError(err)) throw err;
        }
      }
      throw lastError ?? new Error("getTopFixturesFromSearch: all models failed");
    }, {
      cache: globalCache,
      cacheKey,
      customTtl: TTL.FIXTURES,
      maxRetries: 2,
    }).catch(() => []);
  }

  // ─── Bet slip analyser ────────────────────────────────────────────────────────
  async analyzeBetSlip(images: string[]) {
    return executeWithRetry(async (apiKey) => {
      const prompt = `
You are an expert sports betting analyst. Analyze the provided bet slip image(s).

Extract all matches, predictions, and odds shown.
For each match, provide:
- A confidence score (0-100) based on current football knowledge
- Risk level (LOW / MEDIUM / HIGH)
- 2-3 sentence professional reasoning

Also provide:
- 2 Safe Picks: high-probability alternative markets on the SAME matches
  (e.g., Double Chance, Over 1.5, DNB) with reasoning
- 2 Value Bets: markets where the odds look undervalued relative to actual probability,
  specifically referencing the slip odds or estimated market odds
- Total accumulated odds
- Overall risk verdict
- Suggested stake (e.g., 3/10, 5/10)

Return ONLY a JSON object with this exact structure:
{
  "items": [
    {
      "match": "Team A vs Team B",
      "prediction": "Home Win",
      "odds": 1.85,
      "confidence": 85,
      "riskLevel": "LOW",
      "reasoning": "..."
    }
  ],
  "totalOdds": 5.42,
  "overallRisk": "MEDIUM",
  "verdict": "...",
  "suggestedStake": "3/10",
  "safePicks": [
    { "match": "Team A vs Team B", "pick": "Home or Draw", "odds": 1.25, "reason": "..." }
  ],
  "valueBets": [
    { "match": "Team A vs Team B", "market": "Over 2.5 Goals", "odds": 2.10, "value": 15, "reason": "..." }
  ]
}
      `;

      const imageParts = images.map((dataUri) => {
        const m = dataUri.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
        if (!m || m.length !== 3) throw new Error("Invalid image format.");
        return { inlineData: { mimeType: m[1], data: m[2] } };
      });

      let lastError: any;
      for (const model of VISION_MODELS) {
        try {
          const ai = new GoogleGenAI({ apiKey });
          const result = await ai.models.generateContent({
            model,
            contents: [{ role: "user", parts: [{ text: prompt }, ...(imageParts as any)] }],
            config: { responseMimeType: "application/json" },
          });
          const data = parseBalancedJson(result.text ?? "");
          if (!data) throw new Error("Empty or unparseable bet slip response");
          return data;
        } catch (err: any) {
          lastError = err;
          if (!isRetryableGeminiError(err)) throw err;
        }
      }
      throw lastError ?? new Error("analyzeBetSlip: all models failed");
    }, { maxRetries: 2 });
  }

  // ─── Legacy match analysis (simple, no structured data) ─────────────────────
  async getMatchAnalysis(matchId: string) {
    return executeWithRetry(async (apiKey) => {
      const ai = new GoogleGenAI({ apiKey });
      const result = await ai.models.generateContent({
        model: "gemini-2.5-flash-lite",
        contents: [{ role: "user", parts: [{ text: `Analyze match ${matchId} and provide prediction.` }] }],
      });
      return result.text;
    }, { maxRetries: 2 }).catch((err) => {
      console.error("getMatchAnalysis failed:", err);
      throw err;
    });
  }
}

export const multiAgentService = new MultiAgentService();
