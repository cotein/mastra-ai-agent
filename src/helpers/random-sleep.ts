import { sleep } from "./sleep";

/**
 * Espera una cantidad aleatoria de segundos entre un rango mínimo y máximo.
 *
 * @param min - El tiempo mínimo en segundos.
 * @param max - El tiempo máximo en segundos.
 * @returns Una Promesa que se resuelve después del tiempo aleatorio.
 */
export const randomSleep = async (min: number, max: number): Promise<void> => {
  const waitTime = Math.random() * (max - min) + min;
  await sleep(waitTime);
};
