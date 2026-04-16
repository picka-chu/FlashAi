import { useEffect, useRef } from 'react';
import { useUserStore } from '../store/useUserStore';
import axios from 'axios';

export const useMarketingBot = () => {
  const { user } = useUserStore();
  const hasTriggeredFomo = useRef(false);
  const hasTriggeredAddiction = useRef(false);

  useEffect(() => {
    if (!user?.telegram_id) return;

    const sendBotNotification = async (type: string) => {
      try {
        await axios.post('/api/bot/notify', {
          telegram_id: user.telegram_id,
          type
        });
      } catch (e) {
        console.error("Failed to trigger bot notification", e);
      }
    };

    // Trigger FOMO notification 2 minutes after opening the app
    const fomoTimer = setTimeout(() => {
      if (!hasTriggeredFomo.current) {
        sendBotNotification('fomo');
        hasTriggeredFomo.current = true;
      }
    }, 120000);

    // Trigger Addiction/Streak notification 5 minutes after opening
    const addictionTimer = setTimeout(() => {
      if (!hasTriggeredAddiction.current) {
        sendBotNotification('addiction');
        hasTriggeredAddiction.current = true;
      }
    }, 300000);

    // Trigger Comeback notification when user leaves the page (simulated)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        // Send a comeback message 1 hour after they leave (simulated by sending immediately for testing, but ideally handled by a cron job)
        // For demonstration, we'll send it if they leave the app
        sendBotNotification('comeback');
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearTimeout(fomoTimer);
      clearTimeout(addictionTimer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [user?.telegram_id]);
};
