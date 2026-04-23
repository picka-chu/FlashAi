export type UserPlan = 'free' | 'monthly_basic' | 'monthly_pro' | 'admin';

export interface UserProfile {
  id: string;
  telegram_id: number;
  name: string;
  username?: string;
  phone?: string;
  credits: number;
  plan: UserPlan;
  role: 'user' | 'admin';
  photo_url?: string;
}

export interface Match {
  id: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  time: string;
  status: string;
  prediction?: string;
  confidence?: number;
  odds?: string;
}

export interface PredictionHistory {
  id: string;
  user_id: string;
  match_id: string;
  home_team: string;
  away_team: string;
  league: string;
  prediction: string;
  confidence: number;
  analysis: string;
  created_at: string;
}
