import { createComponent, Types } from '@iwsdk/core';

/** A race car marker on the board; index into RaceSim.cars. */
export const CarMarker = createComponent('CarMarker', {
  index: { type: Types.Int16, default: 0 },
});

/** A pinchable 3D button; `action` names what it does, `arg` is optional data. */
export const UiButton = createComponent('UiButton', {
  action: { type: Types.String, default: '' },
  arg: { type: Types.Int16, default: 0 },
});

/** Marks the authored race board root that the race is built on. */
export const RaceBoard = createComponent('RaceBoard', {
  laps: { type: Types.Int16, default: 8, min: 1, max: 30 },
});

/** A grabbable kitchen item on the cooking bench; `kind` = base | pepper | cheese | filling. */
export const KitchenItem = createComponent('KitchenItem', {
  kind: { type: Types.String, default: '' },
});
