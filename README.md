# Tabletop Pit Wall

A mixed-reality race "pit wall" for Meta Quest, built with the Immersive Web SDK (WebXR).
A miniature street circuit appears on your real table, an AI-simulated race of a fictional
league ("Lumen Grand Circuit") runs on it, and you follow it with your hands only:

- **Pinch a car** before the start to predict the winner; pinch any car during the race to ride onboard.
- Floating **live timing tower** with gaps, fastest lap and race events.
- **Onboard camera** picture-in-picture rendered from the car you follow.
- Prediction **points and streaks** saved between sessions.

All teams, drivers and the circuit are original and fictional.

## Develop

```bash
npm install
npm run dev      # IWSDK managed dev server + emulator
npm run build    # production build in dist/
```

Deployed automatically to GitHub Pages from `main`.
