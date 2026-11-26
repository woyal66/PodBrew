import { Link, useLocation } from "wouter";
import { useIsMobile } from "@/hooks/use-mobile";
import { AnimatedLogo } from "@/components/animated-logo";
import { HeaderBrewingIndicator } from "@/components/HeaderBrewingIndicator";
import { VoiceAssistant } from "@/components/voice-assistant";
import { MorningBriefWidget } from "@/components/MorningBriefWidget";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { 
  Sidebar, 
  SidebarContent, 
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { 
  Home, 
  Headphones, 
  Library, 
  Plus,
  Mic2,
  Settings, 
  Search,
  ListMusic,
  Sparkles,
} from "lucide-react";
import { ReactNode } from "react";
import podbrewIconPath from "@assets/icon_1773727280971.png";

interface AppShellProps {
  children: ReactNode;
}

function DesktopSidebar() {
  const [location] = useLocation();
  
  const isCreateMode = location === "/" || location.startsWith("/create");
  const isListenMode = location.startsWith("/listen");
  
  const createItems = [
    { path: "/", icon: Plus, label: "New Podcast", testId: "nav-new-podcast" },
    { path: "/create/voices", icon: Mic2, label: "Voice Studio", testId: "nav-voice-studio" },
  ];
  
  const listenItems = [
    { path: "/listen", icon: Home, label: "Discover", testId: "nav-listen-home" },
  ];
  
  const libraryItems = [
    { path: "/listen/library", icon: Library, label: "Your Podcasts", testId: "nav-your-podcasts" },
    { path: "/listen/playlists", icon: ListMusic, label: "Playlists", testId: "nav-playlists" },
  ];

  return (
    <Sidebar collapsible="icon" className="border-r border-border/50 bg-sidebar/95 backdrop-blur-sm">
      <SidebarHeader className="p-4 border-b border-border/30">
        <Link href="/" className="flex items-center gap-2" data-testid="sidebar-logo">
          <AnimatedLogo />
        </Link>
      </SidebarHeader>
      
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs uppercase tracking-wider text-muted-foreground">
            Create
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {createItems.map((item) => {
                const Icon = item.icon;
                const isActive = location === item.path || location.startsWith(item.path + '/');
                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton 
                      asChild 
                      data-active={isActive}
                      tooltip={item.label}
                    >
                      <Link href={item.path} data-testid={item.testId} className={isActive ? 'bg-sidebar-accent text-sidebar-accent-foreground' : ''}>
                        <Icon className="h-4 w-4" />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs uppercase tracking-wider text-muted-foreground">
            Listen
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {listenItems.map((item) => {
                const Icon = item.icon;
                const isActive = location === item.path || location.startsWith(item.path + '/');
                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton 
                      asChild 
                      data-active={isActive}
                      tooltip={item.label}
                    >
                      <Link href={item.path} data-testid={item.testId} className={isActive ? 'bg-sidebar-accent text-sidebar-accent-foreground' : ''}>
                        <Icon className="h-4 w-4" />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs uppercase tracking-wider text-muted-foreground">
            Your Library
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {libraryItems.map((item) => {
                const Icon = item.icon;
                const isActive = location === item.path || location.startsWith(item.path + '/');
                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton 
                      asChild 
                      data-active={isActive}
                      tooltip={item.label}
                    >
                      <Link href={item.path} data-testid={item.testId} className={isActive ? 'bg-sidebar-accent text-sidebar-accent-foreground' : ''}>
                        <Icon className="h-4 w-4" />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        
        <SidebarGroup className="mt-auto pb-24">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton 
                  asChild 
                  data-active={location === "/settings"}
                  tooltip="Settings"
                >
                  <Link href="/settings" data-testid="nav-settings" className={location === "/settings" ? 'bg-sidebar-accent text-sidebar-accent-foreground' : ''}>
                    <Settings className="h-4 w-4" />
                    <span>Settings</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}

function MobileBottomNav() {
  const [location] = useLocation();
  
  const navItems = [
    { path: "/listen", icon: Home, label: "Discover", testId: "mobile-nav-home" },
    { path: "/", icon: Plus, label: "Create", testId: "mobile-nav-create" },
    { path: "/listen/library", icon: Library, label: "Library", testId: "mobile-nav-library" },
  ];

  const handleAssistantClick = () => {
    window.dispatchEvent(new Event("open-voice-assistant"));
  };

  return (
    <nav 
      className="fixed bottom-0 left-0 right-0 z-[60] bg-card/95 backdrop-blur-xl border-t border-border/30 shadow-2xl md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      data-testid="mobile-bottom-nav"
    >
      <div className="grid grid-cols-4 h-[56px]">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = location === item.path || 
            (item.path.includes('/') && location.startsWith(item.path + '/'));
          
          return (
            <Link
              key={item.path}
              href={item.path}
              className={`flex flex-col items-center justify-center h-full gap-1 transition-colors ${
                isActive ? "text-primary" : "text-muted-foreground"
              }`}
              data-testid={item.testId}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon className="h-5 w-5" />
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          );
        })}
        <button
          onClick={handleAssistantClick}
          className="flex flex-col items-center justify-center h-full gap-1 transition-colors text-muted-foreground"
          data-testid="mobile-nav-assistant"
          aria-label="Open assistant"
        >
          <img
            src={podbrewIconPath}
            alt="Podbrew assistant"
            className="w-7 h-7 rounded-full object-cover"
          />
          <span className="text-[10px] font-medium">Assistant</span>
        </button>
      </div>
    </nav>
  );
}

function MobileHeader() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-lg border-b border-border md:hidden" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="flex items-center px-4 h-14 gap-2">
        <Link href="/" className="flex items-center shrink-0" data-testid="mobile-logo">
          <AnimatedLogo />
        </Link>
        
        <HeaderBrewingIndicator />
        
        <div className="flex items-center gap-2 shrink-0 ml-auto">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                asChild
                data-testid="mobile-settings-button"
              >
                <Link href="/settings">
                  <Settings className="h-4 w-4" />
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Settings</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </header>
  );
}

function DesktopHeader() {
  return (
    <header className="hidden md:flex fixed top-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-lg border-b border-border h-14 items-center px-4 gap-3">
      <div className="flex items-center gap-2 shrink-0">
        <Tooltip>
          <TooltipTrigger asChild>
            <SidebarTrigger data-testid="desktop-sidebar-toggle" />
          </TooltipTrigger>
          <TooltipContent>Toggle sidebar</TooltipContent>
        </Tooltip>
        <Link href="/" className="flex items-center" data-testid="desktop-logo">
          <AnimatedLogo />
        </Link>
      </div>
      
      <HeaderBrewingIndicator />
      
      <div className="flex items-center gap-3 shrink-0 ml-auto">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              asChild
              data-testid="desktop-settings-button"
            >
              <Link href="/settings">
                <Settings className="h-4 w-4" />
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Settings</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}

export function AppShell({ children }: AppShellProps) {
  const isMobile = useIsMobile();
  
  const sidebarStyle = {
    "--sidebar-width": "14rem",
    "--sidebar-width-icon": "3.5rem",
  } as React.CSSProperties;
  
  return (
    <SidebarProvider style={sidebarStyle}>
      <div className="flex min-h-screen w-full overflow-hidden">
        {!isMobile && <DesktopSidebar />}
        
        <div className="flex flex-1 flex-col min-w-0 relative">
          {isMobile ? <MobileHeader /> : <DesktopHeader />}
          
          <main className={`flex-1 overflow-x-hidden min-w-0 md:pt-14 ${isMobile ? 'pb-16' : 'pb-20'}`} style={{ paddingTop: isMobile ? 'calc(3.5rem + env(safe-area-inset-top, 0px))' : undefined }}>
            {children}
          </main>
        </div>
      </div>
      
      {isMobile && <MobileBottomNav />}
      {/* Global Daily Brief edge tab — persists across all pages on mobile */}
      {isMobile && (
        <GlobalDailyBriefEdgeTab />
      )}
      <VoiceAssistant />
    </SidebarProvider>
  );
}

function GlobalDailyBriefEdgeTab() {
  const [, setLocation] = useLocation();
  return (
    <MorningBriefWidget
      onNavigateToNews={() => setLocation("/")}
    />
  );
}
