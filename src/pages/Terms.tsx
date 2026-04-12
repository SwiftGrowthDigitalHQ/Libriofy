import PublicPageLayout from "@/components/landing/PublicPageLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { COMPANY_DISPLAY_NAME, SUPPORT_EMAIL } from "@/lib/companyInfo";

const termsSections = [
  {
    title: "Service usage",
    points: [
      "Libriofy is intended for lawful library and study-center operations. You agree not to use the platform for fraudulent, abusive, or unauthorized activities.",
      "You are responsible for the accuracy of the information you upload, including student records, seat data, payment entries, and contact details.",
    ],
  },
  {
    title: "Subscriptions and billing",
    points: [
      "Certain Libriofy features may require a paid subscription. Pricing, renewal dates, and plan limits depend on the plan selected for your library.",
      "Subscription payments may be collected through Razorpay or other approved payment channels. By purchasing a plan, you authorize the applicable billing amount for the selected service period.",
    ],
  },
  {
    title: "Refund policy",
    points: [
      "Refund requests must be sent to support@libriofy.com with payment details and the reason for the request.",
      "Payments are generally non-refundable once a subscription period has started or the service has been provisioned, except for duplicate charges, billing errors, or cases required by applicable law.",
      "If a refund is approved, it will be processed back to the original payment method. Final settlement timelines depend on Razorpay, the bank, or the payment provider involved.",
    ],
  },
  {
    title: "Account responsibility",
    points: [
      "You are responsible for maintaining the confidentiality of your account credentials and for all activity that happens under your account.",
      "If you suspect unauthorized access, you must notify Libriofy promptly so we can help secure the account.",
    ],
  },
  {
    title: "Changes and support",
    points: [
      "We may update the service, pricing, or these terms when needed. Continued use of Libriofy after an update means you accept the revised terms.",
      "For questions about these terms, billing, or refunds, contact support@libriofy.com.",
    ],
  },
];

const Terms = () => (
  <PublicPageLayout
    eyebrow="Terms of Service"
    title="Terms for using Libriofy"
    description={`${COMPANY_DISPLAY_NAME} provides software tools for library automation. These terms explain the basic rules for service use, billing, refunds, and account responsibilities.`}
    contentClassName="space-y-6"
  >
    <Card className="border-border/70 shadow-[0_24px_60px_-36px_rgba(8,38,44,0.35)]">
      <CardHeader>
        <CardTitle className="text-3xl font-display">Terms summary</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm leading-7 text-muted-foreground">
        <p>
          These Terms of Service apply to your access to and use of Libriofy. Please read them carefully before using
          the platform.
        </p>
        <p>
          If you do not agree with these terms, you should not use the service. Questions can be sent to{" "}
          <a className="text-primary hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </CardContent>
    </Card>

    <div className="grid gap-6 lg:grid-cols-2">
      {termsSections.map((section) => (
        <Card key={section.title} className="border-border/70">
          <CardHeader>
            <CardTitle className="text-2xl font-display">{section.title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-7 text-muted-foreground">
            {section.points.map((point) => (
              <p key={point}>{point}</p>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  </PublicPageLayout>
);

export default Terms;
