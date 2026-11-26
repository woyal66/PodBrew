import { useEffect, useState, useRef } from "react";
import { Wand2, Sparkles, Settings2, Mic2, Clock, Sliders } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type Voice } from "@shared/schema";
import { getVoiceHumanName } from "@shared/voiceNames";
import { type TemplateFormConfig } from "./templateFormConfigs";
import { TopicInput } from "./TopicInput";
import { DurationSelector } from "./DurationSelector";
import { HostsSelector } from "./HostsSelector";
import { ComplexitySlider } from "./ComplexitySlider";
import { CommonPodcastControls } from "./CommonPodcastControls";
import { VoiceControls } from "./VoiceControls";
import { CoHostPersonality } from "./CoHostPersonality";
import { FormWizard, type WizardStep } from "./FormWizard";
import { useIsMobile } from "@/hooks/use-mobile";
import { SettingsSection } from "./SettingsSection";
import { CostEstimateBar } from "@/components/CostEstimateBar";

interface TemplateFormLayoutProps {
  config: TemplateFormConfig;
  
  topic: string;
  setTopic: (topic: string) => void;
  topicRef?: React.RefObject<HTMLTextAreaElement>;
  
  durationMinutes: number;
  setDurationMinutes: (duration: number) => void;
  
  languageComplexity: number;
  setLanguageComplexity: (complexity: number) => void;
  
  numPeople: number;
  setNumPeople: (num: number) => void;
  
  podcastStyle: string;
  setPodcastStyle: (style: string) => void;
  timeFrame: string;
  setTimeFrame: (frame: string) => void;
  coHostPersonality: string;
  setCoHostPersonality: (personality: string) => void;
  podcastMood: string;
  setPodcastMood: (mood: string) => void;
  language: string;
  setLanguage: (lang: string) => void;
  
  selectedVoicePool: string[];
  setSelectedVoicePool: (voices: string[]) => void;
  assignedVoices: string[];
  selectedVoiceIds: string[];
  selectedVoices: Voice[];
  setShowVoiceModal: (show: boolean) => void;
  
  creditsData?: { credits: number; plan: string };
  
  isListening: boolean;
  onVoiceInput: () => void;
  onEnhanceTopic: () => void;
  onToggleLocation?: () => void;
  isEnhancing: boolean;
  onSubmit: (e: React.FormEvent, ...args: any[]) => void;
  isGenerating: boolean;
  brewProgress?: number;
  brewStatus?: string;
  onCancelBrew?: () => void;
  
  children?: React.ReactNode;
  beforeCommonControls?: React.ReactNode;
  discoverySection?: React.ReactNode;
  formTestId?: string;
  isFormValid?: boolean;
  
  locationEnabled?: boolean;
  locationCity?: string | null;
  showLocationToggle?: boolean;
  onMorpheus?: () => void;
  showMorpheus?: boolean;
  isMorpheusOpen?: boolean;
  onQuickBrew?: () => void;
  showQuickBrew?: boolean;
  isQuickBrewLoading?: boolean;
  quickBrewProgress?: number;
  quickBrewStatus?: string;
}

export function TemplateFormLayout({
  config,
  topic,
  setTopic,
  topicRef,
  durationMinutes,
  setDurationMinutes,
  languageComplexity,
  setLanguageComplexity,
  numPeople,
  setNumPeople,
  podcastStyle,
  setPodcastStyle,
  timeFrame,
  setTimeFrame,
  coHostPersonality,
  setCoHostPersonality,
  podcastMood,
  setPodcastMood,
  language,
  setLanguage,
  selectedVoicePool,
  setSelectedVoicePool,
  assignedVoices,
  selectedVoiceIds,
  selectedVoices,
  setShowVoiceModal,
  creditsData,
  isListening,
  onVoiceInput,
  onEnhanceTopic,
  onToggleLocation,
  isEnhancing,
  onSubmit,
  isGenerating,
  brewProgress = 0,
  brewStatus = "",
  onCancelBrew,
  children,
  beforeCommonControls,
  discoverySection,
  formTestId,
  isFormValid = true,
  locationEnabled = false,
  locationCity = null,
  showLocationToggle = config.showLocationToggle !== false,
  onMorpheus,
  showMorpheus = true,
  isMorpheusOpen = false,
  onQuickBrew,
  showQuickBrew = false,
  isQuickBrewLoading = false,
  quickBrewProgress = 0,
  quickBrewStatus = "",
}: TemplateFormLayoutProps) {
  const isMobile = useIsMobile();
  const [hasSubmittedWithoutChanges, setHasSubmittedWithoutChanges] = useState(false);
  const [showBrewPulse, setShowBrewPulse] = useState(false);
  const prevIsGeneratingRef = useRef(isGenerating);

  useEffect(() => {
    if (config.defaultPodcastStyle) {
      setPodcastStyle(config.defaultPodcastStyle);
    }
    if (config.showTimeFrame === false) {
      setTimeFrame("allTime");
    }
  }, [config.defaultPodcastStyle, setPodcastStyle, config.showTimeFrame, setTimeFrame]);

  useEffect(() => {
    if (!prevIsGeneratingRef.current && isGenerating) {
      setShowBrewPulse(true);
      const timer = setTimeout(() => setShowBrewPulse(false), 1500);
      return () => clearTimeout(timer);
    }
    prevIsGeneratingRef.current = isGenerating;
  }, [isGenerating]);

  useEffect(() => {
    setHasSubmittedWithoutChanges(false);
  }, [topic, durationMinutes, languageComplexity, numPeople, podcastStyle, timeFrame, coHostPersonality, podcastMood, language, selectedVoicePool, selectedVoiceIds]);

  const handleFormSubmit = (e: React.FormEvent, ...args: any[]) => {
    setHasSubmittedWithoutChanges(true);
    onSubmit(e, ...args);
  };

  const hasManualVoiceSelected = selectedVoicePool.length > 0 || selectedVoiceIds.length > 0;
  const hasAutoAssignedVoices = assignedVoices.length > 0;
  const canSubmit = topic.trim() && isFormValid && !isGenerating && !hasSubmittedWithoutChanges;

  if (isMobile) {
    const wizardSteps: WizardStep[] = [
      {
        id: "topic",
        title: "What's your topic?",
        shortTitle: "Topic",
        icon: <Sparkles className="w-4 h-4" />,
        isValid: topic.trim().length > 0,
        content: (
          <div className="space-y-2">
            {discoverySection}
            <Card className="bg-card/50">
              <CardContent className="pt-3 pb-3 space-y-3">
                {config.templateId === 'documents' && beforeCommonControls}
                
                <TopicInput
                  label={config.topicLabel}
                  description={config.topicDescription}
                  placeholder={config.topicPlaceholder}
                  icon={config.topicIcon}
                  testId={config.topicTestId}
                  value={topic}
                  onChange={setTopic}
                  onVoiceInput={onVoiceInput}
                  onEnhanceTopic={onEnhanceTopic}
                  onToggleLocation={onToggleLocation}
                  onMorpheus={onMorpheus}
                  onQuickBrew={onQuickBrew}
                  isListening={isListening}
                  isEnhancing={isEnhancing}
                  isGenerating={isGenerating}
                  isQuickBrewLoading={isQuickBrewLoading}
                  brewProgress={quickBrewProgress}
                  brewStatus={quickBrewStatus}
                  topicRef={topicRef}
                  locationEnabled={locationEnabled}
                  locationCity={locationCity}
                  showLocationToggle={showLocationToggle}
                  showMorpheus={showMorpheus}
                  isMorpheusOpen={isMorpheusOpen}
                  showQuickBrew={showQuickBrew}
                  compact={true}
                />
              </CardContent>
            </Card>
          </div>
        ),
      },
      {
        id: "settings",
        title: "Customize your podcast",
        shortTitle: "Settings",
        icon: <Settings2 className="w-4 h-4" />,
        isValid: true,
        content: (
          <div className="space-y-4">
            {config.templateId !== 'documents' && beforeCommonControls}
            
            {/* Format Section */}
            <SettingsSection 
              icon={Clock} 
              title="Format" 
              description="Length and complexity"
            >
              <DurationSelector
                durationMinutes={durationMinutes}
                setDurationMinutes={setDurationMinutes}
                isGenerating={isGenerating}
              />

              <ComplexitySlider
                languageComplexity={languageComplexity}
                setLanguageComplexity={setLanguageComplexity}
                isGenerating={isGenerating}
              />
            </SettingsSection>

            {/* Style Section */}
            <SettingsSection 
              icon={Sliders} 
              title="Style & Tone" 
              description="Customize the feel"
            >
              {children}

              <CommonPodcastControls
                podcastStyle={podcastStyle}
                setPodcastStyle={setPodcastStyle}
                timeFrame={timeFrame}
                setTimeFrame={setTimeFrame}
                podcastMood={podcastMood}
                setPodcastMood={setPodcastMood}
                language={language}
                setLanguage={setLanguage}
                isGenerating={isGenerating}
                styleOptions={config.styleOptions}
                timeFrameOptions={config.timeFrameOptions}
                showPodcastStyle={config.showPodcastStyle !== false}
                showTimeFrame={config.showTimeFrame !== false}
                hideLanguage={true}
              />
            </SettingsSection>
          </div>
        ),
      },
      {
        id: "voice",
        title: "Choose voices",
        shortTitle: "Voice",
        icon: <Mic2 className="w-4 h-4" />,
        isValid: true,
        content: (
          <Card className="bg-card/50">
            <CardContent className="pt-4 space-y-4">
              <div>
                <Label htmlFor="language" className="text-sm font-medium mb-2 block">Language</Label>
                <Select value={language} onValueChange={setLanguage} disabled={isGenerating}>
                  <SelectTrigger id="language" data-testid="select-language">
                    <SelectValue placeholder="Select a language" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[300px]">
                    <SelectItem value="en" data-testid="language-english">English</SelectItem>
                    <SelectItem value="es" data-testid="language-spanish">Spanish</SelectItem>
                    <SelectItem value="fr" data-testid="language-french">French</SelectItem>
                    <SelectItem value="de" data-testid="language-german">German</SelectItem>
                    <SelectItem value="it" data-testid="language-italian">Italian</SelectItem>
                    <SelectItem value="pt" data-testid="language-portuguese">Portuguese</SelectItem>
                    <SelectItem value="nl" data-testid="language-dutch">Dutch</SelectItem>
                    <SelectItem value="pl" data-testid="language-polish">Polish</SelectItem>
                    <SelectItem value="ru" data-testid="language-russian">Russian</SelectItem>
                    <SelectItem value="ja" data-testid="language-japanese">Japanese</SelectItem>
                    <SelectItem value="ko" data-testid="language-korean">Korean</SelectItem>
                    <SelectItem value="zh" data-testid="language-chinese">Chinese</SelectItem>
                    <SelectItem value="ar" data-testid="language-arabic">Arabic</SelectItem>
                    <SelectItem value="hi" data-testid="language-hindi">Hindi</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <HostsSelector
                numPeople={numPeople}
                setNumPeople={setNumPeople}
                isGenerating={isGenerating}
                label={config.templateId === 'news' ? 'Number of Anchors' : 'Number of Hosts'}
              />

              {config.showCoHostPersonality !== false && (
                <CoHostPersonality
                  value={coHostPersonality}
                  onChange={setCoHostPersonality}
                  numPeople={numPeople}
                  isGenerating={isGenerating}
                  personalityOptions={config.personalityOptions}
                />
              )}

              <VoiceControls
                selectedVoiceIds={selectedVoiceIds}
                selectedVoices={selectedVoices}
                onOpenModal={() => setShowVoiceModal(true)}
                creditsData={creditsData}
                durationMinutes={durationMinutes}
                isGenerating={isGenerating}
              />

              {selectedVoiceIds.length === 0 && assignedVoices.length > 0 && (
                <div className="pt-4 border-t">
                  <Label className="text-sm font-medium mb-2 block">Auto-Assigned Voices</Label>
                  <div className="flex flex-wrap gap-2">
                    {assignedVoices.map((voice, index) => (
                      <Badge
                        key={`${voice}-${index}`}
                        variant="secondary"
                        className="capitalize px-3 py-1.5"
                        data-testid={`badge-assigned-voice-${voice}-${index}`}
                      >
                        {getVoiceHumanName(voice)}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ),
      },
    ];

    return (
      <div data-testid={formTestId || `form-${config.templateId}`} className="relative">
        <FormWizard
          steps={wizardSteps}
          onSubmit={handleFormSubmit}
          isGenerating={isGenerating}
          hasSubmittedWithoutChanges={hasSubmittedWithoutChanges}
          showBrewPulse={showBrewPulse}
          submitButtonText={config.submitButtonText}
          submitButtonGeneratingText={config.submitButtonGeneratingText}
          creditsData={creditsData}
          durationMinutes={durationMinutes}
          templateName={config.templateId}
        />

      </div>
    );
  }

  return (
    <form 
      onSubmit={handleFormSubmit} 
      className="space-y-4" 
      data-testid={formTestId || `form-${config.templateId}`}
    >
      {/* Discovery Section - appears before the form on desktop */}
      {discoverySection}

      {/* Topic Section */}
      <Card className="bg-card/50">
        <CardContent className="pt-6 space-y-4">
          {config.templateId !== 'documents' && (
            <TopicInput
              label={config.topicLabel}
              description={config.topicDescription}
              placeholder={config.topicPlaceholder}
              icon={config.topicIcon}
              testId={config.topicTestId}
              value={topic}
              onChange={setTopic}
              onVoiceInput={onVoiceInput}
              onEnhanceTopic={onEnhanceTopic}
              onToggleLocation={onToggleLocation}
              onMorpheus={onMorpheus}
              onQuickBrew={onQuickBrew}
              isListening={isListening}
              isEnhancing={isEnhancing}
              isGenerating={isGenerating}
              isQuickBrewLoading={isQuickBrewLoading}
              topicRef={topicRef}
              locationEnabled={locationEnabled}
              locationCity={locationCity}
              showLocationToggle={showLocationToggle}
              showMorpheus={showMorpheus}
              isMorpheusOpen={isMorpheusOpen}
              showQuickBrew={showQuickBrew}
            />
          )}

          {beforeCommonControls}

          {config.templateId === 'documents' && (
            <TopicInput
              label={config.topicLabel}
              description={config.topicDescription}
              placeholder={config.topicPlaceholder}
              icon={config.topicIcon}
              testId={config.topicTestId}
              value={topic}
              onChange={setTopic}
              onVoiceInput={onVoiceInput}
              onEnhanceTopic={onEnhanceTopic}
              onToggleLocation={onToggleLocation}
              onMorpheus={onMorpheus}
              onQuickBrew={onQuickBrew}
              isListening={isListening}
              isEnhancing={isEnhancing}
              isGenerating={isGenerating}
              isQuickBrewLoading={isQuickBrewLoading}
              topicRef={topicRef}
              locationEnabled={locationEnabled}
              locationCity={locationCity}
              showLocationToggle={showLocationToggle}
              showMorpheus={showMorpheus}
              isMorpheusOpen={isMorpheusOpen}
              showQuickBrew={showQuickBrew}
            />
          )}
        </CardContent>
      </Card>

      {/* Format Section - Duration & Complexity */}
      <SettingsSection 
        icon={Clock} 
        title="Format" 
        description="Set length and complexity"
      >
        <DurationSelector
          durationMinutes={durationMinutes}
          setDurationMinutes={setDurationMinutes}
          isGenerating={isGenerating}
        />

        <ComplexitySlider
          languageComplexity={languageComplexity}
          setLanguageComplexity={setLanguageComplexity}
          isGenerating={isGenerating}
        />
      </SettingsSection>

      {/* Content Style Section */}
      <SettingsSection 
        icon={Sliders} 
        title="Style & Tone" 
        description="Customize the podcast feel"
      >
        {children}

        <CommonPodcastControls
          podcastStyle={podcastStyle}
          setPodcastStyle={setPodcastStyle}
          timeFrame={timeFrame}
          setTimeFrame={setTimeFrame}
          podcastMood={podcastMood}
          setPodcastMood={setPodcastMood}
          language={language}
          setLanguage={setLanguage}
          isGenerating={isGenerating}
          styleOptions={config.styleOptions}
          timeFrameOptions={config.timeFrameOptions}
          showPodcastStyle={config.showPodcastStyle !== false}
          showTimeFrame={config.showTimeFrame !== false}
        />
      </SettingsSection>

      {/* Voice Section */}
      <SettingsSection 
        icon={Mic2} 
        title="Voices" 
        description="Choose hosts and voices"
      >
        <HostsSelector
          numPeople={numPeople}
          setNumPeople={setNumPeople}
          isGenerating={isGenerating}
          label={config.templateId === 'news' ? 'Number of Anchors' : 'Number of Hosts'}
        />

        {config.showCoHostPersonality !== false && (
          <CoHostPersonality
            value={coHostPersonality}
            onChange={setCoHostPersonality}
            numPeople={numPeople}
            isGenerating={isGenerating}
            personalityOptions={config.personalityOptions}
          />
        )}

        <VoiceControls
          selectedVoiceIds={selectedVoiceIds}
          selectedVoices={selectedVoices}
          onOpenModal={() => setShowVoiceModal(true)}
          creditsData={creditsData}
          durationMinutes={durationMinutes}
          isGenerating={isGenerating}
        />

        {selectedVoiceIds.length === 0 && assignedVoices.length > 0 && (
          <div className="pt-4 border-t border-border/50">
            <Label className="text-sm font-medium mb-2 block">Auto-Assigned Voices</Label>
            <div className="flex flex-wrap gap-2">
              {assignedVoices.map((voice, index) => (
                <Badge
                  key={`${voice}-${index}`}
                  variant="secondary"
                  className="capitalize px-3 py-1.5"
                  data-testid={`badge-assigned-voice-${voice}-${index}`}
                >
                  {getVoiceHumanName(voice)}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </SettingsSection>

      <CostEstimateBar
        durationMinutes={durationMinutes}
        numPeople={numPeople}
        creditsAvailable={creditsData?.credits}
        plan={creditsData?.plan}
      />

      <Button
        type="submit"
        size="lg"
        className={`w-full text-lg font-semibold ${showBrewPulse ? 'animate-pulsate-finite' : canSubmit ? 'animate-pulsate' : ''}`}
        disabled={!canSubmit}
        data-testid="button-brew"
      >
        <Wand2 className="mr-2 w-5 h-5" />
        {isGenerating ? config.submitButtonGeneratingText : config.submitButtonText}
      </Button>

    </form>
  );
}
