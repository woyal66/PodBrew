import { 
  SlidersHorizontal, 
  ArrowUpDown, 
  Filter, 
  Globe, 
  Newspaper, 
  Trophy, 
  Mic, 
  Laugh, 
  GraduationCap, 
  Stethoscope, 
  FileText,
  Sparkles 
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";

interface FilterSortMenuProps {
  sortBy: string;
  filterByTemplate: string;
  onSortChange: (value: string) => void;
  onFilterChange: (value: string) => void;
}

const sortOptions = [
  { value: 'listens', label: 'Most Listens' },
  { value: 'date', label: 'Most Recent' },
  { value: 'duration', label: 'Longest First' },
];

const templateOptions = [
  { value: 'all', label: 'All Types', Icon: Globe },
  { value: 'news', label: 'News', Icon: Newspaper },
  { value: 'sports', label: 'Sports', Icon: Trophy },
  { value: 'interview', label: 'Interview', Icon: Mic },
  { value: 'comedy', label: 'Comedy', Icon: Laugh },
  { value: 'educational', label: 'Educational', Icon: GraduationCap },
  { value: 'medical', label: 'Medical', Icon: Stethoscope },
  { value: 'documents', label: 'Documents', Icon: FileText },
  { value: 'custom', label: 'Custom', Icon: Sparkles },
];

export function FilterSortMenu({ 
  sortBy, 
  filterByTemplate, 
  onSortChange, 
  onFilterChange 
}: FilterSortMenuProps) {
  const activeFiltersCount = (filterByTemplate !== 'all' ? 1 : 0);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Mobile: Compact Popover Menu */}
      <div className="block sm:hidden">
        <Popover>
          <PopoverTrigger asChild>
            <Button 
              variant="outline" 
              size="sm" 
              className="gap-2"
              data-testid="button-filter-menu-mobile"
            >
              <SlidersHorizontal className="h-4 w-4" />
              <span>Filter & Sort</span>
              {activeFiltersCount > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1 text-xs">
                  {activeFiltersCount}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80" align="start">
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-2 flex items-center gap-2">
                  <ArrowUpDown className="h-4 w-4" />
                  Sort By
                </label>
                <Select value={sortBy} onValueChange={onSortChange}>
                  <SelectTrigger data-testid="select-sort-mobile">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {sortOptions.map((option) => (
                      <SelectItem 
                        key={option.value} 
                        value={option.value}
                        data-testid={`option-sort-${option.value}`}
                      >
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium mb-2 flex items-center gap-2">
                  <Filter className="h-4 w-4" />
                  Filter by Type
                </label>
                <Select value={filterByTemplate} onValueChange={onFilterChange}>
                  <SelectTrigger data-testid="select-filter-mobile">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {templateOptions.map((option) => {
                      const OptionIcon = option.Icon;
                      return (
                        <SelectItem 
                          key={option.value} 
                          value={option.value}
                          data-testid={`option-filter-${option.value}`}
                        >
                          <span className="flex items-center gap-2">
                            <OptionIcon className="h-4 w-4" />
                            <span>{option.label}</span>
                          </span>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Desktop: Inline Selects */}
      <div className="hidden sm:flex items-center gap-2">
        <div className="flex items-center gap-2">
          <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
          <Select value={sortBy} onValueChange={onSortChange}>
            <SelectTrigger className="w-[160px]" data-testid="select-sort-desktop">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sortOptions.map((option) => (
                <SelectItem 
                  key={option.value} 
                  value={option.value}
                  data-testid={`option-sort-${option.value}`}
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={filterByTemplate} onValueChange={onFilterChange}>
            <SelectTrigger className="w-[160px]" data-testid="select-filter-desktop">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {templateOptions.map((option) => {
                const OptionIcon = option.Icon;
                return (
                  <SelectItem 
                    key={option.value} 
                    value={option.value}
                    data-testid={`option-filter-${option.value}`}
                  >
                    <span className="flex items-center gap-2">
                      <OptionIcon className="h-4 w-4" />
                      <span>{option.label}</span>
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>

        {activeFiltersCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onFilterChange('all')}
            className="text-xs"
            data-testid="button-clear-filters"
          >
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}
