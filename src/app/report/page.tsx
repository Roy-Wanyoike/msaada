"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  HandHeart,
  Loader2,
  MapPin,
  MessageSquare,
  Phone,
  RotateCcw,
  Send,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { COUNTIES, WARDS, type County } from "@/lib/types";
import {
  REPORT_CATEGORIES,
  type CommunityReportDTO,
} from "@/lib/community-report-types";

/**
 * /report — the PUBLIC community reporting form (CR-004).
 *
 * No CHV session required — community members can submit a concern here and
 * a CHV will be assigned to follow up (CR-008). The raw concern text is
 * PII-scrubbed on the server (POST /api/community-reports) BEFORE
 * persistence; the form never sees the redacted version.
 *
 * Multi-step flow:
 *   1. Intro + crisis line
 *   2. Describe the situation (description + category)
 *   3. Location (county / ward / landmark / directions)
 *   4. Contact preference (anonymous OR share name + contact for follow-up)
 *   5. Review summary + Submit
 *   6. Confirmation screen with the report code (MSD-RPT-XXXX) + status
 */

const STEPS = [
  { id: "intro", label: "Welcome", labelSw: "Karibu" },
  { id: "describe", label: "Describe", labelSw: "Eleza" },
  { id: "location", label: "Location", labelSw: "Eneo" },
  { id: "contact", label: "Contact", labelSw: "Mawasiliano" },
  { id: "review", label: "Review", labelSw: "Hakiki" },
] as const;

const CATEGORY_LABEL: Record<(typeof REPORT_CATEGORIES)[number], string> = {
  mental_health: "Mental health / Psychosocial",
  maternal: "Maternal health",
  child_health: "Child health",
  social_support: "Social support",
  other: "Other",
};

const CRISIS_LINE =
  "Kenya Red Cross 1199 · Befrienders Kenya +254 722 178 177";

type SubmitStatus = "idle" | "submitting" | "success" | "error";

interface FormState {
  description: string;
  category: (typeof REPORT_CATEGORIES)[number];
  county: County | "";
  ward: string;
  landmark: string;
  directions: string;
  contactMode: "anonymous" | "share";
  reporterName: string;
  reporterContact: string;
}

const INITIAL_STATE: FormState = {
  description: "",
  category: "mental_health",
  county: "",
  ward: "",
  landmark: "",
  directions: "",
  contactMode: "anonymous",
  reporterName: "",
  reporterContact: "",
};

export default function PublicReportPage() {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(INITIAL_STATE);
  const [status, setStatus] = useState<SubmitStatus>("idle");
  const [submitted, setSubmitted] = useState<CommunityReportDTO | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Generate one idempotency key per form lifecycle — a successful submit
  // also resets this. Prevents duplicate reports on accidental double-click
  // or network-retry. The server enforces the unique constraint.
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `rpt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  );

  const update = useCallback(
    <K extends keyof FormState>(field: K, value: FormState[K]) => {
      setForm((prev) => ({ ...prev, [field]: value }));
    },
    []
  );

  // ---- Per-step validation ----
  const describeValid = form.description.trim().length >= 10;
  const locationValid = form.county !== "";
  const contactValid =
    form.contactMode === "anonymous" ||
    form.reporterName.trim().length > 0 ||
    form.reporterContact.trim().length > 0;

  const canAdvance = useMemo(() => {
    if (step === 0) return true;
    if (step === 1) return describeValid;
    if (step === 2) return locationValid;
    if (step === 3) return contactValid;
    return true;
  }, [step, describeValid, locationValid, contactValid]);

  const wardsForCounty = useMemo(
    () => (form.county ? WARDS[form.county] : []),
    [form.county]
  );

  const handleNext = useCallback(() => {
    if (!canAdvance) return;
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }, [canAdvance]);

  const handleBack = useCallback(() => {
    setStep((s) => Math.max(s - 1, 0));
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!describeValid || !locationValid || !contactValid) {
      toast.error("Please complete all required fields before submitting.");
      return;
    }
    setStatus("submitting");
    setErrorMessage(null);
    try {
      const res = await fetch("/api/community-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          description: form.description.trim(),
          category: form.category,
          county: form.county,
          ward: form.ward || undefined,
          landmark: form.landmark.trim() || undefined,
          directions: form.directions.trim() || undefined,
          reporterName:
            form.contactMode === "share" && form.reporterName.trim()
              ? form.reporterName.trim()
              : undefined,
          reporterContact:
            form.contactMode === "share" && form.reporterContact.trim()
              ? form.reporterContact.trim()
              : undefined,
          idempotencyKey,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        reportCode?: string;
        status?: string;
        error?: string;
        retryAfter?: number;
      };
      if (!res.ok) {
        if (res.status === 429) {
          const sec = data.retryAfter ?? 60;
          throw new Error(
            `Too many reports from your network. Please wait ${sec}s and try again.`
          );
        }
        throw new Error(
          data.error === "INVALID_COUNTY"
            ? "Please pick a valid county."
            : data.error === "MISSING_OR_TOO_SHORT"
              ? "Please describe the situation in at least 10 characters."
              : "We couldn't submit your report. Please try again in a moment."
        );
      }
      // The API returns the full CommunityReportDTO on success (201).
      const report = data as unknown as CommunityReportDTO;
      setStatus("success");
      setSubmitted(report);
      // Reset idempotency key for any future report from the same session.
      setIdempotencyKey(
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `rpt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      );
      if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch (err) {
      setStatus("error");
      const msg = err instanceof Error ? err.message : "Unexpected error.";
      setErrorMessage(msg);
      toast.error(msg);
    }
  }, [
    canAdvance,
    contactValid,
    describeValid,
    form,
    idempotencyKey,
    locationValid,
  ]);

  const handleReset = useCallback(() => {
    setForm(INITIAL_STATE);
    setStatus("idle");
    setSubmitted(null);
    setErrorMessage(null);
    setStep(0);
  }, []);

  // ---- Render ----
  if (status === "success" && submitted) {
    return <ConfirmationScreen report={submitted} onReset={handleReset} />;
  }

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-emerald-50 via-background to-teal-50/40 dark:from-emerald-950/20 dark:via-background dark:to-teal-950/10">
      <Header />
      <main
        id="main"
        tabIndex={-1}
        className="flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8"
      >
        <div className="mx-auto w-full max-w-2xl">
          {/* Crisis line — always visible at the top of the reporting flow */}
          <Alert
            className="mb-5 border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
            role="alert"
          >
            <AlertTriangle className="size-4" aria-hidden />
            <AlertTitle className="text-red-800 dark:text-red-200">
              If someone is in immediate danger
            </AlertTitle>
            <AlertDescription className="text-red-700 dark:text-red-300">
              Call <strong>Kenya Red Cross 1199</strong> or{" "}
              <strong>Befrienders Kenya +254 722 178 177</strong>. This form is
              not for emergencies — it routes a CHV to follow up later.
            </AlertDescription>
          </Alert>

          {/* Step indicator */}
          <StepIndicator currentStep={step} />

          <Card className="border-emerald-200/60 shadow-sm dark:border-emerald-900/40">
            <CardHeader className="pb-4">
              <div className="flex items-start gap-3">
                <div className="hidden size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 sm:flex">
                  <StepIcon step={step} />
                </div>
                <div className="min-w-0">
                  <CardTitle className="text-lg sm:text-xl">
                    {STEPS[step].label}{" "}
                    <span className="text-muted-foreground font-normal">
                      · {STEPS[step].labelSw}
                    </span>
                  </CardTitle>
                  <CardDescription className="mt-1">
                    {step === 0 &&
                      "Tell a community health volunteer what is happening."}
                    {step === 1 &&
                      "Describe the concern in your own words — at least 10 characters."}
                    {step === 2 &&
                      "Where is the concern? County is required; ward + landmark help the CHV find the place."}
                    {step === 3 &&
                      "You may submit anonymously or share a name/phone so a CHV can reach you."}
                    {step === 4 &&
                      "Review your report, then submit. The system will PII-scrub the text before storing."}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <Separator />
            <CardContent className="pt-6">
              <AnimatePresence mode="wait">
                <motion.div
                  key={step}
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  transition={{ duration: 0.2 }}
                >
                  {step === 0 && <IntroStep onStart={handleNext} />}
                  {step === 1 && (
                    <DescribeStep
                      form={form}
                      update={update}
                      valid={describeValid}
                    />
                  )}
                  {step === 2 && (
                    <LocationStep
                      form={form}
                      update={update}
                      wards={wardsForCounty}
                      valid={locationValid}
                    />
                  )}
                  {step === 3 && (
                    <ContactStep
                      form={form}
                      update={update}
                      valid={contactValid}
                    />
                  )}
                  {step === 4 && (
                    <ReviewStep form={form} status={status} />
                  )}
                </motion.div>
              </AnimatePresence>

              {/* Footer nav — sticky on mobile for thumb reach */}
              <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                {step > 0 ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleBack}
                    disabled={status === "submitting"}
                    className="h-11 min-h-[44px] w-full sm:w-auto"
                  >
                    <ArrowLeft className="size-4" aria-hidden />
                    Back
                  </Button>
                ) : (
                  <Button
                    asChild
                    variant="ghost"
                    className="h-11 min-h-[44px] w-full sm:w-auto"
                  >
                    <Link href="/">Back to home</Link>
                  </Button>
                )}

                {step < STEPS.length - 1 ? (
                  <Button
                    type="button"
                    onClick={handleNext}
                    disabled={!canAdvance}
                    className="h-11 min-h-[44px] w-full bg-emerald-600 hover:bg-emerald-700 sm:w-auto"
                  >
                    Continue
                    <ArrowRight className="size-4" aria-hidden />
                  </Button>
                ) : (
                  <Button
                    type="button"
                    onClick={handleSubmit}
                    disabled={status === "submitting" || !canAdvance}
                    className="h-11 min-h-[44px] w-full bg-teal-600 hover:bg-teal-700 sm:w-auto"
                  >
                    {status === "submitting" ? (
                      <>
                        <Loader2 className="size-4 animate-spin" aria-hidden />
                        Submitting…
                      </>
                    ) : (
                      <>
                        <Send className="size-4" aria-hidden />
                        Submit report
                      </>
                    )}
                  </Button>
                )}
              </div>

              {status === "error" && errorMessage && (
                <Alert
                  variant="destructive"
                  className="mt-4"
                  role="alert"
                >
                  <AlertTriangle className="size-4" aria-hidden />
                  <AlertTitle>Could not submit</AlertTitle>
                  <AlertDescription>{errorMessage}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          <p className="mt-4 text-center text-xs text-muted-foreground">
            Msaada · Not a diagnostic tool · Crisis line: {CRISIS_LINE}
          </p>
        </div>
      </main>

      <footer
        className="mt-auto border-t bg-background/80 backdrop-blur"
        role="contentinfo"
      >
        <div className="mx-auto w-full max-w-2xl px-4 py-4 sm:px-6 lg:px-8">
          <p className="text-center text-xs text-muted-foreground sm:text-left">
            Msaada · Community reporting · De-identified at submission ·{" "}
            <Link href="/" className="underline hover:text-foreground">
              CHV sign in
            </Link>
          </p>
        </div>
      </footer>
    </div>
  );
}

// ============================================================
// Header + step chrome
// ============================================================

function Header() {
  return (
    <header
      className="border-b border-emerald-100/60 bg-emerald-50/40 backdrop-blur dark:border-emerald-900/30 dark:bg-emerald-950/20"
      role="banner"
    >
      <div className="mx-auto flex w-full max-w-2xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300"
        >
          <HandHeart className="size-5" aria-hidden />
          <span className="text-base font-semibold">Msaada</span>
        </Link>
        <Badge
          variant="outline"
          className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
        >
          Community report
        </Badge>
      </div>
    </header>
  );
}

function StepIndicator({ currentStep }: { currentStep: number }) {
  return (
    <ol
      className="mb-5 flex items-center justify-between gap-1"
      aria-label="Progress"
    >
      {STEPS.map((s, i) => {
        const done = i < currentStep;
        const current = i === currentStep;
        return (
          <li
            key={s.id}
            className="flex flex-1 flex-col items-center gap-1 text-center"
          >
            <div className="flex w-full items-center">
              <div
                className={cn(
                  "flex size-7 items-center justify-center rounded-full text-xs font-semibold transition-colors sm:size-8",
                  done &&
                    "bg-emerald-600 text-white dark:bg-emerald-700",
                  current &&
                    "bg-teal-600 text-white ring-2 ring-teal-200 dark:bg-teal-700 dark:ring-teal-900",
                  !done &&
                    !current &&
                    "bg-muted text-muted-foreground"
                )}
                aria-current={current ? "step" : undefined}
              >
                {done ? (
                  <CheckCircle2 className="size-4" aria-hidden />
                ) : (
                  i + 1
                )}
              </div>
              {i < STEPS.length - 1 && (
                <div
                  className={cn(
                    "h-0.5 flex-1",
                    done
                      ? "bg-emerald-500"
                      : "bg-muted"
                  )}
                  aria-hidden
                />
              )}
            </div>
            <span
              className={cn(
                "text-[10px] leading-tight sm:text-xs",
                current
                  ? "font-medium text-foreground"
                  : "text-muted-foreground"
              )}
            >
              {s.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function StepIcon({ step }: { step: number }) {
  const Icon =
    step === 0
      ? HandHeart
      : step === 1
        ? MessageSquare
        : step === 2
          ? MapPin
          : step === 3
            ? UserRound
            : ClipboardCheck;
  return <Icon className="size-5" aria-hidden />;
}

// ============================================================
// Step 0: Intro
// ============================================================

function IntroStep({ onStart }: { onStart: () => void }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-foreground/80">
        <strong>Tunaomba msaada?</strong> Use this form to share a concern with
        a Community Health Volunteer in your area. A CHV will be assigned to
        follow up.
      </p>
      <ul className="space-y-2 text-sm text-muted-foreground">
        <li className="flex items-start gap-2">
          <ShieldCheck
            className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
            aria-hidden
          />
          <span>
            Your report is <strong>de-identified</strong> — names, phone
            numbers, and IDs in the description are scrubbed before storage.
          </span>
        </li>
        <li className="flex items-start gap-2">
          <UserRound
            className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
            aria-hidden
          />
          <span>
            You can submit <strong>anonymously</strong> or share your contact so
            a CHV can reach you.
          </span>
        </li>
        <li className="flex items-start gap-2">
          <ClipboardCheck
            className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
            aria-hidden
          />
          <span>
            You will get a <strong>report code</strong> (e.g. MSD-RPT-1234)
            you can quote when following up.
          </span>
        </li>
      </ul>
      <Button
        type="button"
        onClick={onStart}
        className="h-11 min-h-[44px] w-full bg-emerald-600 hover:bg-emerald-700 sm:w-auto"
      >
        Start a report
        <ArrowRight className="size-4" aria-hidden />
      </Button>
    </div>
  );
}

// ============================================================
// Step 1: Describe
// ============================================================

function DescribeStep({
  form,
  update,
  valid,
}: {
  form: FormState;
  update: <K extends keyof FormState>(field: K, value: FormState[K]) => void;
  valid: boolean;
}) {
  const count = form.description.trim().length;
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="description">
          What is happening?{" "}
          <span className="text-muted-foreground font-normal">
            (Eleza hali)
          </span>{" "}
          <span className="text-red-600">*</span>
        </Label>
        <Textarea
          id="description"
          value={form.description}
          onChange={(e) => update("description", e.target.value)}
          placeholder="e.g. A neighbour has been withdrawn and not eating for several days. They mentioned feeling hopeless."
          rows={6}
          maxLength={5000}
          aria-describedby="description-help description-count"
          aria-invalid={!valid && form.description.length > 0}
          className="min-h-32"
        />
        <div className="flex items-center justify-between text-xs">
          <p id="description-help" className="text-muted-foreground">
            {valid
              ? "Looks good — names and phone numbers will be scrubbed automatically."
              : "Describe the situation in at least 10 characters."}
          </p>
          <p
            id="description-count"
            className={cn(
              "tabular-nums",
              count > 5000 - 200 ? "text-amber-600" : "text-muted-foreground"
            )}
          >
            {count}/5000
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="category">
          Category{" "}
          <span className="text-muted-foreground font-normal">
            (Aina)
          </span>
        </Label>
        <Select
          value={form.category}
          onValueChange={(v) =>
            update(
              "category",
              v as (typeof REPORT_CATEGORIES)[number]
            )
          }
        >
          <SelectTrigger
            id="category"
            className="h-11 min-h-[44px] w-full"
            aria-label="Report category"
          >
            <SelectValue placeholder="Pick a category" />
          </SelectTrigger>
          <SelectContent>
            {REPORT_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

// ============================================================
// Step 2: Location
// ============================================================

function LocationStep({
  form,
  update,
  wards,
  valid,
}: {
  form: FormState;
  update: <K extends keyof FormState>(field: K, value: FormState[K]) => void;
  wards: string[];
  valid: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="county">
          County <span className="text-red-600">*</span>{" "}
          <span className="text-muted-foreground font-normal">(Kaunti)</span>
        </Label>
        <Select
          value={form.county || undefined}
          onValueChange={(v) => {
            const next = v as County;
            update("county", next);
            // Reset ward when county changes — a ward from the previous county
            // would be invalid.
            if (form.ward && !WARDS[next].includes(form.ward)) {
              update("ward", "");
            }
          }}
        >
          <SelectTrigger
            id="county"
            className="h-11 min-h-[44px] w-full"
            aria-label="County"
            aria-invalid={!valid}
          >
            <SelectValue placeholder="Select a county" />
          </SelectTrigger>
          <SelectContent>
            {COUNTIES.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="ward">
          Ward{" "}
          <span className="text-muted-foreground font-normal">
            (Wodi — optional)
          </span>
        </Label>
        <Select
          value={form.ward || "none"}
          onValueChange={(v) => update("ward", v === "none" ? "" : v)}
          disabled={!form.county}
        >
          <SelectTrigger
            id="ward"
            className="h-11 min-h-[44px] w-full"
            aria-label="Ward"
            disabled={!form.county}
          >
            <SelectValue
              placeholder={
                form.county ? "Select a ward (optional)" : "Pick a county first"
              }
            />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">(no specific ward)</SelectItem>
            {wards.map((w) => (
              <SelectItem key={w} value={w}>
                {w}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="landmark">
          Landmark{" "}
          <span className="text-muted-foreground font-normal">
            (Alama — optional)
          </span>
        </Label>
        <Input
          id="landmark"
          value={form.landmark}
          onChange={(e) => update("landmark", e.target.value)}
          placeholder="e.g. near the market, by the chief's camp"
          maxLength={500}
          className="h-11 min-h-[44px]"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="directions">
          Directions{" "}
          <span className="text-muted-foreground font-normal">
            (Maelekezo — optional)
          </span>
        </Label>
        <Textarea
          id="directions"
          value={form.directions}
          onChange={(e) => update("directions", e.target.value)}
          placeholder="e.g. Turn right at the borehole, third house on the left."
          rows={3}
          maxLength={1000}
          className="min-h-20"
        />
      </div>
    </div>
  );
}

// ============================================================
// Step 3: Contact preference
// ============================================================

function ContactStep({
  form,
  update,
  valid,
}: {
  form: FormState;
  update: <K extends keyof FormState>(field: K, value: FormState[K]) => void;
  valid: boolean;
}) {
  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="mb-2 text-sm font-medium">
          How should a CHV contact you?{" "}
          <span className="text-muted-foreground font-normal">
            (Jinsi CHV atakavyokufikia)
          </span>
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <ContactOption
            selected={form.contactMode === "anonymous"}
            onClick={() => update("contactMode", "anonymous")}
            icon={<ShieldCheck className="size-4" aria-hidden />}
            title="Anonymous"
            titleSw="Bila jina"
            desc="No name or contact stored."
          />
          <ContactOption
            selected={form.contactMode === "share"}
            onClick={() => update("contactMode", "share")}
            icon={<Phone className="size-4" aria-hidden />}
            title="Share my contact"
            titleSw="Nitokeo"
            desc="A CHV can call/message to follow up."
          />
        </div>
      </fieldset>

      {form.contactMode === "share" && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          transition={{ duration: 0.2 }}
          className="space-y-4 overflow-hidden"
        >
          <Separator />
          <div className="space-y-2">
            <Label htmlFor="reporterName">
              Your name{" "}
              <span className="text-muted-foreground font-normal">
                (Jina lako — optional)
              </span>
            </Label>
            <Input
              id="reporterName"
              value={form.reporterName}
              onChange={(e) => update("reporterName", e.target.value)}
              placeholder="e.g. Amina"
              maxLength={200}
              autoComplete="name"
              className="h-11 min-h-[44px]"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="reporterContact">
              Phone or email{" "}
              <span className="text-muted-foreground font-normal">
                (Simu au barua pepe — at least one)
              </span>
            </Label>
            <Input
              id="reporterContact"
              value={form.reporterContact}
              onChange={(e) => update("reporterContact", e.target.value)}
              placeholder="e.g. 0712 345 678 or am@example.com"
              maxLength={200}
              autoComplete="tel"
              inputMode="tel"
              aria-invalid={!valid}
            />
            <p className="text-xs text-muted-foreground">
              We store this so a CHV can reach you. Your contact will not
              appear in the public report description.
            </p>
          </div>
        </motion.div>
      )}
    </div>
  );
}

function ContactOption({
  selected,
  onClick,
  icon,
  title,
  titleSw,
  desc,
}: {
  selected: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  titleSw: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "flex min-h-[44px] cursor-pointer items-start gap-3 rounded-lg border p-3 text-left transition-colors",
        selected
          ? "border-emerald-500 bg-emerald-50 ring-2 ring-emerald-200 dark:border-emerald-700 dark:bg-emerald-950/40 dark:ring-emerald-900"
          : "border-border hover:border-emerald-300 hover:bg-emerald-50/50 dark:hover:border-emerald-800 dark:hover:bg-emerald-950/20"
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2",
          selected
            ? "border-emerald-600 bg-emerald-600 text-white dark:border-emerald-500 dark:bg-emerald-500"
            : "border-muted-foreground/40"
        )}
      >
        {selected ? (
          <CheckCircle2 className="size-3" aria-hidden />
        ) : null}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "size-4",
              selected
                ? "text-emerald-700 dark:text-emerald-300"
                : "text-muted-foreground"
            )}
          >
            {icon}
          </span>
          <span className="text-sm font-semibold text-foreground">{title}</span>
          <span className="text-xs text-muted-foreground">· {titleSw}</span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
      </div>
    </button>
  );
}

// ============================================================
// Step 4: Review
// ============================================================

function ReviewStep({
  form,
  status,
}: {
  form: FormState;
  status: SubmitStatus;
}) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold">Situation</p>
        <p className="mt-1 whitespace-pre-wrap rounded-md border border-border/60 bg-muted/30 p-3 text-sm text-foreground/90">
          {form.description.trim() || "—"}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Category: <strong>{CATEGORY_LABEL[form.category]}</strong>
        </p>
      </div>
      <Separator />
      <div>
        <p className="text-sm font-semibold">Location</p>
        <ul className="mt-1 space-y-0.5 text-sm text-muted-foreground">
          <li>
            <strong className="text-foreground">County:</strong>{" "}
            {form.county || "—"}
          </li>
          <li>
            <strong className="text-foreground">Ward:</strong>{" "}
            {form.ward || "—"}
          </li>
          {form.landmark && (
            <li>
              <strong className="text-foreground">Landmark:</strong>{" "}
              {form.landmark}
            </li>
          )}
          {form.directions && (
            <li>
              <strong className="text-foreground">Directions:</strong>{" "}
              {form.directions}
            </li>
          )}
        </ul>
      </div>
      <Separator />
      <div>
        <p className="text-sm font-semibold">Contact</p>
        {form.contactMode === "anonymous" ? (
          <p className="mt-1 text-sm text-muted-foreground">
            Submitting anonymously — no name or contact stored.
          </p>
        ) : (
          <ul className="mt-1 space-y-0.5 text-sm text-muted-foreground">
            <li>
              <strong className="text-foreground">Name:</strong>{" "}
              {form.reporterName || "—"}
            </li>
            <li>
              <strong className="text-foreground">Contact:</strong>{" "}
              {form.reporterContact || "—"}
            </li>
          </ul>
        )}
      </div>
      <Alert className="border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
        <ShieldCheck className="size-4" aria-hidden />
        <AlertTitle>De-identification at submission</AlertTitle>
        <AlertDescription className="text-emerald-700 dark:text-emerald-300">
          The server will scrub phones, emails, IDs, and kinship names from
          your description <strong>before</strong> storage. The CHV will see
          only the scrubbed text.
        </AlertDescription>
      </Alert>
      {status === "submitting" && (
        <p className="text-sm text-muted-foreground">
          <Loader2
            className="mr-1 inline size-3 animate-spin"
            aria-hidden
          />
          Submitting your report…
        </p>
      )}
    </div>
  );
}

// ============================================================
// Confirmation screen
// ============================================================

function ConfirmationScreen({
  report,
  onReset,
}: {
  report: CommunityReportDTO;
  onReset: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-emerald-50 via-background to-teal-50/40 dark:from-emerald-950/20 dark:via-background dark:to-teal-950/10">
      <Header />
      <main
        id="main"
        tabIndex={-1}
        className="flex flex-1 items-center justify-center px-4 py-8 sm:px-6 lg:px-8"
      >
        <div className="mx-auto w-full max-w-md">
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.25 }}
          >
            <Card className="border-emerald-200/70 text-center shadow-sm dark:border-emerald-900/40">
              <CardContent className="flex flex-col items-center gap-4 px-6 py-10">
                <div className="flex size-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                  <CheckCircle2 className="size-8" aria-hidden />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-foreground sm:text-2xl">
                    Report received
                  </h1>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Asante sana. Your concern has been logged. A Community
                    Health Volunteer will be assigned to follow up.
                  </p>
                </div>

                <div className="w-full rounded-lg border border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-900 dark:bg-emerald-950/20">
                  <p className="text-xs font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                    Your report code
                  </p>
                  <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-800 dark:text-emerald-200">
                    {report.reportCode}
                  </p>
                  <Separator className="my-3 bg-emerald-200/60 dark:bg-emerald-900/60" />
                  <dl className="grid grid-cols-2 gap-2 text-left text-xs">
                    <dt className="text-muted-foreground">Status</dt>
                    <dd className="text-right font-medium text-foreground">
                      {report.status}
                    </dd>
                    <dt className="text-muted-foreground">County</dt>
                    <dd className="text-right font-medium text-foreground">
                      {report.county}
                    </dd>
                    {report.ward && (
                      <>
                        <dt className="text-muted-foreground">Ward</dt>
                        <dd className="text-right font-medium text-foreground">
                          {report.ward}
                        </dd>
                      </>
                    )}
                    <dt className="text-muted-foreground">Category</dt>
                    <dd className="text-right font-medium text-foreground">
                      {CATEGORY_LABEL[
                        report.category as (typeof REPORT_CATEGORIES)[number]
                      ] ?? report.category}
                    </dd>
                  </dl>
                </div>

                <Alert
                  className="border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
                  role="alert"
                >
                  <AlertTriangle className="size-4" aria-hidden />
                  <AlertTitle className="text-red-800 dark:text-red-200">
                    In an emergency
                  </AlertTitle>
                  <AlertDescription className="text-red-700 dark:text-red-300">
                    Call <strong>Kenya Red Cross 1199</strong> or{" "}
                    <strong>Befrienders Kenya +254 722 178 177</strong> if
                    someone is in immediate danger.
                  </AlertDescription>
                </Alert>

                <div className="flex w-full flex-col gap-2 sm:flex-row">
                  <Button
                    type="button"
                    onClick={onReset}
                    className="h-11 min-h-[44px] w-full bg-emerald-600 hover:bg-emerald-700 sm:flex-1"
                  >
                    <RotateCcw className="size-4" aria-hidden />
                    Submit another
                  </Button>
                  <Button
                    asChild
                    variant="outline"
                    className="h-11 min-h-[44px] w-full sm:flex-1"
                  >
                    <Link href="/">Back to home</Link>
                  </Button>
                </div>

                <p className="text-xs text-muted-foreground">
                  Write down your report code — you can quote it when following
                  up with a CHV or supervisor.
                </p>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </main>
      <footer
        className="mt-auto border-t bg-background/80 backdrop-blur"
        role="contentinfo"
      >
        <div className="mx-auto w-full max-w-md px-4 py-4 sm:px-6 lg:px-8">
          <p className="text-center text-xs text-muted-foreground">
            Msaada · Not a diagnostic tool · Crisis: {CRISIS_LINE}
          </p>
        </div>
      </footer>
    </div>
  );
}
