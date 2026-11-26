import { Link } from "wouter";
import { Helmet } from "react-helmet";
import { ArrowLeft, Shield, Database, Cookie, Mail, Globe, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export default function PrivacyPolicy() {
  return (
    <>
      <Helmet>
        <title>Privacy Policy | PodBrew</title>
        <meta name="description" content="Learn how PodBrew handles your data. Our privacy policy covers information collection, usage, storage, and your rights regarding personal data." />
        <meta property="og:title" content="Privacy Policy | PodBrew" />
        <meta property="og:description" content="Learn how PodBrew handles your data and protects your privacy." />
        <meta property="og:type" content="website" />
      </Helmet>
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8">
          <Link href="/settings">
            <Button variant="ghost" size="sm" className="gap-2" data-testid="button-back">
              <ArrowLeft className="h-4 w-4" />
              Back to Settings
            </Button>
          </Link>
        </div>

        <div className="space-y-8">
          <div className="text-center space-y-4">
            <div className="flex justify-center">
              <div className="p-3 rounded-full bg-primary/10">
                <Shield className="h-8 w-8 text-primary" />
              </div>
            </div>
            <h1 className="text-3xl font-bold tracking-tight" data-testid="text-privacy-title">Privacy Policy</h1>
            <p className="text-muted-foreground">Last updated: December 26, 2024</p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5 text-primary" />
                Information We Collect
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-muted-foreground">
              <p>PodBrew collects information to provide and improve our AI podcast generation services:</p>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li><strong>Account Information:</strong> Email address, name, and profile information when you sign in</li>
                <li><strong>Usage Data:</strong> Podcast topics, preferences, playback history, and interaction patterns</li>
                <li><strong>Generated Content:</strong> Podcasts you create, including topics, scripts, and audio files</li>
                <li><strong>Device Information:</strong> Browser type, device type, and operating system for optimization</li>
                <li><strong>Payment Information:</strong> Processed securely through Stripe; we don't store card details</li>
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Globe className="h-5 w-5 text-primary" />
                How We Use Your Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-muted-foreground">
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li>Generate personalized AI podcasts based on your topics and preferences</li>
                <li>Improve our text-to-speech and content generation algorithms</li>
                <li>Process payments and manage your subscription</li>
                <li>Send important service updates and notifications</li>
                <li>Analyze usage patterns to enhance the user experience</li>
                <li>Prevent fraud and ensure platform security</li>
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lock className="h-5 w-5 text-primary" />
                Data Security & Storage
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-muted-foreground">
              <p>We take data security seriously:</p>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li>All data is encrypted in transit using TLS/SSL</li>
                <li>Audio files are stored securely in Google Cloud Storage</li>
                <li>Database is hosted on secure, managed infrastructure</li>
                <li>Regular security audits and monitoring</li>
                <li>Access controls and authentication for all systems</li>
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cookie className="h-5 w-5 text-primary" />
                Cookies & Tracking
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-muted-foreground">
              <p>We use cookies and similar technologies for:</p>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li><strong>Essential Cookies:</strong> Required for authentication and core functionality</li>
                <li><strong>Analytics:</strong> Understanding how users interact with our platform</li>
                <li><strong>Preferences:</strong> Remembering your settings and preferences</li>
              </ul>
              <p>You can control cookie settings in your browser preferences.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Third-Party Services</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-muted-foreground">
              <p>PodBrew integrates with trusted third-party services:</p>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li><strong>Google Cloud:</strong> AI services, text-to-speech, and storage</li>
                <li><strong>OpenAI:</strong> Content generation and script writing</li>
                <li><strong>Stripe:</strong> Secure payment processing</li>
                <li><strong>Replit:</strong> Authentication services</li>
              </ul>
              <p>Each service has its own privacy policy that governs their data handling.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Your Rights</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-muted-foreground">
              <p>You have the right to:</p>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li>Access your personal data and download your podcasts</li>
                <li>Request correction of inaccurate information</li>
                <li>Delete your account and associated data</li>
                <li>Export your data in a portable format</li>
                <li>Opt out of non-essential communications</li>
              </ul>
              <p>To exercise these rights, contact us through the Settings page or email support.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5 text-primary" />
                Contact Us
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-muted-foreground">
              <p>For privacy-related questions or concerns:</p>
              <p>Email: <a href="mailto:privacy@podbrew.pro" className="text-primary hover:underline">privacy@podbrew.pro</a></p>
              <p>We will respond to privacy inquiries within 30 days.</p>
            </CardContent>
          </Card>

          <Separator />

          <div className="text-center text-sm text-muted-foreground">
            <p>This privacy policy may be updated periodically. Continued use of PodBrew after changes constitutes acceptance of the updated policy.</p>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
