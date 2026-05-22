import type { API } from 'homebridge';
import { OmletCoopDoorPlatform } from './platform';

export = (api: API): void => {
  api.registerPlatform('OmletSmartChickenCoop', OmletCoopDoorPlatform);
};
