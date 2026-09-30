# The Problem

> *Why does this problem exist? Who experiences it? Why does it matter now? What are we trying to change?*

---

## Why a problem?

Kenya has a mental-health treatment gap of over **90%** — meaning the vast majority of people who need mental-health support never receive it. The Kenya Mental Health Policy 2015–2030 explicitly identifies community-level mental health as a critical, under-served gap.

The bottleneck is not at the facility — it's **upstream**, at the household level, where Community Health Volunteers (CHVs) are the only consistent touchpoint with the health system. CHVs walk door-to-door, visit households, and observe the real signals: a mother who's stopped sleeping, a child who's withdrawn from school, a father who's expressing hopelessness, a household buckling under financial stress.

**The problem is that these observations — the earliest, most actionable signals of community mental-health distress — are captured nowhere structured.** They stay in paper notebooks, in the CHV's memory, or are never recorded at all. By the time a signal reaches the health system, it has usually escalated to an acute incident that a facility must respond to, not a community-level intervention that could have prevented it.

This is a **detection + routing failure**, not a treatment failure. The facilities exist. The CHVs exist. The policy framework exists. What doesn't exist is the connective tissue — a tool that lets a CHV capture a natural observation, structure it safely, route it to the right workflow, and give county officials aggregate visibility into what's happening in their communities before it becomes a crisis.

## Who experiences it?

### Community Health Volunteers (CHVs)
- ~90,000+ CHVs across Kenya's 47 counties, each responsible for ~100–500 households.
- They are volunteers (not salaried), often the only health-system touchpoint for rural and informal-settlement households.
- They see the signals every day but have no structured tool — no way to record, triage, or escalate. Paper notebooks don't route. Memory doesn't aggregate.
- When they do detect something serious (e.g., suicidal ideation), there is no protocol that fires immediately — they rely on remembering a phone number or walking to a facility.

### The households
- Rural and informal-settlement (Kibra, Mathare, Mukuru) households with the least access to facility-based care are the most dependent on CHV-level detection.
- Stigma around mental health means households rarely self-refer; the CHV is often the only person who will see the signs.

### County health officials
- Have **zero visibility** into community-level mental-health signals until an acute incident (self-harm, severe breakdown) is reported by a facility.
- Cannot plan resources, deploy follow-ups, or identify geographic clusters of distress because the upstream data doesn't exist in a structured form.

### The health system
- Facilities receive late-stage acute cases that are harder and more expensive to treat, when earlier community-level intervention could have prevented escalation.

## Why does it matter now?

### The AI is finally ready
Large-language models (Qwen, specifically) can now reliably structure a natural-language observation — even in mixed English/Swahili/Sheng — into a standardized WHO-aligned triage flag. This was not possible 2–3 years ago. The CHV can speak or type naturally; the AI structures it. This removes the key UX barrier: CHVs are not clinicians and should not be forced to translate a conversation into clinical terminology.

### The safety lesson is learned
The global AI-in-healthcare discourse has produced a clear consensus: **the AI must not be the authority over the patient.** The highest-profile failures of AI in health have come from collapsing "AI interpretation" and "care decision" into a single step. The architecture that the safety community now advocates — *AI interprets, deterministic policy controls safety, authorized humans control care* — is exactly what Msaada implements. The policy engine is a separate, versioned, auditable layer that the AI cannot override.

### Kenya's policy window
The Kenya Mental Health Policy 2015–2030 and the Community Health Strategy explicitly call for community-level mental-health integration. The CHV platform (eCHIS) is being digitized. The infrastructure is being built; the missing piece is the intelligence + safety layer that turns a CHV's observation into structured, routed, trackable workflow.

### The crisis line exists — but the bridge doesn't
Kenya has the Kenya Red Cross Emergency line (1199) and Befrienders Kenya (+254 722 178 177). But a CHV in a household with an actively suicidal person needs the **protocol to fire at the point of observation** — not after the CHV walks to a facility. The non-dismissable crisis panel that surfaces the crisis line + the "do not leave the household unaccompanied" instruction at the moment of detection is the bridge that doesn't exist today.

## What are we trying to change?

### From: observations lost in notebooks
### To: observations structured, routed, and tracked end-to-end

```
BEFORE                              AFTER
──────                              ────
CHV observes                        CHV observes
    ↓                                   ↓
Writes in notebook                  Speaks/types (Eng/Swa/Sheng)
    ↓                                   ↓
Notebook stays in pocket             PII scrubbed → Qwen structures
    ↓                                   ↓
Signal never reaches system          DETERMINISTIC POLICY evaluates
    ↓                                   ↓
Acute incident at facility           Referral + Follow-up created
    ↓                                   ↓
Late, expensive, reactive            Early, community-level, trackable
```

### Specifically, we're changing four things:

1. **Capture** — from paper notebooks to natural-language voice/text (the CHV doesn't need to be a clinician; the AI structures).

2. **Safety** — from "the CHV remembers a phone number" to a deterministic policy engine that fires a non-dismissable crisis protocol at the point of observation, with the crisis line front and center.

3. **Continuity** — from "referral created = job done" to a full referral lifecycle (created → sent → acknowledged → in_progress → completed) + follow-up tracking (pending → done/missed). "Referral Created" is not "Help Received" — the system tracks the actual outcome.

4. **Intelligence** — from zero visibility to aggregate county dashboards that show community-level mental-health signals (by county, by day, by tag) while protecting individual identity (de-identified by construction — the raw observation is never persisted, the dashboard never reads indicator text).

### What we're NOT changing (and why that matters)

- We're not replacing clinicians. The AI is not a doctor.
- We're not making care decisions. The deterministic policy controls workflow; authorized humans control care.
- We're not inventing resources. Referral destinations come from an authorized config — no fake facility integrations.
- We're not storing patient data carelessly. The raw observation text is never persisted. PII is scrubbed before the model sees it. Identity is preserved through stable internal IDs (names are attributes, never primary keys).

---

**The bottom line:** Msaada is a human coordination layer for AI. The AI finds and structures the need. Deterministic policy controls safety. Authorized humans provide and verify the help. The CHV — the person closest to the need — finally has a structured tool, and the county official finally has a signal.
