import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { RaceSystem } from './race/race-system.js';

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  world.registerSystem(RaceSystem);
});
