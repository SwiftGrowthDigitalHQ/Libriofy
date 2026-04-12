import { Mail, MessageSquare } from "lucide-react";

import PublicPageLayout from "@/components/landing/PublicPageLayout";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SUPPORT_EMAIL } from "@/lib/companyInfo";
import { getSupportWhatsAppUrl } from "@/lib/supportContact";

const faqs = [
  {
    question: "How do I get started with Libriofy for my library?",
    answer:
      "Contact our team with your library name, seat count, and current workflow. We will guide you through setup, onboarding, and the modules that fit your operations.",
  },
  {
    question: "Can Libriofy help with attendance and seat management together?",
    answer:
      "Yes. Libriofy is built for QR attendance, seat allocation, live seat visibility, and operational reports inside the same system.",
  },
  {
    question: "What should I include when I contact support?",
    answer:
      "Please share your library name, registered phone number or email, and a clear summary of the issue so we can verify your account and respond faster.",
  },
  {
    question: "How do billing or payment support requests work?",
    answer:
      "For subscription and payment questions, include the transaction date, payment amount, and the number or email used during payment so our team can investigate quickly.",
  },
];

const Support = () => (
  <PublicPageLayout
    eyebrow="Support"
    title="Help for setup, billing, and daily operations"
    description="Reach the Libriofy support team for onboarding questions, account help, payment issues, or product guidance."
    heroAside={
      <Card className="border-white/10 bg-white/10 text-primary-foreground backdrop-blur">
        <CardHeader>
          <CardTitle className="text-2xl font-display">Support channels</CardTitle>
          <CardDescription className="text-primary-foreground/70">
            Use the channel that is easiest for you. We review both WhatsApp and email support requests.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button asChild className="w-full justify-center">
            <a href={getSupportWhatsAppUrl("Hi Libriofy support, I need help with")} target="_blank" rel="noopener noreferrer">
              <MessageSquare className="h-4 w-4" />
              WhatsApp support
            </a>
          </Button>
          <Button asChild variant="outline" className="w-full justify-center border-white/20 bg-white/5 text-primary-foreground hover:bg-white hover:text-sidebar">
            <a href={`mailto:${SUPPORT_EMAIL}`}>
              <Mail className="h-4 w-4" />
              {SUPPORT_EMAIL}
            </a>
          </Button>
        </CardContent>
      </Card>
    }
  >
    <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      <Card className="border-border/70 shadow-[0_24px_60px_-36px_rgba(8,38,44,0.35)]">
        <CardHeader>
          <CardTitle className="text-3xl font-display">Frequently asked questions</CardTitle>
          <CardDescription>
            Quick answers to common questions from libraries evaluating or already using Libriofy.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Accordion type="single" collapsible className="w-full">
            {faqs.map((faq, index) => (
              <AccordionItem key={faq.question} value={`faq-${index}`}>
                <AccordionTrigger className="text-left text-base font-semibold text-foreground hover:no-underline">
                  {faq.question}
                </AccordionTrigger>
                <AccordionContent className="text-sm leading-7 text-muted-foreground">
                  {faq.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card className="border-border/70">
          <CardHeader>
            <CardTitle className="text-2xl font-display">WhatsApp support</CardTitle>
            <CardDescription>Use WhatsApp for quick discussions with the support team.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full sm:w-auto">
              <a href="https://wa.me/919709783056" target="_blank" rel="noopener noreferrer">
                Open WhatsApp chat
              </a>
            </Button>
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardHeader>
            <CardTitle className="text-2xl font-display">Email support</CardTitle>
            <CardDescription>For account, billing, or compliance-related questions, email us anytime.</CardDescription>
          </CardHeader>
          <CardContent>
            <a className="text-primary hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>
              {SUPPORT_EMAIL}
            </a>
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardHeader>
            <CardTitle className="text-2xl font-display">Before you contact us</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-7 text-muted-foreground">
            <p>Keep your library name and registered phone number ready for faster verification.</p>
            <p>For payment issues, include the date, amount, and payment method used.</p>
            <p>For setup help, share your current seat count and attendance process.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  </PublicPageLayout>
);

export default Support;
