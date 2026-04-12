import PublicPageLayout from "@/components/landing/PublicPageLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { COMPANY_DISPLAY_NAME, SUPPORT_EMAIL } from "@/lib/companyInfo";

const sections = [
  {
    title: "Information we collect",
    points: [
      "We collect basic contact details such as name, phone number, and email address when you sign up, request a demo, or contact Libriofy.",
      "We may also collect service-related information needed to run the platform, such as library setup details, attendance activity, and billing references.",
    ],
  },
  {
    title: "How we use your information",
    points: [
      "We use your data to provide library automation features, respond to support requests, manage accounts, and improve our services.",
      "Contact details may be used for onboarding, service updates, payment follow-up, and customer support communication.",
    ],
  },
  {
    title: "Payments",
    points: [
      "Payments on Libriofy may be processed through Razorpay and other approved payment channels.",
      "We do not store full card or banking credentials on our website. Payment processing data is handled through the relevant payment partner as required for transaction completion and reconciliation.",
    ],
  },
  {
    title: "Data security",
    points: [
      "We take reasonable technical and operational steps to keep your data secure and restrict access to authorized personnel only.",
      "While no online system can guarantee absolute security, we work to protect customer information against unauthorized access, misuse, and loss.",
    ],
  },
  {
    title: "Sharing and retention",
    points: [
      "We do not sell your personal information. Data may be shared only with service providers or legal authorities when required to deliver the service or comply with law.",
      "We retain data for as long as needed to provide the service, maintain records, resolve disputes, and meet legal or operational obligations.",
    ],
  },
];

const PrivacyPolicy = () => (
  <PublicPageLayout
    eyebrow="Privacy Policy"
    title="How Libriofy handles your information"
    description={`${COMPANY_DISPLAY_NAME} collects only the information needed to operate, support, and improve the Libriofy service.`}
    contentClassName="space-y-6"
  >
    <Card className="border-border/70 shadow-[0_24px_60px_-36px_rgba(8,38,44,0.35)]">
      <CardHeader>
        <CardTitle className="text-3xl font-display">Privacy summary</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm leading-7 text-muted-foreground">
        <p>
          This Privacy Policy explains what information we collect, how it is used, and how we protect it when you use
          Libriofy.
        </p>
        <p>
          By using the website or the Libriofy service, you agree to the practices described on this page. If you have
          any privacy questions, you can contact us at{" "}
          <a className="text-primary hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </CardContent>
    </Card>

    <div className="grid gap-6 lg:grid-cols-2">
      {sections.map((section) => (
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

    <Card className="border-border/70">
      <CardHeader>
        <CardTitle className="text-2xl font-display">Contact for privacy questions</CardTitle>
      </CardHeader>
      <CardContent className="text-sm leading-7 text-muted-foreground">
        For questions about this policy, data handling, or payment privacy, email{" "}
        <a className="text-primary hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>
          {SUPPORT_EMAIL}
        </a>
        .
      </CardContent>
    </Card>
  </PublicPageLayout>
);

export default PrivacyPolicy;
