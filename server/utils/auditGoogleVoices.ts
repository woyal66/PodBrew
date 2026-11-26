import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import * as fs from 'fs';
import * as path from 'path';

interface VoiceInfo {
  name: string;
  languageCode: string;
  gender: string;
  naturalSampleRateHertz: number;
  modelType: string;
  accent?: string;
  category?: string;
}

async function auditGoogleVoices() {
  console.log('🔍 Auditing Google Cloud TTS voices...\n');

  const credentials = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  
  let client: TextToSpeechClient;
  if (credentials) {
    try {
      const credentialsObj = JSON.parse(credentials);
      client = new TextToSpeechClient({ credentials: credentialsObj });
    } catch (error) {
      console.error('Failed to parse GOOGLE_APPLICATION_CREDENTIALS_JSON:', error);
      throw new Error('Invalid Google Cloud credentials');
    }
  } else {
    client = new TextToSpeechClient();
  }

  try {
    const [response] = await client.listVoices({});
    const voices = response.voices || [];

    console.log(`✅ Found ${voices.length} total voices\n`);

    // Categorize voices
    const categorized: Record<string, VoiceInfo[]> = {
      'en-US': [],
      'en-GB': [],
      'en-AU': [],
      'en-IN': [],
      'en-CA': [],
      'other': [],
    };

    const modelTypes = new Set<string>();
    const genders = { MALE: 0, FEMALE: 0, NEUTRAL: 0 };

    voices.forEach((voice) => {
      const languageCode = voice.languageCodes?.[0] || 'unknown';
      const name = voice.name || 'unknown';
      const gender = String(voice.ssmlGender || 'NEUTRAL');
      const sampleRate = voice.naturalSampleRateHertz || 0;

      // Extract model type from voice name (Neural2, Wavenet, Journey, Studio, News, etc.)
      let modelType = 'Standard';
      if (name.includes('Neural2')) modelType = 'Neural2';
      else if (name.includes('Wavenet')) modelType = 'WaveNet';
      else if (name.includes('Journey')) modelType = 'Journey';
      else if (name.includes('Studio')) modelType = 'Studio';
      else if (name.includes('News')) modelType = 'News';
      else if (name.includes('Polyglot')) modelType = 'Polyglot';

      modelTypes.add(modelType);
      genders[gender as keyof typeof genders]++;

      const voiceInfo: VoiceInfo = {
        name,
        languageCode,
        gender,
        naturalSampleRateHertz: sampleRate,
        modelType,
      };

      // Categorize by language
      if (languageCode.startsWith('en-US')) {
        categorized['en-US'].push(voiceInfo);
      } else if (languageCode.startsWith('en-GB')) {
        categorized['en-GB'].push(voiceInfo);
      } else if (languageCode.startsWith('en-AU')) {
        categorized['en-AU'].push(voiceInfo);
      } else if (languageCode.startsWith('en-IN')) {
        categorized['en-IN'].push(voiceInfo);
      } else if (languageCode.startsWith('en-CA')) {
        categorized['en-CA'].push(voiceInfo);
      } else {
        categorized['other'].push(voiceInfo);
      }
    });

    // Print statistics
    console.log('📊 Statistics:');
    console.log(`   Total voices: ${voices.length}`);
    console.log(`   Model types: ${Array.from(modelTypes).join(', ')}`);
    console.log(`   Genders: Male: ${genders.MALE}, Female: ${genders.FEMALE}, Neutral: ${genders.NEUTRAL}\n`);

    // Print English voice counts by accent
    console.log('🌍 English Voices by Accent:');
    console.log(`   US English: ${categorized['en-US'].length}`);
    console.log(`   UK English: ${categorized['en-GB'].length}`);
    console.log(`   Australian English: ${categorized['en-AU'].length}`);
    console.log(`   Indian English: ${categorized['en-IN'].length}`);
    console.log(`   Canadian English: ${categorized['en-CA'].length}`);
    console.log(`   Other languages: ${categorized['other'].length}\n`);

    // Print sample voices from each category
    console.log('🎙️  Sample Voices:\n');
    
    Object.entries(categorized).forEach(([lang, voiceList]) => {
      if (lang === 'other') return; // Skip other languages for now
      
      console.log(`${lang.toUpperCase()}:`);
      
      // Group by model type
      const byModel: Record<string, VoiceInfo[]> = {};
      voiceList.forEach((v) => {
        if (!byModel[v.modelType]) byModel[v.modelType] = [];
        byModel[v.modelType].push(v);
      });

      Object.entries(byModel).forEach(([modelType, voices]) => {
        console.log(`  ${modelType} (${voices.length} voices):`);
        voices.slice(0, 5).forEach((v) => {
          console.log(`    - ${v.name} (${v.gender}, ${v.naturalSampleRateHertz}Hz)`);
        });
        if (voices.length > 5) {
          console.log(`    ... and ${voices.length - 5} more`);
        }
      });
      console.log('');
    });

    // Save detailed catalog to JSON file
    const catalogPath = path.join(process.cwd(), 'voice-catalog.json');
    const catalog = {
      totalVoices: voices.length,
      lastUpdated: new Date().toISOString(),
      categorized,
      statistics: {
        modelTypes: Array.from(modelTypes),
        genders,
        byLanguage: Object.keys(categorized).map((lang) => ({
          language: lang,
          count: categorized[lang].length,
        })),
      },
    };

    fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));
    console.log(`💾 Full catalog saved to: ${catalogPath}\n`);

    // Generate curated recommendations for 60-voice expansion
    console.log('🌟 Recommended Voices for PodBrew (60-voice expansion):\n');
    
    const recommendations = generateCuratedRecommendations(categorized);
    recommendations.forEach((category, index) => {
      console.log(`${index + 1}. ${category.name} (${category.voices.length} voices)`);
      category.voices.forEach((v: VoiceInfo) => {
        console.log(`   - ${v.name} (${v.modelType})`);
      });
      console.log('');
    });

    console.log('✅ Audit complete!\n');

  } catch (error) {
    console.error('❌ Error auditing voices:', error);
    throw error;
  }
}

function generateCuratedRecommendations(categorized: Record<string, VoiceInfo[]>) {
  const recommendations = [];

  // US English - Core (20 voices)
  const usCore = categorized['en-US']
    .filter((v) => ['Journey', 'WaveNet', 'Neural2'].includes(v.modelType))
    .slice(0, 20);
  recommendations.push({ name: 'US English - Core Collection', voices: usCore });

  // UK English - Regional (10 voices)
  const ukVoices = categorized['en-GB']
    .filter((v) => ['WaveNet', 'Neural2'].includes(v.modelType))
    .slice(0, 10);
  recommendations.push({ name: 'UK English - Regional Collection', voices: ukVoices });

  // Australian English - Regional (8 voices)
  const auVoices = categorized['en-AU']
    .filter((v) => ['WaveNet', 'Neural2'].includes(v.modelType))
    .slice(0, 8);
  recommendations.push({ name: 'Australian English - Regional Collection', voices: auVoices });

  // Indian English - Regional (6 voices)
  const inVoices = categorized['en-IN']
    .filter((v) => ['WaveNet', 'Neural2'].includes(v.modelType))
    .slice(0, 6);
  recommendations.push({ name: 'Indian English - Regional Collection', voices: inVoices });

  // Canadian English - Regional (4 voices)
  const caVoices = categorized['en-CA']
    .filter((v) => ['WaveNet', 'Neural2'].includes(v.modelType))
    .slice(0, 4);
  recommendations.push({ name: 'Canadian English - Regional Collection', voices: caVoices });

  // Specialty - News anchors (4 voices)
  const newsVoices = categorized['en-US'].filter((v) => v.modelType === 'News').slice(0, 4);
  recommendations.push({ name: 'Specialty - News Anchors', voices: newsVoices });

  // Specialty - Studio quality (8 voices)
  const studioVoices = [
    ...categorized['en-US'].filter((v) => v.modelType === 'Studio'),
    ...categorized['en-GB'].filter((v) => v.modelType === 'Studio'),
  ].slice(0, 8);
  recommendations.push({ name: 'Specialty - Studio Quality', voices: studioVoices });

  return recommendations;
}

// Run the audit
auditGoogleVoices().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
