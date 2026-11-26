import { Link } from "wouter";
import { Helmet } from "react-helmet";
import { ArrowLeft, FileText, AlertTriangle, Scale, CreditCard, Headphones, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export default function TermsOfService() {
  return (
    <>
      <Helmet>
        <title>Terms of Service | PodBrew</title>
        <meta name="description" content="Read PodBrew's terms of service. Understand our usage policies, subscription terms, content guidelines, and user responsibilities." />
        <meta property="og:title" content="Terms of Service | PodBrew" />
        <meta property="og:description" content="PodBrew's terms of service and usage policies." />
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
                <FileText className="h-8 w-8 text-primary" />
              </div>
            </div>
            <h1 className="text-3xl font-bold tracking-tight" data-testid="text-terms-title">Terms of Service</h1>
            <p className="text-muted-foreground">Last updated: December 26, 2024</p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Scale className="h-5 w-5 text-primary" />
                Agreement to Terms
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-muted-foreground">
              <p>By accessing or using PodBrew, you agree to be bound by these Terms of Service. If you disagree with any part of these terms, you may not access the service.</p>
              <p>PodBrew is an AI-powered podcast generation platform that allows users to create customized audio content using advanced text-to-speech technology.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Headphones className="h-5 w-5 text-primary" />
                Service Description
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-muted-foreground">
              <p>PodBrew provides:</p>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li>AI-generated podcast creation from text topics</li>
                <li>Multiple voice options and customization features</li>
                <li>Audio storage and playback capabilities</li>
                <li>Podcast library management and playlists</li>
                <li>Social features including sharing and reactions</li>
              </ul>
              <p>Features may vary based on your subscription plan.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-primary" />
                Subscriptions & Payments
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-muted-foreground">
              <p><strong>Free Tier:</strong> Limited podcast generation with basic features.</p>
              <p><strong>Paid Plans:</strong> Enhanced features, higher generation limits, and premium voices.</p>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li>Subscriptions are billed monthly or annually</li>
                <li>You can cancel your subscription at any time</li>
                <li>Refunds are handled according to our refund policy</li>
                <li>Credits do not roll over between billing periods</li>
                <li>Pricing may change with 30 days notice</li>
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>User Responsibilities</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-muted-foreground">
              <p>You agree to:</p>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li>Provide accurate account information</li>
                <li>Keep your login credentials secure</li>
                <li>Use the service in compliance with applicable laws</li>
                <li>Not share your account with others</li>
                <li>Report any security vulnerabilities responsibly</li>
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Ban className="h-5 w-5 text-destructive" />
                Prohibited Content
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-muted-foreground">
              <p>You may not use PodBrew to generate content that:</p>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li>Promotes violence, hatred, or discrimination</li>
                <li>Contains explicit sexual content or pornography</li>
                <li>Infringes on intellectual property rights</li>
                <li>Spreads misinformation or fake news</li>
                <li>Impersonates individuals without consent</li>
                <li>Promotes illegal activities or substances</li>
                <li>Harasses, threatens, or intimidates others</li>
              </ul>
              <p>Violations may result in account suspension or termination.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Intellectual Property</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-muted-foreground">
              <p><strong>Your Content:</strong> You retain ownership of the topics and text you provide. You grant PodBrew a license to process and store your content for service delivery.</p>
              <p><strong>Generated Audio:</strong> You have the right to use, share, and distribute podcasts you create, subject to these terms.</p>
              <p><strong>PodBrew Platform:</strong> The PodBrew name, logo, software, and technology remain our intellectual property.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                Disclaimers & Limitations
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-muted-foreground">
              <p><strong>Service Availability:</strong> We strive for high uptime but cannot guarantee uninterrupted service.</p>
              <p><strong>AI-Generated Content:</strong> AI-generated content may contain errors or inaccuracies. Users are responsible for reviewing and fact-checking content.</p>
              <p><strong>Limitation of Liability:</strong> PodBrew's liability is limited to the amount paid for the service in the preceding 12 months.</p>
              <p><strong>No Warranty:</strong> The service is provided "as is" without warranties of any kind.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Account Termination</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-muted-foreground">
              <p>We may terminate or suspend your account if you:</p>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li>Violate these Terms of Service</li>
                <li>Engage in prohibited activities</li>
                <li>Abuse the platform or other users</li>
                <li>Fail to pay for subscription services</li>
              </ul>
              <p>You may delete your account at any time from the Settings page.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Governing Law</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-muted-foreground">
              <p>These terms are governed by applicable laws. Any disputes will be resolved through binding arbitration, except where prohibited by law.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Contact</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-muted-foreground">
              <p>For questions about these terms:</p>
              <p>Email: <a href="mailto:legal@podbrew.pro" className="text-primary hover:underline">legal@podbrew.pro</a></p>
            </CardContent>
          </Card>

          <Separator />

          <div className="text-center text-sm text-muted-foreground">
            <p>These terms may be updated periodically. Continued use of PodBrew after changes constitutes acceptance of the updated terms.</p>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
