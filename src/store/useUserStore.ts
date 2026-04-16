import { create } from 'zustand';
import { UserProfile, UserPlan } from '../types';
import { PredictionResult } from '../types/prediction';

export type AnalysisResult = PredictionResult;

interface UserState {
  user: UserProfile | null;
  selectedMatch: any | null;
  analysisResult: AnalysisResult | null;
  isAnalyzing: boolean;
  isLoading: boolean;
  setUser: (user: UserProfile | null) => void;
  setSelectedMatch: (match: any | null) => void;
  setAnalysisResult: (result: AnalysisResult | null) => void;
  setIsAnalyzing: (is: boolean) => void;
  updateCredits: (credits: number) => void;
  updatePlan: (plan: UserPlan) => void;
  setLoading: (isLoading: boolean) => void;
}

export const useUserStore = create<UserState>((set) => ({
  user: null,
  selectedMatch: null,
  analysisResult: null,
  isAnalyzing: false,
  isLoading: true,
  setUser: (user) => set({ user, isLoading: false }),
  setSelectedMatch: (match) => set({ selectedMatch: match }),
  setAnalysisResult: (result) => set({ analysisResult: result }),
  setIsAnalyzing: (is) => set({ isAnalyzing: is }),
  updateCredits: (credits) => 
    set((state) => ({ 
      user: state.user ? { ...state.user, credits } : null 
    })),
  updatePlan: (plan) => 
    set((state) => ({ 
      user: state.user ? { ...state.user, plan } : null 
    })),
  setLoading: (isLoading) => set({ isLoading }),
}));
