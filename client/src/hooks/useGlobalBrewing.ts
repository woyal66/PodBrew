import { useContext } from 'react';
import { GlobalBrewingContext } from '@/contexts/GlobalBrewingContext';

export function useGlobalBrewing() {
  const context = useContext(GlobalBrewingContext);
  if (!context) {
    throw new Error('useGlobalBrewing must be used within a GlobalBrewingProvider');
  }
  return context;
}
