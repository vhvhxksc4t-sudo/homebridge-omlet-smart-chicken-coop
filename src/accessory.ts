import type {
  PlatformAccessory,
  Service,
  CharacteristicValue,
  Logger,
} from 'homebridge';
import type { OmletCoopDoorPlatform } from './platform';
import { OmletApi, type DoorStateValue } from './omletApi';

const TRANSITION_STATES: DoorStateValue[] = [
  'opening', 'openpending', 'closing', 'closepending', 'stopping',
];

const FAST_POLL_MS = 10_000;

export class OmletDoorAccessory {
  private readonly service: Service;
  private readonly api: OmletApi;
  private readonly log: Logger;

  private currentDoorState: DoorStateValue = 'open';
  private pollTimer?: ReturnType<typeof setTimeout>;
  private readonly normalPollMs: number;

  constructor(
    private readonly platform: OmletCoopDoorPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    const { hap, logger, config } = platform;
    this.log = logger;
    this.api = new OmletApi(config.apiKey);
    this.normalPollMs = (config.pollInterval ?? 60) * 1000;

    accessory.getService(hap.Service.AccessoryInformation)!
      .setCharacteristic(hap.Characteristic.Manufacturer, 'Omlet')
      .setCharacteristic(hap.Characteristic.Model, 'Automatic Chicken Coop Door')
      .setCharacteristic(hap.Characteristic.SerialNumber, accessory.context.deviceId);

    this.service =
      accessory.getService(hap.Service.LockMechanism) ??
      accessory.addService(hap.Service.LockMechanism);

    this.service.setCharacteristic(hap.Characteristic.Name, accessory.displayName);

    this.service
      .getCharacteristic(hap.Characteristic.LockCurrentState)
      .onGet(() => this.getLockCurrentState());

    this.service
      .getCharacteristic(hap.Characteristic.LockTargetState)
      .onGet(() => this.getLockTargetState())
      .onSet((value) => this.setLockTargetState(value));

    this.schedulePoll(0);
  }

  private doorStateToLockCurrent(state: DoorStateValue): number {
    const { hap } = this.platform;
    switch (state) {
      case 'open':   return hap.Characteristic.LockCurrentState.UNSECURED;
      case 'closed': return hap.Characteristic.LockCurrentState.SECURED;
      case 'fault':  return hap.Characteristic.LockCurrentState.JAMMED;
      default:       return hap.Characteristic.LockCurrentState.UNKNOWN;
    }
  }

  private doorStateToLockTarget(state: DoorStateValue): number {
    const { hap } = this.platform;
    if (state === 'closed' || state === 'closing' || state === 'closepending') {
      return hap.Characteristic.LockTargetState.SECURED;
    }
    return hap.Characteristic.LockTargetState.UNSECURED;
  }

  private getLockCurrentState(): CharacteristicValue {
    return this.doorStateToLockCurrent(this.currentDoorState);
  }

  private getLockTargetState(): CharacteristicValue {
    return this.doorStateToLockTarget(this.currentDoorState);
  }

  private async setLockTargetState(value: CharacteristicValue): Promise<void> {
    const { hap } = this.platform;
    const deviceId: string = this.accessory.context.deviceId;
    const actionName = value === hap.Characteristic.LockTargetState.SECURED ? 'close' : 'open';

    this.log.info('[%s] → %s door', this.accessory.displayName, actionName);
    try {
      await this.api.performAction(deviceId, actionName);
      this.reschedulePoll(FAST_POLL_MS);
    } catch (err) {
      this.log.error('[%s] action "%s" failed: %s', this.accessory.displayName, actionName, err);
      throw err;
    }
  }

  private schedulePoll(delayMs: number): void {
    this.pollTimer = setTimeout(() => this.poll(), delayMs);
  }

  private reschedulePoll(delayMs: number): void {
    clearTimeout(this.pollTimer);
    this.schedulePoll(delayMs);
  }

  private async poll(): Promise<void> {
    const { hap } = this.platform;
    const deviceId: string = this.accessory.context.deviceId;

    try {
      const device = await this.api.getDevice(deviceId);
      const newState = device.state.door?.state ?? 'open';

      if (newState !== this.currentDoorState) {
        this.log.info(
          '[%s] door: %s → %s',
          this.accessory.displayName,
          this.currentDoorState,
          newState,
        );
        this.currentDoorState = newState;

        this.service.updateCharacteristic(
          hap.Characteristic.LockCurrentState,
          this.doorStateToLockCurrent(newState),
        );
        this.service.updateCharacteristic(
          hap.Characteristic.LockTargetState,
          this.doorStateToLockTarget(newState),
        );
      }
    } catch (err) {
      this.log.warn('[%s] poll failed: %s', this.accessory.displayName, err);
    }

    const inTransition = TRANSITION_STATES.includes(this.currentDoorState);
    this.schedulePoll(inTransition ? FAST_POLL_MS : this.normalPollMs);
  }

  destroy(): void {
    clearTimeout(this.pollTimer);
  }
}
