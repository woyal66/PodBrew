import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLocation } from "wouter";
import { DEFAULT_TIER_RESTRICTIONS, type SubscriptionPlan } from "@shared/schema";

interface HostsSelectorProps {
  numPeople: number;
  setNumPeople: (num: number) => void;
  isGenerating: boolean;
  label?: string;
}

const HOST_OPTIONS = [1, 2, 3, 4, 5];
const COMING_SOON_HOSTS = new Set([4, 5]);

export function HostsSelector({
  numPeople,
  setNumPeople,
  isGenerating,
  label = "Host Count",
}: HostsSelectorProps) {
  const [, navigate] = useLocation();
  const [upgradeDialogOpen, setUpgradeDialogOpen] = useState(false);
  const [attemptedHosts, setAttemptedHosts] = useState<number | null>(null);

  const { data: creditsData, isLoading } = useQuery<{ credits: number; plan: string }>({
    queryKey: ['/api/user/credits'],
  });

  const plan = (creditsData?.plan ?? 'free') as SubscriptionPlan;
  const maxHosts = isLoading ? 5 : (DEFAULT_TIER_RESTRICTIONS[plan]?.maxHosts ?? 3);
  
  const getPlanUpgrade = () => {
    if (plan === 'free' || plan === 'creator' || plan === 'studio') {
      return { name: 'Pro', maxHosts: 4, price: '$19.95/month' };
    }
    if (plan === 'pro') {
      return { name: 'Professional', maxHosts: 5, price: '$29.95/month' };
    }
    return null;
  };

  const handleHostChange = (value: string) => {
    const count = parseInt(value);
    if (COMING_SOON_HOSTS.has(count)) return;
    if (count > maxHosts) {
      setAttemptedHosts(count);
      setUpgradeDialogOpen(true);
      return;
    }
    setNumPeople(count);
  };

  const confirmUpgrade = () => {
    setUpgradeDialogOpen(false);
    navigate('/settings');
  };

  const stayOnCurrent = () => {
    setUpgradeDialogOpen(false);
    setAttemptedHosts(null);
    if (numPeople > maxHosts) {
      setNumPeople(maxHosts);
    }
  };

  const upgradeInfo = getPlanUpgrade();

  return (
    <>
      <div className="space-y-2">
        <Label className="text-sm font-medium">{label}</Label>
        <RadioGroup
          value={numPeople.toString()}
          onValueChange={handleHostChange}
          disabled={isGenerating}
          className="flex gap-4"
          data-testid="radiogroup-hosts"
        >
          {HOST_OPTIONS.map((count) => {
            const isComingSoon = COMING_SOON_HOSTS.has(count);
            const isLocked = !isComingSoon && count > maxHosts;
            const isDisabled = isGenerating || isComingSoon;
            
            return (
              <Tooltip key={count}>
                <TooltipTrigger asChild>
                  <div className="flex items-center space-x-1.5">
                    <RadioGroupItem 
                      value={count.toString()} 
                      id={`hosts-${count}`} 
                      data-testid={`radio-hosts-${count}`}
                      className={`h-3.5 w-3.5 ${isComingSoon || isLocked ? 'opacity-40' : ''}`}
                      disabled={isDisabled}
                    />
                    <Label 
                      htmlFor={`hosts-${count}`} 
                      className={`text-sm font-normal flex items-center gap-1 ${isComingSoon ? 'opacity-40 cursor-not-allowed' : isLocked ? 'opacity-50 cursor-pointer' : 'cursor-pointer'}`}
                    >
                      {count} {count === 1 ? 'Host' : 'Hosts'}
                      {isComingSoon && <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 leading-none">Soon</Badge>}
                      {isLocked && <Sparkles className="w-3 h-3 text-primary" />}
                    </Label>
                  </div>
                </TooltipTrigger>
                {isComingSoon && (
                  <TooltipContent side="top">
                    <p>Coming soon</p>
                  </TooltipContent>
                )}
              </Tooltip>
            );
          })}
        </RadioGroup>
      </div>

      <Dialog open={upgradeDialogOpen} onOpenChange={setUpgradeDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Unlock More Hosts
            </DialogTitle>
            <DialogDescription>
              {attemptedHosts && attemptedHosts > maxHosts && (
                <span>
                  {attemptedHosts} hosts require a higher tier plan
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="p-4 rounded-lg border bg-muted/30">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <Badge variant="outline" className="mb-2 capitalize">{plan} Plan</Badge>
                  <h3 className="font-semibold text-muted-foreground">Current Plan</h3>
                </div>
                <div className="text-right">
                  <div className="text-xl font-bold text-muted-foreground">{maxHosts} hosts</div>
                  <div className="text-xs text-muted-foreground">max per podcast</div>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                More hosts create richer, more dynamic conversations
              </p>
            </div>

            {upgradeInfo && (
              <div className="p-4 rounded-lg border-2 border-primary bg-primary/5">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <Badge className="mb-2 bg-primary/20 text-primary">{upgradeInfo.name} Plan</Badge>
                    <h3 className="font-semibold">Recommended</h3>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-bold">{upgradeInfo.maxHosts} hosts</div>
                    <div className="text-xs text-muted-foreground">max per podcast</div>
                  </div>
                </div>
                <ul className="space-y-1 text-sm">
                  <li className="flex items-start gap-2">
                    <span className="text-primary">✓</span>
                    <span>Up to {upgradeInfo.maxHosts} hosts per podcast</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary">✓</span>
                    <span>More dynamic conversations</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary">✓</span>
                    <span>Panel discussion formats</span>
                  </li>
                </ul>
                <div className="mt-3 pt-3 border-t">
                  <p className="text-sm font-semibold">{upgradeInfo.price}</p>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={stayOnCurrent}
              className="w-full sm:w-auto"
              data-testid="button-stay-current-hosts"
            >
              Stay on {maxHosts} hosts
            </Button>
            <Button
              onClick={confirmUpgrade}
              className="w-full sm:w-auto bg-[#1DB954] hover:bg-[#1DB954]/90 text-black"
              data-testid="button-upgrade-hosts"
            >
              <Sparkles className="h-4 w-4 mr-2" />
              View Plans
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
