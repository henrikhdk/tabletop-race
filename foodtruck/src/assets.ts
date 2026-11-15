import { defineAssets } from '@iwsdk/core';
import { createRaceBoard } from './scene-assets/race-board.scene-asset.js';

export default defineAssets({
  'race-board': createRaceBoard(),
});
