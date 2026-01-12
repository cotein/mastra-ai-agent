/**
 * Pausa la ejecución asíncrona por una cantidad específica de segundos.
 *
 * @param seconds - El número de segundos a esperar.
 * @returns Una Promesa que se resuelve después del tiempo especificado.
 */
export const sleep = async (seconds: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
};
