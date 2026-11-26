import { useState, useEffect } from "react";

const ONBOARDING_KEY = "podbrew_onboarding_completed";
const ONBOARDING_VERSION = "v2"; // Increment to show tour again after updates

export function useOnboarding() {
  const [showTour, setShowTour] = useState(false);
  const [isFirstVisit, setIsFirstVisit] = useState(false);

  useEffect(() => {
    // Check if user has completed onboarding
    const completed = localStorage.getItem(ONBOARDING_KEY);
    const isFirst = !completed || completed !== ONBOARDING_VERSION;
    
    setIsFirstVisit(isFirst);
    
    // Show tour after a brief delay for first-time visitors
    if (isFirst) {
      const timer = setTimeout(() => {
        setShowTour(true);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, []);

  const completeTour = () => {
    localStorage.setItem(ONBOARDING_KEY, ONBOARDING_VERSION);
    setShowTour(false);
    setIsFirstVisit(false);
  };

  const skipTour = () => {
    localStorage.setItem(ONBOARDING_KEY, ONBOARDING_VERSION);
    setShowTour(false);
    setIsFirstVisit(false);
  };

  const restartTour = () => {
    setShowTour(true);
  };

  return {
    showTour,
    isFirstVisit,
    completeTour,
    skipTour,
    restartTour,
  };
}
