import { Link, useLocation } from "wouter";
import { Home, TrendingUp, Library, Settings } from "lucide-react";
import { AnimatedLogo } from "./animated-logo";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { useState, useEffect } from "react";
import { useAttentionCues } from "@/hooks/use-attention-cues";
import { useAnalytics } from "@/hooks/use-analytics";

export function HeaderNav() {
  const [location, setLocation] = useLocation();
  const [isHeaderVisible, setIsHeaderVisible] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);
  const { showListenPulse, dismissListenPulse } = useAttentionCues();
  const { trackListenPageVisit } = useAnalytics();

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      
      if (currentScrollY < lastScrollY || currentScrollY < 10) {
        setIsHeaderVisible(true);
      } 
      else if (currentScrollY > lastScrollY && currentScrollY > 80) {
        setIsHeaderVisible(false);
      }
      
      setLastScrollY(currentScrollY);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [lastScrollY]);

  const navItems = [
    { path: "/", label: "Create", icon: Home, testId: "nav-create" },
    { path: "/listen", label: "Trending", icon: TrendingUp, testId: "nav-trending" },
    { path: "/library", label: "Library", icon: Library, testId: "nav-library" },
  ];

  return (
    <header 
      className={`fixed top-0 left-0 right-0 z-50 bg-background transition-transform duration-300 ${
        isHeaderVisible ? 'translate-y-0' : '-translate-y-full'
      }`}
    >
      <div className="flex items-center justify-between px-4 md:px-6 h-14 md:h-16 w-full">
        <Link 
          href="/" 
          className="hover-elevate active-elevate-2 px-2 md:px-3 py-2 rounded-md transition-colors" 
          data-testid="logo-link"
        >
          <AnimatedLogo />
        </Link>

        <nav className="hidden md:flex items-center gap-1 absolute left-1/2 -translate-x-1/2">
          {navItems.map((item) => {
            const isActive = location === item.path;
            const Icon = item.icon;
            const isListenButton = item.path === "/listen";
            
            const handleNavClick = () => {
              if (isListenButton) {
                dismissListenPulse();
                trackListenPageVisit('navigation');
              }
            };
            
            return (
              <Button
                key={item.path}
                variant={isActive ? "secondary" : "ghost"}
                className={`gap-2 ${isListenButton && showListenPulse ? 'attention-pulse' : ''}`}
                onClick={handleNavClick}
                asChild
              >
                <Link
                  href={item.path}
                  data-testid={item.testId}
                  aria-current={isActive ? "page" : undefined}
                >
                  <Icon className="h-4 w-4" />
                  <span className="text-sm font-medium">{item.label}</span>
                </Link>
              </Button>
            );
          })}
        </nav>

        <div className="flex items-center gap-1.5 md:gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setLocation('/settings')}
                className="hover-elevate active-elevate-2 h-8 w-8 md:h-9 md:w-9"
                data-testid="button-open-settings"
              >
                <Settings className="h-4 w-4 md:h-5 md:w-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Settings</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </header>
  );
}
