import { TEMPLATE_CATEGORIES, type TemplateCategory } from "@shared/schema";
import { 
  Mic, 
  Newspaper, 
  FileText, 
  Trophy, 
  GraduationCap, 
  Calendar, 
  BookOpen, 
  Stethoscope,
  BrainCircuit,
  Lock,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const iconMap = {
  Mic,
  Newspaper,
  FileText,
  Trophy,
  GraduationCap,
  Calendar,
  BookOpen,
  Stethoscope,
  BrainCircuit,
};

const templateColors: Record<string, { bg: string; text: string; border: string }> = {
  custom: { bg: "rgba(29, 185, 84, 0.15)", text: "#1DB954", border: "rgba(29, 185, 84, 0.3)" },
  news: { bg: "rgba(45, 212, 191, 0.15)", text: "#2DD4BF", border: "rgba(45, 212, 191, 0.3)" },
  documents: { bg: "rgba(139, 92, 246, 0.15)", text: "#8B5CF6", border: "rgba(139, 92, 246, 0.3)" },
  sports: { bg: "rgba(245, 158, 11, 0.15)", text: "#F59E0B", border: "rgba(245, 158, 11, 0.3)" },
  teachme: { bg: "rgba(239, 68, 68, 0.15)", text: "#EF4444", border: "rgba(239, 68, 68, 0.3)" },
  events: { bg: "rgba(16, 185, 129, 0.15)", text: "#10B981", border: "rgba(16, 185, 129, 0.3)" },
  stories: { bg: "rgba(236, 72, 153, 0.15)", text: "#EC4899", border: "rgba(236, 72, 153, 0.3)" },
  medical: { bg: "rgba(59, 130, 246, 0.15)", text: "#3B82F6", border: "rgba(59, 130, 246, 0.3)" },
  deepdive: { bg: "rgba(99, 102, 241, 0.15)", text: "#818CF8", border: "rgba(99, 102, 241, 0.3)" },
};

const templateDescriptions: Record<string, string> = {
  custom: "Create a podcast on any topic you choose",
  news: "Generate news and current events podcasts",
  documents: "Convert documents, PDFs, or articles into podcasts",
  sports: "Create sports news and commentary podcasts",
  teachme: "Build educational courses as multi-episode series",
  events: "Generate podcasts about events and conferences",
  stories: "Create narrative-driven story podcasts",
  medical: "Generate medical and health education podcasts",
  deepdive: "NotebookLM-powered conversational deep dive between two AI hosts",
};

interface TemplatePickerProps {
  selectedTemplate: TemplateCategory;
  onSelectTemplate: (template: TemplateCategory) => void;
  /** Templates to completely hide from the picker (e.g. feature-flagged templates not yet available) */
  hiddenTemplates?: TemplateCategory[];
}

export function TemplatePicker({ selectedTemplate, onSelectTemplate, hiddenTemplates = [] }: TemplatePickerProps) {
  return (
    <div className="mb-6 w-full overflow-x-auto scrollbar-hide">
      <div className="flex items-center gap-2 pb-2 min-w-0">
        {Object.entries(TEMPLATE_CATEGORIES)
          .filter(([key]) => !hiddenTemplates.includes(key as TemplateCategory))
          .map(([key, template]) => {
            const IconComponent = iconMap[template.icon as keyof typeof iconMap];
            const isSelected = selectedTemplate === key;
            const colors = templateColors[key] || { bg: "rgba(255,255,255,0.1)", text: "#fff", border: "rgba(255,255,255,0.2)" };

            return (
              <Tooltip key={key}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => onSelectTemplate(key as TemplateCategory)}
                    data-testid={`chip-template-${key}`}
                    data-selected={isSelected}
                    aria-pressed={isSelected}
                    className={`
                      shrink-0 flex items-center gap-2 min-h-[44px] px-4 
                      rounded-md font-medium text-sm
                      transition-all duration-200 ease-out
                      focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50
                      ${isSelected
                        ? "shadow-lg scale-[1.02]"
                        : "hover:shadow-md hover:scale-[1.05] active:scale-[0.98]"
                      }
                    `}
                    style={{
                      backgroundColor: isSelected ? colors.text : colors.bg,
                      borderWidth: "1px",
                      borderStyle: "solid",
                      borderColor: isSelected ? colors.text : colors.border,
                      color: isSelected ? "#000" : colors.text,
                    }}
                  >
                    <IconComponent className="h-4 w-4 shrink-0" style={{ color: isSelected ? "#000" : colors.text }} />
                    <span className="whitespace-nowrap">{template.name}</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {templateDescriptions[key] || template.name}
                </TooltipContent>
              </Tooltip>
            );
          })}
      </div>
    </div>
  );
}
