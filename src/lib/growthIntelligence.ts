export type OpportunityLevel = "High Opportunity" | "Medium Opportunity" | "Low Opportunity";

export type MarketSignals = {
  studentPotential: number; // 0..1
  coachingDensity: number; // 0..1
};

export type OpportunityScoreResult = {
  score: number; // 0..100
  level: OpportunityLevel;
  reason: string;
  components: {
    lowAdoption: number; // 0..1
    studentPotential: number; // 0..1
    coachingDensity: number; // 0..1
  };
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export const normalizeGeoName = (value: string | null | undefined) =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

export const titleCase = (value: string) =>
  value
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((part) => (part ? part[0]!.toUpperCase() + part.slice(1).toLowerCase() : part))
    .join(" ");

// Lightweight market signals used until a richer data source is connected.
// Values are normalized indices (0..1) representing relative potential/density.
export const INDIA_STATE_SIGNALS: Record<string, MarketSignals> = {
  "uttar pradesh": { studentPotential: 0.95, coachingDensity: 0.75 },
  maharashtra: { studentPotential: 0.85, coachingDensity: 0.7 },
  bihar: { studentPotential: 0.9, coachingDensity: 0.55 },
  "west bengal": { studentPotential: 0.8, coachingDensity: 0.55 },
  rajasthan: { studentPotential: 0.78, coachingDensity: 0.75 },
  "madhya pradesh": { studentPotential: 0.76, coachingDensity: 0.55 },
  "tamil nadu": { studentPotential: 0.72, coachingDensity: 0.6 },
  karnataka: { studentPotential: 0.7, coachingDensity: 0.62 },
  gujarat: { studentPotential: 0.7, coachingDensity: 0.55 },
  telangana: { studentPotential: 0.64, coachingDensity: 0.62 },
  "andhra pradesh": { studentPotential: 0.64, coachingDensity: 0.55 },
  haryana: { studentPotential: 0.55, coachingDensity: 0.7 },
  punjab: { studentPotential: 0.52, coachingDensity: 0.6 },
  odisha: { studentPotential: 0.64, coachingDensity: 0.45 },
  jharkhand: { studentPotential: 0.62, coachingDensity: 0.45 },
  chhattisgarh: { studentPotential: 0.58, coachingDensity: 0.4 },
  assam: { studentPotential: 0.58, coachingDensity: 0.35 },
  kerala: { studentPotential: 0.48, coachingDensity: 0.4 },
  delhi: { studentPotential: 0.45, coachingDensity: 0.85 },
  uttarakhand: { studentPotential: 0.42, coachingDensity: 0.5 },
};

export type CitySignal = MarketSignals & {
  city: string;
  state: string;
  district?: string;
  tags: string[];
};

export const INDIA_TARGET_CITIES: CitySignal[] = [
  { city: "Varanasi", district: "Varanasi", state: "Uttar Pradesh", studentPotential: 0.78, coachingDensity: 0.55, tags: ["High student density"] },
  { city: "Lucknow", district: "Lucknow", state: "Uttar Pradesh", studentPotential: 0.82, coachingDensity: 0.7, tags: ["Large coaching hubs"] },
  { city: "Kota", district: "Kota", state: "Rajasthan", studentPotential: 0.65, coachingDensity: 0.95, tags: ["Competitive exam preparation hub"] },
  { city: "Indore", district: "Indore", state: "Madhya Pradesh", studentPotential: 0.72, coachingDensity: 0.65, tags: ["Growing student population"] },
  { city: "Kanpur", district: "Kanpur Nagar", state: "Uttar Pradesh", studentPotential: 0.74, coachingDensity: 0.55, tags: ["Large student market"] },
  { city: "Prayagraj", district: "Prayagraj", state: "Uttar Pradesh", studentPotential: 0.7, coachingDensity: 0.6, tags: ["Exam-driven demand"] },
  { city: "Patna", district: "Patna", state: "Bihar", studentPotential: 0.75, coachingDensity: 0.7, tags: ["Strong exam ecosystem"] },
  { city: "Jaipur", district: "Jaipur", state: "Rajasthan", studentPotential: 0.72, coachingDensity: 0.65, tags: ["Coaching + universities"] },
  { city: "Bhopal", district: "Bhopal", state: "Madhya Pradesh", studentPotential: 0.62, coachingDensity: 0.55, tags: ["Emerging education market"] },
  { city: "Ahmedabad", district: "Ahmedabad", state: "Gujarat", studentPotential: 0.7, coachingDensity: 0.55, tags: ["Metro expansion"] },
  { city: "Surat", district: "Surat", state: "Gujarat", studentPotential: 0.62, coachingDensity: 0.45, tags: ["Rising student base"] },
  { city: "Hyderabad", district: "Hyderabad", state: "Telangana", studentPotential: 0.7, coachingDensity: 0.7, tags: ["Tech + coaching market"] },
  { city: "Bengaluru", district: "Bengaluru Urban", state: "Karnataka", studentPotential: 0.65, coachingDensity: 0.65, tags: ["High willingness to pay"] },
  { city: "Pune", district: "Pune", state: "Maharashtra", studentPotential: 0.68, coachingDensity: 0.65, tags: ["Student city"] },
  { city: "Nagpur", district: "Nagpur", state: "Maharashtra", studentPotential: 0.6, coachingDensity: 0.55, tags: ["Central India growth"] },
  { city: "Chennai", district: "Chennai", state: "Tamil Nadu", studentPotential: 0.65, coachingDensity: 0.6, tags: ["Metro expansion"] },
  { city: "Coimbatore", district: "Coimbatore", state: "Tamil Nadu", studentPotential: 0.58, coachingDensity: 0.5, tags: ["Tier-2 education hub"] },
  { city: "Delhi", district: "New Delhi", state: "Delhi", studentPotential: 0.55, coachingDensity: 0.9, tags: ["Premium coaching clusters"] },
  { city: "Chandigarh", district: "Chandigarh", state: "Chandigarh", studentPotential: 0.45, coachingDensity: 0.55, tags: ["Regional coaching hub"] },
  { city: "Guwahati", district: "Kamrup Metropolitan", state: "Assam", studentPotential: 0.55, coachingDensity: 0.4, tags: ["North-East gateway"] },
];

const defaultSignals: MarketSignals = { studentPotential: 0.55, coachingDensity: 0.45 };

export const getStateSignals = (state: string | null | undefined): MarketSignals => {
  const key = normalizeGeoName(state);
  return INDIA_STATE_SIGNALS[key] ?? defaultSignals;
};

export const calculateOpportunityScore = ({
  librariesCount,
  signals,
  adoptionSaturation = 3,
}: {
  librariesCount: number;
  signals: MarketSignals;
  adoptionSaturation?: number;
}): OpportunityScoreResult => {
  const saturation = Math.max(1, adoptionSaturation);
  const adoptionRatio = Math.max(0, librariesCount) / (Math.max(0, librariesCount) + saturation);
  const lowAdoption = clamp01(1 - adoptionRatio);
  const studentPotential = clamp01(signals.studentPotential);
  const coachingDensity = clamp01(signals.coachingDensity);

  const score = Math.round(100 * (lowAdoption * 0.45 + studentPotential * 0.4 + coachingDensity * 0.15));
  const boundedScore = Math.max(0, Math.min(100, score));

  const level: OpportunityLevel =
    boundedScore >= 70 ? "High Opportunity" : boundedScore >= 45 ? "Medium Opportunity" : "Low Opportunity";

  const tags: string[] = [];
  if (studentPotential >= 0.75) tags.push("High student density");
  if (coachingDensity >= 0.7) tags.push("Strong coaching hubs");
  if (lowAdoption >= 0.65) tags.push("Low current adoption");
  const reason = tags.length > 0 ? tags.slice(0, 2).join(" • ") : "Balanced market signals";

  return {
    score: boundedScore,
    level,
    reason,
    components: { lowAdoption, studentPotential, coachingDensity },
  };
};

