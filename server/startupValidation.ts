import { VOICE_QUALITY_TIERS, SUBSCRIPTION_PLANS, DEFAULT_TIER_RESTRICTIONS } from '../shared/schema';

/**
 * Validates environment variables and configuration on startup
 * Fails fast with actionable errors before the server starts accepting requests
 */
export function validateStartupConfiguration() {
  console.log('\n🔍 [Startup] Running configuration validation...\n');
  
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // 1. Environment Variables (critical for production, optional for dev)
  const criticalEnvVars = {
    'DATABASE_URL': 'Required for persistent storage (can use in-memory for dev)',
    'OPENAI_API_KEY': 'Required for GPT-4o script generation',
    'GOOGLE_APPLICATION_CREDENTIALS_JSON': 'Required for Google Cloud TTS',
    'PERPLEXITY_API_KEY': 'Required for real-time content sourcing'
  };
  
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  Object.entries(criticalEnvVars).forEach(([varName, description]) => {
    if (!process.env[varName]) {
      if (isDevelopment) {
        warnings.push(`Missing env var: ${varName} - ${description}`);
      } else {
        errors.push(`Missing required environment variable: ${varName} - ${description}`);
      }
    }
  });
  
  // 2. Validate Voice Quality Tier Pricing Consistency
  const voiceTiers = Object.entries(VOICE_QUALITY_TIERS);
  voiceTiers.forEach(([tier, config]) => {
    const creditsPerMin = config.creditsPerMinute;
    const centsPerMin = creditsPerMin * 10;
    
    if (creditsPerMin <= 0) {
      errors.push(`Voice tier "${tier}" has invalid creditsPerMinute: ${creditsPerMin}`);
    }
    
    // All tiers should round UP to full cents
    if (centsPerMin % 1 !== 0) {
      warnings.push(`Voice tier "${tier}" has fractional cents: ${centsPerMin}¢/min (should round up)`);
    }
  });
  
  console.log('✅ Voice Quality Tiers:');
  voiceTiers.forEach(([tier, config]) => {
    const centsPerMin = (config.creditsPerMinute * 10).toFixed(1);
    console.log(`   ${tier}: ${config.creditsPerMinute} cr/min = ${centsPerMin}¢/min`);
  });
  console.log('');
  
  // 3. Validate Subscription Plan Consistency
  const subscriptionPlans = Object.entries(SUBSCRIPTION_PLANS);
  subscriptionPlans.forEach(([plan, config]) => {
    if (config.credits <= 0 && plan !== 'enterprise') {
      errors.push(`Subscription plan "${plan}" has invalid credits: ${config.credits}`);
    }
    
    // Check tier restrictions exist
    if (!DEFAULT_TIER_RESTRICTIONS[plan as keyof typeof DEFAULT_TIER_RESTRICTIONS]) {
      errors.push(`Missing tier restrictions for plan: ${plan}`);
    }
  });
  
  console.log('✅ Subscription Plans (Standard Quality @ 0.2 cr/min):');
  subscriptionPlans.forEach(([plan, config]) => {
    const minutes = config.credits / 0.2;
    const hours = (minutes / 60).toFixed(1);
    console.log(`   ${plan}: ${config.credits} credits = ${minutes} min (${hours}h) - $${config.price}/mo`);
  });
  console.log('');
  
  // 4. Validate Duration Restrictions
  Object.entries(DEFAULT_TIER_RESTRICTIONS).forEach(([plan, restrictions]) => {
    if (restrictions.maxDurationMinutes > 60) {
      warnings.push(`Plan "${plan}" maxDurationMinutes is ${restrictions.maxDurationMinutes}, expected <= 60`);
    }
  });
  
  console.log('✅ Duration Restrictions:');
  Object.entries(DEFAULT_TIER_RESTRICTIONS).forEach(([plan, restrictions]) => {
    console.log(`   ${plan}: max ${restrictions.maxDurationMinutes} min, ${restrictions.monthlyCredits} credits/mo`);
  });
  console.log('');
  
  // Report Results
  if (errors.length > 0) {
    console.error('❌ [Startup] Configuration validation FAILED:\n');
    errors.forEach(error => console.error(`   ❌ ${error}`));
    console.error('');
    throw new Error(`Startup validation failed with ${errors.length} error(s). Fix configuration before starting.`);
  }
  
  if (warnings.length > 0) {
    console.warn('⚠️  [Startup] Configuration warnings:\n');
    warnings.forEach(warning => console.warn(`   ⚠️  ${warning}`));
    console.warn('');
  }
  
  console.log('✅ [Startup] Configuration validation passed!\n');
}
