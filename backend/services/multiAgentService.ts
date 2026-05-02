import { GoogleGenAI } from "@google/genai";
import { 
  apiKeyManager, 
  analysisCache, 
  globalCache,
  executeWithRetry,
  isRetryableGeminiError 
} from "./apiCacheService";

const AGENT_MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-1.5-pro", "gemini-1.5-flash"];
const SEARCH_MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-1.5-flash"];
const VISION_MODELS = ["gemini-2.5-flash-lite", "gemini-1.5-flash"];

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
      const today = new Date().toISOString().split('T')[0];
      const prompt = `
You are an elite football intelligence analyst working for a professional betting syndicate.
Today's date: ${today}.
Target match: **${matchName}**

MISSION: Gather all pre-match intelligence that could shift the outcome probability.

Use Google Search NOW to find the following for BOTH teams in "${matchName}":

STEP 1 — INJURY & SUSPENSION REPORT
Search: "${matchName} injuries suspensions lineup ${today}"
- Count confirmed absentees (not just doubts)
- Identify if any KEY players (strikers, central defenders, goalkeeper, playmakers) are missing
- Note if the team has a depleted bench

STEP 2 — MOTIVATION ASSESSMENT
Search: "${matchName} standings form league table"
- Is either team in a relegation battle? (HIGH motivation)
- Title race / top-4 chase? (HIGH motivation)
- Nothing at stake for a mid-table side? (LOW motivation)
- Cup final / knockout stage? (EXTREME — rate as HIGH)
- Derby match? (LOCAL rivalry = HIGH)

STEP 3 — FATIGUE & SCHEDULE
Search: "${matchName} fixture schedule midweek"
- Did either team play within the last 3 days?
- Is either team managing multiple competitions?
- Long distance travel (intercontinental)?

STEP 4 — MANAGERIAL / SQUAD NEWS
Search: "${matchName} news manager squad update ${today}"
- Any tactical changes, rotation hints from press conference?
- Squad depth concerns?

Now synthesize ALL found data and return ONLY a valid JSON object (no markdown, no preamble):
{
  "home_missing": <integer: confirmed absentees for home team, 0-11>,
  "away_missing": <integer: confirmed absentees for away team, 0-11>,
  "home_key_absentee": "<name of most important missing player or empty string>",
  "away_key_absentee": "<name of most important missing player or empty string>",
  "home_motivation": "HIGH" | "MEDIUM" | "LOW",
  "away_motivation": "HIGH" | "MEDIUM" | "LOW",
  "home_fatigue": <boolean: true if played within 72 hours or heavy schedule>,
  "away_fatigue": <boolean>,
  "is_derby": <boolean: true if local/historic rivalry>,
  "home_form_context": "<1-sentence qualitative summary of home team's recent run>",
  "away_form_context": "<1-sentence qualitative summary of away team's recent run>",
  "reasoning": "<3-5 sentence professional betting intelligence summary. Be specific about which factors are MOST likely to shift the outcome. Mention specific players, specific league positions, specific recent results. Do not use vague language.>"
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
      home_key_absentee: '',
      away_key_absentee: '',
      home_motivation: 'MEDIUM',
      away_motivation: 'MEDIUM',
      home_fatigue: false,
      away_fatigue: false,
      is_derby: false,
      home_form_context: '',
      away_form_context: '',
      reasoning: "Limited real-time data available. Statistical model applied without qualitative adjustments."
    }));
  }

  async analyzeMatch(matchData: any) {
    const cacheKey = analysisCache.generateKey('analysis', { matchData });

    return executeWithRetry(async (apiKey, keyIndex) => {
      const today = new Date().toISOString().split('T')[0];
      
      // Build structured data block from all available sources
      const matchStr = matchData.match || 'Unknown Match';
      const homeStats = matchData.stats?.home;
      const awayStats = matchData.stats?.away;
      const lambdas = matchData.poissonLambdas;
      const probs = matchData.probabilities;
      const valueBets = matchData.valueBets || [];
      const context = matchData.context || {};
      const bsdData = matchData.bsdData || null;
      const odds = matchData.odds || {};

      const prompt = `
You are a senior quantitative analyst at a professional football betting syndicate. 
Today: ${today}. Match: **${matchStr}**.

You have been provided with a FULL pre-computed statistical dataset below. Your job is to:
1. Validate the statistical model findings with current real-world intelligence (use Google Search)
2. Add qualitative insight the model cannot capture (tactical, psychological, situational)
3. Identify any OVERRIDES — situations where the qualitative picture strongly contradicts the model
4. Produce a final high-conviction prediction with precise reasoning

═══════════════════════════════════════════
STATISTICAL MODEL DATA (Dixon-Coles Poisson)
═══════════════════════════════════════════
Home xG lambda: ${lambdas?.home?.toFixed(3) || 'N/A'}
Away xG lambda: ${lambdas?.away?.toFixed(3) || 'N/A'}

Probabilities:
- Home Win: ${probs?.homeWin || 'N/A'}
- Draw: ${probs?.draw || 'N/A'}
- Away Win: ${probs?.awayWin || 'N/A'}
- Over 2.5 Goals: ${probs?.over25 || 'N/A'}
- BTTS Yes: ${probs?.bttsYes || 'N/A'}

Season Stats:
- Home: ${homeStats?.played || '?'} played, ${homeStats?.goalsScored || 0} scored, ${homeStats?.goalsConceded || 0} conceded
- Away: ${awayStats?.played || '?'} played, ${awayStats?.goalsScored || 0} scored, ${awayStats?.goalsConceded || 0} conceded

Form (last 5): Home: ${(matchData.form?.home || []).join('')} | Away: ${(matchData.form?.away || []).join('')}

Pre-Match Intelligence (from search agents):
- Home missing: ${context.home_missing || 0} players${context.home_key_absentee ? ` (key: ${context.home_key_absentee})` : ''}
- Away missing: ${context.away_missing || 0} players${context.away_key_absentee ? ` (key: ${context.away_key_absentee})` : ''}
- Home motivation: ${context.home_motivation || 'MEDIUM'} | Away motivation: ${context.away_motivation || 'MEDIUM'}
- Home fatigue: ${context.home_fatigue || false} | Away fatigue: ${context.away_fatigue || false}
- Derby: ${context.is_derby || false}
- Context: ${context.reasoning || 'Not available'}

Value Bets Detected by Model:
${valueBets.length > 0 ? valueBets.map((v: any) => `  - ${v.market}: edge ${v.edge}, odds ${v.odds}`).join('\n') : '  None detected (no odds available)'}

${bsdData?.liveStats ? `
Live Match State (BSD API):
- Score: ${bsdData.score || 'N/A'} | Minute: ${bsdData.elapsed || '?'}
- Possession: ${bsdData.liveStats?.possession?.home || '?'}% vs ${bsdData.liveStats?.possession?.away || '?'}%
- Shots on Target: ${bsdData.liveStats?.shotsOnTarget?.home || 0} vs ${bsdData.liveStats?.shotsOnTarget?.away || 0}
` : ''}

Current Odds Available:
${Object.entries(odds).filter(([_, v]) => v > 1).map(([k, v]) => `  ${k}: ${v}`).join('\n') || '  No odds provided'}

═══════════════════════════════════════════
YOUR ANALYSIS TASK
═══════════════════════════════════════════
Use Google Search to verify:
1. Search: "${matchStr} latest news injuries form ${today}"
2. Search: "${matchStr} odds betting tips"
3. Search: "${matchStr.split(' vs ')[0]} tactical setup" (if relevant)

Then produce your elite analysis. Be SPECIFIC — name players, cite actual recent results, reference league position. 
Do NOT use vague language like "both teams are capable."

CRITICAL RULES:
- If the statistical model and qualitative picture AGREE → high confidence
- If they DISAGREE → explain why and which takes precedence
- Highlight if any value bet has exceptionally strong edge (>10%)
- The "best_value_market" must be the single best bet accounting for BOTH the model AND your qualitative findings
- Confidence 85-95: model + qualitative strongly aligned + value edge present
- Confidence 70-84: good alignment, moderate edge
- Confidence 50-69: mixed signals or thin data
- Never exceed 95 (overconfidence is professional malpractice)

Return ONLY a valid JSON object (absolutely no markdown, no preamble, no trailing text):
{
  "reasoning": "<4-7 sentence elite analysis. Reference specific statistics, specific player names, specific recent results. Explain the SINGLE most important factor driving this prediction. Mention any model override if applicable.>",
  "confidence": <integer 50-95>,
  "best_value_market": "<exact market name e.g. 'Over 2.5 Goals' or 'Home Win' or '1X' or 'BTTS - Yes'>",
  "key_insight": "<1 sentence: the single sharpest insight a casual bettor would miss>",
  "risk_flag": "<'LOW' | 'MEDIUM' | 'HIGH': overall prediction risk based on uncertainty factors>"
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
      const today = new Date().toISOString().split('T')[0];
      const prompt = `
You are a professional football data scout. Today: ${today}.
Target match: **${matchName}**

Use Google Search to gather the following data — be PRECISE, cite actual numbers:

SEARCH 1: "${matchName} recent results form ${today}"
- Find last 5 results for EACH team (W/D/L) with actual scores
- Calculate goals scored and conceded in those 5 games

SEARCH 2: "${matchName} season stats goals scored conceded"
- Find total games played this season for each team
- Total goals scored and conceded this season

SEARCH 3: "${matchName} betting odds today"
- Find current bookmaker odds: Home Win, Draw, Away Win
- Over/Under 2.5 Goals odds
- BTTS Yes/No odds
- Use Betway, Bet365, William Hill, or any major bookmaker

SEARCH 4: "${matchName} league average goals"
- What is the average goals per game in this league?

Return ONLY a valid JSON object (no markdown, no preamble):
{
  "id": "fallback",
  "home": {
    "id": 0,
    "name": "<exact home team name>",
    "last5": {
      "goalsScored": <integer: total goals scored in last 5 games>,
      "goalsConceded": <integer: total goals conceded in last 5 games>,
      "results": ["W"|"D"|"L", "W"|"D"|"L", "W"|"D"|"L", "W"|"D"|"L", "W"|"D"|"L"]
    },
    "season": {
      "played": <integer>,
      "goalsScored": <integer>,
      "goalsConceded": <integer>
    }
  },
  "away": {
    "id": 0,
    "name": "<exact away team name>",
    "last5": {
      "goalsScored": <integer>,
      "goalsConceded": <integer>,
      "results": ["W"|"D"|"L", "W"|"D"|"L", "W"|"D"|"L", "W"|"D"|"L", "W"|"D"|"L"]
    },
    "season": {
      "played": <integer>,
      "goalsScored": <integer>,
      "goalsConceded": <integer>
    }
  },
  "leagueAvgGoals": <float: typical is 2.4-3.2 for top European leagues>,
  "odds": {
    "home": <float: e.g. 2.10>,
    "draw": <float: e.g. 3.30>,
    "away": <float: e.g. 3.50>,
    "over25": <float: e.g. 1.90>,
    "under25": <float: e.g. 1.90>,
    "bttsYes": <float: e.g. 1.80>,
    "bttsNo": <float: e.g. 1.95>,
    "dc1X": <float: e.g. 1.30>,
    "dcX2": <float: e.g. 1.70>,
    "over15": <float: e.g. 1.30>,
    "over35": <float: e.g. 3.20>
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
        
        CRITICAL: Provide both "Safe Picks" and "Value Bets" for the EXACT SAME matches found in the uploaded bet slip.
      - Safe Picks: High-probability alternative markets (e.g., Double Chance, Over 1.5).
      - Value Bets: Markets where the odds provided in the slip (or current market estimates) seem undervalued relative to the actual probability.
      
      Suggest exactly 2 Safe Picks and 2 Value Bets if possible.

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
              "reason": "..."
            }
          ],
          "valueBets": [
            {
              "match": "Team A vs Team B",
              "market": "Over 2.5 Goals",
              "odds": 2.10,
              "value": 15,
              "reason": "..."
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
        model: "gemini-2.5-flash-lite",
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
