import { Lock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  isNativeIOS,
  isNativeMobile,
  nativeHasMicPermission,
  openNativeAppSettings,
} from "@/lib/nativeBridge";
import { useMicPermissionWatcher } from "@/hooks/useMicPermissionWatcher";
import { useToast } from "@/hooks/use-toast";

interface MicPermissionRecoveryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Called when permission is confirmed granted, either by the user tapping
   * "Check again" or by the auto-recover watcher noticing they granted in
   * Settings and returned to the app.
   */
  onGranted: () => void;
}

export function MicPermissionRecoveryDialog({
  open,
  onOpenChange,
  onGranted,
}: MicPermissionRecoveryDialogProps) {
  const nativeIOS = isNativeIOS();
  const nativeMobile = isNativeMobile();
  const { toast } = useToast();

  const handleOpenAppSettings = () => {
    const launched = openNativeAppSettings();
    if (!launched) {
      // Both the native bridge and the platform-specific scheme fallback
      // failed (very old install). Surface manual instructions so the button
      // isn't a dead-end.
      toast({
        title: "Couldn't open Settings",
        description: nativeIOS
          ? "Open your iPhone's Settings app, then scroll to PodBrew and turn on Microphone."
          : "Open your phone's Settings app, then go to Apps → PodBrew → Permissions and turn on Microphone.",
        variant: "destructive",
      });
    }
  };

  // Auto-recover: when this dialog is open on native Android or iOS, listen
  // for the app to come back to the foreground (e.g. after the user toggles
  // mic in Settings) and silently dismiss + retry.
  useMicPermissionWatcher({
    enabled: open,
    onGranted: () => {
      onOpenChange(false);
      onGranted();
    },
  });

  const handleCheckAgain = async () => {
    if (nativeMobile) {
      const native = nativeHasMicPermission();
      if (native === true) {
        onOpenChange(false);
        onGranted();
        return;
      }
      if (native === false) {
        return;
      }
    }
    if (navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
        onOpenChange(false);
        onGranted();
      } catch {
        // Stay open; user needs to grant in Settings.
      }
    }
  };

  const steps = nativeMobile
    ? null
    : [
        "Tap the lock icon or site-settings icon in your browser's address bar",
        'Tap "Permissions" then "Microphone"',
        'Change the setting to "Allow"',
        "Reload the page and tap the mic again",
      ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        data-testid="dialog-mic-permission-recovery"
      >
        <DialogHeader>
          <div className="mx-auto w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center mb-2">
            <Lock className="w-6 h-6 text-destructive" />
          </div>
          <DialogTitle className="text-center">Microphone access blocked</DialogTitle>
          <DialogDescription className="text-center">
            {nativeMobile
              ? "Microphone was denied. Open your phone settings to re-enable it for PodBrew."
              : "You previously blocked the mic. Here's how to re-enable it:"}
          </DialogDescription>
        </DialogHeader>

        {nativeMobile ? (
          <div className="space-y-3">
            <div className="rounded-lg bg-muted/40 px-4 py-3 text-sm text-muted-foreground text-center">
              {nativeIOS ? (
                <>
                  Settings → PodBrew → Microphone →{" "}
                  <span className="text-foreground font-medium">On</span>
                </>
              ) : (
                <>
                  Settings → Apps → PodBrew → Permissions → Microphone →{" "}
                  <span className="text-foreground font-medium">Allow while using app</span>
                </>
              )}
            </div>
            <Button
              className="w-full"
              onClick={handleOpenAppSettings}
              data-testid="button-open-app-settings-create"
            >
              Open App Settings
            </Button>
          </div>
        ) : (
          steps && (
            <ol className="space-y-2 text-sm">
              {steps.map((step, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">
                    {i + 1}
                  </span>
                  <span className="text-foreground pt-0.5">{step}</span>
                </li>
              ))}
            </ol>
          )
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="flex-1"
            data-testid="button-mic-recovery-close"
          >
            Close
          </Button>
          <Button
            onClick={handleCheckAgain}
            className="flex-1"
            data-testid="button-mic-recovery-check-again"
          >
            Check again
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
