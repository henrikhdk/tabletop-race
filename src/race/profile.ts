/** The viewer's season: points from predictions, kept between sessions. */
export interface Profile {
  points: number;
  races: number;
  wins: number;
  streak: number;
  bestStreak: number;
}

const KEY = 'lumen-pitwall-profile-v1';

export function loadProfile(): Profile {
  const empty: Profile = { points: 0, races: 0, wins: 0, streak: 0, bestStreak: 0 };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...empty, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable: start fresh */
  }
  return empty;
}

export function saveProfile(p: Profile) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

/** your driver's finishing position scores championship-style points */
export function scorePrediction(finishPos: number, won: boolean): { points: number; text: string } {
  const points = POINTS[finishPos - 1] ?? 0;
  if (won) return { points, text: 'You called the winner!' };
  return { points, text: `Your pick finished P${finishPos}` };
}
