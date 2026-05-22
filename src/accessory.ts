import type {
  PlatformAccessory,
  Service,
  CharacteristicValue,
  Logger,
} from 'homebridge';
import type { OmletCoopDoorPlatform, DeviceOverride } from './platform';
import { OmletApi, type OmletDevice, type DoorStateValue, type LightStateValue } from './omletApi';

const TRANSITION_STATES: DoorStateValue[] = [
  'opening', 'openpending', 'closing', 'closepending', 'stopping',
];

const FAST_POLL_MS = 10_000;
const LOW_BATTERY_THRESHOLD = 20;

export class OmletDoorAccessory {
  private readonly doorService: Service;
  private readonly lightService: Service | null;
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
    device: OmletDevice,
    private readonly override: DeviceOverride = { name: '' },
  ) {
    const { hap, logger, config } = platform;
    this.log = logger;
    this.api = new OmletApi(config.apiKey);
    this.normalPollMs = (config.pollInterval ?? 60) * 1000;

    // Determine light capability from the live API response.
    // Either the actions list contains on/off, or the state object includes a light sub-object.
    // hideLight in config force-suppresses the service even when a light is fitted.
    const deviceHasLight =
      device.actions.some((a) => a.actionName === 'on' || a.actionName === 'off') ||
      device.state.light !== undefined;
    const showLight = deviceHasLight && !override.hideLight;

    // ── Accessory Information ────────────────────────────────────────────────
    accessory.getService(hap.Service.AccessoryInformation)!
      .setCharacteristic(hap.Characteristic.Manufacturer, 'Omlet')
      .setCharacteristic(hap.Characteristic.Model, 'Automatic Chicken Coop Door')
      .setCharacteristic(hap.Characteristic.SerialNumber, accessory.context.deviceId);

    // ── Remove stale LockMechanism from earlier plugin versions ──────────────
    const staleLock = accessory.getService(hap.Service.LockMechanism);
    if (staleLock) {
      accessory.removeService(staleLock);
    }

    // ── Door (GarageDoorOpener) ──────────────────────────────────────────────
    this.doorService =
      accessory.getService(hap.Service.GarageDoorOpener) ??
      accessory.addService(hap.Service.GarageDoorOpener, accessory.displayName);

    this.doorService.setPrimaryService(true);

    this.doorService
      .getCharacteristic(hap.Characteristic.CurrentDoorState)
      .onGet(() => this.getCurrentDoorState());

    this.doorService
      .getCharacteristic(hap.Characteristic.TargetDoorState)
      .onGet(() => this.getTargetDoorState())
      .onSet((value) => this.setTargetDoorState(value));

    this.doorService
      .getCharacteristic(hap.Characteristic.ObstructionDetected)
      .onGet(() => this.currentDoorState === 'fault');

    // ── Light (Lightbulb) ────────────────────────────────────────────────────
    if (showLight) {
      this.lightService =
        accessory.getService(hap.Service.Lightbulb) ??
        accessory.addService(hap.Service.Lightbulb, `${accessory.displayName} Light`);

      this.lightService
        .getCharacteristic(hap.Characteristic.On)
        .onGet(() => this.currentLightOn)
        .onSet((value) => this.setLightOn(value));

      this.doorService.addLinkedService(this.lightService);
      this.log.info('[%s] light service: enabled (auto-detected)', accessory.displayName);
    } else {
      const existing = accessory.getService(hap.Service.Lightbulb);
      if (existing) {
        accessory.removeService(existing);
      }
      this.lightService = null;
      if (override.hideLight) {
        this.log.info('[%s] light service: hidden (config override)', accessory.displayName);
      } else {
        this.log.info('[%s] light service: disabled (not detected on device)', accessory.displayName);
      }
    }

    // ── Battery ──────────────────────────────────────────────────────────────
    this.batteryService =
      accessory.getService(hap.Service.Battery) ??
      accessory.addService(hap.Service.Battery, `${accessory.displayName} Battery`);

    this.batteryService
      .getCharacteristic(hap.Characteristic.BatteryLevel)
      .onGet(() => this.currentBatteryLevel);

    this.batteryService
      .getCharacteristic(hap.Characteristic.StatusLowBattery)
      .onGet(() =>
        this.currentBatteryLevel <= LOW_BATTERY_THRESHOLD
          ? hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
          : hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL,
      );

    // ChargingState is always NOT_CHARGING — the door runs on wall power or
    // replaceable batteries; it does not charge an internal pack.
    this.batteryService.setCharacteristic(
      hap.Characteristic.ChargingState,
      hap.Characteristic.ChargingState.NOT_CHARGING,
    );

    this.doorService.addLinkedService(this.batteryService);

    this.schedulePoll(0);
  }

  // ── Door helpers ───────────────────────────────────────────────────────────

  private doorStateToCurrentDoorState(state: DoorStateValue): number {
    const { Characteristic } = this.platform.hap;
    switch (state) {
      case 'open':         return Characteristic.CurrentDoorState.OPEN;
      case 'closed':       return Characteristic.CurrentDoorState.CLOSED;
      case 'opening':
      case 'openpending':  return Characteristic.CurrentDoorState.OPENING;
      case 'closing':
      case 'closepending': return Characteristic.CurrentDoorState.CLOSING;
      default:             return Characteristic.CurrentDoorState.STOPPED;
    }
  }

  private doorStateToTargetDoorState(state: DoorStateValue): number {
    const { Characteristic } = this.platform.hap;
    if (state === 'closed' || state === 'closing' || state === 'closepending') {
      return Characteristic.TargetDoorState.CLOSED;
    }
    return Characteristic.TargetDoorState.OPEN;
  }

  private getCurrentDoorState(): CharacteristicValue {
    return this.doorStateToCurrentDoorState(this.currentDoorState);
  }

  private getTargetDoorState(): CharacteristicValue {
    return this.doorStateToTargetDoorState(this.currentDoorState);
  }

  private async setTargetDoorState(value: CharacteristicValue): Promise<void> {
    const { Characteristic } = this.platform.hap;
    const deviceId: string = this.accessory.context.deviceId;
    const actionName = value === Characteristic.TargetDoorState.CLOSED ? 'close' : 'open';

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
          hap.Characteristic.CurrentDoorState,
          this.doorStateToCurrentDoorState(newDoorState),
        );
        this.doorService.updateCharacteristic(
          hap.Characteristic.TargetDoorState,
          this.doorStateToTargetDoorState(newDoorState),
        );
        this.doorService.updateCharacteristic(
          hap.Characteristic.ObstructionDetected,
          newDoorState === 'fault',
        );
      }

      // Light
      if (light && this.lightService) {
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
