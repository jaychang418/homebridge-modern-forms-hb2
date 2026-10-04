import axios from 'axios';
import memoize from 'memoizee';

type ResponsePayload = {
    fanOn: boolean,
    fanSpeed: number,
    fanDirection: 'forward' | 'reverse',
    lightOn: boolean,
    lightBrightness: number,
    clientId: string
}

type RequestPayload = Omit<Partial<ResponsePayload>, 'clientId'>

const BATCH_TIME = Math.floor(1000 / 60);

// Give up on a fan that hasn't answered within this many milliseconds,
// so HomeKit shows "No Response" instead of waiting forever.
const REQUEST_TIMEOUT = 5000;

export class ModernFormsHttpClient {
  private nextUpdatePayloads: RequestPayload[] = []
  private nextUpdateCallbacks: Array<(promise: Promise<ResponsePayload>) => void> = []

  constructor(private ip: string) {}

  // PRIVATE

  // Send one command (or status query) to the fan and return its reply.
  private request(payload: RequestPayload & { queryDynamicShadowData?: 1 }) {
    return axios
      .post<ResponsePayload>(`http://${this.ip}/mf`, payload, { timeout: REQUEST_TIMEOUT })
      .then(res => res.data);
  }

  // PUBLIC

  // Point this client at a new address, e.g. after the fan's IP changed.
  public setIp(ip: string) {
    this.ip = ip;
  }

  public readonly get = memoize(
    () => this.request({ queryDynamicShadowData: 1 }),
    { maxAge: BATCH_TIME },
  )

  public readonly update = (payload: RequestPayload) => {
    if (this.nextUpdatePayloads.length === 0) {
      setTimeout(() => {
        const payload = this.nextUpdatePayloads.reduce<RequestPayload>((final, current) => {
          return { ...final, ...current };
        }, {});

        const callbacks = this.nextUpdateCallbacks;

        this.nextUpdatePayloads = [];
        this.nextUpdateCallbacks = [];

        const promise = this.request(payload);

        callbacks.forEach(callback => callback(promise));
      }, BATCH_TIME);
    }

    return new Promise((res, rej) => {
      this.nextUpdatePayloads.push(payload);
      this.nextUpdateCallbacks.push((promise) => {
        promise.then(res, rej);
      });
    });
  }
}