import type {
  PlatformAccessory,
  Service,
  CharacteristicValue,
  Logger,
} from 'homebridge';
import type { OmletCoopDoorPlatform } from './platform';
import { OmletApi, type DoorStateValue, type LightStateValue } from './omletApi';

const TRANSITION_STATES: DoorStateValue[] = [
  'opening', 'openpending', 'closing', 'closepending', 'stopping',
];

const FAST_POLL_MS = 10_000;
const LOW_BATTERY_THRESHOLD = 20;

export class OmletDoorAccessory {
  private readonly doorService: Service;
  private readonly lightService: Service;
  private readonly batteryService: Service;
  private readonly api: OmletApi;
  private readonly log: Logger;

  private currentDoorState: DoorStateValue = 'open';
  private currentLightOn = false;
  private currentBatteryLevel = 100;
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

    // ── Accessory Information ────────────────────────────────────────────────
    accessory.getService(hap.Service.AccessoryInformation)!
      .setCharacteristic(hap.Characteristic.Manufacturer, 'Omlet')
      .setCharacteristic(hap.Characteristic.Model, 'Automatic Chicken Coop Door')
      .setCharacteristic(hap.Characteristic.SerialNumber, accessory.context.deviceId);

    // ── Door (LockMechanism) ─────────────────────────────────────────────────
    this.doorService =
      accessory.getService(hap.Service.LockMechanism) ??
      accessory.addService(hap.Service.LockMechanism, `${accessory.displayName} Door`);

    this.doorService
      .getCharacteristic(hap.Characteristic.LockCurrentState)
      .onGet(() => this.getLockCurrentState());

    this.doorService
      .getCharacteristic(hap.Characteristic.LockTargetState)
      .onGet(() => this.getLockTargetState())
      .onSet((value) => this.setLockTargetState(value));

    // ── Light (Lightbulb) ────────────────────────────────────────────────────
    this.lightService =
      accessory.getService(hap.Service.Lightbulb) ??
      accessory.addService(hap.Service.Lightbulb, `${accessory.displayName} Light`);

    this.lightService
      .getCharacteristic(hap.Characteristic.On)
      .onGet(() => this.currentLightOn)
      .onSet((value) => this.setLightOn(value));

    // ── Battery ──────────────────────────────────────────────────────────────
    this.batteryService =
      accessory.getService(hap.Service.Battery) ??
      accessory.addService(hap.Service.Battery, `${accessory.displayName} Battery`);

    this.batteryService
      .getCharacteristic(hap.Characteristic.BatteryLevel)
      .onGet(() => this.currentBatteryLevel);

    this.batteryService
      .getCharacteristic(hap.Characteristic.StatusLowBattery)
      .onGet(() => this.currentBatteryLevel <= LOW_BATTERY_THRESHOLD
        ? hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
        : hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL,
      );

    // ChargingState is always NOT_CHARGING — the door runs on either wall power
    // or batteries, it does not charge an internal battery pack.
    this.batteryService.setCharacteristic(
      hap.Characteristic.ChargingState,
      hap.Characteristic.ChargingState.NOT_CHARGING,
    );

    this.schedulePoll(0);
  }

  // ── Door helpers ───────────────────────────────────────────────────────────

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

  // ── Light helpers ──────────────────────────────────────────────────────────

  private async setLightOn(value: CharacteristicValue): Promise<void> {
    const deviceId: string = this.accessory.context.deviceId;
    const actionName = value ? 'on' : 'off';

    this.log.info('[%s] → light %s', this.accessory.displayName, actionName);
    try {
      await this.api.performAction(deviceId, actionName);
      this.reschedulePoll(FAST_POLL_MS);
    } catch (err) {
      this.log.error('[%s] light action "%s" failed: %s', this.accessory.displayName, actionName, err);
      throw err;
    }
  }

  // ── Poll ───────────────────────────────────────────────────────────────────

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
      const { door, light, general } = device.state;

      // Door
      const newDoorState = door?.state ?? 'open';
      if (newDoorState !== this.currentDoorState) {
        this.log.info('[%s] door: %s → %s', this.accessory.displayName, this.currentDoorState, newDoorState);
        this.currentDoorState = newDoorState;
        this.doorService.updateCharacteristic(
          hap.Characteristic.LockCurrentState,
          this.doorStateToLockCurrent(newDoorState),
        );
        this.doorService.updateCharacteristic(
          hap.Characteristic.LockTargetState,
          this.doorStateToLockTarget(newDoorState),
        );
      }

      // Light
      if (light) {
        const newLightOn = (light.state as LightStateValue) === 'on' || light.state === 'onpending';
        if (newLightOn !== this.currentLightOn) {
          this.log.info('[%s] light: %s', this.accessory.displayName, newLightOn ? 'on' : 'off');
          this.currentLightOn = newLightOn;
          this.lightService.updateCharacteristic(hap.Characteristic.On, newLightOn);
        }
      }

      // Battery
      if (general?.batteryLevel !== undefined) {
        const newLevel = general.batteryLevel;
        if (newLevel !== this.currentBatteryLevel) {
          this.currentBatteryLevel = newLevel;
          this.batteryService.updateCharacteristic(hap.Characteristic.BatteryLevel, newLevel);
          this.batteryService.updateCharacteristic(
            hap.Characteristic.StatusLowBattery,
            newLevel <= LOW_BATTERY_THRESHOLD
              ? hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
              : hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL,
          );
          if (newLevel <= LOW_BATTERY_THRESHOLD) {
            this.log.warn('[%s] low battery: %d%%', this.accessory.displayName, newLevel);
          }
        }
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
