
import { dynamicInstructions } from './fausti-prompts';
import { ClientData, OperacionTipo } from '../types';

const mockData: ClientData = {
  nombre: 'Test User',
  link: 'http://example.com',
  tipoOperacion: 'ALQUILAR' as OperacionTipo,
  propiedadInfo: 'Info de prueba'
};

// Test with whitespace
const promptWithSpace = dynamicInstructions(mockData, ' ALQUILAR ' as any);
const promptClean = dynamicInstructions(mockData, 'ALQUILAR' as any);

console.log('--- TEST: " ALQUILAR " (with spaces) ---');
if (promptWithSpace.includes('PROTOCOLO OPERATIVO')) {
    console.log('PASS: Protocol found.');
} else {
    console.log('FAIL: Protocol MISSING.');
}

console.log('\n--- TEST: "ALQUILAR" (clean) ---');
if (promptClean.includes('PROTOCOLO OPERATIVO')) {
    console.log('PASS: Protocol found.');
} else {
    console.log('FAIL: Protocol MISSING.');
}
