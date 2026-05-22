import type { API } from 'homebridge';
import { OmletCoopDoorPlatform } from './platform';

export default (api: API): void => {
  api.registerPlatform('OmletCoopDoor', OmletCoopDoorPlatform);
};
