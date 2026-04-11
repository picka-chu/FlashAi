import { useEffect, useState } from "react";
import { GoogleGenAI } from "@google/genai";
import { 
  Trophy, 
  Calendar, 
  TrendingUp, 
  User, 
  Zap, 
  ChevronRight,
  Info,
  History,
  ShieldCheck,
  BarChart3,
  Lock,
  Settings,
  Eye,
  AlertTriangle
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

// Initialize Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

interface Match {
  id: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  time: string;
  homeLogo: string;
  awayLogo: string;
}

const MOCK_MATCHES: Match[] = [
  {
    id: "1",
    homeTeam: "Arsenal",
    awayTeam: "Man City",
    league: "Premier League",
    time: "Today, 20:00",
    homeLogo: "https://picsum.photos/seed/arsenal/100/100",
    awayLogo: "https://picsum.photos/seed/mancity/100/100",
  },
  {
    id: "2",
    homeTeam: "Real Madrid",
    awayTeam: "Barcelona",
    league: "La Liga",
    time: "Tomorrow, 21:00",
    homeLogo: "https://picsum.photos/seed/madrid/100/100",
    awayLogo: "https://picsum.photos/seed/barca/100/100",
  },
  {
    id: "3",
    homeTeam: "Bayern Munich",
    awayTeam: "Dortmund",
    league: "Bundesliga",
    time: "Today, 18:30",
    homeLogo: "https://picsum.photos/seed/bayern/100/100",
    awayLogo: "https://picsum.photos/seed/dortmund/100/100",
  },
];

declare global {
  interface Window {
    Telegram?: {
      WebApp: any;
    };
  }
}

export default function App() {
  const [tgUser, setTgUser] = useState<any>(null);
  const [selectedMatch, setSelectedMatch] = useState<Match | null>(null);
  const [prediction, setPrediction] = useState<string | null>(null);
  const [isPredicting, setIsPredicting] = useState(false);
  const [currentPage, setCurrentPage] = useState<"onboarding" | "main" | "admin" | "loading">("loading");

  useEffect(() => {
    if (window.Telegram?.WebApp) {
      const tg = window.Telegram.WebApp;
      tg.ready();
      tg.expand();
      setTgUser(tg.initDataUnsafe?.user);
      tg.setHeaderColor("#0a0a0a");

      // Handle routing based on start_param
      const startParam = tg.initDataUnsafe?.start_param;
      if (startParam === "admin") {
        setCurrentPage("admin");
      } else if (startParam === "onboarding") {
        setCurrentPage("onboarding");
      } else {
        setCurrentPage("main");
      }
    } else {
      // Fallback for browser testing
      setCurrentPage("main");
    }
  }, []);

  const handlePredict = async (match: Match) => {
    setSelectedMatch(match);
    setIsPredicting(true);
    setPrediction(null);

    try {
      const prompt = `As a professional football analyst, predict the outcome of the match between ${match.homeTeam} and ${match.awayTeam} in the ${match.league}. Provide a detailed analysis including score prediction, key players to watch, and winning probability. Keep it concise but professional. Use a structured format.`;
      
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
      });

      setPrediction(response.text || "Could not generate prediction.");
    } catch (error) {
      console.error("Prediction error:", error);
      setPrediction("Error generating prediction. Please try again.");
    } finally {
      setIsPredicting(false);
    }
  };

  const handleOnboardingContinue = async () => {
    if (window.Telegram?.WebApp) {
      const tg = window.Telegram.WebApp;
      const telegramId = tg.initDataUnsafe?.user?.id;

      if (telegramId) {
        try {
          await fetch("/api/request-contact", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ telegramId }),
          });
        } catch (error) {
          console.error("Failed to request contact:", error);
        }
      }
      tg.close();
    }
  };

  if (currentPage === "loading") {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Zap className="w-12 h-12 text-orange-500 animate-pulse" />
      </div>
    );
  }

  if (currentPage === "onboarding") {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col p-8 pb-12">
        <div className="flex-1 flex flex-col justify-center space-y-12">
          <div className="space-y-4">
            <h1 className="text-4xl font-bold tracking-tight">
              Welcome to <br />
              <span className="text-orange-500">Flash AI</span>
            </h1>
            <p className="text-zinc-400 text-lg leading-relaxed">
              This official predictor is free, syncs your history across devices, and brings you the latest AI match insights.
            </p>
          </div>

          <div className="space-y-8">
            <div className="flex gap-4">
              <div className="mt-1">
                <AlertTriangle className="w-6 h-6 text-zinc-400" />
              </div>
              <div className="space-y-1">
                <h3 className="font-bold">AI can be inaccurate</h3>
                <p className="text-sm text-zinc-500">Flash AI may provide inaccurate information about teams, players, or match outcomes.</p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="mt-1">
                <Lock className="w-6 h-6 text-zinc-400" />
              </div>
              <div className="space-y-1">
                <h3 className="font-bold">Don't share sensitive info</h3>
                <p className="text-sm text-zinc-500">Predictions and chats may be reviewed by our AI trainers to improve our systems.</p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="mt-1">
                <Settings className="w-6 h-6 text-zinc-400" />
              </div>
              <div className="space-y-1">
                <h3 className="font-bold">Control your history</h3>
                <p className="text-sm text-zinc-500">Decide whether new predictions appear in your history and be used to improve our systems.</p>
              </div>
            </div>
          </div>
        </div>

        <Button 
          onClick={handleOnboardingContinue}
          className="w-full h-14 bg-white text-black hover:bg-zinc-200 rounded-full text-lg font-bold"
        >
          Continue
        </Button>
      </div>
    );
  }

  if (currentPage === "admin") {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6 space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Admin Panel</h1>
          <Button variant="outline" size="sm" onClick={() => setCurrentPage("main")}>Exit</Button>
        </header>

        <div className="grid gap-4">
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader>
              <CardTitle className="text-sm uppercase tracking-widest text-zinc-500">System Status</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <span className="text-green-500 font-bold">Online</span>
                <Badge variant="outline" className="text-zinc-500">v1.0.4</Badge>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader>
              <CardTitle className="text-sm uppercase tracking-widest text-zinc-500">User Growth</CardTitle>
            </CardHeader>
            <CardContent className="h-40 flex items-center justify-center">
              <BarChart3 className="w-12 h-12 text-zinc-800" />
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-orange-500/30">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-zinc-950/80 backdrop-blur-md border-b border-zinc-800/50 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center">
            <Zap className="w-5 h-5 text-zinc-950 fill-current" />
          </div>
          <h1 className="font-bold text-xl tracking-tight">FLASH AI</h1>
        </div>
        <div className="flex items-center gap-3">
          {tgUser ? (
            <div className="flex items-center gap-2 bg-zinc-900 px-3 py-1.5 rounded-full border border-zinc-800">
              <span className="text-xs font-medium text-zinc-400">{tgUser.first_name}</span>
              <div className="w-6 h-6 bg-zinc-800 rounded-full flex items-center justify-center overflow-hidden">
                {tgUser.photo_url ? (
                  <img src={tgUser.photo_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <User className="w-4 h-4 text-zinc-500" />
                )}
              </div>
            </div>
          ) : (
            <Badge variant="outline" className="text-zinc-500 border-zinc-800">Demo Mode</Badge>
          )}
        </div>
      </header>

      <main className="p-4 max-w-2xl mx-auto space-y-6">
        {/* Hero Section */}
        <section className="relative overflow-hidden rounded-2xl bg-zinc-900 border border-zinc-800 p-6">
          <div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 bg-orange-500/10 blur-3xl rounded-full" />
          <div className="relative z-10 space-y-2">
            <div className="flex items-center gap-2 text-orange-500">
              <TrendingUp className="w-4 h-4" />
              <span className="text-xs font-bold uppercase tracking-widest">Live Analysis</span>
            </div>
            <h2 className="text-3xl font-black tracking-tighter leading-none italic uppercase">
              Predict the <br /> <span className="text-orange-500">Unpredictable</span>
            </h2>
            <p className="text-zinc-400 text-sm max-w-[240px]">
              Powered by Gemini AI for deep tactical insights and match outcomes.
            </p>
          </div>
        </section>

        {/* Tabs */}
        <Tabs defaultValue="upcoming" className="w-full">
          <TabsList className="grid w-full grid-cols-3 bg-zinc-900 border border-zinc-800 p-1">
            <TabsTrigger value="upcoming" className="data-[state=active]:bg-zinc-800">Upcoming</TabsTrigger>
            <TabsTrigger value="leagues" className="data-[state=active]:bg-zinc-800">Leagues</TabsTrigger>
            <TabsTrigger value="history" className="data-[state=active]:bg-zinc-800">History</TabsTrigger>
          </TabsList>

          <TabsContent value="upcoming" className="mt-4 space-y-4">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-500 flex items-center gap-2">
                <Calendar className="w-4 h-4" /> Hot Fixtures
              </h3>
              <Button variant="ghost" size="sm" className="text-xs text-zinc-500 hover:text-zinc-100">
                View All <ChevronRight className="w-3 h-3 ml-1" />
              </Button>
            </div>

            <div className="space-y-3">
              {MOCK_MATCHES.map((match) => (
                <motion.div
                  key={match.id}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                >
                  <Card className="bg-zinc-900 border-zinc-800 hover:border-orange-500/50 transition-colors cursor-pointer overflow-hidden" onClick={() => handlePredict(match)}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <Badge variant="secondary" className="bg-zinc-800 text-zinc-400 text-[10px] uppercase font-bold tracking-tighter">
                          {match.league}
                        </Badge>
                        <span className="text-[10px] font-mono text-zinc-500">{match.time}</span>
                      </div>
                      
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex-1 flex flex-col items-center gap-2">
                          <div className="w-12 h-12 rounded-full bg-zinc-800 p-2 border border-zinc-700">
                            <img src={match.homeLogo} alt={match.homeTeam} className="w-full h-full object-contain" referrerPolicy="no-referrer" />
                          </div>
                          <span className="text-xs font-bold text-center leading-tight">{match.homeTeam}</span>
                        </div>
                        
                        <div className="flex flex-col items-center gap-1">
                          <span className="text-xl font-black italic text-zinc-700">VS</span>
                          <div className="px-2 py-0.5 bg-orange-500/10 rounded border border-orange-500/20">
                            <Zap className="w-3 h-3 text-orange-500" />
                          </div>
                        </div>

                        <div className="flex-1 flex flex-col items-center gap-2">
                          <div className="w-12 h-12 rounded-full bg-zinc-800 p-2 border border-zinc-700">
                            <img src={match.awayLogo} alt={match.awayTeam} className="w-full h-full object-contain" referrerPolicy="no-referrer" />
                          </div>
                          <span className="text-xs font-bold text-center leading-tight">{match.awayTeam}</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="leagues" className="mt-4">
             <Card className="bg-zinc-900 border-zinc-800">
                <CardContent className="p-8 flex flex-col items-center justify-center text-center space-y-4">
                  <Trophy className="w-12 h-12 text-zinc-700" />
                  <div className="space-y-1">
                    <p className="font-bold">League Explorer</p>
                    <p className="text-sm text-zinc-500">Browse predictions by league and competition.</p>
                  </div>
                  <Button variant="outline" className="border-zinc-800 hover:bg-zinc-800">Coming Soon</Button>
                </CardContent>
             </Card>
          </TabsContent>

          <TabsContent value="history" className="mt-4">
             <Card className="bg-zinc-900 border-zinc-800">
                <CardContent className="p-8 flex flex-col items-center justify-center text-center space-y-4">
                  <History className="w-12 h-12 text-zinc-700" />
                  <div className="space-y-1">
                    <p className="font-bold">Prediction History</p>
                    <p className="text-sm text-zinc-500">Track your previous AI predictions and their accuracy.</p>
                  </div>
                  <Button variant="outline" className="border-zinc-800 hover:bg-zinc-800">Coming Soon</Button>
                </CardContent>
             </Card>
          </TabsContent>
        </Tabs>

        {/* Prediction Modal/Section */}
        <AnimatePresence>
          {selectedMatch && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="fixed inset-0 z-[100] p-4 flex items-end sm:items-center justify-center bg-zinc-950/80 backdrop-blur-sm"
              onClick={() => !isPredicting && setSelectedMatch(null)}
            >
              <Card 
                className="w-full max-w-lg bg-zinc-900 border-zinc-800 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <CardHeader className="border-b border-zinc-800 pb-4">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Zap className="w-5 h-5 text-orange-500" />
                      AI Analysis
                    </CardTitle>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-8 w-8 rounded-full hover:bg-zinc-800"
                      onClick={() => setSelectedMatch(null)}
                      disabled={isPredicting}
                    >
                      <ChevronRight className="w-4 h-4 rotate-90" />
                    </Button>
                  </div>
                  <CardDescription>
                    {selectedMatch.homeTeam} vs {selectedMatch.awayTeam}
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <ScrollArea className="h-[60vh] p-6">
                    {isPredicting ? (
                      <div className="flex flex-col items-center justify-center py-12 space-y-4">
                        <div className="relative">
                          <div className="w-16 h-16 border-4 border-orange-500/20 border-t-orange-500 rounded-full animate-spin" />
                          <Zap className="absolute inset-0 m-auto w-6 h-6 text-orange-500 animate-pulse" />
                        </div>
                        <div className="text-center space-y-1">
                          <p className="font-bold text-zinc-200">Analyzing Match Data...</p>
                          <p className="text-xs text-zinc-500">Processing team form, injuries, and H2H stats</p>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-6">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800 flex items-center gap-3">
                            <BarChart3 className="w-4 h-4 text-orange-500" />
                            <div>
                              <p className="text-[10px] uppercase font-bold text-zinc-500">Confidence</p>
                              <p className="text-sm font-bold">84%</p>
                            </div>
                          </div>
                          <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800 flex items-center gap-3">
                            <ShieldCheck className="w-4 h-4 text-green-500" />
                            <div>
                              <p className="text-[10px] uppercase font-bold text-zinc-500">Risk Level</p>
                              <p className="text-sm font-bold">Low</p>
                            </div>
                          </div>
                        </div>

                        <div className="prose prose-invert prose-sm max-w-none">
                          <div className="whitespace-pre-wrap text-zinc-300 leading-relaxed font-mono text-xs">
                            {prediction}
                          </div>
                        </div>

                        <Separator className="bg-zinc-800" />

                        <div className="bg-orange-500/5 border border-orange-500/10 p-4 rounded-xl flex gap-3">
                          <Info className="w-5 h-5 text-orange-500 shrink-0" />
                          <p className="text-[10px] text-zinc-400 italic">
                            Predictions are generated by AI based on historical data. Always gamble responsibly.
                          </p>
                        </div>
                      </div>
                    )}
                  </ScrollArea>
                  <div className="p-4 border-t border-zinc-800">
                    <Button 
                      className="w-full bg-orange-500 hover:bg-orange-600 text-zinc-950 font-bold"
                      onClick={() => setSelectedMatch(null)}
                      disabled={isPredicting}
                    >
                      Close Analysis
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Navigation Bar (Mobile Style) */}
      <nav className="fixed bottom-0 left-0 right-0 bg-zinc-950/90 backdrop-blur-lg border-t border-zinc-800 px-6 py-3 flex items-center justify-between z-40">
        <button className="flex flex-col items-center gap-1 text-orange-500">
          <Zap className="w-6 h-6" />
          <span className="text-[10px] font-bold uppercase tracking-tighter">Predict</span>
        </button>
        <button className="flex flex-col items-center gap-1 text-zinc-500 hover:text-zinc-300">
          <Trophy className="w-6 h-6" />
          <span className="text-[10px] font-bold uppercase tracking-tighter">Leagues</span>
        </button>
        <button className="flex flex-col items-center gap-1 text-zinc-500 hover:text-zinc-300">
          <BarChart3 className="w-6 h-6" />
          <span className="text-[10px] font-bold uppercase tracking-tighter">Stats</span>
        </button>
        <button className="flex flex-col items-center gap-1 text-zinc-500 hover:text-zinc-300">
          <User className="w-6 h-6" />
          <span className="text-[10px] font-bold uppercase tracking-tighter">Profile</span>
        </button>
      </nav>
      
      {/* Bottom Padding for Nav */}
      <div className="h-20" />
    </div>
  );
}
