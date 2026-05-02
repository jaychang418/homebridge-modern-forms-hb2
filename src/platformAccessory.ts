import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';

import { ModernFormsPlatform } from './platform';
import { ModernFormsHttpClient } from './utils/client';

const NUMBER_OF_FAN_SPEEDS = 6;

export class ModernFormsPlatformAccessory {
  private client: ModernFormsHttpClient;

  private fanService: Service;
  private lightService: Service;

  constructor(
    private readonly platform: ModernFormsPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
      this.accessory.getService(this.platform.Service.AccessoryInformation)!
        .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Modern Forms')
        .setCharacteristic(this.platform.Characteristic.Model, 'Unknown')
        .setCharacteristic(this.platform.Characteristic.SerialNumber, this.accessory.context.device.clientId);

      this.client = new ModernFormsHttpClient(this.accessory.context.device.ip);

      // FAN SERVICE

      this.fanService =
        this.accessory.getService(this.platform.Service.Fan) ??
        this.accessory.addService(this.platform.Service.Fan);

      this.fanService.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.ip);

      this.fanService.getCharacteristic(this.platform.Characteristic.On)
        .onSet(this.setFanOn.bind(this))
        .onGet(this.getFanOn.bind(this));

      this.fanService.getCharacteristic(this.platform.Characteristic.RotationSpeed)
        .onSet(this.setRotationSpeed.bind(this))
        .onGet(this.getRotationSpeed.bind(this))
        .setProps({ minStep: this.getStepWithoutGoingOver(6) });

      this.fanService.getCharacteristic(this.platform.Characteristic.RotationDirection)
        .onSet(this.setRotationDirection.bind(this))
        .onGet(this.getRotationDirection.bind(this));

      // LIGHT SERVICE

      this.lightService =
        this.accessory.getService(this.platform.Service.Lightbulb) ??
        this.accessory.addService(this.platform.Service.Lightbulb);

      this.lightService.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.ip);

      this.lightService.getCharacteristic(this.platform.Characteristic.On)
        .onSet(this.setLightOn.bind(this))
        .onGet(this.getLightOn.bind(this));

      this.lightService.getCharacteristic(this.platform.Characteristic.Brightness)
        .onGet(this.getBrightness.bind(this))
        .onSet(this.setBrightness.bind(this));
  }

  // HELPERS

  getStepWithoutGoingOver = (steps: number) => {
    return Math.floor(100 / steps * 1000) / 1000;
  }

  debug = (...args: unknown[]) => {
    this.platform.log.debug(`[${this.accessory.context.device.ip}]`, ...args);
  }

  // FAN GETTERS / SETTERS

  async getFanOn(): Promise<CharacteristicValue> {
    this.debug('Get Fan Characteristic On');
    const data = await this.client.get();
    return data.fanOn;
  }

  async setFanOn(value: CharacteristicValue): Promise<void> {
    this.debug('Set Fan Characteristic On ->', value);
    await this.client.update({ fanOn: Boolean(value) });
  }

  async getRotationSpeed(): Promise<CharacteristicValue> {
    this.debug('Get Fan Characteristic RotationSpeed');
    const data = await this.client.get();
    return data.fanSpeed * 100 / NUMBER_OF_FAN_SPEEDS;
  }

  async setRotationSpeed(value: CharacteristicValue): Promise<void> {
    this.debug('Set Fan Characteristic RotationSpeed ->', value);
    const fanSpeed = Math.round(value as number / 100 * NUMBER_OF_FAN_SPEEDS);
    await this.client.update({ fanOn: fanSpeed > 0, fanSpeed });
  }

  async getRotationDirection(): Promise<CharacteristicValue> {
    this.debug('Get Fan Characteristic RotationDirection');
    const data = await this.client.get();
    return data.fanDirection === 'forward' ? 0 : 1;
  }

  async setRotationDirection(value: CharacteristicValue): Promise<void> {
    this.debug('Set Fan Characteristic RotationDirection ->', value);
    await this.client.update({ fanDirection: value === 0 ? 'forward' : 'reverse' });
  }

  // LIGHT GETTERS / SETTERS

  async getLightOn(): Promise<CharacteristicValue> {
    this.debug('Get Light Characteristic On');
    const data = await this.client.get();
    return data.lightOn;
  }

  async setLightOn(value: CharacteristicValue): Promise<void> {
    this.debug('Set Light Characteristic On ->', value);
    await this.client.update({ lightOn: Boolean(value) });
  }

  async getBrightness(): Promise<CharacteristicValue> {
    this.debug('Get Characteristic Brightness');
    const data = await this.client.get();
    return data.lightBrightness;
  }

  async setBrightness(value: CharacteristicValue): Promise<void> {
    this.debug('Set Characteristic Brightness ->', value);
    await this.client.update({ lightOn: (value as number) > 0, lightBrightness: value as number });
  }
}
