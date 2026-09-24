// Pre-written mixed Eng/Swa/Sheng sample transcripts for the demo.
// Judges can pick one to auto-fill the observation textarea without retyping.
// Each label is a hint for what the model is expected to return — NOT shown to
// the CHV in production. The CHV only sees the dropdown label text.

export interface SampleTranscript {
  id: string;
  label: string;
  text: string;
}

export const SAMPLE_TRANSCRIPTS: SampleTranscript[] = [
  {
    id: "routine-1",
    label: "Routine — settled, sleeping & eating well",
    text:
      "Mtoto amelala vizuri usiku, anakula vizuri, anacheza na watoto wenzake. " +
      "Hanawi shule kila siku na mwalimu anasema anafanya vizuri darasani. " +
      "Hakuna dalili za wasiwasi — mzazi tu aliuliza kuhusu msaada wa shule.",
  },
  {
    id: "followup-1",
    label: "Follow-up — withdrawn, poor sleep, lost appetite",
    text:
      "Wiki mbili sasa mtoto amekuwa mteja. Hajacheza na wenzake, halali vizuri " +
      "usiku — anaamka mara kwa mara. Amepoteza hamu ya kula, amepunguza nguvu. " +
      "Mwalimu anasema anasinzia darasani. Hana ugonjwa wa mwili onekanao.",
  },
  {
    id: "referral-1",
    label: "Facility referral — hallucinations, school refusal",
    text:
      "Binti ameanza kuongea na watu wasioonekana, anaogopa mtu wa kushoto anayemfukuza. " +
      "Hawezi kulala bila taa kuwaka, anaongea na kujipiga. Mama ameshaondoka shule " +
      "mwezuima. Anakataa kuoga. Hizi zinaonekana kama dalili za kiwango kikubwa " +
      "zinazohitaji uangalizi wa kitaalam.",
  },
  {
    id: "followup-2",
    label: "Follow-up — irritability, fights, tearful",
    text:
      "Kijana amekuwa na hasira hara harawiki hii, anapigana na watoto wenzake shuleni. " +
      "Analia mara kwa mara bila sababu bayana. Hulala sana mchana. " +
      "Mzazi amefilisika na kazi, hana pesa ya chakula — kijana amezoea kusikia migogoro ya nyumbani.",
  },
  {
    id: "routine-2",
    label: "Routine — playful, engaged, caregiver supportive",
    text:
      "Kijana ako poa, anacheza mpira na marafiki, anakula vizuri. Anasoma vizuri " +
      "na mwalimu wake anampenda. Mzazi ni mwingizaji mzuri, anauliza juu ya maendeleo. " +
      "Hakuna wasiwasi wowote onekanao.",
  },
  {
    id: "crisis-1",
    label: "⚠ CRISIS — explicit self-harm statement (triggers crisis panel)",
    text:
      "Mtoto amesema ataingia river, ameshanusha blanket. " +
      "Anasema hana sababu ya kuishi tena na kwenda river leo jioni. " +
      "Mama amemkuta akikata punda na kujifungia kisu kwa nyuma ya mlango. " +
      "Hizi ni dalili za hatari ya moja kwa moja — anahitaji msaada wa dharura.",
  },
];
