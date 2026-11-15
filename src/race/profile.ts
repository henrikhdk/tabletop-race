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

/** winner exact = 25, podium = 10, top 5 = 4, else 0 */
export function scorePrediction(finishPos: number, won: boolean): { points: number; text: string } {
  if (won) return { points: 25, text: 'Called the winner!' };
  if (finishPos <= 3) return { points: 10, text: `Your pick finished P${finishPos}` };
  if (finishPos <= 5) return { points: 4, text: `Your pick finished P${finishPos}` };
  return { points: 0, text: `Your pick finished P${finishPos}` };
}
