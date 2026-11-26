import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  FileText,
  Youtube,
  Newspaper,
  FileDown,
  Mic2,
  Zap,
  Globe,
  Sparkles,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
} from "lucide-react";
import { useState } from "react";

interface SEOLandingSectionsProps {
  onCreateClick: () => void;
}

const USE_CASES = [
  {
    icon: FileText,
    title: "Turn Blogs Into Podcasts",
    description:
      "Repurpose your blog posts as professional audio content. Paste any blog URL or text and PodBrew transforms it into an engaging podcast your audience can enjoy on the go.",
    example: "Turn your latest article into a podcast your readers can listen to on their commute.",
    cta: "Convert your blog to a podcast now",
    iconColor: "text-blue-400",
  },
  {
    icon: FileDown,
    title: "Convert PDFs to Audio",
    description:
      "Upload research papers, reports, ebooks, or manuals. The AI extracts the key information, structures a conversational script, and generates studio-quality audio.",
    example: "Convert that long industry report into an audio brief you can listen to while working out.",
    cta: "Turn your PDF into a podcast",
    iconColor: "text-amber-400",
  },
  {
    icon: Newspaper,
    title: "Turn Newsletters Into Podcasts",
    description:
      "Give your subscribers an audio option. Paste newsletter content into PodBrew and reach readers who prefer listening, expanding your audience without extra effort.",
    example: "Listen to your favorite newsletter while walking, cooking, or during your daily routine.",
    cta: "Convert your newsletter to audio",
    iconColor: "text-emerald-400",
  },
  {
    icon: Youtube,
    title: "Turn YouTube Videos Into Podcasts",
    description:
      "Paste any YouTube URL and PodBrew extracts the content, transforms it into a podcast-format script, and generates professional audio. Ideal for repurposing video as audio-first content.",
    example: "Turn a 30-minute lecture into an audio episode you can review anywhere, anytime.",
    cta: "Transform a YouTube video now",
    iconColor: "text-red-400",
  },
];

const WHY_PODBREW = [
  {
    icon: Mic2,
    title: "Natural-Sounding AI Voices",
    description:
      "Choose from 30+ premium voices with emotion-driven prosody, diverse accents, and natural pacing that sounds genuinely human. Preview every voice before you create.",
  },
  {
    icon: Zap,
    title: "Fast Turnaround",
    description:
      "Generate a complete, broadcast-ready podcast in under 3 minutes. No recording sessions, editing, or post-production required.",
  },
  {
    icon: Globe,
    title: "Multi-Source Input",
    description:
      "Accepts text, blogs, PDFs, YouTube links, newsletters, and more. PodBrew handles any content format and converts it to audio.",
  },
  {
    icon: Sparkles,
    title: "Fully Customizable Output",
    description:
      "Control topic, style, voice, duration, language, and co-host personality for every custom podcast. No two PodBrew episodes are alike — each is AI-generated specifically for your input.",
  },
  {
    icon: CheckCircle2,
    title: "RSS Feed Distribution",
    description:
      "Get a personal RSS feed URL to listen in Apple Podcasts, Spotify, Google Podcasts, and any other podcast app you already use.",
  },
];

const FAQ_ITEMS = [
  {
    question: "Can I create a custom AI podcast on any topic?",
    answer:
      "Yes. PodBrew is an AI custom podcast generator built for any subject. Type any topic — from personal finance to quantum computing to local travel guides — and the AI researches it in real time, writes a natural multi-host script, and produces a fully custom podcast in minutes. There is no template or fixed format: every podcast is generated specifically for your topic, style preference, chosen voices, and target duration.",
  },
  {
    question: "What makes PodBrew different from other AI podcast generators?",
    answer:
      "PodBrew is designed around deep customization. You choose the topic, podcast style (Conversational, Debate, Interview, News, Narrative, and more), co-host personalities, duration (2–60 minutes), language (80+), and voice (30+ premium AI voices with emotion-driven delivery). Most AI podcast tools produce a single generic voice reading a summary. PodBrew generates true multi-speaker dialogue tailored to your content — much closer to a real podcast studio than a text-to-speech reader.",
  },
  {
    question: "How do I turn a blog into a podcast?",
    answer:
      "Paste your blog URL or text into PodBrew, pick a voice and style, and hit generate. The AI analyzes your blog content, structures it into an engaging podcast script, and converts it to audio with natural-sounding AI voices. Your blog becomes a professional podcast in under 3 minutes.",
  },
  {
    question: "Can I convert a PDF to a podcast?",
    answer:
      "Yes. Upload any PDF document to PodBrew and the AI extracts the key information, creates a conversational podcast script, and generates audio with premium AI voices. It works with research papers, reports, manuals, ebooks, and any other PDF content.",
  },
  {
    question: "How do I turn a YouTube video into a podcast?",
    answer:
      "Paste a YouTube video URL into PodBrew. The AI extracts the video content, transforms it into a podcast-format script, and generates professional audio. This is perfect for repurposing video content into an audio-first format.",
  },
  {
    question: "Can I convert my newsletter into a podcast?",
    answer:
      "Absolutely. Paste your newsletter content into PodBrew, choose a conversational or narrative style, and generate an audio version. It is a great way to reach subscribers who prefer listening over reading.",
  },
  {
    question: "How many AI voices does PodBrew offer?",
    answer:
      "PodBrew offers 30+ premium AI voices with diverse accents, genders, and speaking styles. Each voice features emotion-driven prosody for natural, engaging podcast conversations. You can preview every voice in the AI voice library before creating your podcast.",
  },
  {
    question: "Can I use PodBrew for free?",
    answer:
      "Yes. PodBrew offers a free tier with credits to create short podcasts. Free users can generate 2-minute podcasts and access core features. Paid plans unlock longer durations up to 60 minutes, more credits, and additional features.",
  },
  {
    question: "What file types does PodBrew support?",
    answer:
      "PodBrew accepts plain text, blog URLs, PDF documents, YouTube video links, and newsletter content. You can also simply type a topic and the AI will research and create a podcast from scratch.",
  },
  {
    question: "Is my content secure?",
    answer:
      "Yes. Your uploaded content is processed securely and is not shared with third parties. Private podcasts remain visible only to you, and all data is transmitted over encrypted connections.",
  },
  {
    question: "Can I listen on my favorite podcast app?",
    answer:
      "Absolutely. PodBrew generates a personal RSS feed URL that you can add to Apple Podcasts, Spotify, Google Podcasts, Pocket Casts, or any other podcast player. Your podcasts sync automatically.",
  },
  {
    question: "How fast is the audio generated?",
    answer:
      "Most podcasts are ready in under 3 minutes. The AI writes the script, generates multi-voice audio, and mixes everything automatically. Longer podcasts (30-60 minutes) may take a few minutes more.",
  },
];

function FAQItem({ question, answer }: { question: string; answer: string }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div
      className="border border-border/50 rounded-lg overflow-hidden"
      data-testid={`faq-item-${question.slice(0, 20).replace(/\s+/g, "-").toLowerCase()}`}
    >
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 text-left hover-elevate"
        data-testid={`button-faq-toggle-${question.slice(0, 20).replace(/\s+/g, "-").toLowerCase()}`}
        aria-expanded={isOpen}
      >
        <h3 className="text-sm font-semibold pr-4">{question}</h3>
        {isOpen ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        )}
      </button>
      {isOpen && (
        <div className="px-4 pb-4">
          <p className="text-sm text-muted-foreground leading-relaxed">
            {answer}
          </p>
        </div>
      )}
    </div>
  );
}

export function SEOLandingSections({ onCreateClick }: SEOLandingSectionsProps) {
  return (
    <div className="space-y-10 mt-8">
      {/* Use Cases Section */}
      <section id="use-cases" aria-label="Use cases for AI podcast generation" data-testid="section-use-cases">
        <h2
          className="text-2xl font-bold font-display mb-2"
          data-testid="heading-use-cases"
        >
          Turn Any Content Into a Podcast
        </h2>
        <p className="text-sm text-muted-foreground mb-5 max-w-2xl">
          PodBrew is the AI custom podcast generator that accepts any topic,
          blog, document, YouTube link, or newsletter. Pick your source, choose
          a voice and style, and get a fully custom podcast in minutes.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {USE_CASES.map((useCase) => (
            <Card
              key={useCase.title}
              className="bg-card/60 border-border/50 backdrop-blur-sm"
              data-testid={`card-usecase-${useCase.title.slice(0, 15).replace(/\s+/g, "-").toLowerCase()}`}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-primary/10 rounded-lg flex-shrink-0">
                    <useCase.icon className={`w-5 h-5 ${useCase.iconColor}`} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold mb-1">
                      {useCase.title}
                    </h3>
                    <p className="text-xs text-muted-foreground leading-relaxed mb-1.5">
                      {useCase.description}
                    </p>
                    {useCase.example && (
                      <p className="text-xs text-muted-foreground/80 italic mb-2">
                        {useCase.example}
                      </p>
                    )}
                    <Link
                      href="/"
                      onClick={(e) => {
                        e.preventDefault();
                        onCreateClick();
                      }}
                      className="inline-flex items-center gap-1 text-xs text-primary font-medium hover:underline"
                      data-testid={`link-usecase-cta-${useCase.title.slice(0, 10).replace(/\s+/g, "-").toLowerCase()}`}
                    >
                      {useCase.cta}
                      <ArrowRight className="w-3 h-3" />
                    </Link>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Why PodBrew Section */}
      <section id="why-podbrew" aria-label="Why choose PodBrew" data-testid="section-why-podbrew">
        <h2
          className="text-2xl font-bold font-display mb-2"
          data-testid="heading-why-podbrew"
        >
          Why PodBrew?
        </h2>
        <p className="text-sm text-muted-foreground mb-5 max-w-2xl">
          An AI podcast studio in your pocket. Create professional podcasts
          from any content source without recording equipment, editing software,
          or a production team.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {WHY_PODBREW.map((item) => (
            <div
              key={item.title}
              className="flex items-start gap-3 p-3"
              data-testid={`item-why-${item.title.slice(0, 15).replace(/\s+/g, "-").toLowerCase()}`}
            >
              <div className="p-1.5 bg-primary/10 rounded-md flex-shrink-0">
                <item.icon className="w-4 h-4 text-primary" />
              </div>
              <div>
                <h3 className="text-sm font-semibold mb-0.5">{item.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {item.description}
                </p>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button
            onClick={onCreateClick}
            className="gap-2"
            data-testid="button-why-create-podcast"
          >
            <Sparkles className="w-4 h-4" />
            Create Your First AI Podcast
          </Button>
          <Link href="/voices">
            <Button
              variant="outline"
              className="gap-2"
              data-testid="button-why-explore-voices"
            >
              <Mic2 className="w-4 h-4" />
              Explore the AI Voice Library
            </Button>
          </Link>
        </div>
      </section>

      {/* How It Works Section */}
      <section id="how-it-works" aria-label="How AI podcast generation works" data-testid="section-how-it-works">
        <h2
          className="text-2xl font-bold font-display mb-5"
          data-testid="heading-how-it-works"
        >
          How It Works
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            {
              step: "1",
              title: "Upload Your Content",
              subtitle: "Paste a link, upload a file, or enter text.",
              description:
                "Type any topic, paste a blog URL, upload a PDF, or share a YouTube link. PodBrew accepts any text-based content and handles the rest.",
            },
            {
              step: "2",
              title: "Customize Your Audio",
              subtitle: "Choose from 30+ natural-sounding AI voices.",
              description:
                "Pick your preferred voice, podcast style, duration (2-60 min), mood, and language. Preview voices before you commit.",
            },
            {
              step: "3",
              title: "Listen Anywhere",
              subtitle: "Enjoy your new podcast on your favorite player.",
              description:
                "The AI writes a natural script, generates studio-quality audio, and delivers your podcast in minutes. Download, share, or add to your podcast app via RSS.",
            },
          ].map((step) => (
            <div
              key={step.step}
              className="flex flex-col items-center text-center p-4 rounded-lg border border-border/30 bg-card/30"
              data-testid={`step-how-${step.step}`}
            >
              <div className="w-8 h-8 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center mb-3">
                <span className="text-sm font-bold text-primary">
                  {step.step}
                </span>
              </div>
              <h3 className="text-sm font-semibold mb-0.5">{step.title}</h3>
              <p className="text-xs text-muted-foreground font-medium mb-1.5">{step.subtitle}</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ Section */}
      <section id="faq" aria-label="Frequently asked questions" data-testid="section-faq">
        <h2
          className="text-2xl font-bold font-display mb-5"
          data-testid="heading-faq"
        >
          Frequently Asked Questions
        </h2>
        <div className="space-y-2 max-w-2xl">
          {FAQ_ITEMS.map((item) => (
            <FAQItem
              key={item.question}
              question={item.question}
              answer={item.answer}
            />
          ))}
        </div>
      </section>

      {/* SEO Footer Links */}
      <section
        className="border-t border-border/30 pt-6 pb-4"
        aria-label="Site navigation"
        data-testid="section-seo-footer"
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
          <div>
            <h3 className="font-semibold text-foreground mb-2">Product</h3>
            <ul className="space-y-1.5">
              <li>
                <Link
                  href="/"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  data-testid="link-footer-home"
                >
                  AI Podcast Generator
                </Link>
              </li>
              <li>
                <Link
                  href="/voices"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  data-testid="link-footer-voices"
                >
                  AI Voice Library
                </Link>
              </li>
              <li>
                <Link
                  href="/listen"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  data-testid="link-footer-listen"
                >
                  Discover Podcasts
                </Link>
              </li>
              <li>
                <Link
                  href="/pricing"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  data-testid="link-footer-pricing"
                >
                  Pricing
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <h3 className="font-semibold text-foreground mb-2">Use Cases</h3>
            <ul className="space-y-1.5">
              <li>
                <Link
                  href="/?template=documents"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  data-testid="link-footer-blog-to-podcast"
                >
                  Blog to Podcast
                </Link>
              </li>
              <li>
                <Link
                  href="/?template=documents"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  data-testid="link-footer-pdf-to-podcast"
                >
                  PDF to Podcast
                </Link>
              </li>
              <li>
                <Link
                  href="/?template=custom"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  data-testid="link-footer-youtube-to-podcast"
                >
                  YouTube to Podcast
                </Link>
              </li>
              <li>
                <Link
                  href="/?template=news"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  data-testid="link-footer-newsletter-to-podcast"
                >
                  Newsletter to Podcast
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <h3 className="font-semibold text-foreground mb-2">Resources</h3>
            <ul className="space-y-1.5">
              <li>
                <Link
                  href="/privacy"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  data-testid="link-footer-privacy"
                >
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link
                  href="/terms"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  data-testid="link-footer-terms"
                >
                  Terms of Service
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <h3 className="font-semibold text-foreground mb-2">Get Started</h3>
            <ul className="space-y-1.5">
              <li>
                <Link
                  href="/"
                  onClick={(e) => {
                    e.preventDefault();
                    onCreateClick();
                  }}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  data-testid="link-footer-create-podcast"
                >
                  Create a Podcast
                </Link>
              </li>
              <li>
                <Link
                  href="/listen"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  data-testid="link-footer-trending"
                >
                  Trending Podcasts
                </Link>
              </li>
            </ul>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-6">
          &copy; {new Date().getFullYear()} PodBrew. All rights reserved.
        </p>
      </section>
    </div>
  );
}
