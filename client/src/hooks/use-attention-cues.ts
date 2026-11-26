import { useState, useEffect } from "react";

const LISTEN_PULSE_KEY = "podbrew_listen_pulse_shown";
const PULSE_DURATION = 15000; // 15 seconds

export function useAttentionCues() {
  const [showListenPulse, setShowListenPulse] = useState(false);

  useEffect(() => {
    // Check if user has already seen the Listen pulse
    const pulseShown = localStorage.getItem(LISTEN_PULSE_KEY);
    
    if (!pulseShown) {
      setShowListenPulse(true);
      
      // Stop pulsing after 15 seconds
      const timer = setTimeout(() => {
        setShowListenPulse(false);
        localStorage.setItem(LISTEN_PULSE_KEY, "true");
      }, PULSE_DURATION);
      
      return () => clearTimeout(timer);
    }
  }, []);

  const dismissListenPulse = () => {
    setShowListenPulse(false);
    localStorage.setItem(LISTEN_PULSE_KEY, "true");
  };

  return {
    showListenPulse,
    dismissListenPulse,
  };
}
