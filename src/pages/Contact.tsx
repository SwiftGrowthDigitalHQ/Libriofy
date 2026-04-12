import { type ChangeEvent, type FormEvent, useState } from "react";
import { Mail, MessageSquare, ShieldCheck } from "lucide-react";
import { z } from "zod";

import PublicPageLayout from "@/components/landing/PublicPageLayout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { SUPPORT_EMAIL } from "@/lib/companyInfo";
import { getSafeErrorMessage } from "@/lib/errorHandling";
import { supabase } from "@/lib/supabase";
import { getSupportWhatsAppUrl } from "@/lib/supportContact";

const contactSchema = z.object({
  name: z.string().trim().min(2, "Enter your full name."),
  email: z.string().trim().email("Enter a valid email address."),
  phone: z
    .string()
    .trim()
    .min(10, "Enter a valid phone number.")
    .max(20, "Phone number is too long.")
    .regex(/^[+\d\s()-]+$/, "Phone number can only include digits and standard separators."),
  message: z.string().trim().min(10, "Tell us how we can help.").max(2000, "Message is too long."),
});

type ContactFormValues = z.infer<typeof contactSchema>;
type ContactFormErrors = Partial<Record<keyof ContactFormValues, string>>;

const emptyForm: ContactFormValues = {
  name: "",
  email: "",
  phone: "",
  message: "",
};

const getValidationErrors = (values: ContactFormValues): ContactFormErrors => {
  const parsed = contactSchema.safeParse(values);

  if (parsed.success) {
    return {};
  }

  const nextErrors: ContactFormErrors = {};

  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if (typeof field === "string" && !nextErrors[field as keyof ContactFormValues]) {
      nextErrors[field as keyof ContactFormValues] = issue.message;
    }
  }

  return nextErrors;
};

const Contact = () => {
  const { toast } = useToast();
  const [form, setForm] = useState<ContactFormValues>(emptyForm);
  const [errors, setErrors] = useState<ContactFormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const handleChange =
    (field: keyof ContactFormValues) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value = event.target.value;

      setForm((current) => ({ ...current, [field]: value }));
      setErrors((current) => {
        if (!current[field]) {
          return current;
        }

        const nextErrors = { ...current };
        delete nextErrors[field];
        return nextErrors;
      });

      if (submitError) setSubmitError("");
      if (successMessage) setSuccessMessage("");
    };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const validationErrors = getValidationErrors(form);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      setSuccessMessage("");
      setSubmitError("Please correct the highlighted fields and try again.");
      toast({
        title: "Please review the form",
        description: "Some contact details are missing or invalid.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    setSubmitError("");
    setSuccessMessage("");

    try {
      const { name, email, phone, message } = contactSchema.parse(form);
      const { error } = await supabase.from("contacts").insert([
        {
          name,
          email,
          phone,
          message,
        },
      ]);

      if (error) {
        throw error;
      }

      const confirmationMessage = "Thanks for contacting Libriofy. Our team will get back to you soon.";
      setForm(emptyForm);
      setErrors({});
      setSuccessMessage(confirmationMessage);
      toast({ title: "Message received", description: confirmationMessage });
    } catch (error) {
      const message = getSafeErrorMessage(error);
      setSubmitError(message);
      toast({ title: "Unable to send message", description: message, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <PublicPageLayout
      eyebrow="Contact Libriofy"
      title="Talk to our team"
      description="Share your requirements, support questions, or onboarding needs. Your message will be saved to our contact system and reviewed by the Libriofy team."
      heroAside={
        <Card className="border-white/10 bg-white/10 text-primary-foreground backdrop-blur">
          <CardHeader>
            <CardTitle className="text-2xl font-display">Need a faster response?</CardTitle>
            <CardDescription className="text-primary-foreground/70">
              You can also reach us directly on WhatsApp or by email.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button asChild className="w-full justify-center">
              <a
                href={getSupportWhatsAppUrl("Hi Libriofy team, I need help with")}
                target="_blank"
                rel="noopener noreferrer"
              >
                <MessageSquare className="h-4 w-4" />
                WhatsApp support
              </a>
            </Button>
            <Button
              asChild
              variant="outline"
              className="w-full justify-center border-white/20 bg-white/5 text-primary-foreground hover:bg-white hover:text-sidebar"
            >
              <a href={`mailto:${SUPPORT_EMAIL}`}>
                <Mail className="h-4 w-4" />
                {SUPPORT_EMAIL}
              </a>
            </Button>
          </CardContent>
        </Card>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1.08fr_0.92fr]">
        <Card className="border-border/70 shadow-[0_24px_60px_-36px_rgba(8,38,44,0.35)]">
          <CardHeader>
            <CardTitle className="text-3xl font-display">Send us a message</CardTitle>
            <CardDescription>
              Fill in your details and we will reach out to you on the email or phone number you provide.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-5" onSubmit={handleSubmit} noValidate>
              {successMessage ? (
                <Alert className="border-emerald-200 bg-emerald-50 text-emerald-900">
                  <ShieldCheck className="h-4 w-4 text-emerald-700" />
                  <AlertTitle>Message submitted</AlertTitle>
                  <AlertDescription>{successMessage}</AlertDescription>
                </Alert>
              ) : null}

              {submitError ? (
                <Alert variant="destructive">
                  <AlertTitle>We could not submit your message</AlertTitle>
                  <AlertDescription>{submitError}</AlertDescription>
                </Alert>
              ) : null}

              <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="contact-name">Name</Label>
                  <Input
                    id="contact-name"
                    autoComplete="name"
                    value={form.name}
                    onChange={handleChange("name")}
                    placeholder="Your full name"
                    aria-invalid={Boolean(errors.name)}
                  />
                  {errors.name ? <p className="text-sm text-destructive">{errors.name}</p> : null}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="contact-email">Email</Label>
                  <Input
                    id="contact-email"
                    type="email"
                    autoComplete="email"
                    value={form.email}
                    onChange={handleChange("email")}
                    placeholder="you@example.com"
                    aria-invalid={Boolean(errors.email)}
                  />
                  {errors.email ? <p className="text-sm text-destructive">{errors.email}</p> : null}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="contact-phone">Phone</Label>
                  <Input
                    id="contact-phone"
                    type="tel"
                    autoComplete="tel"
                    value={form.phone}
                    onChange={handleChange("phone")}
                    placeholder="+91 98765 43210"
                    aria-invalid={Boolean(errors.phone)}
                  />
                  {errors.phone ? <p className="text-sm text-destructive">{errors.phone}</p> : null}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="contact-message">Message</Label>
                <Textarea
                  id="contact-message"
                  value={form.message}
                  onChange={handleChange("message")}
                  placeholder="Tell us about your library, requirement, or support issue."
                  rows={7}
                  aria-invalid={Boolean(errors.message)}
                />
                {errors.message ? <p className="text-sm text-destructive">{errors.message}</p> : null}
              </div>

              <Button type="submit" className="w-full sm:w-auto" disabled={isSubmitting}>
                {isSubmitting ? "Sending..." : "Submit"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="border-border/70">
            <CardHeader>
              <CardTitle className="text-2xl font-display">What happens next</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm leading-7 text-muted-foreground">
              <p>Your form submission is stored securely in our Supabase contact system for follow-up.</p>
              <p>
                Please include the library name, city, and a short summary of your requirement so our team can respond
                faster.
              </p>
              <p>For payment or billing help, mention the registered phone number linked to your Libriofy account.</p>
            </CardContent>
          </Card>

          <Card className="border-border/70">
            <CardHeader>
              <CardTitle className="text-2xl font-display">Direct contact</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-muted-foreground">
              <div className="rounded-2xl bg-secondary/70 p-4">
                <p className="font-medium text-foreground">Email</p>
                <a className="mt-1 inline-block text-primary hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>
                  {SUPPORT_EMAIL}
                </a>
              </div>
              <div className="rounded-2xl bg-secondary/70 p-4">
                <p className="font-medium text-foreground">WhatsApp</p>
                <a
                  className="mt-1 inline-block text-primary hover:underline"
                  href={getSupportWhatsAppUrl("Hi Libriofy team, I need support with")}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Chat on WhatsApp
                </a>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </PublicPageLayout>
  );
};

export default Contact;
