import { createContext, useContext, useState, useEffect } from "react";

type Currency = "USD" | "AUD" | "EUR";

interface CurrencyContextType {
  currency: Currency;
  setCurrency: (currency: Currency) => void;
  formatPrice: (priceUSD: number) => string;
  getConvertedPrice: (priceUSD: number) => number;
}

const CurrencyContext = createContext<CurrencyContextType | undefined>(undefined);

// Conversion rates (as of November 2025, approximate)
const CONVERSION_RATES: Record<Currency, number> = {
  USD: 1,
  AUD: 1.54,
  EUR: 0.92,
};

const CURRENCY_SYMBOLS: Record<Currency, string> = {
  USD: "$",
  AUD: "A$",
  EUR: "€",
};

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  const [currency, setCurrencyState] = useState<Currency>("USD");

  // Load currency preference from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem("podbrew_currency");
    if (saved && ["USD", "AUD", "EUR"].includes(saved)) {
      setCurrencyState(saved as Currency);
    }
  }, []);

  const setCurrency = (newCurrency: Currency) => {
    setCurrencyState(newCurrency);
    localStorage.setItem("podbrew_currency", newCurrency);
  };

  const getConvertedPrice = (priceUSD: number): number => {
    return Number((priceUSD * CONVERSION_RATES[currency]).toFixed(2));
  };

  const formatPrice = (priceUSD: number): string => {
    const converted = getConvertedPrice(priceUSD);
    return `${CURRENCY_SYMBOLS[currency]}${converted.toFixed(2)}`;
  };

  return (
    <CurrencyContext.Provider value={{ currency, setCurrency, formatPrice, getConvertedPrice }}>
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() {
  const context = useContext(CurrencyContext);
  if (!context) {
    throw new Error("useCurrency must be used within CurrencyProvider");
  }
  return context;
}
