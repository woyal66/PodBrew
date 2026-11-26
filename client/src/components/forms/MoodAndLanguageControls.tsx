import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PODCAST_MOODS } from "@shared/schema";

interface MoodAndLanguageControlsProps {
  podcastMood: string;
  setPodcastMood: (mood: string) => void;
  language: string;
  setLanguage: (lang: string) => void;
  isGenerating?: boolean;
  hideLanguage?: boolean;
}

export function MoodAndLanguageControls({
  podcastMood,
  setPodcastMood,
  language,
  setLanguage,
  isGenerating = false,
  hideLanguage = false,
}: MoodAndLanguageControlsProps) {
  return (
    <>
      <div className="space-y-2">
        <Label className="text-sm font-medium">Select Mood</Label>
        <RadioGroup
          value={podcastMood}
          onValueChange={setPodcastMood}
          disabled={isGenerating}
          className="flex flex-wrap gap-x-4 gap-y-2"
          data-testid="radiogroup-mood"
        >
          {Object.entries(PODCAST_MOODS).map(([value, config]) => (
            <div key={value} className="flex items-center space-x-1.5">
              <RadioGroupItem 
                value={value} 
                id={`mood-${value}`} 
                data-testid={`radio-mood-${value}`}
                className="h-3.5 w-3.5"
              />
              <Label 
                htmlFor={`mood-${value}`} 
                className="text-sm cursor-pointer font-normal"
              >
                {config.label}
              </Label>
            </div>
          ))}
        </RadioGroup>
      </div>

      {!hideLanguage && (
        <div className="space-y-2">
          <Label className="text-sm font-medium">Language</Label>
          <Select value={language} onValueChange={setLanguage} disabled={isGenerating}>
            <SelectTrigger data-testid="select-language" className="h-9">
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
              <SelectItem value="zh" data-testid="language-chinese">Chinese</SelectItem>
              <SelectItem value="ja" data-testid="language-japanese">Japanese</SelectItem>
              <SelectItem value="ko" data-testid="language-korean">Korean</SelectItem>
              <SelectItem value="ar" data-testid="language-arabic">Arabic</SelectItem>
              <SelectItem value="hi" data-testid="language-hindi">Hindi</SelectItem>
              <SelectItem value="bn" data-testid="language-bengali">Bengali</SelectItem>
              <SelectItem value="tr" data-testid="language-turkish">Turkish</SelectItem>
              <SelectItem value="vi" data-testid="language-vietnamese">Vietnamese</SelectItem>
              <SelectItem value="th" data-testid="language-thai">Thai</SelectItem>
              <SelectItem value="sv" data-testid="language-swedish">Swedish</SelectItem>
              <SelectItem value="no" data-testid="language-norwegian">Norwegian</SelectItem>
              <SelectItem value="da" data-testid="language-danish">Danish</SelectItem>
              <SelectItem value="fi" data-testid="language-finnish">Finnish</SelectItem>
              <SelectItem value="el" data-testid="language-greek">Greek</SelectItem>
              <SelectItem value="cs" data-testid="language-czech">Czech</SelectItem>
              <SelectItem value="ro" data-testid="language-romanian">Romanian</SelectItem>
              <SelectItem value="hu" data-testid="language-hungarian">Hungarian</SelectItem>
              <SelectItem value="uk" data-testid="language-ukrainian">Ukrainian</SelectItem>
              <SelectItem value="he" data-testid="language-hebrew">Hebrew</SelectItem>
              <SelectItem value="id" data-testid="language-indonesian">Indonesian</SelectItem>
              <SelectItem value="ms" data-testid="language-malay">Malay</SelectItem>
              <SelectItem value="tl" data-testid="language-tagalog">Tagalog</SelectItem>
              <SelectItem value="sw" data-testid="language-swahili">Swahili</SelectItem>
              <SelectItem value="af" data-testid="language-afrikaans">Afrikaans</SelectItem>
              <SelectItem value="sq" data-testid="language-albanian">Albanian</SelectItem>
              <SelectItem value="am" data-testid="language-amharic">Amharic</SelectItem>
              <SelectItem value="hy" data-testid="language-armenian">Armenian</SelectItem>
              <SelectItem value="az" data-testid="language-azerbaijani">Azerbaijani</SelectItem>
              <SelectItem value="eu" data-testid="language-basque">Basque</SelectItem>
              <SelectItem value="be" data-testid="language-belarusian">Belarusian</SelectItem>
              <SelectItem value="bs" data-testid="language-bosnian">Bosnian</SelectItem>
              <SelectItem value="bg" data-testid="language-bulgarian">Bulgarian</SelectItem>
              <SelectItem value="ca" data-testid="language-catalan">Catalan</SelectItem>
              <SelectItem value="hr" data-testid="language-croatian">Croatian</SelectItem>
              <SelectItem value="et" data-testid="language-estonian">Estonian</SelectItem>
              <SelectItem value="gl" data-testid="language-galician">Galician</SelectItem>
              <SelectItem value="ka" data-testid="language-georgian">Georgian</SelectItem>
              <SelectItem value="gu" data-testid="language-gujarati">Gujarati</SelectItem>
              <SelectItem value="ht" data-testid="language-haitian">Haitian Creole</SelectItem>
              <SelectItem value="ha" data-testid="language-hausa">Hausa</SelectItem>
              <SelectItem value="is" data-testid="language-icelandic">Icelandic</SelectItem>
              <SelectItem value="ga" data-testid="language-irish">Irish</SelectItem>
              <SelectItem value="jw" data-testid="language-javanese">Javanese</SelectItem>
              <SelectItem value="kn" data-testid="language-kannada">Kannada</SelectItem>
              <SelectItem value="kk" data-testid="language-kazakh">Kazakh</SelectItem>
              <SelectItem value="km" data-testid="language-khmer">Khmer</SelectItem>
              <SelectItem value="lo" data-testid="language-lao">Lao</SelectItem>
              <SelectItem value="la" data-testid="language-latin">Latin</SelectItem>
              <SelectItem value="lv" data-testid="language-latvian">Latvian</SelectItem>
              <SelectItem value="lt" data-testid="language-lithuanian">Lithuanian</SelectItem>
              <SelectItem value="mk" data-testid="language-macedonian">Macedonian</SelectItem>
              <SelectItem value="mg" data-testid="language-malagasy">Malagasy</SelectItem>
              <SelectItem value="ml" data-testid="language-malayalam">Malayalam</SelectItem>
              <SelectItem value="mt" data-testid="language-maltese">Maltese</SelectItem>
              <SelectItem value="mr" data-testid="language-marathi">Marathi</SelectItem>
              <SelectItem value="mn" data-testid="language-mongolian">Mongolian</SelectItem>
              <SelectItem value="ne" data-testid="language-nepali">Nepali</SelectItem>
              <SelectItem value="fa" data-testid="language-persian">Persian</SelectItem>
              <SelectItem value="pa" data-testid="language-punjabi">Punjabi</SelectItem>
              <SelectItem value="sr" data-testid="language-serbian">Serbian</SelectItem>
              <SelectItem value="si" data-testid="language-sinhala">Sinhala</SelectItem>
              <SelectItem value="sk" data-testid="language-slovak">Slovak</SelectItem>
              <SelectItem value="sl" data-testid="language-slovenian">Slovenian</SelectItem>
              <SelectItem value="so" data-testid="language-somali">Somali</SelectItem>
              <SelectItem value="su" data-testid="language-sundanese">Sundanese</SelectItem>
              <SelectItem value="ta" data-testid="language-tamil">Tamil</SelectItem>
              <SelectItem value="te" data-testid="language-telugu">Telugu</SelectItem>
              <SelectItem value="uz" data-testid="language-uzbek">Uzbek</SelectItem>
              <SelectItem value="cy" data-testid="language-welsh">Welsh</SelectItem>
              <SelectItem value="yi" data-testid="language-yiddish">Yiddish</SelectItem>
              <SelectItem value="yo" data-testid="language-yoruba">Yoruba</SelectItem>
              <SelectItem value="zu" data-testid="language-zulu">Zulu</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
    </>
  );
}
